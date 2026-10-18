# 工作追蹤

> **兩層。** desk（https://github.com/fallrising/desk 的 docs/operating-method.md）只放大需求進度，給人看；大需求完成稱「驗收」。本 repo 技術任務自己管理，可拆子任務；位置與格式由本 repo 決定。不要求卡片編號或 `Desk-Task`。

> **兩階段。** 現在是第一階段：用文件與 PR。第二階段（run 狀態、心跳、Grok Bot 掃描、自動派工）尚未啟用，不要寫成已生效。

本目錄的 [task](task-template.md)、[report](report-template.md) 只是可選格式，不是認領權威，也不要求串行指派或由 orchestrator 負責 routing／acceptance。

已完成、仍帶 doing claim 的舊任務紀錄在 [archive/tools/codex-usage/tasks/346-offline-evidence](../../archive/tools/codex-usage/tasks/346-offline-evidence/)。檔案內容不改，不要照它認領。被取代的舊契約在 [archive/docs/work-tracking/README.md](../../archive/docs/work-tracking/README.md)，同樣不是現行規則。

## 授權

- 變更走 PR，不直接動 main。
- 只有不可逆或危險操作才問 owner。文字以根目錄 [AGENTS.md](../../AGENTS.md) 為準。
- `Refs` 不得用來自動關閉 issue。
- 本說明不另給開工、merge 或發布授權。標成 `ready` 不是 merge 許可。

## 公開邊界

不要把私人任務內容、個人檔案路徑、主機名、IP、網域、帳號或憑證寫進這個公開 repo。可以寫的公開指標只有 `fallrising/desk` 的 `docs/operating-method.md`。

## 執行紀錄

一件工作的執行紀錄放在該工作自己的目錄，與程式同一個 PR，不寫到另一個 repo。可選的 `log.md` 只追加：誰或哪個 agent、何時開始與結束、已知的用量或成本（不知道就寫 unknown）、證據在哪。`report.md` 放交付結果。暫存檔要寫用途、位置，以及要不要留。舊的獨立執行紀錄庫不再收新紀錄。公開紀錄不要帶私人細節。
