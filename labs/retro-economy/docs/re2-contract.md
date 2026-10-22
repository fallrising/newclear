# RE-2 交易契約

延伸 [RE-1 HTTP／重試契約](re1-contract.md)，規則來源為 [rules.md](rules.md) 與 [SDD](SDD.md)。只完成交易，不代替 RE-3 真人試玩。

## 動作與狀態

沿用 `POST /api/action`、Bearer token 與 `{action_id, action}`；`action` 僅允許：

- `{type:"list", item, quantity, price}`：四種物品 ore／herb／kit／medicine，數量與**整筆總價**各為 1–99 的整數（拒絕布林、浮點、字串或額外欄位）。掛單時必須有足量物品；成功結果另有 `listing_id`。
- `{type:"buy", listing_id}`：ID 為 1 至 2^63−1 的整數；購買整筆，不可買自己的掛單。必須仍 open、買家貨幣足夠、賣家仍有足量物品。
- `{type:"cancel", listing_id}`：只有賣家能取消仍 open 的掛單。

不限制交易地點；既有規則僅限制製作地點。掛單及取消不增減背包或貨幣，也不保留庫存。允許同批庫存重複掛單；賣家可繼續製作或消耗它，買家需以伺服器成交結果為準。缺貨時拒絕，掛單仍 open，之後賣家補貨可用新的 action_id 再買。沒有 escrow、到期、部分成交或手續費。

`GET /api/state` 保留 RE-1 的 `state`，並新增頂層 `listings` 陣列，按 ID 排序，包含 open／sold／cancelled：`{id,seller_id,seller_name,item,quantity,price,status}`。玩家姓名只作純文字，沒有 token。UI 每 1.5 秒輪詢，同一次回應更新角色與市場。成交／取消後保留歷史狀態，方便辨識；原型尚無歷史清理或分頁。

## 原子保存與重送

新增 `listings` 表；既有 RE-1 資料庫重新開啟會建立缺少的表，不重建角色、不重發補給。每次購買把買賣雙方背包、貨幣、掛單狀態及動作收據放在同一 SQLite transaction。任一步驟失敗皆 rollback。HTTPServer 保持單執行緒，競購／買取消請求依到達次序處理，只有第一個符合條件的動作生效。

沿用每角色永久收據：同 ID／同內容回傳原結果；同 ID／不同內容 409。規則拒絕也保存；條件改變後要新 ID 才是新嘗試。掛單、購買、取消都先在 localStorage 保存確切請求再送出，網路回覆遺失或重載後重試同一內容。舊收據可能包含舊角色狀態，UI 收到後以新的 GET 更新畫面，不把歷史結果當現況。拒絕不改角色、物品、貨幣或掛單；合法 token 的拒絕收據會增加一筆 log。

## 驗收

RE-A03～A07 以純規則、SQLite rollback／reopen、真實 HTTP 競購及買取消競爭測試。無效 token、非法數值／物品／欄位、非本人取消、自買、缺貨與餘額不足不改經濟狀態。總貨幣始終等於 `12 × 角色數 + 8 × 已領獎角色數`。

瀏覽器自動驗收用兩個隔離 context 的真實操作，驗證掛單、購買、取消、輪詢、丟棄成交回覆後重載重送、伺服器重啟，以及補足異職供應後第二輪登塔不重發獎勵。這是自動驗收，不是兩位真人或玩法平衡證據。
