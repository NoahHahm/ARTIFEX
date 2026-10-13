package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func keyTestServer(t *testing.T) *Server {
	t.Helper()
	dsn := os.Getenv("ARTIFEX_PG_DSN")
	if dsn == "" {
		t.Skip("ARTIFEX_PG_DSN required for isolated integration tests")
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost" {
		t.Skip("API key integration tests require local PostgreSQL")
	}
	admin, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("apikey_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(`CREATE DATABASE "` + name + `"`); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Exec(`DROP DATABASE "` + name + `" WITH (FORCE)`); admin.Close() })
	u.Path = "/" + name
	t.Setenv("ARTIFEX_PG_DSN", u.String())
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Fatalf("isolated postgres required: %v", err)
	}
	t.Cleanup(func() { m.Close() })
	return &Server{m: m, engine: NewEngine(m), ctx: context.Background(), jwtKey: []byte("test-only-signing-key-32-bytes-long")}
}

func keyRequest(t *testing.T, h http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestAPIKeyTaskIsolation(t *testing.T) {
	s := keyTestServer(t)
	h := s.Handler()
	jwtToken, _ := signJWT(s.jwtKey)
	keyResponse := keyRequest(t, h, "POST", "/api/api-keys", jwtToken, `{"scopes":["tasks:read","tasks:write"]}`)
	var k struct {
		Key string
		ID  int64
	}
	if err := json.Unmarshal(keyResponse.Body.Bytes(), &k); err != nil || k.Key == "" {
		t.Fatalf("key: %s", keyResponse.Body.String())
	}
	own, err := s.m.CreateTask("isolated fixture", "no scans", nil, 0, 600)
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.m.CreateTask("hidden fixture", "no scans", nil, 0, 600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.m.pg.Exec(`UPDATE tasks SET owner='someone-else' WHERE id=$1`, other.ID); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/tasks/" + own.ID, "/api/tasks/" + own.ID + "/status"} {
		w := keyRequest(t, h, "GET", path, k.Key, "")
		if w.Code != 200 {
			t.Fatalf("owned %s: %d %s", path, w.Code, w.Body.String())
		}
	}
	for _, path := range []string{"/api/tasks/" + other.ID, "/api/tasks/" + other.ID + "/status"} {
		w := keyRequest(t, h, "GET", path, k.Key, "")
		if w.Code != 404 {
			t.Fatalf("foreign %s: %d", path, w.Code)
		}
	}
	w := keyRequest(t, h, "GET", "/api/tasks", k.Key, "")
	if w.Code != 200 || strings.Contains(w.Body.String(), "hidden fixture") {
		t.Fatalf("list exposes other owner: %d %s", w.Code, w.Body.String())
	}
	for _, path := range []string{"/api/llm", "/api/tasks/" + own.ID + "/scope", "/api/stats", "/api/tasks/" + own.ID + "/coverage", "/api/tasks/categories"} {
		w = keyRequest(t, h, "GET", path, k.Key, "")
		if w.Code != 403 {
			t.Fatalf("key overreach %s: %d", path, w.Code)
		}
	}
	for _, method := range []string{"PATCH", "DELETE"} {
		w = keyRequest(t, h, method, "/api/tasks/"+own.ID, k.Key, "{}")
		if w.Code != 403 {
			t.Fatalf("key mutation: %d", w.Code)
		}
	}
	for _, path := range []string{"/api/tasks?token=" + k.Key, "/api/tasks"} {
		r := httptest.NewRequest("GET", path, nil)
		r.AddCookie(&http.Cookie{Name: "artifex_token", Value: k.Key})
		w = httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 401 {
			t.Fatalf("cookie/query key accepted: %d", w.Code)
		}
	}
	r := httptest.NewRequest("GET", "/api/tasks/"+own.ID+"/status", nil)
	r.Header.Set("X-API-Key", k.Key)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("X-API-Key: %d", w.Code)
	}
	r.Header.Del("X-API-Key")
	r.Header.Set("Authorization", k.Key)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatalf("non-Bearer authorization accepted: %d", w.Code)
	}
	r.Header.Del("Authorization")
	r.Header.Set("X-API-Key", k.Key)
	r.Header.Set("Authorization", "Bearer "+jwtToken)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatalf("mixed credentials: %d", w.Code)
	}
	w = keyRequest(t, h, "DELETE", "/api/api-keys/"+strconv.FormatInt(k.ID, 10), jwtToken, "")
	if w.Code != 200 {
		t.Fatalf("revoke: %d", w.Code)
	}
	w = keyRequest(t, h, "GET", "/api/tasks", k.Key, "")
	if w.Code != 401 {
		t.Fatalf("revoked key: %d", w.Code)
	}
	stored, err := s.m.pg.ListAPIKeys(context.Background(), "ARTIFEX")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, v := range stored {
		if v.ID == k.ID {
			found = v.RevokedAt != nil
		}
	}
	if !found {
		t.Fatal("revocation not persisted")
	}
	var hash string
	if err := s.m.pg.QueryRow(`SELECT token_hash FROM api_keys WHERE id=$1`, k.ID).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if hash == k.Key || len(hash) != 64 {
		t.Fatal("plaintext key stored")
	}
	expiredRaw := apiKeyPrefix + strings.Repeat("a", 64)
	past := time.Now().Add(-time.Hour)
	if _, err := s.m.pg.CreateAPIKey(context.Background(), apiKeyHash(expiredRaw), "ARTIFEX", "expired", []string{"tasks:read"}, &past); err != nil {
		t.Fatal(err)
	}
	w = keyRequest(t, h, "GET", "/api/tasks", expiredRaw, "")
	if w.Code != 401 {
		t.Fatalf("expired key: %d", w.Code)
	}
	if err := s.m.pg.Close(); err != nil {
		t.Fatal(err)
	}
	w = keyRequest(t, h, "GET", "/api/tasks", k.Key, "")
	if w.Code != 503 {
		t.Fatalf("storage failure: %d", w.Code)
	}
}

func TestAPIKeyCreateTaskScopes(t *testing.T) {
	s := keyTestServer(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s.ctx = ctx
	h := s.Handler()
	jwtToken, _ := signJWT(s.jwtKey)
	mint := func(scopes string) string {
		w := keyRequest(t, h, "POST", "/api/api-keys", jwtToken, `{"scopes":`+scopes+`}`)
		var k struct{ Key string }
		json.Unmarshal(w.Body.Bytes(), &k)
		if k.Key == "" {
			t.Fatalf("mint: %s", w.Body.String())
		}
		return k.Key
	}
	read := mint(`["tasks:read"]`)
	write := mint(`["tasks:write"]`)
	w := keyRequest(t, h, "POST", "/api/tasks", read, `{"description":"inert fixture"}`)
	if w.Code != 403 {
		t.Fatalf("read key created task: %d", w.Code)
	}
	w = keyRequest(t, h, "GET", "/api/tasks", write, "")
	if w.Code != 403 {
		t.Fatalf("write key read tasks: %d", w.Code)
	}
	for _, body := range []string{`{"owner":"other"}`, `{"source_task_ids":["1"]}`, `{"company_ids":[1]}`, `{"llm_profile_id":1}`, `{"intercept_rules":[]}`} {
		w = keyRequest(t, h, "POST", "/api/tasks", write, body)
		if w.Code != 400 {
			t.Fatalf("unsafe create accepted: %d %s", w.Code, w.Body.String())
		}
	}
	w = keyRequest(t, h, "POST", "/api/tasks", write, `{"name":"key fixture","description":"inert fixture","goal":"no network targets","coverage_enabled":false}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var task struct{ ID string }
	if err := json.Unmarshal(w.Body.Bytes(), &task); err != nil {
		t.Fatal(err)
	}
	owned, err := s.m.pg.TaskOwnedBy(context.Background(), task.ID, "ARTIFEX")
	if err != nil || !owned {
		t.Fatalf("owner not bound: %v %v", owned, err)
	}
	w = keyRequest(t, h, "GET", "/api/tasks/"+task.ID+"/status", read, "")
	if w.Code != 200 {
		t.Fatalf("status: %d", w.Code)
	}
}

func TestAPIKeyLocalHTTPWithCurl(t *testing.T) {
	s := keyTestServer(t)
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()
	jwtToken, _ := signJWT(s.jwtKey)
	w := keyRequest(t, s.Handler(), "POST", "/api/api-keys", jwtToken, `{"scopes":["tasks:read"]}`)
	var k struct{ Key string }
	if err := json.Unmarshal(w.Body.Bytes(), &k); err != nil || k.Key == "" {
		t.Fatal("mint failed")
	}
	task, err := s.m.CreateTask("curl fixture", "no scans", nil, 0, 600)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/tasks", "/api/tasks/" + task.ID, "/api/tasks/" + task.ID + "/status"} {
		cmd := exec.Command("curl", "--silent", "--show-error", "--fail", "--config", "-")
		cmd.Stdin = strings.NewReader("header = \"X-API-Key: " + k.Key + "\"\nurl = \"" + ts.URL + path + "\"\n")
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("curl %s: %v", path, err)
		}
		if !json.Valid(out) {
			t.Fatalf("curl returned invalid JSON for %s", path)
		}
		t.Logf("curl GET %s: 200 JSON", path)
	}
}

func TestAPIKeyJWTSubjectAndExpiry(t *testing.T) {
	s := keyTestServer(t)
	h := s.Handler()
	for _, claims := range []jwt.RegisteredClaims{
		{Subject: "other", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))},
		{Subject: "ARTIFEX"},
		{Subject: "ARTIFEX", ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Hour))},
	} {
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.jwtKey)
		if err != nil {
			t.Fatal(err)
		}
		w := keyRequest(t, h, "POST", "/api/api-keys", token, `{"scopes":["tasks:read"]}`)
		if w.Code != 401 {
			t.Fatalf("untrusted identity minted key: %d", w.Code)
		}
	}
}

func TestAPIKeyManagementLifecycle(t *testing.T) {
	s := keyTestServer(t)
	h := s.Handler()
	jwtToken, _ := signJWT(s.jwtKey)
	w := keyRequest(t, h, "POST", "/api/api-keys", jwtToken, `{"name":"integration","scopes":["tasks:read"]}`)
	if w.Code != 201 {
		t.Fatalf("create key: %d %s", w.Code, w.Body.String())
	}
	var result struct {
		Key   string `json:"key"`
		ID    int64  `json:"id"`
		Owner string `json:"owner"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Key == "" || result.ID == 0 || result.Owner != "ARTIFEX" {
		t.Fatalf("bad key metadata: %s", w.Body.String())
	}
	w = keyRequest(t, h, "GET", "/api/api-keys", jwtToken, "")
	if w.Code != 200 || strings.Contains(w.Body.String(), result.Key) || strings.Contains(w.Body.String(), "token_hash") {
		t.Fatalf("list leaked key or failed: %d %s", w.Code, w.Body.String())
	}
	for _, body := range []string{`{"owner":"other","scopes":["tasks:read"]}`, `{"scopes":["admin"]}`, `{"scopes":[]}`, `{"scopes":["tasks:read"],"expires_at":"2000-01-01T00:00:00Z"}`} {
		w = keyRequest(t, h, "POST", "/api/api-keys", jwtToken, body)
		if w.Code != 400 {
			t.Fatalf("invalid create accepted: %d %s", w.Code, w.Body.String())
		}
	}
	w = keyRequest(t, h, "GET", "/api/api-keys", result.Key, "")
	if w.Code != 403 {
		t.Fatalf("key management by key: %d", w.Code)
	}
	w = keyRequest(t, h, "POST", "/api/api-keys", "", `{"scopes":["tasks:read"]}`)
	if w.Code != 401 {
		t.Fatalf("anonymous management: %d", w.Code)
	}
}
