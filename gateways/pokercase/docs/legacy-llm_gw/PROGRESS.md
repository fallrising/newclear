# Progress

## Phase 1 — Scaffold + Core Abstractions ✅

- [x] Cargo init with feature flags
- [x] Config parsing from env vars
- [x] Directory structure: auth/, kms/, db/, message_bus/, api/, models/, templates/, static/

## Phase 2 — KMS Layer ✅

- [x] `Kms` trait (encrypt / decrypt / key_id)
- [x] `LocalKms` — AES-256-GCM envelope encryption
- [x] Master key auto-generation on first run
- [x] Feature flag: `kms-local`

## Phase 3 — Auth Layer ✅

- [x] Auth0 JWKS fetch
- [x] JWT validation middleware
- [x] `AuthenticatedUser` extractor with `FromRequestParts<AppState>`
- [x] Role/permission checking

## Phase 4 — Database Layer ✅

- [x] `Database` trait (CRUD for users + prompts)
- [x] SQLite impl with auto-migration
- [x] Feature flags: `db-sqlite`, `db-postgres`, `db-mysql`, `db-firebase`

## Phase 5 — Message Bus Layer ✅

- [x] `MessageBus` trait (publish / connect / disconnect)
- [x] EMQX impl via rumqttc
- [x] Feature flags: `bus-emqx`, `bus-redis`, `bus-rest`, `bus-supabase`, `bus-firebase`

## Phase 6 — Prompt API + WebSocket ✅

- [x] `POST /api/prompts` — encrypt, store, publish via bus
- [x] `GET /api/prompts` — list (decrypted for response)
- [x] `GET /api/prompts/{id}` — single prompt
- [x] Authorization: user sees own prompts, admin sees all
- [x] WebSocket handler with per-user broadcast rooms

## Phase 7 — Frontend ✅

- [x] HTMX server-rendered pages (login, dashboard)
- [x] MiniJinja templates
- [x] Static file serving (CSS, JS)
- [x] WebSocket client for real-time result push

## Build Status

| Check | Status |
|-------|--------|
| Compile | ✅ Clean, zero warnings |
| Clippy | ✅ Clean, zero warnings |
| Tests | ⏳ Not yet written |

## Known Gaps

- Non-SQLite database backends not implemented (postgres, mysql, firebase)
- Non-EMQX message bus backends not implemented (redis, rest, supabase, firebase)
- No integration tests
- No rate limiting
- No key rotation support
- No worker result subscription flow (bus reads result topic)
