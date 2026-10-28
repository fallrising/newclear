# Self-authorization source evidence — 2026-10-28

[SA01–04](../self-authorization.md)新增正常認證後的machine self metadata來源及runner獨立查詢模式。這是source與本機驗證，不是已部署的原Lab功能；沒有雲端查詢、續權、token／secret生成或服務變更。

## 測試

共用launcher執行`python3 platform/cloud-lab/tools/check.py`，最終41Node＋135Python＝176tests通過，無失敗或略過。新增3個Worker案例、1個真實HTTP整合及11個Python案例。

- 正常HMAC／grant／nonce流程、僅自身metadata、空JSON、錯簽名／replay／過期／撤銷／human拒絕。
- 嚴格response schema、credential id／generation、grant引用、scope及時間驗證；沒有讀不到就使用歷史bundle的fallback。
- 真正本機HTTP→Worker→SQLite D1→Python CLI：metadata查詢成功，commands／grants／schedules逐列相等；journal及lock檔不存在；正常防重播nonce增加1筆。合成human403、撤銷machine後CLI固定診斷exit1。
- config拒絕非0600、hardlink及最後一層symlink；CLI不得與once／stop-at混用，不呼叫journal／lock／claim／report。
- 真實緩慢HTTP response以0.2秒測試期限中止，耗時小於0.8秒；遲到connect完成不送request；redirect／HTML／超限及401／403／500拒絕且無重試或provider body洩露。

stdout只含來源時間及期限；Access service-token expiry與resident stop保留null，deadline_complete=false。scope／id與secret沒有出現在CLI輸出。

## RED與限制

初次Node命令未使用repo慣例`--test-isolation=none`，只得到opaque file failure；沒有把它算作行為RED。改用既有模式後，3個新Worker案例以404／預期200或422失敗。Python初始8cases因尚無新模式/API出現26errors；均保留。第一輪完整173GREEN後，獨立審查要求修正總deadline。

Reviewer指出post-return elapsed檢查不能中斷緩慢stream；lead加入真實slow-stream回歸，初始1.960秒超過0.8秒界線而失敗，再加入可取消transport。最終176GREEN包含修正。證據位於共用workspace SA-red、SA-node-red、SA-unit、SA-regression、SA-deadline-red、SA-final-regression的protected evidence。

Node SQLite experimental warning與Python既有測試的unclosed SQLite ResourceWarning保留；suite仍通過，不宣稱無warning。新transport總deadline限制caller等待與已連線socket；DNS解析若阻塞可留在daemon thread直到OS返回，取消後不送請求。任意OS阻塞不是硬即時保證；自訂注入client須自行實作transport界限。

## 交付邊界

獨立審查結果見[T828](../../../../.team/reports/T-828.md)，Git／CI與合併後收尾見[任務板](../tasks/BOARD.md)。原AS採集器沒有自動合併self metadata；新版Worker與runner尚未安裝，原Lab已知過期狀態不因本機測試改變。程序觀測契約已定義，實作仍待下一任務；不能從CLI啟動參數推定另一resident程序的stop-at。完整AC06–08仍pending，沒有usable tag。
