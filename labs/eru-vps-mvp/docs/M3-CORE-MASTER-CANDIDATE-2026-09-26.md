# ERU-013 unreleased upstream master compatibility probe（2026-09-26）

這是對更新 source snapshot 的本機前置相容性探測，不是下一個 release，也不會取代既有 v0.1.5 manifest。ERU-014 safe AddNode patch 仍 verified-not-deployed。

## Upstream 狀態

Repo 鎖定 core tag `v0.1.5`，commit `e19ceb7e09d95bedea3eb0c25bec9308101fecc5`。官方 GitHub release page 的最新穩定版是 `v0.1.5`，於 2026-09-09 發布，與 repo 鎖定來源相同。上游 `master` 的精確 HEAD `e9b48c12663f18e1356ee29f7ce2ac0963a8ae4d` 比 v0.1.5 多 5 個 commit，尚無更新的穩定 tag。參考 [v0.1.5 release](https://github.com/projecteru2/core/releases/tag/v0.1.5)、[release list](https://github.com/projecteru2/core/releases) 與 [鎖定 tag 與 master candidate 比較](https://github.com/projecteru2/core/compare/e19ceb7e09d95bedea3eb0c25bec9308101fecc5...e9b48c12663f18e1356ee29f7ce2ac0963a8ae4d)。

## 隔離驗證

來源由精確 commit 建立於 `/tmp/eru-core-master-e9b48-validation`。使用 repo 現有兩份 reviewed v0.1.5 patch：先單獨帶入 lock regression tests，確認未修補 master 有兩個預期的 nil-context panic；再加入 lock-context 修正及 cumulative safe AddNode 變更。兩份 patch 均能套用到乾淨的 master source snapshot。

官方 Go 1.27.1 `linux/amd64` 下，結果如下：

- baseline targeted regression：exit 1，兩個 `cannot create context from nil parent` 預期簽名。
- patched lock regression tests：通過。
- `go test ./cluster/calcium ./store/common -count=1`：通過。
- `go test ./lock/... -count=1`：通過。
- `go build -buildvcs=false -trimpath`：通過。
- 第二份由相同 commit 的 fresh `git archive` 解出的 source、使用新的 `GOCACHE` 獨立 build：通過，SHA256 與第一次相同，為 `ac1028f51fedfd782d83692f573ff1056b8f48f5021f0562d4c5954949f6c353`。source archive SHA256 為 `3ed77c2d949efef5a536b01c6fad48052a9ae479ad7f2b6f3dbfbb2275dc7143`。

原始測試 log、source archive 與兩個 artifact 留在 `/tmp/eru-core-master-e9b48-validation` 與 `/tmp/eru-core-master-e9b48-independent`，沒有加入 repo。這只證明兩份 patch 可套用並在一個 unreleased source snapshot 通過選定 tests／build；沒有宣稱整個 upstream suite 通過，也沒有建立新 release manifest、更新 artifact lock、部署 core、修改 VPS 或做 E2E。

## 下一步

在 upstream 發布下一個穩定 tag 後，先重查 tag/commit 與差異，再用該 tag 作正式 `validate_core_patch.py` input，完成新 tag 的 baseline、patch、相容性 tests、兩次 build 及 manifest review。此 master probe 不關閉 ERU-013，也不改變目前只允許 v0.1.5 safe patch 部署的狀態；全庫正式 VPS E2E 仍排在本機開發之後。待檢查項目起始：2026-09-26 11:12 UTC；此項只是等待下一個 stable tag，沒有背景程序或 soak 在執行。
