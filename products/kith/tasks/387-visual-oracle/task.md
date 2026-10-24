# #387 — 本地 pixel oracle

Status: VERIFIED — 本地 author gates；parent final review/CI/merge 另行記錄

Source base: d8ca3c4089a9fbe852459da3d9602329224230e7. W7 VERIFIED；D16 的 W7 前延期已滿足。AC-VIS01–03 見 [SUCCESS](../../SUCCESS.md)。

範圍：登入、operator 首頁空態、控制台四名合成人類清單；desktop/light 1280×800、DPR1、zh-TW、Asia/Taipei。既有 seed/auth/static bundle，不呼叫模型、不用真內容。鎖定 Node24.18.0、Playwright1.56.1 Chromium1194；作業系統及字型實測記錄於 baseline metadata。

先建立窄 VIS ID／PNG evidence 故障測試，再修改 harness/schema/config。外部瀏覽器請求拒絕；服務只連 loopback/fake provider。候選存於 protected artifacts，獨立視覺審查後才採用。原生 threshold0/maxDiffPixels0（Pixelmatch includeAA=false，不宣稱 RGBA／bytes 完全相同）mismatch RED 與至少三次 fresh GREEN（baseline SHA256 不變）是不同必要證據。

既有 gates 不放寬；所有 npm/build/browser/test 經 shared launcher，唯一 build/dist/state/output 在自身 task。根 CI 不改；本地 pixel gate 及更新規則記錄在 docs/v2/11-visual-oracle.md。未跑檢查、環境偏差與候選未批准均明列。


最終對應證據見 [report](report.md)。核准的 bounded harness 延伸：`e2e/harness/nested.ts` 的 external build／connectivity capability、`e2e/fixtures/kith.ts` 的 opt-in CDP init、`e2e/scripts/run-visual.py` portable runner，以及既有 W0 fault/probe specs。沒有變更產品行為、依賴 lock、root CI 或其他專案。
