# HAI Taskboard — ConnectedApp 首輪設計

## 目標

Owner 於 2026-10-23 已確認以目前掛載的 ConnectedApp 重做首輪基準；本文件取代舊 fixture App／四個展示畫面的假設。延續 D1：不新增 URL 路由。這是 FE review 的設計與驗收計畫，並非產品完工或本輪已執行瀏覽器驗收的宣告。

後續修改只改善現有 ConnectedApp 的可讀性、操作回饋、鍵盤使用及窄視窗表現；保持 server authoritative board、明確的人類確認、deterministic Fake-only 與既有安全邊界。詳細頁、attention／impact 完整流程、QA／Done 與 restore 等缺口仍依 [SUCCESS](../SUCCESS.md) 保留未完成。

## 依據

- [實際入口](../web/src/main.tsx)：掛載 ConnectedApp；[舊 App](../web/src/app.tsx#L65) 是未掛載的 fixture 實作，不能當成目前首頁或整合證據。
- [ConnectedApp](../web/src/connected/app.tsx#L52)：登入／查詢 session、專案清單與建立／開啟專案、board、建立空 Draft、初始規格接納、MarkReady、Fake dispatch 及命令結果均在同一頁。Board 在 [L500](../web/src/connected/app.tsx#L500) 明示不以 fixture 取代載入中的快照。
- [可見狀態與錯誤](../web/src/connected/app.tsx#L336)：目前已有 role=status 與 role=alert；命令錯誤另在 [L819](../web/src/connected/app.tsx#L819) 顯示。舊 D3「把 sr-only 錯誤改成可見」不再是待實作項，改為驗證現有回饋在實際情境可見且可理解。
- [主題按鈕](../web/src/connected/app.tsx#L301) 是頁內 light／dark 切換；不得假設 OS color-scheme 或重新載入會保留主題。
- [API client](../web/src/connected/client.ts#L67) 使用 same-origin cookie、no-store、禁止 redirect；[CommandRunner](../web/src/connected/commands.ts#L18) 保留原始命令 identity，回應遺失時只自動查詢一次原命令結果，仍 uncertain 才提供手動查詢，不能重送 mutation。
- [BoardStream](../web/src/connected/stream.ts#L14) 先取 snapshot 才訂閱，事件只觸發重新驗證；失聯／reset 先撤除 Connected 權威，generation fence 排除過期回應，auth revoked 停止連線。
- [本機啟動與安全契約](../docs/local-development.md)、[connected runtime SDD](../docs/sdd/connected-local-runtime.md)、[traceability](../docs/traceability.md) 是啟動與證據依據；既有歷史證據不等於本次 targets 已驗證。
- [session component 測試](../web/src/local-session-browser.spec.tsx#L46)、[command 測試](../web/src/connected-board-command.spec.ts#L28)、[重連測試](../web/src/connected-attention-reconnect.spec.ts#L15) 是窄層回歸依據；component 測試與舊 fixture responsive 測試均不能替代真實瀏覽器同源驗收。

## 不做的事

- 不新增 router、四個舊 fixture 展示頁、產品流程、外部依賴或後端 API；不把既有規格接納功能刪掉或改成自動確認。
- 不呼叫真實模型、agent、provider、使用者 repository 或 shell 工作負載；不讀取既有 session、真實任務資料或 provider 憑證。只用新的合成資料與 deterministic Fake。
- 不以 stub、mock API、standalone Vite 或靜態截圖宣稱 runtime 整合通過；不放寬 Host／Origin／cookie／檔案權限驗證，不引入虛構 CSRF token endpoint。
- 不改 SUCCESS 或將 Fake 成功標成 Done；本輪僅文檔重定基準，targets 保持 verified=false。

## 修改項目

1. **基準（本輪）**：同步 DESIGN、REVIEW、PROMPT、targets 到 ConnectedApp；將登入、專案、board、初始規格接納及命令結果列為同頁狀態，不再列四個不存在的 URL 頁面。
2. **後續 FE 範圍**：只在實測顯示問題時調整 ConnectedApp 與其既有樣式的表單分組、標籤、換行、focus、狀態／錯誤對比。保留登入 token 的 password 欄位與送出即清除；保留 exact AC bytes、明確接納 checkbox、版本與 digest 的可讀性。未觀察到缺陷的 D3 不新增重複 alert。
3. **操作契約**：pending／uncertain 不更換 authoritative lane、不重送 mutation；需要 Connected 的操作維持停用。登入失敗、過期 session、revalidating、命令拒絕及結果不確定須清楚區分，不能顯示假成功。Draft 建立不等於接納規格或 Ready；Fake 成功仍為 Developing。
4. **驗證與回退**：後續行為修正先加能失敗的窄層回歸，再以現有 `scripts/check-web.sh` 跑 format／lint／Vitest／build。需要後端接線變動時停止擴張本 FE 範圍。視覺回退只撤回該次 FE patch，保留原有 runtime 契約與舊測試，不清除既有資料。

## 啟動方式

依 [local-development](../docs/local-development.md) 的完整流程建立一次性、可清理的本機 runtime；以下是順序及前置條件，不是尚未驗證的一鍵啟動命令。

1. 遵循[共同隔離協定](../../../docs/fe-review/PROTOCOL.md)：runtime 與 headless 瀏覽器置於同一個獨立 network namespace，禁止 `--network host` 或共用其他服務的 pod；loopback 必須位於此隔離環境。先確認磁碟容量與現有 Node 24.20.x／pnpm 11.25.0／Go pin。於 `products/hai-taskboard` 執行既有 `bash scripts/check-ci-pins.sh web`，再於 `web` 執行 `corepack pnpm install --frozen-lockfile --ignore-scripts` 與 `corepack pnpm build`。沿用共享套件／Go caches，不能把 caches 或 SDK 搬入任務目錄。
2. 依既有 backend build 入口建立 task-owned binary。建立全新、私有 0700 合成 data root，runtime child 起初不存在；資料根在 Git tree 外。build／state／tmp 可分任務隔離，需留存的去敏證據另放指定持久位置，不放會自動清理的 `/tmp`。
3. 使用精確 `HAI_TASKBOARD_LISTEN_ADDR=127.0.0.1:8080`、`HAI_TASKBOARD_ORIGIN=http://127.0.0.1:8080`、本機 actor 與新生成 canonical 32-byte base64url session token。`HAI_TASKBOARD_WEB_ROOT` 指向已建置、符合 owner／非 symlink／不可 group-world write 要求的絕對 web root，且與私有 data root 分離。不得把 token 寫入 targets、命令列、URL、儲存庫、storageState、trace、截圖或日誌；禁止 shell tracing。
4. 若驗收初始規格接納，先建立全新合成 Git repo 及 immutable committed manifest，使用實際新 project／work-item IDs。依文件建立 operator-owned 非 symlink 0600 approved-repositories JSON，設 `HAI_TASKBOARD_APPROVED_REPOSITORIES_FILE` 後才啟動。repository hint 並不授權讀取；不使用使用者 repo，不 fetch、不執行匯入文字，不使用 linked worktree 或 alternates。
5. 同源開啟 `http://127.0.0.1:8080/`。`/healthz` 只代表公開健康檢查可用，不證明 web root、登入或 seed 成功。POST `/api/v1/session` 用 token 換取 `__Host-hai_session`；GET 查詢、DELETE 登出。保留 Secure／HttpOnly／SameSite=Strict 與精確 Host／Origin 檢查，不另設 CSRF token API。採已有 loopback 驗證基礎的 Chromium；其他瀏覽器不預先宣稱支援。
6. 透過真實 UI 建立／開啟專案、建立空 Draft；需要 Ready／Fake dispatch 時明確完成 binding 檢視、proposal、preparation、exact AC bytes 與 acceptance，不能用假 Ready seed 取代契約。每次使用 fresh synthetic state，受控故障測試只能影響自己啟動的程序與連線。
7. 結束時只停止本次持有 PID，等待 graceful shutdown 後才讀取或清理自己的 state；證據先去敏並留存。若發現 OutcomeUnknown／NeedsReconcile，保留事實，不自動重試或標記 Done。

`targets.json` 只描述同源登入入口與健康路徑，不提供 standalone Vite `start`：現有 [Vite 設定](../web/vite.config.ts) 沒有 runtime API proxy。未來 runner 必須先完成上述生命週期與安全登入；通用未登入 capture 只能證明登入頁，不能冒充已登入 board 驗收。

## 第 3 輪驗收

- 視覺：同一 `/` 的未登入、專案清單、已載入 board、規格接納及 command result 狀態；桌面與窄視窗、200% zoom、鍵盤 focus。board 橫向捲動可用且不遮蔽表單／按鈕，長 ID／digest／AC bytes 可讀，沒有整頁非預期溢出。
- 主題：用現有頁內按鈕分別取得 light／dark 證據；若 runner 的 colorSchemes 只改 OS media，不能當成完成暗色主題驗收。
- 真實接線：登入／查詢／登出、專案建立／開啟／刷新、空 Draft、明確規格接納、Ready 及 Fake dispatch。確認 snapshot／事件驅動更新，成功 Fake 不進 Done；對照 exact command identity 與前後 authoritative snapshot。
- 故障：錯誤 token、session 撤銷、已知 command rejection、失聯回應、reset／reconnect。pending／uncertain 不自動重送 POST；允許既有的一次自動原結果 GET，手動 recovery 仍查同一命令。遲到的登入／登出／snapshot 不得覆蓋新 session。截圖與 trace 避開 token 填寫，保存前檢查無 token／cookie／其他秘密。
- 可見回饋：role=status／alert、停用控制、uncertain 與 revalidating 必須對視覺及輔助科技可辨；本條驗證既有 D3 實作，不預判缺陷。
- 證據門檻：記錄精確來源 revision、環境、命令、結果及去敏 artifact；跑既有 web gate 與必要的窄層／少量真實瀏覽器流程。只有實際完成 startup、session、seed、互動與證據核對後才考慮更新 targets.verified；仍不代表產品 SUCCESS 完成。

## 開放問題

Owner 的 ConnectedApp 基準與 D1 不加 router 已確認，不再重複求批。尚待後續實測決定的技術事項：capture runner 如何管理同源 runtime／安全 session／合成 admission 資料、故障注入與去敏 artifact。它們是驗收實作工作，不構成目前已執行或已通過的證據。若實測需要新增 API、擴張產品流程或放寬安全邊界，應回報超出本次 FE 範圍。
