# FE Review Prompt — phark

先讀 [PROTOCOL](../../../docs/fe-review/PROTOCOL.md)、元件 AGENTS/SUCCESS、[REVIEW](REVIEW.md)、[本輪報告](tasks/round2/report.md) 及 [RUNNER](RUNNER.md)。原 M1–M3 已完成限定實測，targets.verified 不表示第 3 輪完整健康或產品主線完成。後續工作須依當次明確任務，不因本檔擴張 dormant 例外。

前端 React19/Vite8/Tailwind4/Radix，既有 /api proxy 保持 localhost8080；後端 Spring/SQLite。owner 已確認 [D1 API fixture 方案](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)。使用現有 runner 的全新 private DB/media、即時 credentials、真 Session/CSRF 與預設 quotas，不寫 DB、不降低安全規則、不使用正式資料。

啟動由外層隔離 launcher 控制；參考 [RUNNER](RUNNER.md)。Vite mirror 保留 hash-pinned 原插件／alias／proxy，只有 cache/state 改到 private mount。原始 vite.config.ts 不改。每次 run ID、state 必須全新，不覆寫歷史。

真實四路由為 /、/notifications、/search?q=fe-review、/profiles/<actual returned handle>。shared-capture.mjs 以實際 fixture handle 和 private storageState 產生完整 targets，呼叫原 docs/fe-review/capture.mjs，不用 fake --start。靜態 targets 三個固定路由不是動態登入 fixture 的替代品。

保持手機橫向 deck 與桌面三欄。頁面 overflow 與容器 scroll/client width 分開檢查；真 Tab focus-visible、每欄 load-more、opaque cursor/stable identity、pending/error/request ID、optimistic rollback、session切換與登出皆有分開的真 API／controlled mock 證據。不要把 mock 當 Spring 接線。

目前只驗 light；對比 incomplete、Search moderate landmark 與歷史 abort/FAIL 見 REVIEW。後續第3輪須重新取得該輪授權與完整清單，不能以本次12-key matrix或文件verified代替。

沿用 npm run lint、npm run build（含tsc -b）；沒有 frontend test script。review guards 使用 Node 內建 test。PNG、raw logs、cookies、DB/media 保留 private；只提交安全合成摘要、來源／artifact hashes 與報告。未知健康事件仍 fail，精確例外必須有同一請求與後續狀態證明。
