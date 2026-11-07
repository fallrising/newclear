# M1 interruption and lost-report qualification

本輪依owner「繼續開發」驗證既有恢復語義，先建立可重跑的隔離故障工具；若發現缺陷才修改產品runtime。Python 3.11標準庫、Node既有built-ins；實際Worker測試沿用外部既有Miniflare/workerd工具鏈，沒有新增產品依賴或套件管理器。

| AC | 故障與可觀察結果 | 層次 |
| --- | --- | --- |
| FR-01 | started提交後、collector完成前SIGKILL；重啟不再次採集，回報unknown，控制面維持reconciling／active而非成功 | 真實Python程序、SQLite；實際workerd/D1 binding |
| FR-02 | completed提交後、回報抵達控制面前斷線；journal精確保留，lease自然到期後取得新reconcile_only fence，原樣重報結果 | 真實HTTP／程序與實際workerd/D1 binding |
| FR-03 | 控制面已保存回報但ACK遺失；重啟claim為空、同命令仍terminal，collector次數不增加 | 真實HTTP／程序與實際workerd/D1 binding |
| FR-04 | 對帳驗證command identity／external_ref／artifact bytes與時間；舊fence被拒絕；unknown保持容量占用；重複submit同ID | 獨立對帳斷言，保留每個故障階段snapshot |

本機回歸測試使用受控HTTP服務；可選qualification執行未改寫的Worker、migration、實際D1 binding與Python runner，使用synthetic身份、numeric loopback HTTP及專用持久fixture。此層不代表遠端Cloudflare、Access撤權、主機重開機或完整AC-07通過。

故障注入僅在tests fixture／qualification代理，產品CLI不增加kill／drop開關。fixture collector在呼叫既有固定OS collector前寫入可fsync的計數marker；started案例在此暫停，主導只終止該次建立的子程序。每個案例獨立journal，unknown案例最後執行，不清空DB解鎖。不得讀取、停止或改寫現有live服務／憑證／journal，不啟用CF Cron或付費功能。

隔離驗證與獨立審查已通過。原T-0003-4及AC-06～08保持pending。

## 可重跑入口

一般回歸沿用 `python3 platform/cloud-lab/tools/check.py`，會加入三項Python程序／HTTP案例。可選實際runtime驗證在共用launcher內執行：

```sh
timeout --signal=TERM --kill-after=10s 180s node platform/cloud-lab/tools/qualify_recovery.mjs /external/qualified-toolchain
```

替換為既有、已驗證的Miniflare工具鏈，不自動下載。每次使用新的launcher task ID；工具要求AGENT_BUILD_DIR及AGENT_EVIDENCE_DIR，並以exclusive recovery目錄拒絕重用舊證據。synthetic config、journal與D1 fixture保存在evidence/recovery下，暫存放build；不得把唯一證據當cache刪除。外層timeout只用於本次資格工具，不用來啟動live常駐服務。

工具建立loopback代理及自己擁有的Python子程序，逐案注入故障；finally關閉代理、workerd並回收子程序。summary.json只在全部斷言通過後寫入；若有failure.json或非零exit，不能只挑已通過案例宣稱全通過。

FR-01～04的隔離結果見[恢復證據](evidence/m1-recovery.md)。人工接手unknown時，保留原命令、journal與external_ref，停止新增派送並查明原執行結果；本輪沒有新增「清掉unknown」或重做命令的授權介面。
