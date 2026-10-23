# HAI Taskboard FE review

狀態：2026-10-23 首輪設計已按 owner 確認的 ConnectedApp 基準更新；本次僅文件審查，尚未啟動 runtime 或執行瀏覽器驗收。`targets.verified=false`。

| 項目 | 目前事實與處置 |
| --- | --- |
| C1 入口與資料 | [main.tsx](../web/src/main.tsx) 掛載 ConnectedApp，使用真實本機 session／API／snapshot／SSE；舊 fixture App 不代表目前首頁。改採 deterministic Fake-only 同源 runtime。 |
| C2 畫面範圍 | 同一 `/` 的登入、專案清單／建立／開啟、board／Draft、規格接納、Ready／Fake dispatch、命令結果；保留 D1 不加 router。四個舊 fixture 展示面不列為本次現有功能。 |
| C3 錯誤回饋 | [app.tsx:336](../web/src/connected/app.tsx#L336) 已有可見 status／alert，[命令結果](../web/src/connected/app.tsx#L819) 已有拒絕與 uncertain 回饋。舊 D3 改為真實故障回歸驗證，不直接新增一套錯誤 UI。 |
| C4 主題與窄視窗 | [頁內切換](../web/src/connected/app.tsx#L301) 控制 light／dark；需實際操作後取證。OS media、舊 fixture tests 或僅登入頁截圖不能替代 ConnectedApp 的窄視窗／zoom／鍵盤驗收。 |
| C5 權威與命令 | snapshot 是權威，事件只觸發 revalidation；pending／uncertain 不移動 lane。遺失回應允許一次原命令結果 GET，不能再次 POST。 |
| C6 安全啟動 | 同源 127.0.0.1:8080、prebuilt WEB_ROOT、全新合成私有 state、新 session token、精確 Host／Origin、原 cookie 屬性；規格接納另需明確合成 repository approval。詳見 [DESIGN](DESIGN.md)。 |

Owner 已確認的 ConnectedApp 基準及無新路由方向已納入，不再列成待批准。尚未完成的是安全 harness／合成資料／實際 capture 與故障驗收；本輪不執行，也不將歷史 browser evidence 計為本輪通過。

產品仍依 [SUCCESS](../SUCCESS.md) 保持未完成；完整 detail／attention／impact、QA／Done、restore 缺口未由本次文件消除。Fake 成功最多沿現有流程維持 Developing。

後續修改依 [DESIGN](DESIGN.md) 的既有表單、狀態、focus、換行與對比範圍，以觀察到的缺陷為依據；執行後把命令、來源 revision、結果及去敏 artifacts 回填此處。不得透過降低驗證、放寬 cookie 或重送 uncertain mutation 取得成功畫面。
