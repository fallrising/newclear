# mkfk short-chaos 失敗診斷與重新資格（2026-10-23）

## 診斷

- CI [39631545715](https://github.com/fallrising/newclear/actions/runs/39631545715/attempts/1)（10-21）與 39280446602（10-19）的 short chaos 失敗；當時 seed 與違例未保存。
- 修復前 `fdc534bc^` 本機重跑 short profile：8 次中第 8 次失敗（[loop](chaos-loop-before-fix.txt)），seed `1792737864556127627`，117 s；[報告](chaos-short-failure-before-fix.json)。
- 違例：broker 3 的 `events/0` 在 healing 後 90 s 內沒追上，因此其 committed copy 與 leader 不同。broker log 顯示 broker 1 在 term 8 成為 `events/0` leader 後，broker 3 一直沒有追上直到關閉（約 100 s），沒有分歧資料，是複製 liveness 問題。
- 根因：leader 只在 reply 屬於「最近一次」送給該 peer 的 AppendEntries 時才採用拒絕的 conflict hint。heartbeat 與重送同時在途時每個 reply 都屬於較舊的 RPC，nextIndex 永不回退。`TestM7LaggingFollowerCatchesUpWithSeveralAppendsInFlight` 在修復前 RED（queue 永遠剩 2 個 append）。

## 修復與驗證

修復：任一本 term 的拒絕 hint 只要高於 matchIndex 即可降低 nextIndex；移除不再使用的 `latestRPC`。SDD [02-replication §4](../../../../systems/mkfk/docs/sdd/02-replication.md) 已寫明此規則。

- 修復後 short chaos 30/30 PASS，其中 5 次重播上述 seed（[loop](chaos-loop-after-fix.txt)）。
- 來源 `fdc534bca955fb30cc21d87b2d849b8c4aa05d77`（clean checkout）以 [mkfk-gate.sh](mkfk-gate.sh) 依序跑全部 gate，結果見 [summary.txt](summary.txt)：fmt-check、vet、unit、race、model、integration、short chaos（[報告](chaos-short-report.json)，7 faults、0 violations）、full chaos（[報告](chaos-full-report.json)，28 faults、0 violations、21,368 acknowledged records）、三 broker Compose demo 與 demo-down 全部 PASS。
- 環境：Linux 4 vCPU／15 GiB、Go 1.27.1（toolchain auto）、Docker 29.1.3；主機沒有 Compose，demo 透過 [dockerwrap](dockerwrap) 在 `docker:29.1.3-cli` 映像內執行 docker CLI。完整 logs 保存於執行機 `~/test/backup/T-0374-mkfk-livelock/`。
