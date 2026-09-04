# Phark 產品任務樹

> 最後更新：2026-09-04

狀態：`[x]` 完成、`[~]` 進行中、`[ ]` 待辦。優先級由 P0 到 P2。

## P0：可持續的時間線

- [x] **SDD-001 — Cursor-paginated timelines**
  - [x] bounded keyset API
  - [x] 三欄獨立載入更多
  - [x] Docker、runtime 與 CI 驗收
- [x] **SDD-002 — Replies and conversation threads**
  - [x] 規格、設計與 API 契約
  - [x] replies table、repository、service、tests
  - [x] inline conversation UI 與 reply composer
  - [x] Docker、runtime 與 CI 驗收
- [x] **SDD-003 — Schema migrations**
  - [x] migration history、legacy baseline 與 fail-closed 規格
  - [x] 導入 Flyway
  - [x] 將現有 schema 建立為 baseline migration
  - [x] migration rollback/restore runbook
- [x] **SDD-004 — Consistent API errors**
  - [x] RFC 9457 Problem Details
  - [x] validation field errors
  - [x] request correlation ID

## P1：社交核心

- [x] **SDD-005 — Accounts and profiles**（likes/reposts 的前置依賴）
  - [x] handle、display name、bio
  - [x] session authentication 與 CSRF
  - [x] author ownership、legacy compatibility 與 profile page
- [x] **SDD-006 — Likes**
  - [x] idempotent like/unlike
  - [x] per-user uniqueness
  - [x] timeline optimistic update
- [x] **SDD-007 — Reposts**
  - [x] repost/unrepost
  - [x] original post attribution
  - [x] timeline fan-out 規則
- [x] **SDD-008 — Notifications**
  - [x] reply/like/repost events
  - [x] unread cursor
  - [x] retention policy

## P2：探索與營運

- [x] **SDD-009 — Search**
  - [x] SQLite FTS5 index
  - [x] cursor-paginated results
  - [x] query limits
- [x] **SDD-010 — Media attachments**
  - [x] object storage abstraction
  - [x] upload validation
  - [x] image rendering
- [x] **SDD-011 — Moderation and abuse controls**
  - [x] rate limiting
  - [x] content reporting
  - [x] author/IP abuse signals
- [ ] **SDD-012 — Production durability**
  - [ ] SQLite online backup
  - [ ] metrics and alerts
  - [ ] deploy notifications

## 依賴關係

```text
001 pagination ──> 002 replies ──> 004 API errors
                         │
003 migrations ──> 005 accounts ──> 006 likes ──> 008 notifications
                         └─────────> 007 reposts ─┘
009 search、010 media、011 moderation 可在 accounts 後分流
012 durability 可與產品功能並行
```
