# T-0369 第 1 輪交付與確認紀錄

來源：main `f6d07b45fd8dee7acf4a050efaf908db8449def4`（2026-10-23）。本頁是 [SDD](SDD.md) 的證據與決策索引，不修改 SDD，不宣告第 2 輪或產品驗收完成。

**最新交付狀態（2026-10-23）：** #564 與 #565 已通過必要 CI 並合併；整合主線 `71b19d6283729e6ce6ed2ade042fc15c749a5ddb` 的 AC-1～14 全部 PASS，AC-15 的明確 owner 確認已回寫。第 1 輪設計交付完成，結案紀錄由任務板與帳本保存；[最終證據](#final-delivery-20261023) 見文末。以下各輪時間與待決策紀錄保留當時情況。

## 歷史輪次目標、範圍與停止條件

Owner 要求繼續接手收尾。本輪從 2026-10-23T16:36:34Z 起，16:53:34Z 停止新工作，16:56:34Z 截止，含 CI 等待及交接。只核對既有設計 PR、執行文件檢查、彙整待決策內容並回寫帳本；不啟動 UI、capture、runtime 修復或反覆 CI。未通過必要 CI 不合併；人工決策未取得不寫 AC-15 通過。工具數不代表 provider 用量；tokens／provider requests／費用未知。

## 已確認的交付證據

- [PR #555](https://github.com/fallrising/newclear/pull/555) 的 head `599ae5afe7dc9218fb2aaf4edb2de0f24d8bd1e6`：本輪獨立核對 12 個修改檔案均在配對元件 fe-review 範圍，AC-11、81 個相對連結、targets JSON 與空白檢查通過。targets 仍未驗證；無產品程式變更。沒有未解 review thread。
- 同 head 的 Flowshot CI（[39984881909](https://github.com/fallrising/newclear/actions/runs/39984881909)）Linux／Intel Mac／Apple Silicon Mac、Loom CI（[39984881895](https://github.com/fallrising/newclear/actions/runs/39984881895)）及 contracts（[39984881849](https://github.com/fallrising/newclear/actions/runs/39984881849)）五項全部 SUCCESS。Linux gate 耗時 25m35s；本輪只等待並讀取既有 run，未重新觸發。PR 從 draft 轉 ready 後於 16:39:41Z 正常合併。
- 在上述 main 執行 `python3 docs/fe-review/check_design.py`：AC-1～AC-14 全部 PASS、exit 0。共 14 個設計單位、15 份 DESIGN（Flowshot＋Loom 配對）。這只證明文件存在及七個標題完整，不能推論內容仍符合最新程式或 AC-15 已完成。
- 未執行本輪 UI／browser／runtime 測試；第 1 輪 SDD 明確排除這些工作。既有 CI 不取代第 2／3 輪實跑證據。

## 設計決策清單

下列選定方案已由 owner 明確確認；連結指向完整修改、驗證與回滾方案。hai-taskboard 以 ConnectedApp 校準，不沿用 legacy fixture 首頁；CMS 共用 UI 維持先提議。確認依據是下方本次明確答覆，並非 agent merge 或結構 PASS。

| AC／單位 | 本次可審閱的建議與範圍 |
| --- | --- |
| AC-1 [kith](../../products/kith/fe-review/DESIGN.md) | D1/D2：沿用既有真 worker＋本機 D1／seed harness 與既有 fake provider；不加 production fake。D3：沿用 harness，暫不改開發綁定工具。 |
| AC-2 [dim-gate](../../platform/dim-gate/fe-review/DESIGN.md) | A1/A2：既有 e2e 驗證流程；fe-review 負責畫面／a11y，另寫切身分與主題的擷取腳本，不改共用 capture。 |
| AC-3 [hai-taskboard](../../products/hai-taskboard/fe-review/DESIGN.md) | **已選定 ConnectedApp**：以目前入口重寫設計及隔離資料來源，保留 Fake-only 與 application commands；不另開 legacy fixture 首頁，不新增產品功能。校準文件已由 [#565](https://github.com/fallrising/newclear/pull/565) 驗證並合併。 |
| AC-4 [agent-platform](../../platform/agent-platform/fe-review/DESIGN.md) | D1：隔離 PostgreSQL＋真 FastAPI＋fake backend；缺少的狀態以受控 API 覆寫補拍，不能把補拍當真整合驗收。 |
| AC-5 [cms-scaffold](../../apps/cms-scaffold/fe-review/DESIGN.md) | D1 已選 (b)：共用 packages/ui 維持先提議，沒有直接修改授權；D2 採 loopback 啟動覆寫，不改共用 Vite 設定。 |
| AC-6 [ice-maker](../../platform/ice-maker/fe-review/DESIGN.md) | A1/A2：保留內嵌頁面，以 fe-review 專用腳本注入既有合成 extractor；不改正式啟動路徑，不引入新依賴。 |
| AC-7 [fleet](../../specs/fleet/fe-review/DESIGN.md) | D1：樣式／a11y 與不改契約的呈現；D2 已確認：用模板修動作按鈕 swap、Rollback JSON 與錯誤提示。保留 API、cookie、路由契約，不把 D2 混成純樣式授權。 |
| AC-8 [ojbquay](../../systems/ojbquay/fe-review/DESIGN.md) | D1：真 Compose stack 作整合來源，先交付有資源所有權及 loopback 證據的隔離方案；既有預設 stack 不直接沿用，若需後端／Compose 改動另定範圍。 |
| AC-9 [goku](../../products/goku/fe-review/DESIGN.md) | D2：環境設定改成無敏感值範例並移出追蹤；D3：保留 React18／Vite5／Tailwind3，不做 major 升級。 |
| AC-10 [phark](../../products/phark/fe-review/DESIGN.md) | D1：由 fe-review 腳本透過現有 API 建立合成資料，保留真 Spring／SQLite、Session／CSRF 行為；不新增後端 seed command。 |
| AC-11 [flowshot](../../apps/flowshot/fe-review/DESIGN.md)＋[loom](../../apps/loom/fe-review/DESIGN.md) | review-only preload／scenario driver；不改 production IPC。Flowshot 本 FE 切片只做現有 shell 的 Web 截圖，原生／Mac 產品 gate 保留。Loom 要完整事件生命週期，未知 invoke 必須拒絕。 |
| AC-12 [pokercase](../../gateways/pokercase/fe-review/DESIGN.md) | D1：TUI 保留 ANSI 快照，報告用純文字；Web 使用本輪合成登入資料，不連真 provider。 |
| AC-13 [clarkq](../../systems/clarkq/fe-review/DESIGN.md) | D1：隔離 go run＋authenticated API seed，不使用既有 demo Compose project；新建合成 key／state、保留 API 驗證。 |
| AC-14 [fanzloud](../../platform/fanzloud/fe-review/DESIGN.md) | D1：靜態資產＋本機最小假 HTTP／WebSocket API，保留 HTTPS/WSS、session 與事件重播的待驗契約；不改 control-plane、不連 Cloud runner。 |

## 進入下一輪前的驗證前提

1. **hai-taskboard 現況漂移**：[`web/src/main.tsx`](../../products/hai-taskboard/web/src/main.tsx) 匯入並渲染 ConnectedApp；[`web/src/app.tsx`](../../products/hai-taskboard/web/src/app.tsx) 的 legacy fixture App 仍存在，但不是首頁入口。舊 REVIEW C1／DESIGN D2／PROMPT 的 fixture-only 說法不能套在目前 `/`。這是靜態證據；本次 owner 已選 ConnectedApp，校準設計不得退回 legacy fixture 入口，也不新增產品流程。
2. **共用 cache 規則**：所有實作沿用 owner 的 shared-cache 政策；若個別設計寫了 task-local cache，不構成改設 GOPATH／GOCACHE／GOMODCACHE／CARGO_HOME／npm cache 的授權。僅 task 專用的 build／state／tmp 可隔離；實作前修正具體啟動說明，唯一證據必須保留。
3. **未存在的 harness 不可當成命令**：Flowshot／Loom preload driver、各元件 seed／登入／擷取 wrapper 都需依設計實作並驗證，targets 不提前改 verified。整合與 mock 證據分別記錄。
4. **AC-15 的人工決策已取得**：11 個一般設計單位採原清單建議、hai-taskboard 採 ConnectedApp、CMS 維持限制、Fleet 採模板修正。文件校準／CI 交付完成後才能結束本卡；這不授權新增依賴、發布或部署。

## 當時下一入口（owner 確認回寫前）

完成本次決策回寫與 hai-taskboard ConnectedApp 文件校準，通過審查及必要 CI 後對帳結束 T-0369。後續第 2 輪按各元件 DESIGN 另定有界實作；本次不一次啟動全部 runtime 工作。原歷史 FAIL 與未執行驗證保留。


<a id="owner-confirmation-20261023"></a>
## 2026-10-23 owner 明確確認

Owner 對前述三組具體建議回答：「全部同意，搞吧。」本輪開始觀測時間為 2026-10-23T16:57:29Z，對話未另提供訊息發送秒數；不把觀測時間冒充發送時間。

- 11 個一般設計單位採本頁建議與所連完整設計；不加入新功能、major 升級或新的 runtime 依賴。
- hai-taskboard 以**現行 ConnectedApp**校準設計；不把舊 fixture App 當首頁或完整整合證據。
- CMS 的 `packages/ui` 維持先提議；Fleet 採已列出的模板 swap／Rollback JSON／錯誤提示修正，後端 API 契約不變。
- 這是 AC-15 所需的人類設計確認。當時各文件回寫、hai-taskboard 校準及必要 CI 仍須完成，不追溯抹去原待確認／FAIL 歷史，也不把產品 SUCCESS 改成通過。

本輪期限：16:57:29Z 開始，17:14:29Z 停新工作、17:17:29Z 截止（含審查、CI、收尾）。只完成設計確認與文件交付，沒有執行第 2／3 輪 runtime。


<a id="final-delivery-20261023"></a>
## 2026-10-23 最終設計交付證據

- Owner 已明確確認上列三組建議。AC-15 以本頁確認紀錄、完整假設清單與 owner 的持續合併授權為依據；正常合併由受託 agent 執行，不冒稱 owner 親自按下合併，也不以 CI 代替人類確認。
- [#564](https://github.com/fallrising/newclear/pull/564)：head `6c17f1042d577669b7bb631cc20beaee4f951243` 的 27 項 CI 全部 SUCCESS；先前獨立審查接受 45 份文件及 312 相對連結，無未解審查討論。18:02:18Z 正常合併為 `71b19d6283729e6ce6ed2ade042fc15c749a5ddb`，fetch 後 45 檔與已審閱來源一致。
- [#565](https://github.com/fallrising/newclear/pull/565)：head `0a4ad7901c825cfc9e943904be1a8d89281f15d6` 的 backend／web／contracts 三項 CI SUCCESS；ConnectedApp 四檔經作者以外來源核對、AC-3 與 38 相對連結／JSON 檢查通過。17:17:05Z 正常合併為 `9dbe8c6c0238a21b6c7ab8cab7aa93b7323d961d`，四份遠端內容回讀一致。
- 在整合主線 `71b19d6283729e6ce6ed2ade042fc15c749a5ddb` 執行 `python3 docs/fe-review/check_design.py`：AC-1～14 全部 PASS；`python3 scripts/check_project_success.py` 與 `python3 scripts/check_indexes.py`：42 契約及導航索引 PASS；`python3 -m unittest discover -s scripts/tests -q`：20 tests PASS。
- 以上結論限於第 1 輪設計。沒有在本輪啟動 UI、capture 或 runtime；targets 保持未驗證，產品 SUCCESS 與第 2／3 輪不因此完成。舊 FAIL 和當時待決策紀錄保留原意。

完成紀錄以[任務板](../tasks/BOARD.md#t-0369)追蹤；後續實作須按各元件已確認 DESIGN 另定有界工作，不在本次收尾啟動。
