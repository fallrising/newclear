# Gameplay Pattern Catalog — Agent contract

先讀 [SUCCESS.md](SUCCESS.md)、[SDD.md](SDD.md)、[METADATA.md](METADATA.md)、[完整度報表](docs/coverage.md) 和 [最近驗證](docs/verification.md)。遵守根 AGENTS 與公開內容邊界。不因文件完成自行 merge、deploy 或打 tag。

實作前更新範圍、AC 與 [任務板](docs/tasks/BOARD.md)。每次 push 更新 last_activity。未合併不得標 done 或填 end。T-0001 的完成歷史保留，全量工作使用新的任務節。

筆記的 JSON frontmatter 加 Markdown 是內容權威；`sources/manifest.json` 是來源分母；`dist` 只能由 build.py 生成。不得鏡像原站全文、圖片或遊戲素材，不得把本地分析偽稱來源事實，不得把搜尋索引摘錄升格為直接頁面或實玩驗證。每篇最後必須附 sources 對應的實際條目網址。

提交前執行 `python3 sources/inventory.py --check`、`python3 sources/text_cache.py --check`、`python3 status.py --check`、`python3 build.py --check`、單元測試、靜態建置與瀏覽器 smoke。環境限制逐項記錄。從 repo root 執行 `python3 scripts/check_project_success.py --write-index` 與 `python3 scripts/check_indexes.py`。

`status.py --write` 從筆記與 `check_quotes.py` 產生 SUCCESS 狀態區、frontmatter `source_commit`、inventory 該列與 `review/pr-snippet.md`。不要手抄篇數或 SHA。改了 catalog 或該列 `source_commit` 的 PR，描述要包含這個片段。內容欄只能是來源原文的引用；`python3 check_quotes.py --check` 失敗就不能當通過。`review/auto_check.py` 仍在目錄裡，但 validate 不讀它，CI 也不呼叫它或 `review/promote.py`。模型的 pass 不是 reviewed。

收尾更新 SUCCESS、證據與根索引。新增來源或分類先同步 metadata 契約和測試。不把 pending 改成 passed，也不用筆記篇數代替 manifest 分母。
