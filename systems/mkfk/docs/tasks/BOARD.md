# mkfk tasks

技術任務連回 desk 卡 [T-0353](https://github.com/fallrising/desk/blob/main/tasks/T-0353-mkfk/task.md)。單張任務不封存；合併前 `end` 留空。

| id | title | status | desk | issue | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 399 | leader 更替後，未套用前綴的副本在序號檢查前回 NOT_LEADER／NOT_READY | closed | T-0353 | https://github.com/fallrising/newclear/issues/399 | 2026-10-19T01:10:48Z | 2026-10-19T01:28:21Z | 2026-10-19T01:28:21Z |
| 400 | Raft pre-vote 評估（ADR，不實作） | in_progress | T-0353 | https://github.com/fallrising/newclear/issues/400 | 2026-10-19T03:32:37Z |  | 2026-10-19T03:35:32Z |
| 401 | 環境 B 重跑，回答 follower 是否整段 60 秒靜默 | blocked | T-0353 | https://github.com/fallrising/newclear/issues/401 | 2026-10-19T03:32:37Z |  | 2026-10-19T03:35:32Z |

`401` 停在這裡：這個工作區沒有環境 B 的主機清單，也沒有 SSH。本機 loopback 不是環境 B，不能拿來回答那個 60 秒靜默有沒有重現。
