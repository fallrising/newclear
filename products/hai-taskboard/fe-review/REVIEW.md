# HAI Taskboard FE review

狀態：2026-10-24 原批准R2本機驗證通過；真實同源ConnectedApp／session／admission／Fake與30唯一畫面已實跑，targets.verified=true僅原R2。最終獨立複審／CI／交付分開追蹤，詳見 [本輪報告](tasks/round2/report.md)。

| 項目 | 目前事實與處置 |
| --- | --- |
| C1 入口與資料 | [main.tsx](../web/src/main.tsx) 掛載 ConnectedApp，使用真實本機 session／API／snapshot／SSE；舊 fixture App 不代表目前首頁。改採 deterministic Fake-only 同源 runtime。 |
| C2 畫面範圍 | 同一 `/` 的登入、專案清單／建立／開啟、board／Draft、規格接納、Ready／Fake dispatch、命令結果；保留 D1 不加 router。四個舊 fixture 展示面不列為本次現有功能。 |
| C3 錯誤回饋 | [app.tsx:336](../web/src/connected/app.tsx#L336) 已有可見 status／alert，[命令結果](../web/src/connected/app.tsx#L819) 已有拒絕與 uncertain 回饋。舊 D3 改為真實故障回歸驗證，不直接新增一套錯誤 UI。 |
| C4 主題與窄視窗 | [頁內切換](../web/src/connected/app.tsx#L301) 控制 light／dark；需實際操作後取證。OS media、舊 fixture tests 或僅登入頁截圖不能替代 ConnectedApp 的窄視窗／zoom／鍵盤驗收。 |
| C5 權威與命令 | snapshot 是權威，事件只觸發 revalidation；pending／uncertain 不移動 lane。遺失回應允許一次原命令結果 GET，不能再次 POST。 |
| C6 安全啟動 | 同源 127.0.0.1:8080、prebuilt WEB_ROOT、全新合成私有 state、新 session token、精確 Host／Origin、原 cookie 屬性；規格接納另需明確合成 repository approval。詳見 [DESIGN](DESIGN.md)。 |

Owner 已確認的 ConnectedApp 基準及無新路由方向已納入，不再列成待批准。安全harness／合成資料／實際capture與有界故障驗證已有本輪新證據；既有歷史browser evidence沒有被冒作本輪通過。

產品仍依 [SUCCESS](../SUCCESS.md) 保持未完成；完整 detail／attention／impact、QA／Done、restore 缺口未由本次文件消除。Fake 成功最多沿現有流程維持 Developing。

後續修改依 [DESIGN](DESIGN.md) 的既有表單、狀態、focus、換行與對比範圍，以觀察到的缺陷為依據；執行後把命令、來源 revision、結果及去敏 artifacts 回填此處。不得透過降低驗證、放寬 cookie 或重送 uncertain mutation 取得成功畫面。


## 本輪已觀測、未修正的限制

- 已接納的current requirement/head為1，但board讀legacy表仍顯示AC0；不得以該計數宣稱正確覆蓋，見 [唯讀狀態證據](tasks/round2/admission-state-check.json)。
- Prepared／Developing畫面有較早command refresh的「Projection refresh unavailable」提示，同時後續SSE snapshot已恢復Connected。這是不同時間的結果並列造成的既有回饋限制；本次不改backend／commands／stream，也不隱藏提示。
- 30張actualtheme／三尺寸畫面axe0／overflow0，不等於零UI缺陷。真Tab／3pxfocus／ArrowRight、真runtime斷線與恢復、controlledreset／sessionloss／logout均通過；完整zoom／coarse-pointer／產品UX驗收仍不在本輪完成宣告內。
- 既有D3 status／alert已驗證拒絕與uncertain回饋，未增加重複alert。下拉選單實際accessible names與label關聯正常；原exactlabel timeout是harness對包含option文字的labeltext假設，保留於歷史FAIL。
