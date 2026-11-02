# M0 文件驗證紀錄

日期：2026-11-02。範圍：新項目規格與必要索引；沒有 runtime 測試、部署或安全審計。

## 來源完整性

終端 `git clone` 回報 `Could not resolve host: github.com`；不推斷 GitHub app 無法存取。app 已成功讀取 repo、建立工作分支及先行認領。

以 app 讀取固定基準 `244c7f7b416508aedd8f5f8d4a082ae2bb17d022` 的內容，在本機重建必要文字檔；寫入前 Git blob SHA 對照如下，完全一致，不以手抄內容直接覆蓋未核對檔案。

| 基準檔案 | Git blob SHA |
| --- | --- |
| README.md | c2448aa120dc6724232147b6b6f7d2919516a758 |
| PROJECTS.md | d266d36948392459ffe12ca9dccdb70769d92ef4 |
| docs/project-success/inventory.json | 38a87501617d5f7c3ba950af0344c3a239a7ef81 |
| scripts/check_project_success.py | 55b07757ec3f54c79aaf18a0ed7f0b18d98ccd79 |

## 已執行檢查

- 固定來源 blob hash 驗證：PASS。
- repo 原版 validator 的元件 targeted 模式：PASS（14 條 AC、frontmatter、必要章節及 SUCCESS 導航）；不代表全庫模式。
- PROJECTS 使用原版 `index_text` renderer：先重現既有索引逐 byte 相同，再加新項；既有 inventory entries 與索引 rows 保留。
- 本元件 Markdown 本地連結、code fences、AC-001–014 唯一性、M0 認領列對照及 runtime pending：PASS。

完整 clone 不可得，所以沒有在本機執行全庫 `--write-index`／`check_indexes.py`／全庫測試；使用原版 renderer 不是冒充完整 CLI 已跑過。全庫必要檢查由 PR 的候選 SHA CI 補驗，結果回讀後記在 PR。提交透過 Git Data 的 tree＋commit，非 force fast-forward 並檢查 expected head；不修改 main。

## 未驗證／停止條件

AC-006–014 全部 NOT RUN。E2EE profile、真 CF hibernation／buffer 邊界、真 ntfy/Bark iOS delivery、安全 reviewer 均未驗。這是 Draft SDD，不標 mainline complete，不建立 usable tag，不合併／部署。
