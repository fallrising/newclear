# Changelog

## [0.1.0] — 2026-06-19

### Added

- **Auth**: Auth0 JWT verification with JWKS auto-fetch. `AuthenticatedUser` extractor for route handlers. Role-based authorization (user, admin).
- **KMS**: Local AES-256-GCM envelope encryption. Auto-generates master key on first run. `Kms` trait for swappable implementations.
- **Database**: SQLite via sqlx with auto-migration. `Database` trait supporting CRUD for users and prompts. Feature-flagged backends for Postgres, MySQL, Firebase.
- **Message Bus**: EMQX MQTT integration via rumqttc. `MessageBus` trait with publish/connect/disconnect. Feature-flagged backends for Redis, REST, Supabase, Firebase.
- **Prompt API**: `POST /api/prompts` encrypts and stores prompts, publishes to message bus. `GET /api/prompts` lists with decryption. `GET /api/prompts/{id}` with single lookup.
- **WebSocket**: Per-user broadcast rooms. Real-time push when worker publishes result.
- **Frontend**: HTMX server-rendered dashboard. MiniJinja templates. Login page with Auth0 redirect. WebSocket client auto-updates prompt cards on result.
- **Config**: All settings via environment variables. Feature flags for compile-time backend selection.
- **Project**: Cargo workspace with modular structure. Zero warnings on build and clippy.
