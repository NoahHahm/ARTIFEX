import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { en } from "../i18n/messages/settings.ts";

// Exercise the actual component and handlers with a small hook host. No browser,
// credentials, live backend, or extra React testing dependencies are required.
function mount(apiOverrides = {}) {
  const state = [],
    refs = [],
    effects = [],
    pending = [];
  let cursor = 0,
    tree;
  const api = { apiKeys: async () => [], ...apiOverrides };
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial;
      return [
        state[i],
        (next) => {
          state[i] = typeof next === "function" ? next(state[i]) : next;
        },
      ];
    },
    useRef(initial) {
      const i = cursor++;
      refs[i] ??= { current: initial };
      return refs[i];
    },
    useCallback(fn) {
      const i = cursor++;
      refs[i] ??= fn;
      return refs[i];
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!effects[i] || deps.some((d, n) => d !== effects[i][n])) {
        effects[i] = deps;
        pending.push(fn);
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  let source;
  try {
    source = readFileSync(new URL("../components/api-key-settings.tsx", import.meta.url), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  const module = { exports: {} };
  const clipboard = { writeText: async () => undefined };
  const context = {
    module,
    exports: module.exports,
    Date,
    TextEncoder,
    navigator: { clipboard },
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "@/lib/api") return { api };
      if (name === "@/i18n")
        return {
          useI18n: () => ({
            t: (key, params = {}) =>
              (en[key.replace("settings.", "")] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params[k])),
            fmt: { dateTime: (s) => s },
          }),
        };
      return new Proxy({}, { get: (_, key) => key });
    },
  };
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } })
      .outputText,
    context,
  );
  const Component = module.exports.APIKeySettings;
  assert.equal(typeof Component, "function");
  function render() {
    cursor = 0;
    tree = Component();
    while (pending.length) pending.shift()();
    return tree;
  }
  function nodes(node = tree) {
    if (!node || typeof node !== "object") return [];
    return [
      node,
      ...[node.props?.children]
        .flat(Infinity)
        .filter((child) => child !== undefined)
        .flatMap((child) => nodes(child)),
    ];
  }
  render();
  return {
    api,
    clipboard,
    render,
    async flush() {
      await new Promise(setImmediate);
      render();
    },
    byId: (id) => nodes().find((n) => n.props?.id === id),
    byType: (type) => nodes().find((n) => n.type === type),
    button: (text) => nodes().find((n) => n.type === "Button" && n.props.children === text),
    text: () => JSON.stringify(tree),
  };
}

test("API key settings loads metadata and defaults to read-only permissions", async () => {
  const ui = mount();
  assert.ok(ui, "Settings must provide API key management");
  assert.match(ui.text(), /Loading API keys/);
  await ui.flush();
  assert.match(ui.text(), /No API keys yet/);
  assert.equal(ui.byId("api-key-write").props.checked, false);
  assert.equal(ui.button(en.apiKeyCreate).props.disabled, true);
});

test("API helpers use JWT-authenticated management routes and metadata-only list responses", async () => {
  const requests = [],
    storage = [];
  const module = { exports: {} };
  let payload = { keys: null };
  const source = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module,
    exports: module.exports,
    window: {},
    localStorage: {
      getItem: (key) => {
        storage.push(key);
        return "test-only-owner-jwt";
      },
    },
    require(name) {
      if (name === "@/i18n/request")
        return {
          localizedFetch: async (url, init) => {
            requests.push({ url, init });
            return { ok: true, status: 200, json: async () => payload };
          },
        };
      if (name === "@/lib/mock/enabled") return { MOCK: false };
      return {};
    },
  });
  const { api } = module.exports;
  assert.equal((await api.apiKeys()).length, 0);
  assert.equal(requests[0].url, "/api/api-keys");
  assert.equal(requests[0].init.cache, "no-store");
  payload = { ...metadata, key: secret };
  const input = { name: "automation", scopes: ["tasks:read"], expires_at: "2099-01-01T00:00:00Z" };
  assert.equal((await api.createAPIKey(input)).key, secret);
  assert.equal(requests[1].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[1].init.body), input);
  payload = { revoked: true };
  assert.equal((await api.revokeAPIKey(7)).revoked, true);
  assert.equal(requests[2].url, "/api/api-keys/7");
  assert.equal(requests[2].init.method, "DELETE");
  assert.ok(requests.every((r) => r.init.headers.Authorization === "Bearer test-only-owner-jwt"));
  assert.deepEqual(storage, ["artifex_token", "artifex_token", "artifex_token"]);
});

const metadata = {
  id: 7,
  owner: "ARTIFEX",
  name: "automation",
  scopes: ["tasks:read"],
  created_at: "2030-01-01T00:00:00Z",
};
const secret = "test-only-one-time-secret";
const submit = (ui) => ui.byType("form").props.onSubmit({ preventDefault: () => undefined });
function nameKey(ui, label = " automation ") {
  ui.byId("api-key-name").props.onChange({ target: { value: label } });
  ui.render();
}

test("creation sends read-only by default, shows/copies once, and dismiss clears the secret", async () => {
  const requests = [];
  const ui = mount({
    createAPIKey: async (input) => {
      requests.push(input);
      return { ...metadata, key: secret };
    },
    apiKeys: async () => (requests.length ? [metadata] : []),
  });
  await ui.flush();
  nameKey(ui);
  await submit(ui);
  ui.render();
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ name: "automation", scopes: ["tasks:read"] }]);
  assert.equal(ui.byId("api-key-secret").props.value, secret);
  assert.match(ui.text(), /shown only once/);
  assert.equal(ui.button(en.apiKeyCreate).props.disabled, true);
  let copied;
  ui.clipboard.writeText = async (text) => {
    copied = text;
  };
  await ui.button(en.apiKeyCopy).props.onClick();
  ui.render();
  assert.equal(copied, secret);
  ui.button(en.apiKeyDismiss).props.onClick();
  ui.render();
  assert.equal(ui.byId("api-key-secret"), undefined);
  assert.equal(ui.text().includes(secret), false);
  assert.equal(ui.byId("api-key-write").props.checked, false);
});

test("write is opt-in, expiry is UTC, duplicate creation is blocked during flight", async () => {
  let resolve,
    input,
    calls = 0;
  const ui = mount({
    createAPIKey: (value) => {
      calls++;
      input = value;
      return new Promise((r) => {
        resolve = r;
      });
    },
  });
  await ui.flush();
  nameKey(ui);
  ui.byId("api-key-write").props.onCheckedChange(true);
  ui.byId("api-key-expiry").props.onChange({ target: { value: "2099-02-03T04:05" } });
  ui.render();
  const flight = submit(ui);
  ui.render();
  assert.equal(ui.byId("api-key-name").props.disabled, true);
  await submit(ui);
  assert.equal(calls, 1);
  assert.deepEqual(Array.from(input.scopes), ["tasks:read", "tasks:write"]);
  assert.equal(input.expires_at, new Date("2099-02-03T04:05").toISOString());
  resolve({ ...metadata, key: secret });
  await flight;
  ui.render();
});

test("invalid expiry and overlong UTF-8 label do not send requests", async () => {
  let calls = 0;
  const ui = mount({
    createAPIKey: async () => {
      calls++;
    },
  });
  await ui.flush();
  nameKey(ui);
  for (const expiry of ["invalid", "2000-01-01T01:00"]) {
    ui.byId("api-key-expiry").props.onChange({ target: { value: expiry } });
    ui.render();
    await submit(ui);
    ui.render();
    assert.match(ui.text(), /valid future/);
  }
  nameKey(ui, "é".repeat(101));
  await submit(ui);
  ui.render();
  assert.match(ui.text(), /200 UTF-8 bytes/);
  assert.equal(calls, 0);
});

test("list failure is not empty state; retry restores metadata with expired/revoked states", async () => {
  let fail = true;
  const ui = mount({
    apiKeys: async () => {
      if (fail) throw Error("private backend diagnostic");
      return [
        metadata,
        { ...metadata, id: 8, expires_at: "2000-01-01T00:00:00Z" },
        { ...metadata, id: 9, revoked_at: "2030-01-01T00:00:00Z" },
      ];
    },
  });
  await ui.flush();
  assert.match(ui.text(), /Could not load/);
  assert.equal(ui.text().includes(en.apiKeyEmpty), false);
  fail = false;
  await ui.button(en.apiKeyRefresh).props.onClick();
  ui.render();
  assert.match(ui.text(), /Expired/);
  assert.match(ui.text(), /Revoked/);
  assert.match(ui.text(), /ARTIFEX/);
});

test("create failure hides backend diagnostics, preserves draft, and enables retry", async () => {
  const ui = mount({
    createAPIKey: async () => {
      throw Error(secret);
    },
  });
  await ui.flush();
  nameKey(ui);
  await submit(ui);
  ui.render();
  assert.match(ui.text(), /Could not create/);
  assert.equal(ui.text().includes(secret), false);
  assert.equal(ui.byId("api-key-name").props.value, " automation ");
  assert.equal(ui.button(en.apiKeyCreate).props.disabled, false);
});

test("metadata refresh failure after creation never loses the one-time secret", async () => {
  let reads = 0;
  const ui = mount({
    apiKeys: async () => {
      if (++reads > 1) throw Error("unavailable");
      return [];
    },
    createAPIKey: async () => ({ ...metadata, key: secret }),
  });
  await ui.flush();
  nameKey(ui);
  await submit(ui);
  ui.render();
  assert.equal(ui.byId("api-key-secret").props.value, secret);
  assert.match(ui.text(), /Could not load API keys/);
  assert.equal(ui.text().includes(en.apiKeyEmpty), false);
});

test("clipboard failure retains the secret for manual copying", async () => {
  const ui = mount({ createAPIKey: async () => ({ ...metadata, key: secret }) });
  await ui.flush();
  nameKey(ui);
  await submit(ui);
  ui.render();
  ui.clipboard.writeText = async () => {
    throw Error("denied");
  };
  await ui.button(en.apiKeyCopy).props.onClick();
  ui.render();
  assert.match(ui.text(), /copy the key manually/);
  assert.equal(ui.byId("api-key-secret").props.value, secret);
});

test("revoke requires confirmation, cancel sends nothing, failed revoke stays open, success refreshes", async () => {
  let calls = 0,
    fail = true,
    reads = 0;
  const ui = mount({
    apiKeys: async () => {
      reads++;
      return [{ ...metadata, ...(calls && !fail ? { revoked_at: "2030-01-01T00:00:00Z" } : {}) }];
    },
    revokeAPIKey: async (id) => {
      calls++;
      assert.equal(id, 7);
      if (fail) throw Error(secret);
      return { revoked: true };
    },
  });
  await ui.flush();
  ui.button(en.apiKeyRevoke).props.onClick();
  ui.render();
  assert.equal(ui.byType("AlertDialog").props.open, true);
  assert.match(ui.text(), /does not stop already running tasks/);
  ui.button(en.apiKeyCancel).props.onClick();
  ui.render();
  assert.equal(calls, 0);
  ui.button(en.apiKeyRevoke).props.onClick();
  ui.render();
  // Select the confirmation's destructive button, not the list action.
  const confirm = () => ui.byType("AlertDialogFooter").props.children[1];
  await confirm().props.onClick();
  ui.render();
  assert.equal(ui.byType("AlertDialog").props.open, true);
  assert.match(ui.text(), /Could not confirm/);
  fail = false;
  await confirm().props.onClick();
  ui.render();
  assert.equal(ui.byType("AlertDialog").props.open, false);
  assert.equal(reads, 2);
  assert.equal(ui.button(en.apiKeyRevoke).props.disabled, true);
});
