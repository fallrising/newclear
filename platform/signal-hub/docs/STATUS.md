# Signal Hub — STATUS

公開技術進度快照，日期：2026-10-13。任務認領與 owner 驗收仍以 owner 帳本為準。

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
| M4 | 訂閱、webhook／ntfy、摘要、重試、DLQ／重放與投遞看板已通過獨立審查及全部CI；整合紀錄見PR #351 |
| M5 | 封存／匯回、一致備份與隔離還原已實作，完整 gate 與獨立審查進行中 |
| M6 | 真實來源／部署驗收未實作 |

## M5 隔離還原演練（整合驗證中）

2026-10-13 使用本輪自建暫存目錄與合成資料。`go test -race -count=1 ./cmd/signalhub` 通過（3.616秒），含真正服務 subprocess／SQLite／TLS 接收端：先建立 pending、inflight、DLQ，封存驗證清除後產生一致備份；停止來源服務，還原至全新 DB 並匯回 archive；原事件可查且帶 restored，原 seq 保留。pending／lease 到期工作續作，readonly 無法 replay、owner 附理由重放成功；持久化接收端只接受三個唯一 delivery ID，原 bytes/HMAC 與備份 SHA 不變。不是生產資料或正式通知帳號驗收。

`scripts/e2e_archive.py --binary <binary>` 通過61個 HTTP/OpenAPI回應與17個CLI結果，獨立核對 gzip／SHA256／manifest／membership／精確清除、寫入與驗證失敗、遲到新part、200去重／409衝突、重複匯回期限／audit／cursor、規則回填與不重送歷史、live-WAL一致備份、隔離查詢／新事件／queue恢復。整合版本 `d73f10ac100e22be9571582007bab84c7e8e216d` 的完整 `go test -race -count=1 ./...` 通過10個套件（store375.340秒）；vet、format、build、28個前端測試／types／format／build、6 schemas／64 fixtures／15 webhook／5 canonical向量，以及原有142個HTTP回應全部通過。browser fixture獨立probe也通過。獨立review及遠端Chromium/CI仍待完成；[PR #352](https://github.com/fallrising/newclear/pull/352) 尚未合併。

首版[CI38395539540](https://github.com/fallrising/newclear/actions/runs/38395539540)通過10個race套件、28前端測試、contracts、203個HTTP回應／17個M5 CLI結果及9個sandboxed Chromium案例（24.7秒）。桌面與390px手機匯回詳情截圖已目視確認，沒有缺字或水平溢出，browser health無異常。但獨立[T-504](../.team/reports/T-504.md)的R1發現DB識別只查部分欄位會接受不完整／未支援schema，故首版未被接受。T-506加入寫入前read-only完整schema驗證，原始失敗與修正證據分開保存；獨立複驗與修正版完整gate仍進行中。

## M4 驗證結果

R1修正後完整 `go test -race -count=1 ./...` 再次通過10個套件（store289.763秒）；vet、format、正式binary build、contracts及142個HTTP回應也重新通過。

本機已完成 webhook／ntfy、daily digest、持久化 cursor／claim／attempt、12次重試上限、兩分鐘lease、DLQ事件與附理由owner重放。兩個channel共用HTTPS精確allowlist與DNS/IP/TLS防護；不新增runtime依賴。新增投遞看板保留M1–M3視圖。獨立審查與遠端CI均已通過；合併狀態見 [PR #351](https://github.com/fallrising/newclear/pull/351)。這不是部署或正式帳號驗收。

- `go test -v ./cmd/signalhub -run TestM4RealServiceDeliveryRecovery -count=1`：實際service subprocess／SQLite與本機TLS接收端，500×3→200、400→DLQ→重放、ntfy／摘要、SIGKILL→lease到期→持久化接收端去重，全部通過。固定15個HMAC向量也由參考接收端驗證。時鐘與唯一測試接收端在Go測試內注入；正式CLI不提供繞過安全政策的選項。
- `scripts/e2e_delivery.py`：69個正式binary HTTP／OpenAPI回應通過，涵蓋啟用起點、分頁、角色、理由／audit、拒絕重載保留舊憑證及實際未dial loopback。此腳本只推進合成資料的最後重試次數；完整12次狀態機另有focused測試。
- M1／M2的34個與M3的39個真實HTTP回應全部通過；contracts為6schemas、63fixtures、15webhook向量、5canonical向量。
- 前端format、26個unit tests（保留原17個）、TypeScript與build通過。兩個新增Chromium案例涵蓋六種決策／執行事件關聯鏈，以及101訂閱／105投遞、角色隔離與重放。HTTP／SQLite fixture probe通過；本機Chrome缺`libnspr4.so`，實際browser驗收已在CI38379149575全部通過，未停用sandbox。
- 初次服務整合測試發現HTTP400因non-nil error摘要被誤分類成連線重試；修正為以有效HTTP狀態判斷，新增400／301帶摘要回歸，真實服務DLQ／重放重新通過。未放寬驗證。

- 獨立審查發現合法極端offset時間造成摘要cursor解析失敗與無效公開日期；已改用精確Unix秒持久化，公開邊界保持RFC3339有限年域，新增兩個原生回歸。四項獨立race probes及focused race全部通過，R1已結案，見[T-404](../.team/reports/T-404.md)。

M4產品版本 `10316c7948e9f6b8192915344dfbd9ad79827b3a` 的[CI38379149575](https://github.com/fallrising/newclear/actions/runs/38379149575)通過全部gate：10個Go race套件、26前端測試、contracts、143個HTTP回應（34+39+70；poll次數可隨時序略變）、8個真正Go／Chromium案例（19秒）。桌面投遞、390px手機與關聯鏈截圖已目視確認中文、狀態、理由與權限提示可讀；手機無水平溢出，預期重放403之外的console/pageerror/HTTP錯誤為零。驗收映射見[PLAN](../.team/PLAN.md)。最後文件提交保留相同執行檔內容並再次通過必要CI後正常整合。

## M3 歷史驗證入口與證據

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

- [Quickstart](quickstart.md)、[runtime](runtime.md)、[M3實作契約](m3-design.md) 提供操作及精確語義。設定仍使用JSON子集；M4訂閱契約見 [M4設計](m4-design.md)。
- 200分組上限包含前桶保留的zero／null系列；新增分組可能進入`__other__`。圖表完整載入所選區间的全部分頁，大範圍／高基數會增加瀏覽器記憶體使用。舊版本bucket寬度變更時可能呈現離散點，精確資料仍可查表。
- M5 只在手動命令或明確維護目錄設定時執行驗證後封存清除；recomputable_from是實際熱資料的最早事件。單次評估／回填最多1,000,000桶，超過時明確拒絕且不截斷。
- readyz僅代表DB可用；尚未驗證磁碟耗盡、實體斷電、tailnet ACL、非root部署及持續運作。M5封存還原與M6真實來源／部署驗收各自獨立；部署仍需明確授權。

首次M3遠端CI run38292215976的6個browser案例中5個通過；指標主流程斷言通過，但console404使最後檢查失敗。補上隨binary提供的favicon與Go資源回歸測試；CI另安裝Noto CJK測試字型以修正截圖缺字。最終瀏覽器結果與截圖驗收見[PR #349](https://github.com/fallrising/newclear/pull/349)及[PLAN](../.team/PLAN.md)，保留首次失敗紀錄。

上述首次browser失敗已由CI38293396899的完整6/6通過結案；sandbox保持啟用。最後提交僅同步驗收紀錄，執行檔內容與已驗證產品版本相同。

M4首次CI38377908329：native gates全部通過，Chromium7/8（AC-37與原有6例通過）。投遞案例因implicit label locator超時；快照存在正確combobox無障礙名稱。兩處改為精確role/name，保留原斷言與timeout，經T-405獨立複審後由CI38379149575完整8/8通過結案。
