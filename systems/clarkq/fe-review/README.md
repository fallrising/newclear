# FE review — ClarkQ

原 R2（DESIGN M1–M3）候選驗證完成。手機長 queue 折行、捲動區鍵盤操作、主要按鈕對比及五秒刷新焦點已修正。獨立審查、必要 CI 與發布由主代理收尾；不代表完整 R3 或新 production／cluster 驗收。

- [報告](tasks/round2/report.md)與[證據索引](tasks/round2/result.json)：三次執行、原始失敗、13份 source hashes、23張私有 PNG。
- [RUNNER](RUNNER.md)：隔離容器、全新 key/state、原始共用 capture 與續跑規則。
- [PROMPT](PROMPT.md)、[REVIEW](REVIEW.md)、[DESIGN](DESIGN.md)、[targets](targets.json)。

共用 capture 三個深色尺寸幾何通過；最後三個長資料頁面 axe violations/incomplete 均0，14項鍵盤/API步驟通過。仍保留預設瀏覽器 `/favicon.ico` 404（一筆 console error），不是零錯誤宣告。受控401／400／斷線另有精確證據。

`targets.verified=true` 僅指已執行的原 R2。需依 RUNNER 提供臨時私有 storageState；受版控 targets 沒有 key，不可裸跑當已登入。PNG、session/state、服務原始日誌均不提交。
