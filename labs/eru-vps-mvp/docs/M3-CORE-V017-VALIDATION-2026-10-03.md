# core v0.1.7 候選 patch：本機驗證紀錄

狀態：**verified-not-deployed**。兩次隔離 build、各自的 compatibility tests、實際 binary byte 比對與新 validation manifest 均通過。ERU-013 仍進行中，正式剩餘 12 項（近期 1、後續 11）。未部署、未改 deployment locks、未連 VPS。

## 來源與候選邊界

- upstream stable：[v0.1.7](https://github.com/projecteru2/core/releases/tag/v0.1.7)，精確 commit `c80116374a49682d133f74dcb65cb90cb9549bc4`。validator 以本機 `refs/tags/v0.1.7^{commit}` 核對精確 SHA，再用 `git archive` 取得乾淨來源。
- patch：`patches/core-v0.1.7-safe-node-add.patch`，revision 1；review snapshot SHA256：`ac094234fc6a9d5615e90e85cc78f3c1cc2004e99723a3bae612dcd7883c89f5`。包含 lock-context 修補、AddNode 預設 bypass，以及 synthetic v0.1.5 metadata／wire compatibility tests。
- toolchain：Go 1.27.1，linux/amd64；官方 archive SHA256 `63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445`。
- deployment source／artifact locks 仍固定 v0.1.5。source override 只選定本次驗證來源，不代表修改部署版本或已完成升級。

## Compatibility 的可證明範圍

`compat/v015/testdata/legacy.json` 是依 upstream v0.1.5 commit `e19ceb7e09d95bedea3eb0c25bec9308101fecc5` 的 JSON tags、nested resource shapes 與 store key layout 建立的 synthetic fixture；不是從舊 binary 或 live cluster 匯出的 snapshot。

候選測試透過實際 core store update/delete/status binding 與 RPC conversion，核對 workload identity、owner/digest labels、resource round trip、fenced node identity、RPC capacity/usage、exact 四個 key 的 cleanup 與 unrelated data 保留。missing status 不得繼承鄰近 node 的 readiness；etcd exact-read tests 區分 `ErrKeyNotFound`、ambiguous cardinality 與 backend errors，GetMulti 遇到缺失或不明 key 不可回傳 partial success。

這些測試不證明 external resource-plugin quota repair、rolling upgrade、實際 runtime、網路或 VPS 相容性。`compatible_from_versions` 的聲明只在以上有界 metadata／wire 契約內成立；不能取代 upgrade／rollback／interruption 或完整 E2E。

## 重建命令與必要證據

以下為兩次獨立建置的命令模板；`<build-A>` 與 `<build-B>` 必須是兩個不存在的新目錄，每次各自解開 source、toolchain，使用獨立 GOPATH／GOCACHE。單純複製 artifact 或 result.json 不算獨立重建。

```sh
python3 scripts/validate_core_patch.py \
  --source <upstream-core-checkout> \
  --source-tag v0.1.7 \
  --source-commit c80116374a49682d133f74dcb65cb90cb9549bc4 \
  --patch patches/core-v0.1.7-safe-node-add.patch \
  --patch-revision 1 \
  --compatibility-from v0.1.5=./compat/v015 \
  --output <build-A>
```

第二次只把 output 換成 `<build-B>`。每次 baseline 只先套 lock regression tests，必須重現兩個 `cannot create context from nil parent`；再套其餘 patch，執行以下流程。baseline 預期非零是缺陷重現證據，不能當成 patched suite 成功。

| 檢查 | Build A | Build B |
| --- | --- | --- |
| clean source／patch check、官方 Go archive SHA | PASS | PASS |
| baseline 兩個 lock panic 重現 | PASS | PASS |
| `go test ./cluster/calcium -run '^TestWithNodesPlanLocked(NilContextOnLockFailure\|PartialFailureUnlocks)$' -count=1` | PASS | PASS |
| `go test ./cluster/calcium ./store/common ./store/etcdv3/meta -count=1` | PASS | PASS |
| `go test ./lock/... -count=1` | PASS | PASS |
| `go build -buildvcs=false -trimpath -o <output>/eru-core .` | PASS | PASS |
| `go test ./compat/v015 -count=1` | PASS | PASS |
| artifact SHA256／byte-identical 比對 | PASS | PASS |

`go test ./store/etcdv3/meta -run '^TestV015' -count=1 -v` 可單獨檢查 exact-read 新案例；上表 calcium stage 已包含整個 meta package。兩份 result 必須有相同 source／patch／toolchain／artifact identity、各自成功的 compatibility step，且是不同檔案身分。公開 manifest 須經 publisher 與 `core_release.validation_record` 驗證，原始 logs 與 binary 留在本機受保護 evidence。

## 實際結果

兩次 build 均以全新 source、toolchain、GOPATH、GOCACHE 執行；同一 controller 僅共用模組下載 cache，沒有共用編譯 cache、binary 或 result 檔案。這是同一主機的兩份隔離建置，不宣稱兩台獨立主機。兩次 baseline exit 1 且各重現兩個 nil-context panic；regression、calcium/store/meta、locks、build、compatibility 全部 exit 0。

Artifact SHA256：`312fc5ccffed086ff0d772b8c609ed079b055710b45e052830a7d67db3f5c356`。除了 checksum 相同，也直接比對兩份 binary bytes 相同。[公開 validation manifest](../patches/core-v0.1.7-safe-node-add.validation.json) 經 `core_publish.py` 以新檔不可覆寫方式產生，再用 `core_release.validation_record` 驗證；兩份既有 v0.1.5 manifest 也仍通過。

`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`：446 tests，68.675 秒，OK。原 CI validation block、compileall 與獨立 patch/validator/design review 通過。既有 v0.1.5 preserved-contract 測試通過；舊版 missing-workload 回傳 Code(1051) 的預期 RED 與新版 NotFound 的 GREEN 是刻意的語意遷移，不宣稱錯誤碼相同。

## 尚未完成

兩次 build 與本機 manifest 已驗證；ERU-013 的跨版本 upgrade／rollback／interruption、safe AddNode 受控部署與 VPS E2E 尚未執行。ERU-015 另有 [fresh executor 設計](M3-FRESH-EXECUTOR-DESIGN-2026-10-03.md)，但 coordinator、bootstrap、pending barrier 及三次 live generations 都未完成；設計文件不能當成 executor 實作。
