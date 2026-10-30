# T-0445 — Fixture 啟動所有權與安全診斷

本輪只處理 [#701](https://github.com/fallrising/newclear/issues/701) 的 `cost_auth`、`cursor_cli_e2e` 啟動與既有 Cursor 重啟 helper，以及獨立重現的 listening 日誌錯報。desk 認領 [PR327](https://github.com/fallrising/desk/pull/327) 合併後才實作；初次認領的編號衝突與失敗 CI 保留，正常更正為 T-0445，沒有改寫歷史。

## 目標與範圍

原 fixture 先借用一個連接埠、釋放後再啟動 gateway，僅以 health 成功判定啟動。現在使用 port 0，由子程序成功 bind 後回報實際位址；確認 owned child 仍存活、health 內容與自己的合成 admin token 通過，才執行原有設定與推論。public listener 的認證政策、Cursor fake CLI/runtime、工具與歷史資料斷言保留。

runtime 只移動既有 listening／四條 endpoint 日誌到 bind/local_addr 成功之後，使用實際 bound address。不新增 API、flag、依賴、schema、observer、產品 timeout 或 provider 行為；dashboard 的既有 configured-port0 顯示不在本輪。測試 helper 明確依賴既有日誌格式，格式不符即拒絕啟動。

## 固定驗收

| AC | 必須成立 | 本輪證據 |
| --- | --- | --- |
| FS-1 | bind 成功後才宣告 listening；port0 顯示非零實際 port；bind 失敗不得宣告 ready | 同一凍結 real-process probe：port0／occupied port 的 RED → 最小日誌修正 → GREEN；沒有 HTTP 請求 |
| FS-2 | 只接受 owned child 的位址，使用同一啟動 deadline，health／admin／child 存活通過後才設定或推論 | 真 gateway loopback/public、serial/concurrent、互換 admin token 的 401；occupied foreign listener 零觸碰；錯誤 token／redirect 拒絕 |
| FS-3 | 固定大小持續排空 stderr；過大行捨棄至換行後恢復；只保留固定錯誤碼與數值，不輸出原始內容 | 4096-byte 行上限、過大行後有效 ready、持續 drainage、畸形位址、early exit／silent deadline、canary 遮罩；證據層次分開 |
| FS-4 | failure／Drop／取消只清理自己的 child/drainer，保留 foreign listener 與既有功能 | 實際 child reap、listener 釋放、取消 PID 消失；兩個原 target 正常並行與 serial 均通過 |
| FS-5 | 無桌面可重跑、驗證 pins／inventory／來源與分層報告，保留舊旅程 | 固定入口 10 情境、必要完整檢查、八組既有隔離回歸；獨立審查／正常 PR／必要 CI／遠端回讀／帳本／備份與 cleanup 是交付門檻 |

helper 清空繼承環境，使用合成 HOME／CLI config／data，明確 host、固定 log filter、no-color、stdin null；刻意的 Cursor canary 再明確加入。client 禁用 proxy 與 redirect，限制回應 body，所有非同步啟動階段共用絕對 deadline。binary override 僅存在於 test helper，必須 absolute path 與 SHA256 成對相符；一般產品 binary 沒有新增 override。

## 可重跑驗證與結果

在 component 執行：

```sh
cargo +1.99.0 test --locked --test fixture_startup -- --nocapture
cargo +1.99.0 test --locked --test cost_auth --test cursor_cli_e2e -- --test-threads=1
cargo +1.99.0 test --locked
cargo +1.99.0 fmt --check
cargo +1.99.0 clippy --locked --all-targets -- -D warnings
python3 -m unittest discover -s scripts/tests -v
```

封存入口使用已固定的 manifest、兩份 Python helper、Python 實際執行檔、57 份來源、normal／focused native binary 與 10-test inventory；不依賴共享 target 或待清理工作樹。`fixture_startup_walkthrough.py --manifest <verified-manifest> --output-dir <new-results>` 產生報告；`fixture_startup_check.py --manifest <verified-manifest> --report <report>` 唯讀核對。完整私人操作位置由交接提供，不寫入公開文件。

本機結果：406 Rust tests／23 groups；原兩 target 的 4＋14 項 serial 通過；149 Python（含新 checker 的 20 項純測試）；20 repository validator tests；fmt、Clippy、locked normal/native builds 通過。實際 Cargo artifact、各 executable inventory 與 digest 已核對；`cargo build` 與 `cargo test` 的 dev-feature 組合不同，獨立 normal binary 保持固定，不將共享路徑當作同一 binary。

新入口的 10 情境分為 3 個真 gateway HTTP、1 個真 gateway process-only（occupied port，零 HTTP）、2 個受控 child HTTP、3 個受控 child、1 個 pure parser。測得的 request／cleanup 計數與來源推導分開；取消後無法回讀的 request counters 不補零。原 generic／Claude／Cursor／named 四條九階段旅程、measurement coverage、Antigravity settlement、buffered HTTP、buffered CLI 均用本輪獨立 binary 通過；buffered CLI 報告另經獨立 checker 對帳。它們都是隔離 HTTP／fake CLI 證據，不是真實 client/version/provider 驗收。

## 失敗紀錄與限制

保留兩種不同 RED：實際 gateway listening 錯報；獨立 review 找到 runner 在 leader 已退出後的例外路徑可能漏清理 owned group，純 mocked 測試重現後修正 finally 與 scoped SIGTERM handling。後者是 wrapper control-flow 證據，沒有冒稱完整 SIGKILL 或實際中斷矩陣；runner 的未完整觀測 descendant cleanup 仍為 null。

完整 Rust 首次在未改動的 `claude_live_e2e::cs4_finalization_failure_never_replays_and_restart_recovers_once` 失敗：`cs_rows` 預期的 data array 不存在。既有 helper 未保留 status/body 與足夠 child 身分證據，因此原因未知；單案隔離控制及之後正常並行完整回歸通過，沒有修改第三個 fixture，也不能據此宣稱 401、port collision 或根因已修。T0426 startup exit101、T0429 auth401 的歷史原因同樣未知。編譯時遺漏 Cursor restart 舊欄位、sccache／Python socket 環境限制及恢復步驟均保留，沒有用它們冒充產品 RED。

## 剩餘路徑

#701 更廣 fixture／startup／auth 根因與 CLI 首次輸出前 timeout、#698 provider/process crash／完整 SIGKILL、#699 更廣價格／分組／billing basis／decimal／currency／新 usage mapping／真帳單、#700 真 client/version/provider、Antigravity native stream／工具／圖片都未完成。AC-04 工具與 AC-17 Cursor text-only 的產品範圍仍未決。

原17項 AC、T-1102、Cargo 與其他 tracked plans 保持；mainline incomplete、usable_tag none、desk in_progress，#698–702 不因本輪關閉。舊入口／digest／handoff／備份與另存 owner 證據不改；T0428 合成請求曾到官方端點得401的外連歷史保留。沒有本輪 owner 親跑聲稱，沒有真 credential／私人 DB／provider／登入／Docker／新增依賴／擴權／release／deploy。整輪工具、agent/model/provider、retry、token、費用及 execution/active/wait 未完整量測者為 unknown/null。本輪交付後停止，不自動啟動下一個里程碑。
