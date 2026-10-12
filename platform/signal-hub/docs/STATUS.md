# Signal Hub — STATUS

公開技術進度快照，日期：2026-10-12。任務認領與 owner 驗收仍以 owner 帳本為準。

## 目前狀態

M0 契約、M1 事件 runtime、M2 事件看板／來源新鮮度已分別由 PR #198、#199、#200 合併。M3 已實作並通過驗證：規則指標、版本／回填、門檻事件、設定重載與圖表。合併結果見 [PR #349](https://github.com/fallrising/newclear/pull/349)，驗收紀錄見 [.team/PLAN](../.team/PLAN.md)。尚未部署或接入真實生產者。

| 項目 | 實作與驗證範圍 |
| --- | --- |
| M1／M2 regression | 原有角色隔離、WAL 恢復、事件去重、來源新鮮度與看板流程 |
| M3 規則 | 六種 aggregation、typed filter、UTC 桶、partial／late／停機補算、最多200分組 |
| 版本與回填 | 同版本異內容整份設定拒絕、熱資料回填、舊 rollup 保留、CLI backfill、90K量測 |
| 門檻事件 | complete buckets、連續 crossed／recovered、穩定ID、重算與重啟防重複、分組淘汰恢復 |
| API／重載 | owner／readonly 指標與規則查詢、分頁、owner 重載、失敗保留舊設定及憑證 |
| 圖表 | 原生 React／SVG、時間／分組、版本分隔、partial、threshold、可操作的精確資料表 |
| M4–M6 | 已拆出後續任務；投遞、封存／還原及真實來源／部署驗收未實作 |

## 驗證入口與證據

M3產品版本 `e44afd8e595af46a1867b48aaef89a9f3db5032e` 的[CI38293396899](https://github.com/fallrising/newclear/actions/runs/38293396899)全部通過，含6個真正Go／Chromium案例（21.6秒）。桌面與390px手機指標截圖已目視確認中文、圖表標記與版面；嚴格console/pageerror/HTTP錯誤檢查為零。獨立review與browser補修複審皆通過。

- 先於M3變更驗證原始M2：本機真實 HTTP／SQLite 的34個回應檢查通過；[未修改 main 的 CI run 38289184149](https://github.com/fallrising/newclear/actions/runs/38289184149) 通過 Go／frontend／contracts／HTTP 與5個真正 Go／Chromium案例。這修正了舊文件仍寫 M2 未合併的過期狀態。
- `go test -race -count=1 ./...`、`go vet ./...`、`gofmt` 與 `go build -trimpath -o <binary> ./cmd/signalhub` 是9個Go package的必要 gate。聚合／版本／threshold／失敗隔離測試位於 `internal/rules` 和 `internal/store`，HTTP角色與配置驗證有各自focused tests。
- `npm ci`、`npm run format:check`、`npm test`（17 tests）及 `npm run build`（含TypeScript）通過；CI另檢查重建後dist與提交內容完全一致。沒有新增runtime依賴。
- `python contracts/check.py` 通過6 schemas、61正反fixtures、15 webhook vectors、5 canonical vectors、strict JSON與OpenAPI。`scripts/e2e_smoke.py` 通過34個M1/M2真實HTTP回應；`scripts/e2e_rules.py` 通過39個M3真實HTTP回應，包含大型分組、游標、版本、權限、失敗重載、CLI回填及重啟防重複。
- Quickstart的三段Python範例已原樣執行：真實loopback服務收到202新增／200去重，唯讀可查詢，owner重載成功；停止後CLI回填成功。
- `TestRuleBackfill90K` 在90天90,000筆合成事件上量測：一次回填約2.03秒，8,644筆rollup，總count90,000。Go heap快照約3.43→1.33MB，並非峰值記憶體或生產容量保證。未使用容易抖動的時間上限作測試斷言。
- `browser/metrics.spec.mjs` 補充第6個真實Go／Chromium案例：跨頁指標、保留的舊版本、partial、threshold、分組、桌面／390px手機、token不落地、登出及console/pageerror。舊資料移除僅發生於此案例的合成暫存DB，用來重現未來retention後的版本邊界。
- 本機Chromium缺少系統函式庫；隔離補齊後仍在sandbox啟動前失敗，詳見[T-303](../.team/reports/T-303.md)。未變更host安全政策或停用sandbox；瀏覽器gate使用既有Ubuntu24.04 CI的受支援Chrome路徑。CI的`signal-hub-browser` artifact保存截圖與失敗診斷14天。
- 獨立review發現並要求回歸：停機留下舊partial桶、合法大分組使threshold事件超長、cursor超過HTTP限制、淘汰分組留下crossed狀態。修正及各項獨立複驗見[T-304](../.team/reports/T-304.md)。驗收映射見[PLAN](../.team/PLAN.md)。

## 限制與後續

- [Quickstart](quickstart.md)、[runtime](runtime.md)、[M3實作契約](m3-design.md) 提供操作及精確語義。設定仍使用JSON子集；subscriptions必須為空。
- 200分組上限包含前桶保留的zero／null系列；新增分組可能進入`__other__`。圖表完整載入所選區间的全部分頁，大範圍／高基數會增加瀏覽器記憶體使用。舊版本bucket寬度變更時可能呈現離散點，精確資料仍可查表。
- 尚無retention cleanup；recomputable_from是實際保留的最早事件，並非已套用90天政策。單次評估／回填最多1,000,000桶，超過時明確拒絕且不截斷。
- readyz僅代表DB可用；尚未驗證磁碟耗盡、實體斷電、tailnet ACL、非root部署及持續運作。M4投遞、M5封存還原、M6真實來源／部署驗收各自獨立；部署仍需明確授權。

首次M3遠端CI run38292215976的6個browser案例中5個通過；指標主流程斷言通過，但console404使最後檢查失敗。補上隨binary提供的favicon與Go資源回歸測試；CI另安裝Noto CJK測試字型以修正截圖缺字。最終瀏覽器結果與截圖驗收見[PR #349](https://github.com/fallrising/newclear/pull/349)及[PLAN](../.team/PLAN.md)，保留首次失敗紀錄。

上述首次browser失敗已由CI38293396899的完整6/6通過結案；sandbox保持啟用。最後提交僅同步驗收紀錄，執行檔內容與已驗證產品版本相同。
