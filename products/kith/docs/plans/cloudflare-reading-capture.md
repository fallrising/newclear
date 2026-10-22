# Cloudflare 閱讀與快記模組：Kith 重用評估與 MVP 計劃

- 日期：2026-10-18；MVP 縮減 2026-10-22（前一版見 commit `b97319d7`）
- 狀態：階段 1 快記 API／Web 已實作並通過本地 RC-01～04；閱讀、notes 正向功能與 Runner 留待階段 2
- 核對基準：newclear `main` @ `63e2f3b3a47776e35865fcb28d368e8f4d32be22`
- 範圍：沿用 Kith 的 Web／Cloudflare 基礎，增加私人的閱讀與快記能力

本文是公開摘要；私人來源、資料樣本、帳號、主機與部署設定不放在此處。本文不改寫 [SDD](../../SDD.md)、[DESIGN](../../DESIGN.md) 或 [v2 契約](../v2/README.md)，也不是 [v2 實作 prompt](../v2/IMPLEMENT-PROMPT.md) 可自動開始的 `DOC_READY` 里程碑。

## 1. 要解決的問題

使用者需要一個手機上每天願意打開的介面：讀 AI 整理後的文章、立刻記下閃念、在文章下方留下自己的補充。
MVP 只解決這三件事；公開發布、通訊收件、統計、版本差異都延後。

Kith 維持單 operator、邀請制的人機群聊用途。Ice Maker 與 Flowshot 不受影響。

## 2. 使用者已確認的方向

1. 網站、閱讀、收件、批註與簡易事件上報以 **Cloudflare** 為家；GitHub 保存內容與版本；自架 Runner 負責匯出與建置，不是手機保存的同步前置。
2. 公開入口可直接閱覽，私人入口需要驗證；公開範圍涵蓋正文、附件、索引與衍生產物。
3. 文章上方是 AI 整理區，下方是人類補充區，中間有分隔線。
4. 手機、Telegram、Slack 的原始輸入先持久化，第一次保存不經 AI。
5. GitHub Actions 自動更新閱讀內容，不靠手動 reload；手機快記優先。
6. 可用自寫 JavaScript 監聽頁面事件上報 Worker，不要求 Umami 相容。
7. 優先重用 Kith；不新增付費 LLM API 或 provider 依賴。

MVP 實作其中 1、3、4（只做手機）、5、7；2 的公開部分與 6、以及 Telegram／Slack 列為後續。

## 3. MVP 範圍

**一個私人部署**，只有 operator 一人使用：

| 功能 | MVP 做法 |
| --- | --- |
| 驗證 | 重用 Kith 既有 session／operator 登入；不加 Cloudflare Access、不做 member／visitor 權限 |
| 快記 | 手機輸入框 → Worker → D1 `captures` 表；回傳 `capture_id` 與「已保存」。不呼叫 AI、不寫聊天室 `messages` |
| 收件匣 | 列出 captures 與同步狀態（已保存／已匯出 Git） |
| 閱讀 | CI 從內容 repo 固定 commit 建置文章 JSON（目錄＋正文）並發布為 Worker 靜態資產；頁面顯示建置 commit |
| AI／人類分區 | AI 正文來自 Git 建置產物（唯讀）；人類補充存 D1 `notes`，以文章穩定 ID 對應，畫面合成「AI 在上、人類在下」 |
| Git 匯出 | Runner 定期呼叫一個受保護的匯出端點，取得未匯出的 captures／notes，寫成檔案 commit 到內容 repo 後回報已匯出。**只做 D1 → Git 單向** |

權威邊界：captures 與 notes 的權威在 D1；AI 正文的權威在 Git。人不直接在 Git 改 notes；若改了，下次匯出以 D1 為準並記錄覆蓋。這讓 AI 整理流程結構上無法改到人類補充。

不做：公開部署與公開範圍投影、Cloudflare Access、Telegram／Slack adapter、頁面事件統計、閱讀紀錄與「上次讀後改了什麼」、批註版本歷史、離線待送佇列、雙向同步、Markdown 完整格式（先重用 Kith 的安全子集並加標題／連結／清單）。

## 4. 資料契約（階段 0）

[SQL 草稿](reading-capture-schema.sql)位於 docs/plans，**不會**隨 `db:migrate:local` 自動套用。階段 1 已在隔離 D1 驗證並提升為 [0007 migration](../../migrations/0007_reading_capture.sql)，與 runtime 一起接受獨立審查；沒有套用正式環境。草稿只新增兩表與待匯出索引，不改聊天室表。

| 表 | 欄位 |
| --- | --- |
| captures | id、body、source（`web`）、client_key（冪等鍵，唯一）、created_at、exported_commit（可空） |
| notes | id、article_id（唯一）、body、updated_at、revision（正整數）、exported_commit（可空） |

- 快記由瀏覽器產生 `client_key`；重送同 key 回傳原 `capture_id`，不重複建立或覆寫原文。若 payload 不同，仍保留原紀錄並在回應明示衝突；不得對另一份文字顯示保存成功。首次成功持久化前不回「已保存」；逾時是結果未知，同 key 重試。
- 送出前內容留在既有本機草稿（[draftStorage.ts](../../web/src/features/composer/draftStorage.ts) 的做法）；畫面清楚區分「本機草稿」與「已保存」。
- captures 是不可編輯的原始快記；每篇文章只有一份可編輯的人類補充，`notes.article_id` 唯一。兩種 body 都保留原字串（不 trim、不經 AI），UTF-8 為 1～16,384 bytes。空白或非法字元的 UI/API 檢查由階段 1/2 定義；SQL 不冒充完整輸入驗證。
- id/client_key 是非空穩定 opaque ID；API 必須限制長度並拒絕路徑字元，Runner 不把任意輸入直接拼成檔案路徑。時間由 Worker 產生 UTC RFC3339；排序加 id 作 tie-breaker。單 operator 模組不需要 room/member 外鍵；認證仍在 Worker 邊界。
- `exported_commit = NULL` 表示尚待匯出；非空是已成功推送到內容 repo 的 commit。只有 Runner 確認持久化到遠端後才能回報，不以本機檔案存在或 git commit 成功作為已匯出證據。
- notes 每次編輯在同一交易中遞增 `revision`、更新 `updated_at` 並清空 `exported_commit`。revision 不以時間戳取代，避免同毫秒或時鐘回撥造成舊 ACK 命中新內容；達 JS 安全整數上限時拒絕編輯，不回捲。匯出 ACK 用 `WHERE id = ? AND revision = ?` 比對快照，零列更新表示仍待匯出。
- 匯出路徑固定為 captures/<安全編碼 id>.json 與 notes/<安全編碼 id>.json。重試檢查內容及 revision，不只檢查檔案存在；相同快照無需新 commit，修改過的 note 覆寫同一路徑。Runner 單一實例序列執行，避免舊快照覆蓋新版本；Git push 衝突不回報成功。D1 → Git 單向權威不變，偵測人工改檔時記錄覆寫事件。

revision 與每篇唯一補充是本階段定案：前者補足 RC-05 的匯出／編輯競態，後者符合單 operator 的補充編輯區，沒有加入版本歷史或多使用者評論。

## 5. Kith 重用對照

| 面向 | 重用 | 新增 |
| --- | --- | --- |
| 手機 Web 與 UI | React、路由、元件、窄螢幕布局（[App](../../web/src/app/App.tsx)） | 收件匣、閱讀頁、補充編輯區 |
| 登入 | [auth.ts](../../worker/auth.ts) session、CSRF、operator | 無 |
| Markdown | [渲染器](../../web/src/markdown/Markdown.tsx) 安全白名單 | 標題、內部連結、清單 |
| 儲存與部署 | [wrangler.toml](../../wrangler.toml) 的 Workers assets、D1 | 兩張新表與 migration；不動聊天室表 |
| Agent | 不接 | — |

Kith 現行 SDD 以 Workers Paid 為部署畫像；本模組只用 Workers、D1、靜態資產，目標是 free tier 可承載，實作時量測確認，不宣稱整套 Kith 可免費運行。
是「Kith 內的新模組」還是「共用程式碼的另一個輕量 Worker」：MVP 建議先做 Kith 內的獨立路由與獨立表，量測後再決定是否拆分。

## 6. 驗收（MVP）

| ID | 情境 | 預期 |
| --- | --- | --- |
| RC-01 | 手機送出快記 | 回傳 `capture_id`；重新整理後仍在收件匣；過程無 AI／provider 呼叫 |
| RC-02 | 保存回應遺失後重送同 `client_key` | 只有一筆 capture |
| RC-03 | 斷網時輸入 | 顯示「本機草稿」，不顯示「已保存」 |
| RC-04 | 未登入請求快記、notes、匯出端點 | 拒絕 |
| RC-05 | Runner 停止期間持續快記 | 保存不受影響；Runner 恢復後補匯出，Git 無重複檔 |
| RC-06 | 內容 repo 更新 AI 正文並重新建置 | 閱讀頁顯示新 commit；同文章的人類補充仍在 |
| RC-07 | 建置失敗 | 閱讀頁維持上一版，快記不受影響 |

沿用 [AGENTS](../../AGENTS.md) 與 [v2 E2E 規則](../v2/08-testing-e2e.md)：先寫 E2E（合成資料、本地 CF 環境），再實作；不把預期行為當成已完成測試。

完整 fixture、故障切點、觀測與階段分工見 [RC 測試清單](reading-capture-tests.md)。階段 0 的 SQLite 檢查僅驗證草稿；階段 1 RC-01～04 已取得本地 CF/API/Web 證據，見 [#456 報告](../../tasks/456-reading-capture-phase1/report.md)，RC-05～07 仍待階段 2。

## 7. 階段

| 階段 | 交付 |
| --- | --- |
| 0 | 本頁資料契約定案＋[兩張表 migration 草稿](reading-capture-schema.sql)與 [RC 測試清單](reading-capture-tests.md)；交付／驗證見 [#446 報告](../../tasks/446-reading-capture-phase0/report.md) |
| 1 | 快記＋收件匣（RC-01～04）；[實作／驗證報告](../../tasks/456-reading-capture-phase1/report.md)，最終 CI／審查與 merge 證據在 PR #457 |
| 2 | 閱讀頁＋人類補充＋CI 建置與 Runner 匯出（RC-05～07） |
| 之後 | 使用兩週後，依實際需要從延後清單挑下一項：公開部署、Telegram／Slack、已讀與更新差異、事件統計 |

## 8. 階段 2 接線決定與後續

- 文章 ID 採明確 registry 欄位，不從檔名推導；改名保持同 ID。完整限制、介面與原子建置見 [階段 2 契約](reading-capture-phase2.md)。
- Runner 採專用、可撤銷的匯出／ACK bearer 憑證，D1 只存雜湊；CLI 從 owner-only 檔案讀取。正式憑證由 operator 另行建立，不檢入來源或 CI。
- 第一個延後項目的優先順序。

上述具體方案先於階段 2 程式凍結；不改階段 0 的 opaque ID／授權邊界。CI 建置固定 commit 與本地原子發布驗收不需帳號秘密；私人來源接線與正式發布不在本次授權內。若後續需要真人操作，不得代答。階段 0 沒有套用 migration、修改 feature flags、部署或 Agent runtime。
