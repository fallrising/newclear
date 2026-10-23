# T-0369 第 1 輪交付與待確認清單

來源：main `f6d07b45fd8dee7acf4a050efaf908db8449def4`（2026-10-23）。本頁是 [SDD](SDD.md) 的證據與決策索引，不修改 SDD，不宣告第 2 輪或產品驗收完成。

## 本輪目標、範圍與停止條件

Owner 要求繼續接手收尾。本輪從 2026-10-23T16:36:34Z 起，16:53:34Z 停止新工作，16:56:34Z 截止，含 CI 等待及交接。只核對既有設計 PR、執行文件檢查、彙整待決策內容並回寫帳本；不啟動 UI、capture、runtime 修復或反覆 CI。未通過必要 CI 不合併；人工決策未取得不寫 AC-15 通過。工具數不代表 provider 用量；tokens／provider requests／費用未知。

## 已確認的交付證據

- [PR #555](https://github.com/fallrising/newclear/pull/555) 的 head `599ae5afe7dc9218fb2aaf4edb2de0f24d8bd1e6`：本輪獨立核對 12 個修改檔案均在配對元件 fe-review 範圍，AC-11、81 個相對連結、targets JSON 與空白檢查通過。targets 仍未驗證；無產品程式變更。沒有未解 review thread。
- 同 head 的 Flowshot CI（[39984881909](https://github.com/fallrising/newclear/actions/runs/39984881909)）Linux／Intel Mac／Apple Silicon Mac、Loom CI（[39984881895](https://github.com/fallrising/newclear/actions/runs/39984881895)）及 contracts（[39984881849](https://github.com/fallrising/newclear/actions/runs/39984881849)）五項全部 SUCCESS。Linux gate 耗時 25m35s；本輪只等待並讀取既有 run，未重新觸發。PR 從 draft 轉 ready 後於 16:39:41Z 正常合併。
- 在上述 main 執行 `python3 docs/fe-review/check_design.py`：AC-1～AC-14 全部 PASS、exit 0。共 14 個設計單位、15 份 DESIGN（Flowshot＋Loom 配對）。這只證明文件存在及七個標題完整，不能推論內容仍符合最新程式或 AC-15 已完成。
- 未執行本輪 UI／browser／runtime 測試；第 1 輪 SDD 明確排除這些工作。既有 CI 不取代第 2／3 輪實跑證據。

## 需要擁有者確認的假設清單

下列都是**待確認**；連結指向完整修改、驗證與回滾方案。可逐列接受或退回，不把工作授權、agent merge 或結構 PASS 當作人工決策。hai-taskboard 的 D2 必須先選定新基準，不能整批照舊批准。

| AC／單位 | 本次可審閱的建議與範圍 |
| --- | --- |
| AC-1 [kith](../../products/kith/fe-review/DESIGN.md) | D1/D2：沿用既有真 worker＋本機 D1／seed harness 與既有 fake provider；不加 production fake。D3：沿用 harness，暫不改開發綁定工具。 |
| AC-2 [dim-gate](../../platform/dim-gate/fe-review/DESIGN.md) | A1/A2：既有 e2e 驗證流程；fe-review 負責畫面／a11y，另寫切身分與主題的擷取腳本，不改共用 capture。 |
| AC-3 [hai-taskboard](../../products/hai-taskboard/fe-review/DESIGN.md) | **需重訂基準**：舊 D2 假設已過時。建議以目前 ConnectedApp 重寫設計與隔離資料來源，再審 D1/D3；替代方案是明確保留獨立 legacy fixture 切片，另設入口，不能把 `/` 當 fixture。兩者都尚未實作。 |
| AC-4 [agent-platform](../../platform/agent-platform/fe-review/DESIGN.md) | D1：隔離 PostgreSQL＋真 FastAPI＋fake backend；缺少的狀態以受控 API 覆寫補拍，不能把補拍當真整合驗收。 |
| AC-5 [cms-scaffold](../../apps/cms-scaffold/fe-review/DESIGN.md) | D1 涉及額外範圍：是否允許日後修改共用 packages/ui，且三 app 全套 gate／bundle 測試皆通過？當前設計不需要此權限，可先保留未批准。D2 建議只用 loopback 啟動覆寫，不改共用 Vite 設定。 |
| AC-6 [ice-maker](../../platform/ice-maker/fe-review/DESIGN.md) | A1/A2：保留內嵌頁面，以 fe-review 專用腳本注入既有合成 extractor；不改正式啟動路徑，不引入新依賴。 |
| AC-7 [fleet](../../specs/fleet/fe-review/DESIGN.md) | D1：樣式／a11y 與不改契約的呈現；D2 另需確認：用模板修動作按鈕 swap、Rollback JSON 與錯誤提示。保留 API、cookie、路由契約，不把 D2 混成純樣式授權。 |
| AC-8 [ojbquay](../../systems/ojbquay/fe-review/DESIGN.md) | D1：真 Compose stack 作整合來源，先交付有資源所有權及 loopback 證據的隔離方案；既有預設 stack 不直接沿用，若需後端／Compose 改動另定範圍。 |
| AC-9 [goku](../../products/goku/fe-review/DESIGN.md) | D2：環境設定改成無敏感值範例並移出追蹤；D3：保留 React18／Vite5／Tailwind3，不做 major 升級。 |
| AC-10 [phark](../../products/phark/fe-review/DESIGN.md) | D1：由 fe-review 腳本透過現有 API 建立合成資料，保留真 Spring／SQLite、Session／CSRF 行為；不新增後端 seed command。 |
| AC-11 [flowshot](../../apps/flowshot/fe-review/DESIGN.md)＋[loom](../../apps/loom/fe-review/DESIGN.md) | review-only preload／scenario driver；不改 production IPC。Flowshot 本 FE 切片只做現有 shell 的 Web 截圖，原生／Mac 產品 gate 保留。Loom 要完整事件生命週期，未知 invoke 必須拒絕。 |
| AC-12 [pokercase](../../gateways/pokercase/fe-review/DESIGN.md) | D1：TUI 保留 ANSI 快照，報告用純文字；Web 使用本輪合成登入資料，不連真 provider。 |
| AC-13 [clarkq](../../systems/clarkq/fe-review/DESIGN.md) | D1：隔離 go run＋authenticated API seed，不使用既有 demo Compose project；新建合成 key／state、保留 API 驗證。 |
| AC-14 [fanzloud](../../platform/fanzloud/fe-review/DESIGN.md) | D1：靜態資產＋本機最小假 HTTP／WebSocket API，保留 HTTPS/WSS、session 與事件重播的待驗契約；不改 control-plane、不連 Cloud runner。 |

## 進入下一輪前的已知缺口

1. **hai-taskboard 現況漂移**：[`web/src/main.tsx`](../../products/hai-taskboard/web/src/main.tsx) 匯入並渲染 ConnectedApp；[`web/src/app.tsx`](../../products/hai-taskboard/web/src/app.tsx) 的 legacy fixture App 仍存在，但不是首頁入口。舊 REVIEW C1／DESIGN D2／PROMPT 的 fixture-only 說法不能套在目前 `/`。這是本輪靜態證據；沒有跑 UI，也沒有決定替代產品流程。
2. **共用 cache 規則**：所有實作沿用 owner 的 shared-cache 政策；若個別設計寫了 task-local cache，不構成改設 GOPATH／GOCACHE／GOMODCACHE／CARGO_HOME／npm cache 的授權。僅 task 專用的 build／state／tmp 可隔離；實作前修正具體啟動說明，唯一證據必須保留。
3. **未存在的 harness 不可當成命令**：Flowshot／Loom preload driver、各元件 seed／登入／擷取 wrapper 都需依設計實作並驗證，targets 不提前改 verified。整合與 mock 證據分別記錄。
4. **AC-15 待 owner 明確確認**：既有設計文件仍有待決定項目。建議先確認不擴權的共通方案，hai-taskboard 基準、cms 共用套件權限、fleet 模板行為修正分別決定；本頁不授權新增依賴或下一輪實作。

## 下一入口

先取得上述決策並對 hai-taskboard 做文件校準，再按元件更新 REVIEW 的已決定項與 DESIGN；之後才能提出第 2 輪有界實作。T-0369 維持 in_progress，既有 FAIL 與歷史報告保留，不因本次結構全 PASS 封存卡。
