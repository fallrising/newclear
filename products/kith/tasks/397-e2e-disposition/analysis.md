# Kith #397：原始 E2E 失敗的處置

## 固定來源與原始結果

比較主線 `8d16672837ef7a8cdc70ed015d0ca605c138b624`。原日誌仍可由 GitHub job logs 取得；artifact API 在本次讀取時回傳空清單，所以沒有冒稱已重看舊 trace。

| 原始 commit | job / run | 實際結果 |
| --- | --- | --- |
| `631cf771c95615a6207d528355b3ef4f8b99b1f3` | [108562347400 / 36298748286](https://github.com/fallrising/newclear/actions/runs/36298748286/job/108562347400) | 41 passed、2 failed、1 skipped |
| `71033c5fc86a3f7bd42f22079c155aae09d85461` | [109053717101 / 36459357758](https://github.com/fallrising/newclear/actions/runs/36459357758/job/109053717101) | 相同兩個案例失敗；41 passed、1 skipped |

日誌 SHA-256 與完整 commit 在 [evidence.json](evidence.json)。這些是取回的歷史結果，不是本次重新執行。`9ab2a4d` 到第一個失敗 commit 的 Kith 差異僅 `fe-review/REVIEW.md`；不能把該次合併說成引入 runtime bug 的證據。

## E2E-W1-03：空 gap 回應多算一次請求

兩個 job 都在舊 `w1-chat.spec.ts:304` 失敗：`benAfterSeqRequests() - n2` 預期 1，實際 2。進入 K 段時剛從別的 room 回 Lobby，測試尚未等待該次初始 catch-up 完成就取基準並攔截 gap 回應。

既有 [6aca87ed](https://github.com/fallrising/newclear/commit/6aca87ed360671edfc493d48b1d887de7739eb5e) 在點 Lobby 前註冊 `waitForResponse`，等待成功的 Lobby `order=asc` 回應與房間標題，再取計數。固定主線與原始 spec 的差異正是這六行等待；`toBe(1)`、空洞不重試及後續同步斷言均保留。這是來源支持的測試準備競態修正，不是放寬同步次數。

## E2E-W3-02：在 sidebar 刷新前取房間順序

兩個 job 都在舊 `w3-mention.spec.ts:119` 失敗：Alt+ArrowUp 預期進入當次建立的 family room，實際仍在 Lobby。測試在 quick switch 到 quiet 後，尚未等待路由 refetch 將最新訊息提交到 sidebar，就讀取列表順序。

既有 [029728ef](https://github.com/fallrising/newclear/commit/029728ef6739b83351fd2b7d5d91f217382bf939) 等待 `/api/rooms` 成功回應、live room、quiet 選中狀態及 Lobby 中本測試訊息 preview，再讀列表並操作。原「上一個 room」URL 斷言未放寬。該提交記錄 isolated W3-02、TypeScript、evidence validation 通過且 retries=0；本次只核對來源與紀錄，不冒稱重跑該歷史來源。

## 現行 CI 與結案邊界

[PR407](https://github.com/fallrising/newclear/pull/407) 在 owner 的 CI 瘦身決定下移除 hosted `e2e:all`，保留本機命令。這個政策變更與上述測試修復是兩件事。原 issue 的「hosted e2e 恢復綠燈」不再是現行 CI 定義；本報告不擅自恢復 job，也不將其移除算成修好測試。

後來的 [PR457](https://github.com/fallrising/newclear/pull/457) 與 [PR464](https://github.com/fallrising/newclear/pull/464) 保存較新來源的完整本機 E2E 通過紀錄，僅作後續驗證佐證。原始失敗永遠保留。新像素 oracle 屬 [#387](https://github.com/fallrising/newclear/issues/387)，不拿候選圖片或本文件當成它的驗收。

本次沒有執行產品／瀏覽器測試、付費模型或部署；只交付缺失的歷史因果與政策對照。現行重跑命令仍是 `npm run e2e:all` 與 `npm run e2e:validate -- <run-id>`，須遵守既有隔離與版本規則。Owner 決定是否接受此歷史處置並關閉 issue。
