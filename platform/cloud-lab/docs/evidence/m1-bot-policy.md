# BP01–04 — 持久 bot 政策本機證據

本輪只交付source／local政策，不改live安裝／Grok設定／Cloudflare／授權／付費。原HL provider資產session500任務仍open；不以此工作代替它。政策與操作契約見[bot-policy](../bot-policy.md)。

## 驗證對應

| AC | 已執行證據 |
| --- | --- |
| BP-01 | strict private policy、config digest、<=24h／authority_until、數字上限／型別、明確初始化及不可覆寫；保留舊request |
| BP-02 | reservation commit先於HTTP；bootstrap失敗及ACK遺失不退還新ID；同ID原bytes恢復；FLOCK並行及持久call額度 |
| BP-03 | 實際多個stdio程序重連共用帳本、可信--policy傳入、模型policy／initialize參數拒絕；expiry／rollback／state loss拒絕 |
| BP-04 | 完整suite、獨立T842審查、文件／task／report／diff驗證；正常Git交付另於任務板回讀 |

初始BP-red因未實作initialize_policy／policy_path失敗（29個discovered tests含15個誤被再次發現的imported舊測試，21個error含subcase）。改以module引用fixture避免重複發現；14個新增policy tests GREEN。首輪GREEN的SQLite connection ResourceWarning來自測試context manager未close，已改closing；未忽略警告。初次完整316tests通過（63Node／253Python）。

T842初審REWORK指出：到期拒絕尚未保存high_water，時鐘倒退可重新准入。BP-clock-red新增「call開始已到期」及「bootstrap後才到期」兩個case均重現失敗。修正為持久保存最大觀測時間後才拒絕，拒絕不扣call／新ID額度；下一個handle重新開DB仍拒絕回退。另一P3是文件寫exact0600但共用private_read接受owner-only模式；文件改為owner-only／建議0600，新增0400可讀及0640拒絕的測試，不改共用安全邊界。

實際HTTP整合用既有synthetic local Lab、真實Python stdio／bridge subprocess／SQLite及collector：離線初始化call上限3／新ID上限1；第一次POST已accepted但子程序ACK延遲而被timeout清理；兩個重連程序同時恢復，同ID一個accepted、另一個STATE_BUSY或POLICY_RATE_LIMITED；原runner完成後第三次call validated。再重連status拒絕POLICY_CALL_LIMIT，server nonce未增，僅一筆command且原bytes相同，帳本calls3／reservations1。測試只遮蔽fixture外層Git標記與故意延遲ACK，沒有放寬授權或政策。

最終BP-final完整 **319tests通過（63Node／256Python），零fail／skip**；T842 focused複審ACCEPT，初審P1／P3均關閉。主導檢查全部scoped diff與原始測試紀錄；project-success、indexes、llms、task及diff檢查通過，report驗證在交付前完成。獨立審查只讀source與提供的本機log，未執行live或重跑測試。

## 範圍與限制

完整回歸使用既有launcher並保留BP-red、BP-green、BP-full、BP-clock-red、BP-final原始log；私有路徑不寫入公開證據。Node的既有SQLite experimental warning保留。Linux／本機Python3.13與Node24驗證；Python3.11未本機執行。遠端CI結果與merge時間由任務板補記。

政策只約束合作入口與指定原state；同OS使用者／舊版本／整份state回滾不是防竄改邊界。authority_until是operator帶入的fresh最早上限，離線工具不能自行證明遠端期限；遠端grant仍決定准入。到期是停止開始新I/O，不能撤銷已accepted命令／已開始HTTP。沒有自動續期／配額重置；顯式政策續期／遷移與live常態啟用仍後續。沒有模型呼叫、真人瀏覽器驗收、usable tag或完整主線完成宣稱。
