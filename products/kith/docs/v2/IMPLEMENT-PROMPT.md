# 實作 prompt（施工）

> 用法：把本檔的 GitHub 網址交給 LLM agent，對它說「讀這個檔案，照做」即可：
> <https://github.com/fallrising/newclear/blob/main/products/kith/docs/v2/IMPLEMENT-PROMPT.md>
>
> 可在同一句話後面加一行指定範圍（不加就用預設）：
> - `本次只做：W3`：只做指定里程碑，完成後停下。
> - `做完不要合併`：開好 PR 就停下，等使用者審核。
>
> 細化施工圖用的是另一份：[PHASE2-PROMPT.md](PHASE2-PROMPT.md)。

---

你是 Kith v2 的**實作者**。你照施工圖寫程式，不做設計決定。

## 0. 文件位置（一律以 GitHub `main` 為準）

Repository：<https://github.com/fallrising/newclear>（公開 monorepo，預設分支 `main`）。下表每個網址都對應 repo 內同名路徑；你 clone 之後讀本機檔案即可，內容相同。

| 文件 | GitHub 網址 |
| --- | --- |
| 本 prompt | <https://github.com/fallrising/newclear/blob/main/products/kith/docs/v2/IMPLEMENT-PROMPT.md> |
| kith 專案規則 | <https://github.com/fallrising/newclear/blob/main/products/kith/AGENTS.md> |
| v2 索引與開發規則 | <https://github.com/fallrising/newclear/blob/main/products/kith/docs/v2/README.md> |
| 里程碑狀態 | <https://github.com/fallrising/newclear/blob/main/products/kith/docs/v2/09-roadmap.md> |
| 決策與開放問題 | <https://github.com/fallrising/newclear/blob/main/products/kith/docs/v2/10-decisions.md> |
| 施工圖目錄 | <https://github.com/fallrising/newclear/tree/main/products/kith/docs/v2/milestones> |
| W0 施工圖（harness 與慣例） | <https://github.com/fallrising/newclear/blob/main/products/kith/docs/v2/milestones/W0.md> |
| W1 施工圖（前端慣例） | <https://github.com/fallrising/newclear/blob/main/products/kith/docs/v2/milestones/W1.md> |
| W2–W7 施工圖 | `https://github.com/fallrising/newclear/blob/main/products/kith/docs/v2/milestones/W<n>.md`（`<n>` 為 2–7） |
| 框架章節 00–10 | <https://github.com/fallrising/newclear/tree/main/products/kith/docs/v2> |
| 契約（JSON Schema） | <https://github.com/fallrising/newclear/tree/main/products/kith/contracts/v2> |

工作目錄：repo 內的 `products/kith`。下文的相對路徑都相對於它。

## 1. 決定本次要做哪個里程碑

1. `git fetch origin main`，從最新 `main` 開工作分支（若工作階段已指定分支名稱，用指定的；否則用 `agent/kith-v2-w<n>`）。
2. 讀 `docs/v2/09-roadmap.md`，找**第一個**狀態為 `DOC_READY` 的里程碑，就是本次的 `Wn`。
   - 若使用者指定了 `本次只做：Wn`，改做該里程碑；但它前一個里程碑必須是 `VERIFIED`，否則停下回報。
   - 若有里程碑是 `IN_PROGRESS`：先看有沒有對應的開啟中 PR 或分支；有就接手繼續，沒有就把它當成 `DOC_READY` 重新開始。
   - 全部都是 `VERIFIED`：回報「v2 已全部完成」並停止。
3. 在 `09-roadmap.md` 把 `Wn` 改成 `IN_PROGRESS`，作為本分支第一個 commit。

## 2. 開工前依序讀完

1. `AGENTS.md`（kith 的禁止事項與交接格式）。
2. `docs/v2/README.md`（開發規則、文件優先級、ID 命名）。
3. `docs/v2/milestones/W0.md`、`docs/v2/milestones/W1.md`：所有後續里程碑沿用的 harness、指令、目錄與命名慣例。
4. `docs/v2/milestones/Wn.md`：本次施工圖，**全文**。
5. 施工圖引用到的框架章節（`docs/v2/00`–`10`）、契約（`contracts/v2/`）、v1 文件與現行程式。

施工圖裡已經寫明的事，不要再自己重新設計。

## 3. 施工規則

1. **照任務卡順序做。** 依 `Wn.md` §6 的 `Wn-T01`、`Wn-T02`… 逐張完成。每張卡一個 commit，訊息以卡號開頭，例如 `feat(kith): W2-T06 migration and me`。
2. **只碰檔案清單。** 只修改 `Wn.md` §3 列出的檔案；標明「完整內容」「逐字」的段落照抄。
3. **文件先行。** 施工圖與程式、工具、實際行為不符時：停下，先用**獨立 commit** 修改施工圖（`docs(kith): Wn …`，訊息寫明原因），再寫程式。不可以不改文件就繞過。
4. **不改大框架。** `10-decisions.md` 裡 `Accepted` 的決策、INV、V2-INV、BR、RT 都是固定的。必須改的時候，在 `10-decisions.md` 新增 `Q-xx`（矛盾、選項、建議），然後停下來問使用者（§6）。
5. **測試規則（使用者指定）：**
   - 不在寫完程式後補單元測試。
   - E2E 是主要且預設唯一的驗證手段；每次 E2E 產出證據資料夾。
   - 必須單獨驗證某個模組時，先寫出所有失敗方式（FM 清單），再寫程式。
   - 開發期間只跑任務卡「驗證」欄指定的 spec 或指令，**不跑全套 E2E**；全套只在最後的回歸任務卡跑一次。
6. **不新增依賴。** 只用施工圖指定的套件與版本。
7. **不提交秘密。** 不寫真實 API key、token、密碼；E2E 用 seed 裡的測試帳號與 canary。
8. **不做範圍外的事。** `Wn.md` §1.2「不做」清單裡的項目一律不碰。發現順手想修的問題，記在 PR 說明的「後續」一節，不要順便改。

## 4. 完成條件

以下全部成立，才算完成：

- `Wn.md` §9 交付檢查表逐項打勾，並且確實執行過。
- `Wn.md` 列出的全部 E2E ID 通過；`npm run e2e:all` 通過；`npm run e2e:validate -- <run_id>` 印出 `ok`。
- v1 回歸：`products/kith` 的 `npm test`、`npm run lint` exit 0，以及施工圖要求的其他 lint。
- 遮罩命中 0。
- `docs/v2/09-roadmap.md` 的 `Wn` 改為 `VERIFIED`，附全套 run 的 `run_id`；`docs/v2/README.md` 的施工圖狀態表同步更新。

「可編譯」「可啟動」「部分 E2E 通過」都不等於完成。沒有執行過的檢查，不得寫成已通過。

## 5. PR 與合併

1. 推送分支，開 PR 到 `main`，標題 `feat(kith): v2 Wn <里程碑主題>`。
2. PR 說明依序包含：
   - 完成的任務卡清單。
   - 對施工圖或框架文件的修改，逐條列出並附原因（對應哪個文件 commit）。
   - 新增的 `Q-xx`，以及採用的預設。
   - E2E 證據：全套 run 的 `run_id` 與 `summary.md` 全文。
   - 實際執行過的指令與結果（exit code）；沒有執行的項目明說原因。
   - 依 `AGENTS.md`「Required handoff」列出 milestone、requirement／test IDs、commands、evidence、已知風險、下一個可執行任務。
3. CI 全綠後合併（merge commit），然後回到 §1 繼續下一個 `DOC_READY` 的里程碑。
   - 使用者說了 `做完不要合併`：開好 PR 就停下。
   - 使用者說了 `本次只做：Wn`：合併後停下，不繼續下一個。
   - CI 紅：先修；同一個失敗修兩次仍不過，停下回報（§6）。
4. 每合併一個里程碑，在回覆中簡短回報：里程碑、PR 網址、`run_id`、新增的 Q-xx。

## 6. 什麼時候停下來問使用者

- 需要改 `Accepted` 決策、任何不變量，或新增依賴。
- 施工圖與官方文件或實際工具行為衝突，而且修文件會改變已決定的行為。
- 同一個問題修了兩次仍然失敗。
- 需要真實憑證、外部網路，或需要部署。

問的時候一次列完所有問題，每題附選項與你的建議，然後停止，不要自行假設後繼續。
