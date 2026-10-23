# mkfk tasks

技術任務連回 desk 卡 [T-0353](https://github.com/fallrising/desk/blob/main/tasks/T-0353-mkfk/task.md)。單張任務不封存；合併前 `end` 留空。

| id | title | status | desk | issue | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 399 | leader 更替後，未套用前綴的副本在序號檢查前回 NOT_LEADER／NOT_READY | closed | T-0353 | https://github.com/fallrising/newclear/issues/399 | 2026-10-19T01:10:48Z | 2026-10-19T03:27:19Z | 2026-10-19T03:27:19Z |
| 400 | Raft pre-vote 評估（ADR，不實作） | in_progress | T-0353 | https://github.com/fallrising/newclear/issues/400 | 2026-10-19T03:32:37Z |  | 2026-10-19T03:45:03Z |
| 401 | Docker compose 上按 finding 4 跑 rf3-isr2-b1-p1 | in_progress | — | https://github.com/fallrising/newclear/issues/401 | 2026-10-19T03:32:37Z |  | 2026-10-19T15:40:08Z |
| short-chaos | OP-05 short chaos：落後 follower 在多個 append 在途時永遠追不上（Raft livelock） | in_progress | [T-0374](https://github.com/fallrising/desk/blob/main/tasks/T-0374-audit-repairs-newclear/task.md) | — | 2026-10-23T06:41:32Z |  | 2026-10-23T07:07:55Z |

`399` 的 `end`／`last_activity` 是 issue 關閉時間 `2026-10-19T03:27:19Z`。PR #415 合併時間是 `2026-10-19T01:28:21Z`。

`401` 與已封存的 T-0353 分開，不改那張卡。場景是現有三節點 compose 的 `rf3-isr2-b1-p1`（1 KiB、四個 producer、`acks=all`、預熱 10 秒、量測 60 秒 × 3），沒有 netem、沒有磁碟延遲。判定見 `docs/benchmarks/silent-follower/README.md`。手動跑，不進 CI。
