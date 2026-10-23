# Pokercase 技術任務

## T-0377 — Cursor 外部隔離

需求：[desk T-0377](https://github.com/fallrising/desk/tree/main/tasks/T-0377-thinrouter-cursor-isolation)。規格：[cursor-isolation](../cursor-isolation.md)。

| ID | 任務 | AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| CUR-01 | 外部容器 runner、回歸與 canary | CI-1–CI-5 | done | 2026-10-23T16:57:52Z | 2026-10-23T18:01:20Z | 2026-10-23T18:05:45Z |

原 Claude session 的其餘未驗證產品旅程仍保留 SUCCESS.md，不納入此隔離切片的完成聲明。

CUR-01 已由 [PR #566](https://github.com/fallrising/newclear/pull/566) 合併為 `cbf1021f4d67ff60683dbfdb47e7bd75101e07bd`，本機完整測試、Docker canary、獨立審查及必要 CI 均通過。此狀態只表示 CI-1–CI-5 隔離切片完成，整體產品及真帳號旅程仍依 SUCCESS.md 待驗收。
