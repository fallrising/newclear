# spring-pool — Software Design Document (v1)

Status: lead-reviewed implementation contract; deployment remains gated on account configuration. Machine-readable API contract: [`contracts/openapi.json`](../contracts/openapi.json). When this document and the contract disagree, the implementer must stop and report the discrepancy rather than guess.

## 1. Scope

### 1.1 In scope

- Single owner, single workspace.
- **Scripts**: UTF-8 text (pasted or uploaded file, max 64 KiB = 65 536 bytes), language label `bash` | `python` | `powershell`, title, description, tags. Create, read, list, search by title and tag, edit, archive.
- **Immutable revisions**: every successful save of a script or runbook appends a new revision. Optimistic concurrency: stale writes return `409`.
- **Runbooks**: versioned, 1–30 ordered steps. Each step pins an existing `(script_id, script_revision)` and has a plain-text instruction. Pinned revisions stay readable after the script is archived.
- **Markdown export** of a runbook revision that embeds pinned script text safely, including text that contains backticks.
- **Audit** of actor/time/action/entity/revision only. Bodies, titles, and instructions are never written to the audit log.
- **Retention**: all revisions and audit events are retained. Cleanup requires a future explicitly approved scope; this MVP has no deletion endpoint.

### 1.2 Out of scope (must not be built)

Script execution or runners, SSH, scheduling, secret storage, Git sync, teams or roles, unarchive, hard delete of scripts or runbooks, history or audit-log cleanup, full-text search of bodies, OpenAPI runtime libraries, React, web fonts, images, third-party services beyond Cloudflare Workers, D1, and Access.

## 2. Architecture

```
Browser ──HTTPS──▶ Cloudflare Access (owner allowlist)
                     │ Cf-Access-Jwt-Assertion
                     ▼
               spring-pool-web  (Hono + hono/jsx SSR, TypeScript)
                     │ service binding `API` (no public route)
                     │ X-Spring-Pool-Actor: <verified email>
                     ▼
               spring-pool-api  (Rust, workers-rs → Wasm)
                     │ D1 binding `DB`
                     ▼
               D1 database `spring-pool` (dedicated)
```

| Component | Runtime deps allowed | Public route | Bindings |
|---|---|---|---|
| `web/` | `hono` only (includes `hono/jsx`) | staging workers.dev hostname, behind Access | `API` (service → `spring-pool-api`) |
| `api/` | `worker`, `serde`, `serde_json` (+ required Wasm transitives) | **none** (`workers_dev = false`, `preview_urls = false`, no `routes`) | `DB` (D1) |

- Only the API binds D1. The web worker has no D1 binding.
- The web worker holds no deployment token. The Cloudflare API token is operator-only and is never a Worker var, secret, or test fixture.
- Repository layout: `web/` (Hono worker), `api/` (Rust crate), `api/migrations/` (D1 SQL), `tests/integration/` (Node `node:test` against local workerd), `e2e/` (Playwright). Dev-only tooling (wrangler, TypeScript, Playwright, worker-build) is allowed. Any other runtime library needs lead approval.
- Free-tier friendly: no KV, Durable Objects, Queues, Cron, R2, or paid features. Keep the Wasm bundle under 3 MiB compressed (use `wasm-opt`/release profile `opt-level = "z"`, `lto = true`).

## 3. Authentication and trust boundaries

### 3.1 Web worker (edge of trust)

Every request, including `/healthz` and `/assets/*`, runs the auth middleware first:

1. **Config check (fail closed).** `AUTH_MODE` must be `access` or `local`.
   - `access` requires non-empty `ACCESS_TEAM_DOMAIN` (e.g. `example.cloudflareaccess.com`), `ACCESS_AUD`, `OWNER_EMAIL`.
   - `local` requires `ENVIRONMENT == "local"`, non-empty `LOCAL_OWNER_EMAIL`, and a request URL hostname of `localhost`, `127.0.0.1`, or `[::1]`.
   - Any missing, empty, or unknown value returns `503` with the plain page "Authentication is not configured." No API call is made.
2. **`access` mode.** Read only the `Cf-Access-Jwt-Assertion` request header. Ignore the `CF_Authorization` cookie and any client-supplied identity header.
   - Parse the JWT. The header must have `alg == "RS256"` and a `kid`.
   - Fetch the JWKS from `https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`. Cache it in isolate memory for 10 minutes. On an unknown `kid`, refetch once.
   - Verify the signature with Web Crypto (`RSASSA-PKCS1-v1_5`, `SHA-256`).
   - Required claims: `aud` contains `ACCESS_AUD`; `iss == "https://" + ACCESS_TEAM_DOMAIN`; `exp > now`; `nbf <= now + 60 s` when present; `email`, compared case-insensitively, equals `OWNER_EMAIL`.
   - Missing or invalid token → `401` "Not authenticated." Valid token for a different email → `403` "Not authorized." JWKS fetch failure → `503`. None of these responses echo token contents.
3. **`local` mode.** Actor = `LOCAL_OWNER_EMAIL`. Every page shows the banner "LOCAL AUTH MODE".
4. The resulting **actor** is the lowercased email. It is stored in the request context and is the only value ever sent to the API as `X-Spring-Pool-Actor`.

**Local auth cannot be enabled in staging, by construction:**

- `web/wrangler.jsonc` top-level (local) vars set `ENVIRONMENT = "local"`, `AUTH_MODE = "local"`. `env.staging.vars` sets `ENVIRONMENT = "staging"`, `AUTH_MODE = "access"`, plus the Access values. `LOCAL_OWNER_EMAIL` exists only in `.dev.vars` (git-ignored; `.dev.vars.example` is committed).
- Even if `AUTH_MODE=local` were injected in staging, the `ENVIRONMENT` and loopback-hostname checks reject it.
- The config test (§10, T-AUTH-4) parses `web/wrangler.jsonc` and fails if `env.staging` enables `local`; deployment preflight additionally requires non-empty Access vars.

### 3.2 API worker (internal only)

- The API is reachable only through the web worker's service binding. It has no route, no `workers.dev`, and no preview URL. The web worker calls it with absolute URLs on the placeholder host `https://api.internal`, e.g. `https://api.internal/v1/scripts`.
- The web worker **never proxies arbitrary paths**. Each web handler calls one fixed API route and builds a fresh `Request`: only `Content-Type`, `Accept`, and `X-Spring-Pool-Actor` are set, and no browser headers are forwarded.
- Every API route except `GET /v1/health` requires `X-Spring-Pool-Actor`: 3–254 chars, contains `@`, no control characters. Missing or invalid → `401 unauthenticated`. The API trusts this header only because it cannot be reached publicly. §10 T-BOUND-* verifies the boundary.

### 3.3 CSRF (web)

All state-changing web routes are `POST` and must pass **both** checks, otherwise `403` with the page "Request rejected (CSRF)." and no API call:

1. The `Origin` header is present and equals the request URL origin. A missing Origin is rejected.
2. Double-submit token: middleware ensures a cookie `__Host-sp_csrf` (32 random bytes, base64url; `Secure; HttpOnly; SameSite=Strict; Path=/`). In `local` mode over http, the name is `sp_csrf` without `Secure`. Every form includes a hidden field `csrf` with the same value, and the handler compares them in constant time.

### 3.4 XSS and response headers (web)

- All HTML is produced by `hono/jsx`, which escapes by default. `dangerouslySetInnerHTML` / `raw()` is forbidden except for the static, constant asset tags in the layout. Script bodies render as escaped text in `<pre><code>`.
- Headers on every web response:
  - `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Cache-Control: no-store`
- Assets `/assets/app.css` and `/assets/app.js` are served by the web worker from bundled strings. No inline scripts or styles, no external origins.
- The Markdown export is served as `text/markdown; charset=utf-8` with `Content-Disposition: attachment` so it is never rendered as HTML.

## 4. Data model (D1 / SQLite)

Migration file: `api/migrations/0001_init.sql`. D1 enforces foreign keys by default. Timestamps are ISO-8601 UTC with milliseconds, e.g. `2026-09-30T12:34:56.789Z`, generated by the API. IDs are `INTEGER` with `AUTOINCREMENT`, so IDs are never reused.

```sql
CREATE TABLE scripts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  archived_at      TEXT,
  archived_by      TEXT,
  CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);

CREATE TABLE script_revisions (
  script_id   INTEGER NOT NULL REFERENCES scripts(id),
  revision    INTEGER NOT NULL CHECK (revision >= 1),
  title       TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT    NOT NULL CHECK (length(description) <= 2000),
  tags_json   TEXT    NOT NULL,              -- JSON array, e.g. ["ops","db"]
  tag_index   TEXT    NOT NULL,              -- ",ops,db," (or "," when no tags) for exact-tag LIKE
  language    TEXT    NOT NULL CHECK (language IN ('bash','python','powershell')),
  body        TEXT    NOT NULL CHECK (length(CAST(body AS BLOB)) BETWEEN 1 AND 65536),
  created_at  TEXT    NOT NULL,
  created_by  TEXT    NOT NULL,
  PRIMARY KEY (script_id, revision)
);

CREATE TABLE runbooks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  current_revision INTEGER NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  archived_at      TEXT,
  archived_by      TEXT,
  CHECK ((archived_at IS NULL) = (archived_by IS NULL))
);

CREATE TABLE runbook_revisions (
  runbook_id  INTEGER NOT NULL REFERENCES runbooks(id),
  revision    INTEGER NOT NULL CHECK (revision >= 1),
  title       TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description TEXT    NOT NULL CHECK (length(description) <= 2000),
  step_count  INTEGER NOT NULL CHECK (step_count BETWEEN 1 AND 30),
  created_at  TEXT    NOT NULL,
  created_by  TEXT    NOT NULL,
  PRIMARY KEY (runbook_id, revision)
);

CREATE TABLE runbook_steps (
  runbook_id      INTEGER NOT NULL,
  revision        INTEGER NOT NULL,
  position        INTEGER NOT NULL CHECK (position BETWEEN 1 AND 30),
  script_id       INTEGER NOT NULL,
  script_revision INTEGER NOT NULL,
  instruction     TEXT    NOT NULL CHECK (length(instruction) BETWEEN 1 AND 2000),
  PRIMARY KEY (runbook_id, revision, position),
  FOREIGN KEY (runbook_id, revision) REFERENCES runbook_revisions(runbook_id, revision),
  FOREIGN KEY (script_id, script_revision) REFERENCES script_revisions(script_id, revision)
);
CREATE INDEX runbook_steps_pin ON runbook_steps(script_id, script_revision);

CREATE TABLE audit_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT    NOT NULL,
  actor       TEXT    NOT NULL,
  action      TEXT    NOT NULL CHECK (action IN (
                'script.create','script.update','script.archive',
                'runbook.create','runbook.update','runbook.archive')),
  entity_type TEXT    NOT NULL CHECK (entity_type IN ('script','runbook')),
  entity_id   INTEGER NOT NULL,
  revision    INTEGER NOT NULL
);
```

### 4.1 Integrity triggers (same migration)

Error messages use the prefix `sp:`. The API maps them to HTTP errors (§5.4).

```sql
-- Scripts: no hard delete, no unarchive, revision never decreases.
CREATE TRIGGER scripts_no_delete BEFORE DELETE ON scripts
BEGIN SELECT RAISE(ABORT, 'sp:no_hard_delete'); END;
CREATE TRIGGER scripts_guard_update BEFORE UPDATE ON scripts
BEGIN
  SELECT RAISE(ABORT, 'sp:no_unarchive') WHERE OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL;
  SELECT RAISE(ABORT, 'sp:revision_regress') WHERE NEW.current_revision < OLD.current_revision;
END;
CREATE TRIGGER scripts_audit_archive AFTER UPDATE OF archived_at ON scripts
WHEN OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
BEGIN
  INSERT INTO audit_events (occurred_at, actor, action, entity_type, entity_id, revision)
  VALUES (NEW.archived_at, NEW.archived_by, 'script.archive', 'script', NEW.id, NEW.current_revision);
END;

-- Script revisions: append-only, head must advance by exactly 1, audit is automatic.
CREATE TRIGGER script_revisions_guard_insert BEFORE INSERT ON script_revisions
BEGIN
  SELECT RAISE(ABORT, 'sp:not_found')         WHERE NOT EXISTS (SELECT 1 FROM scripts WHERE id = NEW.script_id);
  SELECT RAISE(ABORT, 'sp:archived')          WHERE EXISTS (SELECT 1 FROM scripts WHERE id = NEW.script_id AND archived_at IS NOT NULL);
  SELECT RAISE(ABORT, 'sp:revision_conflict') WHERE NEW.revision <> (SELECT current_revision + 1 FROM scripts WHERE id = NEW.script_id);
END;
CREATE TRIGGER script_revisions_advance AFTER INSERT ON script_revisions
BEGIN
  UPDATE scripts SET current_revision = NEW.revision, updated_at = NEW.created_at WHERE id = NEW.script_id;
  INSERT INTO audit_events (occurred_at, actor, action, entity_type, entity_id, revision)
  VALUES (NEW.created_at, NEW.created_by,
          CASE WHEN NEW.revision = 1 THEN 'script.create' ELSE 'script.update' END,
          'script', NEW.script_id, NEW.revision);
END;
CREATE TRIGGER script_revisions_immutable BEFORE UPDATE ON script_revisions
BEGIN SELECT RAISE(ABORT, 'sp:immutable_revision'); END;
CREATE TRIGGER script_revisions_no_delete BEFORE DELETE ON script_revisions
BEGIN SELECT RAISE(ABORT, 'sp:immutable_revision'); END;

-- Runbooks: identical pattern.
CREATE TRIGGER runbooks_no_delete BEFORE DELETE ON runbooks
BEGIN SELECT RAISE(ABORT, 'sp:no_hard_delete'); END;
CREATE TRIGGER runbooks_guard_update BEFORE UPDATE ON runbooks
BEGIN
  SELECT RAISE(ABORT, 'sp:no_unarchive') WHERE OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL;
  SELECT RAISE(ABORT, 'sp:revision_regress') WHERE NEW.current_revision < OLD.current_revision;
END;
CREATE TRIGGER runbooks_audit_archive AFTER UPDATE OF archived_at ON runbooks
WHEN OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
BEGIN
  INSERT INTO audit_events (occurred_at, actor, action, entity_type, entity_id, revision)
  VALUES (NEW.archived_at, NEW.archived_by, 'runbook.archive', 'runbook', NEW.id, NEW.current_revision);
END;
CREATE TRIGGER runbook_revisions_guard_insert BEFORE INSERT ON runbook_revisions
BEGIN
  SELECT RAISE(ABORT, 'sp:not_found')         WHERE NOT EXISTS (SELECT 1 FROM runbooks WHERE id = NEW.runbook_id);
  SELECT RAISE(ABORT, 'sp:archived')          WHERE EXISTS (SELECT 1 FROM runbooks WHERE id = NEW.runbook_id AND archived_at IS NOT NULL);
  SELECT RAISE(ABORT, 'sp:revision_conflict') WHERE NEW.revision <> (SELECT current_revision + 1 FROM runbooks WHERE id = NEW.runbook_id);
END;
CREATE TRIGGER runbook_revisions_advance AFTER INSERT ON runbook_revisions
BEGIN
  UPDATE runbooks SET current_revision = NEW.revision, updated_at = NEW.created_at WHERE id = NEW.runbook_id;
  INSERT INTO audit_events (occurred_at, actor, action, entity_type, entity_id, revision)
  VALUES (NEW.created_at, NEW.created_by,
          CASE WHEN NEW.revision = 1 THEN 'runbook.create' ELSE 'runbook.update' END,
          'runbook', NEW.runbook_id, NEW.revision);
END;
CREATE TRIGGER runbook_revisions_immutable BEFORE UPDATE ON runbook_revisions
BEGIN SELECT RAISE(ABORT, 'sp:immutable_revision'); END;
CREATE TRIGGER runbook_revisions_no_delete BEFORE DELETE ON runbook_revisions
BEGIN SELECT RAISE(ABORT, 'sp:immutable_revision'); END;

-- Steps: only for the head revision, never beyond step_count, never updated.
CREATE TRIGGER runbook_steps_guard_insert BEFORE INSERT ON runbook_steps
BEGIN
  SELECT RAISE(ABORT, 'sp:immutable_revision')
    WHERE NEW.revision <> (SELECT current_revision FROM runbooks WHERE id = NEW.runbook_id);
  SELECT RAISE(ABORT, 'sp:step_out_of_range')
    WHERE NEW.position > (SELECT step_count FROM runbook_revisions WHERE runbook_id = NEW.runbook_id AND revision = NEW.revision);
END;
CREATE TRIGGER runbook_steps_immutable BEFORE UPDATE ON runbook_steps
BEGIN SELECT RAISE(ABORT, 'sp:immutable_revision'); END;

CREATE TRIGGER runbook_steps_no_delete BEFORE DELETE ON runbook_steps
BEGIN SELECT RAISE(ABORT, 'sp:immutable_revision'); END;

-- Audit: append-only in v1 (no cleanup endpoint).
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'sp:audit_immutable'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'sp:audit_immutable'); END;
```

### 4.2 Write operations (no SQL `BEGIN`)

A D1 `batch()` runs as one implicit transaction: if any statement fails, the whole batch rolls back. Single statements are atomic on their own. Triggers run inside the statement that fires them. **Never issue `BEGIN`/`COMMIT`.** All values are bound parameters (`?N`); SQL is never built by string concatenation.

| Operation | Statements |
|---|---|
| Create script | `batch([ INSERT INTO scripts(created_at,updated_at) VALUES(?now,?now); INSERT INTO script_revisions(script_id,revision,…) VALUES((SELECT max(id) FROM scripts),1,…); SELECT max(id) AS id FROM scripts ])`. Within the serialized batch, `max(id)` is the new row, because AUTOINCREMENT guarantees a new maximum. |
| Update script | One statement: `INSERT INTO script_revisions(script_id,revision,…) VALUES(?id, ?expected_revision+1, …)`. The triggers enforce the head, advance it, and write the audit event. |
| Archive script | `UPDATE scripts SET archived_at=?now, archived_by=?actor WHERE id=?id AND current_revision=?expected AND archived_at IS NULL`. If `meta.changes == 0`, read the row and classify (§5.4). The trigger writes the audit event. |
| Create runbook | `batch([ INSERT INTO runbooks …; INSERT INTO runbook_revisions VALUES((SELECT max(id) FROM runbooks),1,…,?step_count); INSERT INTO runbook_steps VALUES((SELECT max(id) FROM runbooks),1,?pos,…) ×N; SELECT max(id) AS id FROM runbooks ])` |
| Update runbook | `batch([ INSERT INTO runbook_revisions VALUES(?id,?expected+1,…,?step_count); INSERT INTO runbook_steps VALUES(?id,?expected+1,?pos,…) ×N ])` |
| Archive runbook | Same as archive script, on `runbooks`. |

Under concurrency, two updates with the same `expected_revision` both try to insert revision `N+1`. D1 serializes writes, so the second one fails the trigger (`sp:revision_conflict`) or the primary key, and is reported as `409`. Exactly one revision and one audit row are written.

Runbook pin existence is validated in one bound `json_each` query before the atomic batch. This keeps a maximum-size runbook write below the Free plan's 50 D1-query limit per invocation. The title-search implementation also avoids the 50-byte LIKE-pattern limit while preserving literal ASCII-insensitive matching. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## 5. HTTP API (API worker)

Base path `/v1`. JSON in and out: `Content-Type: application/json; charset=utf-8`, except the export route. There is no CORS, because the API has no browser caller.

### 5.1 Common rules

- **Path IDs** (`{script_id}`, `{runbook_id}`, `{revision}`) must match `^[1-9][0-9]{0,15}$`. Anything else → `404 not_found`, or `revision_not_found` for `{revision}`.
- **Request body limit:** 524 288 bytes (checked with `Content-Length` and while reading). Exceeded → `413 request_too_large`.
- **Parsing:** strict serde with `deny_unknown_fields`. Malformed JSON, wrong JSON types, missing required fields, or unknown fields → `400 invalid_request`.
- **Semantic validation** → `422 validation_failed`, with `details[]` listing every failing field (`field` uses JSON-path-like syntax, e.g. `steps[2].instruction`, 0-based).
- **Check order:** 401 → 404 (path shape) → 413 → 400 → 422 → 404 (existence) → 409.
- **Unknown path** → `404 not_found`. **Known path, wrong method** → `405 method_not_allowed` with an `Allow` header.
- **Unexpected error** → `500 internal_error`. The message is generic; details go only to `console.error`, and never include bodies or actor emails.

### 5.2 Field rules

| Field | Rule |
|---|---|
| `title` | Trimmed by the API. After trimming: 1–200 Unicode scalar values (empty → `too_short`), no control chars (U+0000–U+001F, U+007F). |
| `description` | Optional, default `""`. Trimmed; ≤ 2000 scalar values. `\n` and `\t` allowed; other control chars rejected. |
| `tags` | Optional, default `[]`. ≤ 10 items, each matching `^[a-z0-9][a-z0-9-]{0,31}$`, unique (`duplicate`). Order preserved. |
| `language` | `bash` \| `python` \| `powershell`. |
| `body` | 1–65 536 **UTF-8 bytes**, no U+0000. Stored byte-for-byte; no trimming or newline normalization by the API. Over the limit → `413 script_too_large` (details `field: "body"`). |
| `expected_revision` | Integer ≥ 1. |
| `steps` | 1–30 items (`too_few_items` / `too_many_items`). |
| `steps[i].script_id`, `script_revision` | Integers ≥ 1. The pinned revision must exist → otherwise issue `not_found` on `steps[i].script_revision`. Pinning a revision of an **archived** script is allowed; responses flag it with `script_archived: true`. |
| `steps[i].instruction` | Plain text, trimmed, 1–2000 scalar values; `\n` and `\t` allowed. |
| Query `limit` | 1–100, default 50. Query `before_id` / `before_revision`: positive integer. Query `archived`: `exclude` (default) \| `include` \| `only`. Query `q`: 1–200 chars. Query `tag`: tag format. Any invalid query → `400 invalid_request`. |

Validation issue codes: `required`, `too_short`, `too_long`, `invalid_format`, `invalid_value`, `duplicate`, `too_few_items`, `too_many_items`, `not_found`.

### 5.3 Routes

All routes except health require `X-Spring-Pool-Actor`. Schemas are named as in `contracts/openapi.json`.

| Method & path | Request | Success | Errors |
|---|---|---|---|
| `GET /v1/health` | — | `200 Health` | `503 Health` (`status: "degraded"`, `database: "error"`) |
| `GET /v1/scripts?q&tag&archived&limit&before_id` | — | `200 ScriptList` (ordered `id DESC`) | 400, 401 |
| `POST /v1/scripts` | `ScriptCreate` | `201 Script`, `Location: /v1/scripts/{id}` | 400, 401, 413, 422 |
| `GET /v1/scripts/{script_id}` | — | `200 Script` (head; works when archived) | 401, 404 |
| `PUT /v1/scripts/{script_id}` | `ScriptUpdate` | `200 Script` (new revision) | 400, 401, 404, 409 `revision_conflict`/`archived`, 413, 422 |
| `POST /v1/scripts/{script_id}/archive` | `ArchiveRequest` | `200 Script` (`archived_at` set; revision unchanged) | 400, 401, 404, 409 `revision_conflict`/`archived`, 422 |
| `GET /v1/scripts/{script_id}/revisions?limit&before_revision` | — | `200 ScriptRevisionList` (ordered `revision DESC`) | 400, 401, 404 |
| `GET /v1/scripts/{script_id}/revisions/{revision}` | — | `200 ScriptRevision` (readable regardless of archive) | 401, 404 `not_found`/`revision_not_found` |
| `GET /v1/runbooks?q&archived&limit&before_id` | — | `200 RunbookList` | 400, 401 |
| `POST /v1/runbooks` | `RunbookCreate` | `201 Runbook`, `Location` | 400, 401, 413, 422 |
| `GET /v1/runbooks/{runbook_id}` | — | `200 Runbook` | 401, 404 |
| `PUT /v1/runbooks/{runbook_id}` | `RunbookUpdate` | `200 Runbook` | 400, 401, 404, 409, 413, 422 |
| `POST /v1/runbooks/{runbook_id}/archive` | `ArchiveRequest` | `200 Runbook` | 400, 401, 404, 409, 422 |
| `GET /v1/runbooks/{runbook_id}/revisions?limit&before_revision` | — | `200 RunbookRevisionList` | 400, 401, 404 |
| `GET /v1/runbooks/{runbook_id}/revisions/{revision}` | — | `200 RunbookRevision` | 401, 404 |
| `GET /v1/runbooks/{runbook_id}/revisions/{revision}/export` | — | `200 text/markdown; charset=utf-8` + `Content-Disposition: attachment; filename="runbook-{id}-r{revision}.md"` | 401, 404 |
| `GET /v1/audit?limit&before_id` | — | `200 AuditList` (ordered `id DESC`) | 400, 401 |

Search semantics:

- `q` is a case-insensitive (ASCII), literal substring match on the **head** revision title using `instr(lower(title), lower(?)) > 0`. The bound query stays literal, including `%`, `_` and backslash. This supports the agreed 200-scalar query limit without exceeding D1's 50-byte LIKE-pattern limit.
- `tag` is an exact match via `tag_index LIKE '%,'||?||',%'`.
- Both filters combine with AND.
- Pagination: the API fetches `limit+1` rows. `next_before_id` / `next_before_revision` is the last returned item's id or revision when more rows exist; otherwise `null`.

### 5.4 Error envelope and mapping

```json
{ "error": { "code": "revision_conflict", "message": "Script 7 is at revision 4; you sent expected_revision 3.", "current_revision": 4, "details": [] } }
```

`current_revision` is present only on `409`. `details` is present (possibly empty) on `422`/`413` and optional otherwise.

| Code | HTTP | When |
|---|---|---|
| `invalid_request` | 400 | Malformed JSON, type errors, unknown fields, bad query |
| `unauthenticated` | 401 | Missing or invalid `X-Spring-Pool-Actor` |
| `not_found` | 404 | Unknown path, bad id, missing script/runbook |
| `revision_not_found` | 404 | Entity exists, revision does not exist |
| `method_not_allowed` | 405 | Wrong method |
| `revision_conflict` | 409 | `expected_revision` ≠ head (trigger `sp:revision_conflict`, PK violation on revision insert, or archive `changes == 0` with head ≠ expected) |
| `archived` | 409 | Update/archive of an archived entity (trigger `sp:archived` or archive `changes == 0` with `archived_at` set) |
| `request_too_large` | 413 | Raw body > 524 288 bytes |
| `script_too_large` | 413 | `body` > 65 536 UTF-8 bytes |
| `validation_failed` | 422 | Field rules, including missing pins. A foreign-key failure during a runbook write is re-validated and reported as `not_found` on the step. |
| `internal_error` | 500 | Anything else |

On a `409`, the API re-reads the head to fill `current_revision`.

### 5.5 Markdown export format

The goal is deterministic output with no possible fence breakout:

````text
# {esc(title)}

{esc(description)}                       ← omitted when empty

_Runbook {id}, revision {revision}, saved {revision_created_at}_

## Step {n}: {esc(script_title)}

_Script {script_id}, revision {script_revision}, {language}{", archived" if archived}_

{esc(instruction)}

{F}{language}
{body}{"\n" if body does not end with "\n"}
{F}
````

- `F` is a backtick fence of length `max(3, L + 1)`, where `L` is the longest run of consecutive `` ` `` characters anywhere in `body`. The body is emitted verbatim and never escaped.
- `esc(s)` handles plain text line by line:
  - Strip leading spaces/tabs.
  - Prefix every ASCII punctuation character (`!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~`) with `\`.
  - Join lines with `"  \n"` (hard break), keeping blank lines as paragraph breaks.

  This neutralises headings, lists, HTML, links, emphasis, and fences in user text.
- Line endings are `\n` everywhere. The output ends with exactly one `\n`.
- Pure function in the Rust crate (`export::render`); unit-tested natively.

### 5.6 Health

`GET /v1/health` runs `SELECT 1` and returns `{"status":"ok","service":"spring-pool-api","build":"<BUILD_REVISION>","database":"ok"}`. `BUILD_REVISION` is a Worker var set at deploy (git short SHA, else `"dev"`). The response never includes the account ID, database ID, hostnames, or actor.

## 6. Web worker routes (SSR)

All pages use the shared layout (§8). Forms are native HTML; each POST carries `csrf`, and every mutation form carries `expected_revision` as a hidden field.

| Route | Purpose → API call |
|---|---|
| `GET /` | `302` → `/scripts` |
| `GET /scripts?q&tag&archived&before_id` | List/search → `GET /v1/scripts` |
| `GET /scripts/new` | Create form |
| `POST /scripts` | `multipart/form-data`: `title, description, tags, language, body, file, csrf` → `POST /v1/scripts` → `303 /scripts/{id}` |
| `GET /scripts/:id` | Head view, body, runbooks list link, actions |
| `GET /scripts/:id/edit` | Edit form prefilled from head |
| `POST /scripts/:id` | Update → `PUT /v1/scripts/:id` → `303 /scripts/:id` |
| `POST /scripts/:id/archive` | → `POST …/archive` → `303 /scripts/:id` |
| `GET /scripts/:id/revisions` | History list |
| `GET /scripts/:id/revisions/:rev` | Historical revision (read-only) |
| `GET /runbooks?q&archived&before_id` | List/search |
| `GET /runbooks/new`, `POST /runbooks` | Create |
| `GET /runbooks/:id`, `GET /runbooks/:id/edit`, `POST /runbooks/:id` | View / edit / update |
| `POST /runbooks/:id/archive` | Archive |
| `GET /runbooks/:id/revisions`, `GET /runbooks/:id/revisions/:rev` | History |
| `GET /runbooks/:id/revisions/:rev/export.md` | Streams the API export with the same headers |
| `GET /audit?before_id` | Audit table |
| `GET /healthz` | `{"status","service":"spring-pool-web","build","api":{…API health…}}`. `503` if the API is unreachable. |
| `GET /assets/app.css`, `GET /assets/app.js` | Static, `Cache-Control: public, max-age=300`, still behind auth |

Web form rules:

- **Tags input:** comma-separated. The web worker trims, lowercases, drops empty entries, and sends the array. The API does all remaining validation.
- **Script content:**
  - If `file` is non-empty and `body` is non-empty → `422` "Provide pasted text or a file, not both."
  - A file is decoded with `new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })`. Invalid UTF-8 → `422` "File is not valid UTF-8." File bytes are preserved exactly, including CRLF and any BOM.
  - Textarea input has CRLF normalized to LF, because browsers submit CRLF by HTML spec.
  - A raw web request over 262 144 bytes → `413` page.
- **Runbook step editing without JS:** the form renders rows `steps[i].script_id`, `steps[i].script_revision`, `steps[i].instruction`. Submit buttons `name="action"` with values `save`, `add_step`, `remove:i`, `up:i`, `down:i`. Non-`save` actions re-render the form (status 200) with the edited rows and do not call the API. `app.js` progressively enhances the same controls client-side; the form must still work with JS disabled.
- **Script picker:** a `<select>` of non-archived scripts (`GET /v1/scripts?limit=100`) plus a numeric revision field defaulting to the head. Existing pins to archived scripts are kept as-is and labelled "archived".
- **API error mapping in web:**
  - `422`/`413` → re-render the form with the same status, field errors, and the user's input preserved.
  - `409` → re-render the form with status `409`, the user's input preserved, and the notice "Not saved: this item changed (now revision N) or was archived. Review the current revision, then re-apply your changes." with a link to it.
  - `404` → 404 page.
  - `401` from the API (a bug) → `500`.
  - Network error or `5xx` → `502` page "API unavailable". No internals are shown.

## 7. Migrations and configuration

- `api/migrations/0001_init.sql` contains §4 in full. Apply locally with `wrangler d1 migrations apply spring-pool --local`. The **operator** applies it to staging with `--remote --env staging`, using the operator's token. Forward-only: later changes are new numbered files and never edit applied ones.
- `api/wrangler.toml`:
  - `main` = built shim, `compatibility_date` pinned, `workers_dev = false`, `preview_urls = false`, no `routes`.
  - `[[d1_databases]] binding = "DB"`.
  - `[vars] BUILD_REVISION = "dev"`.
  - `[env.staging]` repeats the D1 binding with the staging `database_id`, again with no routes.
- `web/wrangler.jsonc`:
  - `services: [{ binding: "API", service: "spring-pool-api" }]`, and the same in `env.staging` pointing at the staging API name.
  - Vars as in §3.1. `BUILD_REVISION` is set via `--var` at deploy.
  - `env.staging.workers_dev = true`, `preview_urls = false`, no custom routes or DNS changes. The staging workers.dev hostname must be protected by the dedicated Access application before public traffic is enabled. Lead verifies the protection and keeps fail-closed auth until configured.
- Local run: `wrangler dev -c web/wrangler.jsonc -c api/wrangler.toml` (one workerd process, service binding resolved locally, local D1 state in `.wrangler/`).

## 8. UI brief

**Character:** a clear operational workbench. Dense but calm, no decoration, content first. The system font stack (`system-ui, sans-serif`; code in `ui-monospace, monospace`). No web fonts, images, icon fonts, CDNs, or analytics. One `app.css` with CSS custom properties, a light default, and `prefers-color-scheme: dark`. Contrast must meet WCAG AA.

**Layout:**

- Top bar: product name "spring-pool", nav links **Scripts**, **Runbooks**, **Audit**, and the actor email.
- Page header: title, status badges (`rev N`, `archived`), and a primary action on the right.
- Desktop (≥ 900 px): lists are `<table>` elements with sortable-looking but static columns (title, tags, language, rev, updated). Detail pages use a two-column layout: metadata/actions sidebar plus a main content column.
- Mobile (< 900 px): single column. Tables collapse to stacked `<article>` cards. Action buttons are full-width. Code blocks scroll horizontally (`overflow-x: auto`) and never wrap-break code.

**Scripts library:**

- A search form (`<form role="search">` with `q`, `tag`, and an `archived` `<select>`) above the results, with a result count.
- The detail page shows the body in `<pre><code>` with line numbers via CSS counters, plus a "Copy" button. The button is progressive: it is hidden when JS is unavailable and uses the Clipboard API when present.
- The revisions page is a table of revision, date, actor, and size, with links. Historical views show a persistent banner: "Viewing revision N of M — read-only."

**Runbooks:**

- The detail page is an ordered list (`<ol>`) of steps. Each step shows its instruction, the pinned script title with an `rN` link, an archived badge if applicable, and the collapsible pinned body (`<details>`).
- The step editor is a `<fieldset>` per step with `<legend>Step n</legend>`, plus Up/Down/Remove buttons as real `<button>`s. There is an "Add step" button, disabled at 30 steps with the explanatory text "Maximum 30 steps."
- "Export Markdown" is a plain link to the `.md` route.

**Semantic controls:** use real `<button>`, `<a>`, `<label for>`, `<fieldset>`, and `<table>` with `<th scope>`.

- Required fields are marked with `required` and a visible "(required)".
- Errors appear in an error summary at the top (`role="alert"`, links to fields), plus inline messages linked with `aria-describedby`.
- Archive uses a clearly labelled `<form method="post">` button and preserves every historical revision. No delete or cleanup controls.
- Focus styles stay visible, and a skip-link goes to main content.

**Empty, error, and loading states:**

- Empty library: "No scripts yet." plus a "New script" button. Empty search: "No scripts match "q"." plus a clear-filters link.
- Empty runbooks: explain that runbooks pin script revisions, with a "New runbook" link (or "Create a script first" when no scripts exist).
- Empty audit: "No activity recorded yet."
- Error pages 401/403/404/409/413/422/502/503 share one template: plain heading, one sentence, a next-step link. No stack traces or IDs beyond what the user requested.
- The conflict notice keeps the user's edits in the form.
- No spinners: pages are server-rendered. JS enhancements are optional and silent on failure.

## 9. Non-functional requirements

- The API never logs bodies, titles, instructions, or actor emails. The web worker logs only method, route pattern, status, and duration.
- All SQL uses bound parameters.
- Dependency policy is in §2. `Cargo.toml` lists only `worker`, `serde` (derive), and `serde_json`. Dev-only test crates are allowed for native unit tests. `web/package.json` `dependencies` lists only `hono`.

## 10. Verification scenarios

Layers:

- **(U)** Rust native unit tests (`cargo test`) and TypeScript unit tests (`node --test`).
- **(I)** Integration tests (`node --test tests/integration`) against `wrangler dev` with a fresh local D1 and `AUTH_MODE=local`. API-level cases call the local API worker URL directly; that is possible only in local dev.
- **(E)** Playwright E2E, few and focused, against local web.
- **(C)** Config checks (`node --test tests/config`) that parse the wrangler files.

| ID | Layer | Scenario | Expected |
|---|---|---|---|
| T-REV-1 | I | Create a script, then PUT twice with the correct `expected_revision` | Revisions 1, 2, 3 exist. `GET …/revisions/1` returns the original body unchanged. Audit shows create, update, update with revisions 1, 2, 3 and no body/title fields. |
| T-REV-2 | U/I | Attempt `UPDATE script_revisions` / `DELETE FROM scripts` via D1 directly (local test harness) | Aborted with `sp:immutable_revision` / `sp:no_hard_delete` |
| T-CONC-1 | I | Two concurrent PUTs with the same `expected_revision=1` (`Promise.all`) | Exactly one `200` (rev 2) and one `409 revision_conflict` with `current_revision: 2`. Exactly one `script.update` audit row. |
| T-CONC-2 | I | PUT with stale `expected_revision` after a successful edit; archive with stale revision | `409 revision_conflict` |
| T-CONC-3 | E | Two browser tabs editing the same script; the second saves | 409 page with the edits preserved and a link to the current revision |
| T-NF-1 | I | GET/PUT `/v1/scripts/999999`, `/v1/scripts/abc`, `/v1/runbooks/0` | `404 not_found` |
| T-NF-2 | I | `GET /v1/scripts/{id}/revisions/99`; a pin to a nonexistent revision in a runbook | `404 revision_not_found`; `422` with `steps[0].script_revision` `not_found` |
| T-SIZE-1 | I | Body of exactly 65 536 bytes (multi-byte chars included) | `201`, `byte_size = 65536` |
| T-SIZE-2 | I/E | Body of 65 537 bytes (API), and a 65 537-byte file upload (web) | `413 script_too_large`; web re-renders with the error |
| T-SIZE-3 | I | Runbook with 30 steps / 31 steps / 0 steps | `201` / `422 too_many_items` / `422 too_few_items` |
| T-VAL-1 | U/I | Unknown field, wrong type, bad tag, duplicate tag, bad language, NUL in body, invalid UTF-8 file (web) | 400 / 422 with the documented issue codes |
| T-ARCH-1 | I | Pin script rev 1 in a runbook, edit the script to rev 2, archive the script | `GET` runbook still shows the step with `script_archived: true`. `GET …/revisions/1` returns 200. Export contains the rev 1 body. PUT on the script → `409 archived`. |
| T-ARCH-2 | I | List scripts with `archived` = default / `include` / `only` | Archived script hidden / present / only |
| T-RETAIN-1 | I | Attempt revision/step/audit deletion through local SQL; call an unknown cleanup URL | SQL aborts; URL returns 404; history remains intact |
| T-EXP-1 | U | Body containing a line of four backticks plus shorter inline backtick runs | Fence of 5 backticks. Round-trip: a CommonMark parse of the output yields a code block whose content equals the body exactly. |
| T-EXP-2 | U | Title/instruction containing `# x`, `<script>`, `[a](javascript:1)`, ```` ``` ```` | Rendered as literal text (all punctuation escaped); no heading, HTML, link, or fence |
| T-EXP-3 | I | Export endpoint headers | `text/markdown; charset=utf-8`, `attachment` filename as specified |
| T-XSS-1 | E | Script title and body `<img src=x onerror=alert(1)></code><script>alert(1)</script>` | Displayed literally. No dialog. The CSP header is present. |
| T-CSRF-1 | I | POST `/scripts` with no `Origin`, a foreign `Origin`, a missing `csrf` field, or a mismatched cookie | `403` and no API write (the audit count is unchanged) |
| T-AUTH-1 | U | Web auth middleware in `access` mode with a missing header, bad signature, wrong `aud`/`iss`, expired token, or other email (test JWKS injected via a fetch stub) | 401 / 401 / 401 / 401 / 403. A valid token passes with the lowercased actor. |
| T-AUTH-2 | U | Missing `ACCESS_AUD` (or `OWNER_EMAIL`, `ACCESS_TEAM_DOMAIN`), or `AUTH_MODE` unset/unknown | `503` and the API binding is never called |
| T-AUTH-3 | U | `AUTH_MODE=local` with `ENVIRONMENT=staging`, or with host `spring-pool.example.com` | `503` |
| T-AUTH-4 | C | Parse `web/wrangler.jsonc` | `env.staging.vars.AUTH_MODE == "access"`, `ENVIRONMENT == "staging"`, Access vars provided by operator at deployment (never committed identity), no `LOCAL_OWNER_EMAIL`, `workers_dev == true`, `preview_urls == false`, no custom routes |
| T-AUTH-5 | U | Client sends `X-Spring-Pool-Actor: attacker@x` to web | Ignored. The API receives only the verified actor. |
| T-BOUND-1 | C | Parse `api/wrangler.toml` (all envs) | No `routes`/`route`, `workers_dev = false`, `preview_urls = false`. The only D1 binding is in the API; the web config has no `d1_databases`. |
| T-BOUND-2 | I | API without `X-Spring-Pool-Actor` on each non-health route | `401 unauthenticated` |
| T-BOUND-3 | I | Web `GET /v1/scripts`, `GET /api/v1/scripts` | `404` (no pass-through proxy) |
| T-HEALTH-1 | I | `GET /v1/health`, `GET /healthz` | 200. `build` present. The response contains none of: account ID, database ID, email. |
| T-PERSIST-1 | I | Create a script and runbook, restart `wrangler dev` (same `.wrangler` state), read again | Data and revisions intact; export byte-identical to before the restart |
| T-E2E-1 | E | Happy path: create 2 scripts (paste + file), build a 2-step runbook, reorder steps without JS (`javaScriptEnabled: false`), save, export | Downloaded Markdown contains both bodies in order |
| T-UI-1 | E | Mobile viewport (390×844): list, detail, and step editor usable; no horizontal page scroll except inside code blocks | Pass |

**Minimum gate before the lead accepts implementation:** all U, I, and C tests pass; E2E T-E2E-1, T-XSS-1, and T-CONC-3 pass; `python3 -m json.tool contracts/openapi.json` succeeds; and a manual diff of the API route table against `contracts/openapi.json` finds no drift.
