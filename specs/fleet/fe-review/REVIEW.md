# FE Review — fleet — REVIEW

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1 保留樣式／a11y 與契約限制；D2 採 (a) 模板修正 swap、Rollback JSON、錯誤提示，不改後端 API。 第 2 輪執行情況見下文；完整第 3 輪未驗收。
> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：設計方向已由 owner 確認**；見上方決策紀錄。文件回寫／必要 CI 與後續實作驗證分開追蹤。
- 第 2 輪：M1–M9 實作與限定 runtime/native gate 通過；targets verified 僅限 R2，獨立最終審查／CI／發布由 root 收尾。
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **B（maintain / public contract）**：第 2 輪修改不得改變對外契約；不新增 tutorial 系列。對外契約的具體範圍列在 `DESIGN.md`「依據 → 對外契約」。

## 本輪目前結論與保留限制

### C1 已驗證的私有啟動與真登入

[run-review.mjs](run-review.mjs) 擁有新 SQLite、隨機合成 token、既有 API seed、heartbeat 與 browser/server 清理。基線003真表單 POST/login303，受保護 catalog200，cookie Secure／HttpOnly／SameSite=Lax 均成立。001 的 URL-filtered cookie assertion 失敗與002未產生 inner receipt 均保留；不能用003覆寫歷史。

公開 targets 是四頁路由 inventory，runner 產生分離匿名登入／受保護頁面的私有 targets 與 storageState。原設計 seed.sh 候選由 runner inline API seed 實現，不直接 go run、不安裝新 runtime dependency、不掛 Docker socket、不啟動真 agent/CF/workload。最終12選定截圖（11原圖＋1精確replacement）、12 loaded guards與4 desktop axe已完成；五項axe finding保留，非完整R3。

### C2 公開契約維持

原路由／方法、表單欄位 token、Secure/HttpOnly/Lax cookie、八欄 catalog、tr row-ID、hx-post 目標與原 API JSON 契約均保留。vendored htmx2.0.4、後端 handlers/store/providers 未改。catalog table 仍為第一個 table，仍以 hx-select=table 輪詢。

### C3 M4/M5 聚焦問題已實測修正

catalog-only LivePoll 移除重複 meta refresh，node/service 保留15秒。穩定按鈕 ID 與 disabled 樣式已加入。首 final001 真失敗後，focus001時間線證明 table selector 繼承會排除 row fragment，且 disabled 後在 swap 前焦點已落BODY。Root 明確核准同一 M5 根因修正：row exact hx-select 覆寫，catalog-only WeakMap 在原先聚焦、目前BODY、目標仍存在且enabled時還原，使用者焦點已移往別處則不搶回。Native/VM RED→GREEN，focus002實測 immediate row、請求後焦點與真15秒poll全部通過；final003已通過完整限定互動，包括真Tab移到header後不搶焦點。

### C4 M6/M7 已實作並實測

服務動作保留原 hx-post、改 hx-swap=none 並只在 successful 時 reload；Rollback 使用小型 json-body encoder；錯誤用 role=alert、textContent 顯示 status/error.message。基線003已真實觀測 form body→400 invalid_json、current release不變；實際 declaredJSON=false，不能把舊模板試圖設定JSON header寫成真實header。JSON+cookie202與錯body400原生契約通過，final003真瀏覽器JSON202/current release/reload以及真controlled404 text-only/no reload全通過。

### C5 保留的後端呈現限制

登入失敗仍回 JSON；不存在的 node/service HTML 路由仍純文字404。不在批准模板範圍，未修改。Cloudflare OTP 與真實工作負載未驗證，AC-03 pending、mainline incomplete、usable_tag none。

### C6/M1 與 C7/M2/M3

viewport/table-scroll/wrapping、表格caption/scope、物件名稱、focus-visible已實作。healthy #067a55 與 progressing #8a5a00 已依 WCAG 公式在白底／頁面底色驗算≥4.5:1，保留文字與非色彩符號，node health class一致。最終12 loaded/overflow全通過。service/mobile先測到hidden Actions越出BODY，再以table-scroll相對定位最小修復並補單張截圖；全部PNG混合來源界線見報告。4 desktop axe保留3 serious頁首contrast與2 critical node/service meta-refresh，incomplete0。Root依原DESIGN M2只改Health、M4明訂保留refresh接受R2，不改完整R3零critical/serious條件；完整R3未通過。深色模式仍不支援，未加入。

### C8/M8

明確呈現無services/releases/facts/instance/audit，focused native rendering PASS；真空catalog已在final001驗證。node/releases/instance空狀態已真瀏覽器取證；no-audit用native rendering，不虛稱runtime無audit。

詳細 receipts、失敗與本輪精確限制見 [report](tasks/round2/report.md)。完整R3、所有axe結果、互動console/request觀測與12張matrix必須分開記錄。

## 本次確認的決定

### D1 第 2 輪可修改的範圍

- 選項：(a) 只允許樣式與 a11y 修正；(b) 允許模板結構調整。
- 建議：(a)，符合 B 檔的契約限制。`DESIGN.md` 對 (a) 的解讀：可改 CSS、加不影響行為的屬性與標記（`aria-*`、`scope`、`id`、`<caption>`、viewport、呈現用外層 `div`）與空狀態列，可在 `pages.go` 傳入只影響呈現的資料；不改路由、表單欄位、cookie、`row` 片段與 `hx-post` 路徑。
- 狀態：**2026-10-23 owner 已確認上述選定方案**；未選方案不在授權內。

### D2 服務頁動作按鈕與 Rollback（C4）的修正方式

- 選項：(a) 只改模板：按鈕改 `hx-swap="none"` 並在成功後重載頁面；Rollback 用 `layout.html` 內嵌的小型 htmx 擴充送出 JSON 本體；加一個顯示錯誤回應的 `role="alert"` 區塊。(b) 改後端：`mutateDesired` 對服務頁回 `HX-Refresh` 標頭、`handleServiceDeploy` 另外接受 form 編碼。(c) 第 2 輪不修，只記錄。
- 建議：(a)，不動後端與 API 契約，也不新增 vendored 檔案；它超出 D1 (a)「只做樣式與 a11y」的字面範圍，所以單獨列出。
- 狀態：**2026-10-23 owner 已確認上述選定方案**；未選方案不在授權內。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設（D1、D2）都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
- 設計 PR（`fe-review/design-fleet`，Closes #152）：撰寫 `DESIGN.md`，修正 `targets.json`、`PROMPT.md`。
