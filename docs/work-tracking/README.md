# 工作追蹤

> **兩層。** 大需求的流程依據是 desk（https://github.com/fallrising/desk 的 docs/operating-method.md）§0，這裡不重述。本 repo 的技術任務照根目錄 [AGENTS.md](../../AGENTS.md) 的技術任務合約管理（位置、欄位、合併門檻都在那裡）。不要求 `Desk-Task` trailer。

本目錄的 [task](task-template.md)、[report](report-template.md) 只是可選格式，不是認領權威，也不要求串行指派或由 orchestrator 負責 routing／acceptance。

已完成、仍帶 doing claim 的舊任務紀錄在 [archive/tools/codex-usage/tasks/346-offline-evidence](../../archive/tools/codex-usage/tasks/346-offline-evidence/)。檔案內容不改，不要照它認領。被取代的舊契約在 [archive/docs/work-tracking/README.md](../../archive/docs/work-tracking/README.md)，同樣不是現行規則。

## 授權

- 變更走 PR，不直接動 main。
- 只有不可逆或危險操作才問 owner。文字以根目錄 [AGENTS.md](../../AGENTS.md) 為準。
- `Refs` 不得用來自動關閉 issue。
- 開工條件與合併門檻見根目錄 AGENTS.md 的技術任務合約；本說明不另給授權。標成 `ready` 不是 merge 許可。

## 公開邊界

不要把私人任務內容、個人檔案路徑、主機名、IP、網域、帳號或憑證寫進這個公開 repo。公開可以指向 `fallrising/desk` 的 `docs/operating-method.md`，以及 journal 的 run 路徑格式。

## 執行紀錄

過程紀錄以 desk 的 [`docs/operating-method.md`](https://github.com/fallrising/desk/blob/main/docs/operating-method.md) 為準。owner 選用，或 desk §0 讓工作選用時，寫到 `fallrising/journal` 的 `runs/<repo>/<project>/YYYY/MM/<UTC>-<run-id>/run.md`。公開紀錄不要帶私人細節。

## 任務板

項目任務板預設放在 `<項目目錄>/docs/tasks/BOARD.md`（hai-taskboard 已用 `docs/tasks/`），欄位見根目錄 AGENTS.md 的技術任務合約。板檔是工作流本身的文件，不受各項目 AGENTS「只改當前 task 允許路徑」限制。
