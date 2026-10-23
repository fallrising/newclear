# HAI Taskboard 後續 FE review 提示

先讀 [DESIGN](DESIGN.md)、[REVIEW](REVIEW.md)、[targets](targets.json)、[local-development](../docs/local-development.md) 與 [SUCCESS](../SUCCESS.md)。Owner 已確認 2026-10-23 的 ConnectedApp 基準及 D1 不新增 router；不要重問這兩項，也不要把舊 fixture App 視為目前入口。

目前 main.tsx 掛載 ConnectedApp。工作限於現有同頁登入、專案、board／Draft、初始規格接納、Ready／Fake dispatch、命令結果的視覺與可用性。先確認實際問題，再調整表單分組、可讀性、focus、換行或對比；D3 可見 status／alert 已存在，應驗證而非預設需補一套錯誤 UI。不新增 detail／attention／impact／Done 功能或 URL。

啟動與資料：

- 遵循[共同隔離協定](../../../docs/fe-review/PROTOCOL.md)，runtime 與瀏覽器使用同一個獨立 network namespace；禁止 `--network host` 或共用其他服務的 pod。
- 依文件建立 pinned frontend build、backend binary 與同源 runtime；exact origin 為 `http://127.0.0.1:8080`，設定符合契約的 prebuilt WEB_ROOT。不要用沒有 API proxy 的 standalone Vite 作為整合入口。
- 使用全新私有合成 state 與 session token、deterministic Fake；共享 caches 保持預設。只操作自己持有的程序與合成 repo，不啟用 provider／真實 agent，不讀既有使用者資料或憑證。
- 保留 exact Host／Origin 及 Secure／HttpOnly／SameSite=Strict cookie；POST／GET／DELETE `/api/v1/session` 是既有登入／查詢／登出契約，不新增 CSRF token endpoint。禁止 token 落入 targets、URL、storage、trace、截圖、日誌或儲存庫。
- 規格接納需先依文件批准新合成 repository，使用 immutable manifest 與實際 project／work-item IDs；repository hint 不等於 approval。明確完成 proposal、preparation、exact AC bytes、acceptance；不能假造 Ready。
- `/healthz` 只證明健康端點；未登入 capture 只能證明登入畫面。安全 runtime／session／seed harness 尚待後續實作與實測，本輪沒有已驗證啟動命令。

驗收依 DESIGN：桌面／窄視窗、200% zoom、鍵盤、頁內 light／dark；包含上述真實同頁操作與錯誤 token、session revoked、拒絕、uncertain、reset／reconnect。snapshot 才是權威；pending／uncertain 不移動 lane、不重送 POST，既有自動原結果 GET 與手動 lookup 必須沿用原 command identity。確認過期 session／snapshot 回應被隔離。Fake 成功保持 Developing，不能宣稱 Done。

行為修正先有能失敗的窄層 regression，再跑既有 web gate；component／fixture tests 不能替代真實 browser acceptance。只保留去敏證據，記錄來源 revision、精確命令與結果；持久證據不要放 disposable tmp。停止時等待自己的 runtime graceful shutdown 才處理自己的 state。

本次文件基準不代表產品或瀏覽器驗收完成。`targets.verified` 保持 false，直到真正完成 startup、session、合成資料、互動及證據核對；更新 REVIEW 時列明未通過／未執行項，不改寫 SUCCESS 的未完成結論。
