"use client";

import * as React from "react";
import { KeyRoundIcon } from "lucide-react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import type { APIKeyMetadata, CreateAPIKeyInput } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function APIKeySettings() {
  const { t, fmt } = useI18n();
  const [keys, setKeys] = React.useState<APIKeyMetadata[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [name, setName] = React.useState("");
  const [write, setWrite] = React.useState(false);
  const [expiry, setExpiry] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  // Keep the secret separate from metadata and only in this component's memory.
  const [secret, setSecret] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [copying, setCopying] = React.useState(false);
  const [copyError, setCopyError] = React.useState(false);
  const [revokeTarget, setRevokeTarget] = React.useState<APIKeyMetadata | null>(null);
  const inFlight = React.useRef(false);
  const mounted = React.useRef(false);

  const loadKeys = React.useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await api.apiKeys();
      if (mounted.current) setKeys(result);
    } catch {
      if (mounted.current) setLoadError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    void loadKeys();
    return () => {
      mounted.current = false;
    };
  }, [loadKeys]);

  const disabled = loading || busy || !!secret || !!revokeTarget;

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || disabled) return;
    setError("");
    const label = name.trim();
    if (!label || new TextEncoder().encode(label).length > 200) {
      setError(t("settings.apiKeyInvalidName"));
      return;
    }
    const input: CreateAPIKeyInput = { name: label, scopes: write ? ["tasks:read", "tasks:write"] : ["tasks:read"] };
    if (expiry) {
      const date = new Date(expiry);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
        setError(t("settings.apiKeyInvalidExpiry"));
        return;
      }
      input.expires_at = date.toISOString();
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const { key, ...metadata } = await api.createAPIKey(input);
      if (!mounted.current) return;
      setSecret(key);
      setCopied(false);
      setCopyError(false);
      setKeys((previous) => [metadata, ...previous]);
      setName("");
      setWrite(false);
      setExpiry("");
      // Re-read metadata after the write without making secret visibility depend on it.
      await loadKeys();
    } catch {
      if (mounted.current) setError(t("settings.apiKeyCreateError"));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function revokeKey() {
    if (!revokeTarget || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api.revokeAPIKey(revokeTarget.id);
      if (!result.revoked) throw new Error("Revocation not confirmed");
      if (!mounted.current) return;
      setRevokeTarget(null);
      await loadKeys();
    } catch {
      if (mounted.current) setError(t("settings.apiKeyRevokeError"));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function copyKey() {
    if (!secret || copying) return;
    setCopying(true);
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(secret);
      if (mounted.current) setCopied(true);
    } catch {
      if (mounted.current) setCopyError(true);
    } finally {
      if (mounted.current) setCopying(false);
    }
  }

  return (
    <Card className="mb-4 break-inside-avoid md:mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRoundIcon className="size-4" />
          {t("settings.apiKeys")}
        </CardTitle>
        <CardDescription>{t("settings.apiKeyOwnerHelp")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={createKey} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="api-key-name">{t("settings.apiKeyName")}</Label>
            <Input
              id="api-key-name"
              required
              maxLength={200}
              autoComplete="off"
              value={name}
              disabled={disabled}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <fieldset disabled={disabled} className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">{t("settings.apiKeyPermissions")}</legend>
            <p className="text-muted-foreground text-sm">{t("settings.apiKeyRead")}</p>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="api-key-write" className="text-sm font-normal">
                {t("settings.apiKeyWrite")}
              </Label>
              <Switch
                id="api-key-write"
                checked={write}
                disabled={disabled}
                aria-describedby="api-key-write-warning"
                onCheckedChange={setWrite}
              />
            </div>
            <p id="api-key-write-warning" className="text-muted-foreground text-xs">
              {t("settings.apiKeyWriteWarning")}
            </p>
          </fieldset>
          <div className="flex flex-col gap-2">
            <Label htmlFor="api-key-expiry">{t("settings.apiKeyExpiry")}</Label>
            <Input
              id="api-key-expiry"
              type="datetime-local"
              value={expiry}
              disabled={disabled}
              aria-describedby="api-key-expiry-help"
              onChange={(e) => setExpiry(e.target.value)}
            />
            <p id="api-key-expiry-help" className="text-muted-foreground text-xs">
              {t("settings.apiKeyExpiryHelp")}
            </p>
          </div>
          {error && !revokeTarget && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <Button type="submit" disabled={disabled || !name.trim()}>
            {busy ? t("settings.apiKeyCreating") : t("settings.apiKeyCreate")}
          </Button>
        </form>

        {secret && (
          <section
            aria-labelledby="api-key-secret-title"
            className="bg-muted/30 flex flex-col gap-3 rounded-md border p-3"
          >
            <h3 id="api-key-secret-title" className="text-sm font-medium">
              {t("settings.apiKeySecretTitle")}
            </h3>
            <p id="api-key-secret-notice" className="text-muted-foreground text-sm">
              {t("settings.apiKeySecretNotice")}
            </p>
            <Label htmlFor="api-key-secret">{t("settings.apiKeySecret")}</Label>
            <Input
              id="api-key-secret"
              readOnly
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-xs"
              value={secret}
              aria-describedby="api-key-secret-notice"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={copying} onClick={copyKey}>
                {copied ? t("settings.apiKeyCopied") : t("settings.apiKeyCopy")}
              </Button>
              <Button
                type="button"
                disabled={copying}
                onClick={() => {
                  setSecret(null);
                  setCopied(false);
                  setCopyError(false);
                }}
              >
                {t("settings.apiKeyDismiss")}
              </Button>
            </div>
            {copyError && (
              <p role="alert" className="text-destructive text-sm">
                {t("settings.apiKeyCopyError")}
              </p>
            )}
          </section>
        )}

        <div className="flex flex-col gap-3 border-t pt-4" aria-busy={loading}>
          <Button type="button" variant="outline" disabled={loading || busy || !!revokeTarget} onClick={loadKeys}>
            {t("settings.apiKeyRefresh")}
          </Button>
          {loading ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("settings.apiKeyLoading")}
            </p>
          ) : loadError ? (
            <p role="alert" className="text-destructive text-sm">
              {t("settings.apiKeyLoadError")}
            </p>
          ) : keys.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("settings.apiKeyEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {keys.map((key) => {
                const status = key.revoked_at
                  ? "apiKeyRevoked"
                  : key.expires_at && new Date(key.expires_at).getTime() <= Date.now()
                    ? "apiKeyExpired"
                    : "apiKeyActive";
                return (
                  <li key={key.id} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 break-words font-medium">{key.name || t("settings.apiKeyUnnamed")}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">{t(`settings.${status}`)}</span>
                    </div>
                    <dl className="text-muted-foreground grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                      <dt>{t("settings.apiKeyId")}</dt>
                      <dd>{key.id}</dd>
                      <dt>{t("settings.apiKeyOwner")}</dt>
                      <dd className="break-words">{key.owner}</dd>
                      <dt>{t("settings.apiKeyPermissions")}</dt>
                      <dd className="break-words font-mono">{key.scopes.join(", ")}</dd>
                      <dt>{t("settings.apiKeyCreated")}</dt>
                      <dd>{fmt.dateTime(key.created_at)}</dd>
                      <dt>{t("settings.apiKeyExpires")}</dt>
                      <dd>{key.expires_at ? fmt.dateTime(key.expires_at) : t("settings.apiKeyNoExpiry")}</dd>
                      {key.revoked_at && (
                        <>
                          <dt>{t("settings.apiKeyRevokedAt")}</dt>
                          <dd>{fmt.dateTime(key.revoked_at)}</dd>
                        </>
                      )}
                    </dl>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={disabled || !!key.revoked_at}
                      onClick={() => {
                        setError("");
                        setRevokeTarget(key);
                      }}
                    >
                      {t("settings.apiKeyRevoke")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
      <AlertDialog
        open={!!revokeTarget}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setRevokeTarget(null);
            setError("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.apiKeyRevokeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.apiKeyRevokeConfirm", {
                name: revokeTarget?.name || t("settings.apiKeyUnnamed"),
                id: revokeTarget?.id ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setRevokeTarget(null);
                setError("");
              }}
            >
              {t("settings.apiKeyCancel")}
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={revokeKey}>
              {busy ? t("settings.apiKeyRevoking") : t("settings.apiKeyRevoke")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
