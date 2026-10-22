# Ojbquay 技術任務板

需求 T-0368（desk T-0374）。固定 AC 見 [SDD](../../SDD.md)，對照與剩餘工作見 [specification-map](../specification-map.md)。

| ID | 任務 | 對應 AC | 狀態 |
| --- | --- | --- | --- |
| OJB-SDD-BUILD | 同一 commit `./gradlew build` 與 `sdk/go` 的 `go test ./...` | AC-04/05/06/08/09、AC-03 單元層 | todo |
| OJB-SDD-STACK | 同一 commit `make validate-deploy`、`make e2e`、`e2e/pull_share.sh`；記錄 loaded version 收斂時間；停 console 後再發送一次 | AC-01/02/03/07/11 | todo |
| OJB-SDD-CONSOLE | 同一 stack 走一次 console golden path | AC-10 | todo |
| OJB-SDD-RELEASE | SUCCESS 寫入結果、CI 綠燈、合併、`usable/ojbquay/v1.0.0` | 全部 | todo |
