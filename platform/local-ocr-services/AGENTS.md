# AGENTS.md

The parent `<workspace-root>/AGENTS.md` applies. This file records repository facts.

## Project facts

- Python 3.11 service code lives under `src/ocr_service`.
- All engines implement the protocol in `src/ocr_service/backends/base.py`.
- Optional engine imports must remain lazy so base tests do not install model runtimes.
- `POST /v1/ocr` accepts raw image bytes, not URLs or multipart forms.
- Engine images must remain independent and use one Uvicorn worker per container.
- Never add a runtime model download fallback. Model acquisition belongs to image build.
- Never commit `.env`, API keys, model caches, generated artifacts, or OCR input data.

## Repository-native checks

- `make test` builds and runs the isolated contract-test image.
- `make compile` checks Python syntax without writing bytecode to the worktree.
- `make compose-check` renders every Compose profile.
- `make check` runs all three gates.

## 主線與驗收文件先行

- 接手前先讀 [SUCCESS.md](SUCCESS.md)、相關規格與最近驗證紀錄，核對目前主線及缺口。
- 實作前先更新 SUCCESS 的本次目標、範圍、AC 與驗證計畫；不得為了完成而縮小已承諾主線。
- 收尾逐項記錄實際命令、結果、來源版本與未通過原因，同步 README 必要入口及項目進度；未跑不可寫通過。
- 主線全部驗收、必要 CI／審查通過並合併後，按 repo 共用規範建立 annotated `usable/<slug>/vX.Y.Z`，回讀遠端並更新索引。現行 owner 授權適用；本規則不授權部署或付費服務。
- 參考／封存項目保留其結束條件，不以新增文件當作可執行版本，也不因此恢復開發。
