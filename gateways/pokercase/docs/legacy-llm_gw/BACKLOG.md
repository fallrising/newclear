# Backlog

## High Priority

- [ ] **Integration tests** — Test full prompt lifecycle: auth → encrypt → store → publish → WS push
- [ ] **Worker result subscription** — Poll or subscribe to message bus response topics; decrypt and push to WebSocket clients
- [ ] **Error handling** — Structured error responses from all API endpoints (consistent JSON error format)
- [ ] **Rate limiting** — Per-user rate limiting on prompt submission endpoint

## Medium Priority

- [ ] **Postgres database backend** — Implement `Database` for CockroachDB / Supabase via sqlx-postgres
- [ ] **MySQL database backend** — Implement `Database` for PlanetScale / TiDB via sqlx-mysql
- [ ] **Firebase Firestore backend** — Implement `Database` for Firebase (NoSQL document model)
- [ ] **Redis message bus** — Implement `MessageBus` for Redis Pub/Sub
- [ ] **REST message bus** — Implement `MessageBus` for generic HTTP POST
- [ ] **Supabase Realtime bus** — Implement `MessageBus` for Supabase WebSocket channels
- [ ] **Firebase FCM bus** — Implement `MessageBus` for Firebase Cloud Messaging
- [ ] **Key rotation** — Support periodic DEK re-encryption with new master key
- [ ] **Pagination** — Add `Link` headers and proper pagination metadata to list endpoints
- [ ] **Health endpoint** — `GET /health` with DB and bus connectivity checks

## Low Priority

- [ ] **OpenTelemetry** — Distributed tracing across the system
- [ ] **Admin panel** — Web UI for managing users and viewing all prompts
- [ ] **Prompt templates** — Save and reuse prompt templates per user
- [ ] **Batch submission** — Accept CSV/batch prompt submissions
- [ ] **Audit log** — Log all encrypt/decrypt operations with user ID and timestamp
- [ ] **Docker image** — Multi-stage Docker build for production deployment
- [ ] **CI/CD** — GitHub Actions for build, clippy, test, and deploy
- [ ] **WebSocket reconnection** — Exponential backoff reconnection in frontend JS

## Completed

- [x] Cargo init with feature flags
- [x] Local AES-256-GCM envelope encryption (KMS)
- [x] Auth0 JWT verification with JWKS
- [x] SQLite database backend
- [x] EMQX MQTT message bus backend
- [x] Prompt CRUD API
- [x] WebSocket real-time push
- [x] HTMX frontend with login + dashboard
