# Ojbquay 技術任務板

需求 T-0368（desk T-0374）。固定 AC 見 [SDD](../../SDD.md)，驗收結果見 [SUCCESS](../../SUCCESS.md)。

| ID | 任務 | 對應 AC | 狀態 |
| --- | --- | --- | --- |
| OJB-SDD-BUILD | 同一 commit `./gradlew build` 與 `sdk/go` 的 `go test ./...` | AC-04/05/06/08/09、AC-03 單元層 | done（71ac5f77） |
| OJB-SDD-STACK | `make validate-deploy`、`make e2e`、`e2e/pull_share.sh`、loaded version 收斂、停 console 後發送 | AC-01/02/03/07/11 | done（71ac5f77） |
| OJB-SDD-CONSOLE | 真 stack console 旅程 `pnpm e2e:stack` | AC-10 | done（71ac5f77） |
| OJB-SDD-RELEASE | PR CI 綠燈、owner 同意合併、建立 `usable/ojbquay/v1.0.0` 並回讀遠端 | 全部 | 待 owner |

## T-0380

| ID | Task | AC | Status | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| OJB-FE2-1 | Approved M1–M4 and review-only isolation/gRPC | R2-AC-8/E | in_progress | 2026-10-24T11:18:59Z | — | 2026-10-24T12:44:21Z |
