# Node Index

| ID | Milestone | Size | Depends | Status | Spec |
|---|---|---:|---|---|---|
| N00 | M0 | M | — | blocked | [專案骨架、CI 與 Contract Pipeline](N00-foundation-ci-contracts.md) |
| N01 | M0 | M | N00 | todo | [SQLite Schema、Migration 與 Repository](N01-sqlite-schema-migrations.md) |
| N02 | M1 | M | N00, N01 | todo | [Workspace、PathGuard 與 Lazy File Tree](N02-workspace-lazy-tree.md) |
| N03 | M1 | M | N00 | todo | [Deterministic Markdown Render Model](N03-markdown-render-model.md) |
| N04 | M1 | S | N02, N03 | todo | [多分頁與狀態持久化](N04-tabs-state.md) |
| N05 | M2 | L | N03 | todo | [DOM Selection 到 Anchor Capture](N05-selection-anchor-capture.md) |
| N06 | M2 | M | N01, N04, N05 | todo | [Annotation CRUD、Sidebar 與重疊高亮](N06-annotation-crud-highlight.md) |
| N07 | M2 | S | N06 | todo | [Comment Thread 與 Tombstone 引用](N07-comment-thread.md) |
| N08 | M4 | M | N01, N04, N06 | todo | [扁平 Tag 系統與 System Pin](N08-tag-system.md) |
| N09 | M3 | L | N05, N06 | todo | [純函數 Reanchor Engine 與批量交易](N09-reanchor-engine.md) |
| N10 | M3 | M | N09 | todo | [Orphan 列表與手動恢復](N10-orphan-management.md) |
| A01 | M4 | S | N03, N06 | todo | [檔內搜尋](A01-in-document-search.md) |
| A02 | M3 | M | N02, N09 | todo | [檔案 Watcher、事件序列化與 Rename](A02-file-watcher-rename.md) |
| A03 | M4 | M | N02, N04, A02 | todo | [Command Palette](A03-command-palette.md) |
| A04 | M4 | S | N08 | todo | [Tag AND Filter View](A04-tag-filter-view.md) |
| A05 | M4+ | M | N02, N03, A02 | todo | [Wikilink 與 Incremental Backlinks](A05-wikilink-backlinks.md) |
| A06 | M4+ | S | N03 | todo | [安全 Mermaid 渲染](A06-mermaid.md) |
| A07 | M4+ | S | N02, N06, N07, N08 | todo | [Annotation/Tag 匯出](A07-export.md) |
