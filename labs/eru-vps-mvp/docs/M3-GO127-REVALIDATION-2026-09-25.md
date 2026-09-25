# ERU-013 Go 1.27.1 隔離重驗（2026-09-25）

本輪只重驗已鎖定的 `v0.1.5` patch；不是新 upstream release、不是部署，也不會改動現有 release manifest。工作區工具鏈、source archives、module/build caches、logs 與 binary 都留在 `/tmp/eru-go127`，系統 Go 1.22.2 與 repo 內 artifacts 未變。

## 固定輸入

- Go 官方 [Go 1.27.1 release](https://go.dev/doc/devel/release) 已於 2026-09-01 發布；從 [官方下載頁](https://go.dev/dl/) 取得 `go1.27.1.linux-amd64.tar.gz`。下載大小為 70,553,950 bytes，SHA-256 `63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445`，與 repo validation manifest 一致。
- source 使用鎖定 tag `v0.1.5`，commit `e19ceb7e09d95bedea3eb0c25bec9308101fecc5`；patch `core-v0.1.5-lock-context.patch` SHA-256 為 `620492926d2693ff7aff05b2d7524a1bc7d2be2c60795a4f366c1d4361245d5b`。patch 對 tag source 可乾淨套用。
- `GOTOOLCHAIN=local`，Go module、GOCACHE、GOPATH 都指定在 `/tmp`；未修改系統 Go 或 repo lock。

## 結果

baseline 使用 patch 新增的兩個 regression tests，但保留 upstream 原版 `cluster/calcium/lock.go`。兩測均以 `cannot create context from nil parent` panic 失敗；partial failure 案例也確認已取得的 locks 沒有全部依 reverse order 解鎖。這證明測試確實重現原問題，而非空跑。

套用完整 patch 後，兩個 regression tests、`go test ./cluster/calcium -count=1`、`go test ./lock/... -count=1` 與 `go build -trimpath` 都通過。另直接執行 repo 的 `validate_core_patch.py`，它自行重新檢查官方 archive SHA，並回報 baseline `1`、regression／calcium／locks／build `0`，狀態 `verified-not-deployed`。

兩份各自由精確 commit 匯出的 source archive，以不同且全新的 GOCACHE 獨立建置，得到相同 SHA-256 `1e674e955b6504892d9e7a60807e02e18043ba739787481bbd456cb30ca68363`；此值與公開 v0.1.5 validation manifest 的 artifact SHA 一致。validator 的第三次 build 也得到同一 SHA。原先從 dirty Git checkout 建置會將 `v0.1.5+dirty`／VCS metadata 編入 build info，產生不同 hash；改用鎖定 commit 的 source archive，並由 validator 使用 `-buildvcs=false` 後，即重現已發布 manifest。沒有因此新增或覆寫任何 release manifest。

## 範圍與剩餘工作

結果只證明現有 v0.1.5 patch 在官方 Go 1.27.1 下可重現建置並通過指定 package tests。沒有測試下一個 upstream 版本，沒有跨版本 compatibility evidence，沒有 upgrade／rollback／VPS E2E，因此 ERU-013 仍進行中，剩餘任務仍為 12 項。完整 console／deployment logs 與 artifact 未複製進 repo。
