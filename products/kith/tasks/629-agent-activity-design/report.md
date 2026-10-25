STATUS: VERIFIED — AV-0 文件驗證通過；Git 交付狀態見下方紀錄

Issue: https://github.com/fallrising/newclear/issues/629
Component: products/kith
Task: [task.md](task.md)
Branch: `docs/kith-agent-activity-629`
PR: https://github.com/fallrising/newclear/pull/630

## 變更與範圍

新增[Agent 活動視圖與辦公室動畫開發計畫](../../docs/plans/agent-activity-office.md)，並更新 README、SDD、v2 索引、SUCCESS 與任務板，共 8 個 Kith Markdown 檔。文件區分本機上游 viewer、Kith 的既有狀態與提及流程，以及後續未實作的活動／動畫功能。沒有 runtime、測試、依賴、CI 或跨元件變更。

本輪只有 AV-0 文件。AV-1／2／3 仍 NOT_STARTED；聊天室 AC-04、`mainline: incomplete` 與 `usable_tag: none` 資格不變。SUCCESS 前置 metadata 與查核基準完全一致，不把文件查核日期當作 runtime 重新驗收日期。

## 來源與驗證環境

- Kith／newclear 基準：`cfc68b97e0ee77a185807cbaf9695a29fcbcc48e`；提交前再查 main，仍為同一版本。
- 上游參考：`Charonyuu/whatsmyagentdoing@c9dc82f7bca2503fa32fadb40db86cd15946df71`，package 0.3.0；逐項來源見計畫 §2。
- 文件檢查：Python 3.12.14、git 2.51.1。來源檔案由 GitHub App 按固定 SHA 讀取，本地 Git index 以相同基準內容建立，只供差異驗證；遠端 commit 的 parent／tree 使用 GitHub 實際物件。

## 文件驗證

| 檢查 | 結果 | 證據與界線 |
| --- | --- | --- |
| `python3 scripts/check_project_success.py --projects products/kith` | PASS，exit 0 | `PASS: 1 project success contracts and navigation/index`；只聲稱 Kith 目標檢查，不取代 PR 全域契約 CI |
| `git diff --check` | PASS，exit 0 | 無空白錯誤；差異基準為上述固定 main |
| 變更白名單與相對連結 | PASS | 8 個指定 Markdown、167 個相對連結目標；以完整遠端 tree 與新增檔案解析連結目標，不以空白 placeholder 充當來源；UTF-8／尾端換行正常 |
| SUCCESS metadata | PASS | 與基準前置 metadata 完全一致；沒有提升主線或 usable tag 資格 |
| 公開資料邊界 | PASS | 未納入私人來源 URL／內容、原始 session、憑證、帳號或主機設定；本輪未取得真實執行資料 |
| 上游／展示權限獨立審查 | ACCEPT | 確認 localhost viewer、複製 resume 指令、靜默推測限制、private payload 不等於公開安全及素材邊界；demo 規劃與正式登入 origin 分離 |
| Kith 契約獨立審查 | ACCEPT | 確認有界 status ingress／unknown fallback、已知 runtime epoch 失效、無 heartbeat 與 trace 時序限制、提及不自動送出及既有成本／權限邊界；必要修正已回讀 |
| 範圍／公開資料獨立審查 | ACCEPT | 恰好 8 個 Kith Markdown，未加入私人來源、未另起平台、未把程式里程碑寫成完成；發布時另核對遠端 tree 範圍 |

上述獨立審查為文件與原始碼契約查核，沒有執行 runtime 或 E2E。計畫中的 E2E-AV IDs 是未來驗收案例，不是已存在或已通過的測試。本輪未使用付費模型、未啟動真實 provider／原生 CLI，也未部署。

## 遠端交付

首次以 Draft 建立 [PR #630](https://github.com/fallrising/newclear/pull/630)，base 為 `main`。2026-10-25 owner 已追加更新文件並合併的明確授權；本輪依最終候選完成必要檢查／審查後正常合併。最終合併 SHA／時間以 PR 與[任務板](https://github.com/fallrising/newclear/blob/main/products/kith/docs/tasks/BOARD.md) 的實際收尾紀錄為準。首個文件 commit 為 [`db0097f35a0134a5125528467242ba66a5fc7127`](https://github.com/fallrising/newclear/commit/db0097f35a0134a5125528467242ba66a5fc7127)，parent 為上述固定 main。已透過 GitHub App 回讀分支與 PR head、commit parent／tree、完整 8 檔內容與 compare 路徑；內容與候選逐檔一致，沒有把本地來源快照的其他檔案發布為新增。

首個文件 commit 的 CI 已完成並確認 run 的 head SHA：

| Workflow／job | 結果 | 執行紀錄 |
| --- | --- | --- |
| Kith CI／test、web | SUCCESS | [run 40177140228](https://github.com/fallrising/newclear/actions/runs/40177140228)：既有 lint／npm test、web build 與合成閱讀 bundle build 均通過 |
| Project success contracts／validate | SUCCESS | [run 40177140217](https://github.com/fallrising/newclear/actions/runs/40177140217)：全域文件契約 workflow 通過 |

上表只證明列出的來源 commit，不代替後續 head 的 CI。上一輪 Draft 交付 head `0be2d7b1a0f75cb58df50810c7da961fb069bdfd` 的 [Kith CI](https://github.com/fallrising/newclear/actions/runs/40177349501) 與 [Project success contracts](https://github.com/fallrising/newclear/actions/runs/40177349443) 亦已通過；本輪只更新 plan／task／report／BOARD 的授權與交付說明，提交後仍按新 head 核對。最終 head、其自身 CI、最終遠端回讀結果保存在 [PR Checks](https://github.com/fallrising/newclear/pull/630/checks) 與 PR／issue 的交付摘要，須對照同一 SHA，不從上一輪成功外推。Issue 使用 `Refs #629`，在 AV-0 合併、遠端回讀與任務板收尾完成後才關閉。

## 限制與交接

終端 clone 因 HTTPS proxy 連線不可用而 exit 128；GitHub App 的 repo 讀寫已獨立確認成功。此次透過 App 固定來源、原子 Git 物件、帶 expected head 的非 force 分支更新與遠端回讀交付，沒有把終端網路問題誤判為 repo 權限不足。

本輪完成 AV-0 PR 合併、遠端回讀與任務板收尾；合併前任務列保持 in_progress／無 end，合併後以只改任務板的 PR 記錄實際 merged_at。程式工作另立 AV-1，先驗證資料語意與明確提及，再進 AV-2 的 2D／靜態展示；本輪不啟動下一個程式里程碑。
