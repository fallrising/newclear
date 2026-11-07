# iris-lab

以固定版本的 [antirez/iris.c](https://github.com/antirez/iris.c) 建立可重現的本機生圖實驗：記清楚模型、平台、建置依賴、輸入與輸出，讓後續接入工作流程時能核對每次執行。

**狀態：M0 文件先行，spec-only；尚無本項目的可執行工具或實機出圖證據。** 文檔檔位未分級，長期投入待決；本輪交付限研究、SDD、驗收設計與專案入口。

## 從哪裡開始

| 文件 | 內容 |
| --- | --- |
| [SUCCESS.md](SUCCESS.md) | 主線、逐項驗收、已完成範圍與未驗缺口 |
| [SDD.md](SDD.md) | M0 交付與後續 M1 介面、資料、失敗及重現契約 |
| [平台與模型](docs/platform-models.md) | OS／GPU backend、模型與依賴邊界 |
| [教學與來源](docs/sources.md) | 官方入口、第三方實測教學、版本與採用限制 |
| [驗證計畫](docs/verification-plan.md) | 後續實機試跑順序、負例與證據格式 |
| [版本鎖定](upstream.lock.json) | 固定引擎 commit 與模型 revision；權重內容尚未下載驗證 |
| [M0 文件檢查](docs/evidence/m0-document-review.md) | 本輪實際檢查及證據邊界 |
| [任務板](docs/tasks/BOARD.md) | T-0402 文件交付狀態 |

Iris 將支援的影像模型推論實作為原生程式，可避開推論時的 Python／PyTorch／Diffusers 環境；模型下載、測試工具與 GPU 驅動仍各有依賴。它有固定的模型架構範圍，不能拿任意聊天模型或 GGUF 檔直接執行。具體結論與來源見[平台與模型](docs/platform-models.md)。

後續第一條驗證主線為 **Apple Silicon + Metal + FLUX.2 Klein 4B distilled + 512×512 txt2img**。這是實作／驗證目標，目前沒有對目標硬體的速度、記憶體或畫質承諾。Linux GPU／CPU、圖片編輯與其他模型在另一期驗證。

## 本輪能驗證什麼

在 monorepo 根目錄執行 `python3 scripts/check_indexes.py`，可檢查項目契約與導航。新增檔案須先加入 Git index；這項檢查不會下載模型或執行影像推論。

目前沒有 `iris-lab` binary、可直接執行的 quickstart 或 usable tag。[SDD](SDD.md) 中的命令與 JSON 是待實作介面，不是已存在功能。來源程式與模型未匯入本 repo；Iris 的 MIT 與各模型授權分別適用。
