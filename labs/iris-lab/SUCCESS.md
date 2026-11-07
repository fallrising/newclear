---
project: labs/iris-lab
purpose: 以固定 Iris 與模型版本驗證可重現的本機原生生圖流程
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-24
source_commit: 4fc5d9a7b49139115518379bf05e1cfec4fe1bce
---

# iris-lab 成功契約

## 主線與範圍

主線是 [SDD](SDD.md) 定義的本機單次生圖流程：固定原生 Iris、固定且完整驗證的 FLUX.2 Klein 4B distilled 模型，在 Apple Silicon Metal 產生有效圖片並保存可重現收據。後續 runtime 尚未實作；本次 T-0402 限 M0 研究與文件交付，不能由文件完成推導主線完成。

本檔 `source_commit` 是核對的 monorepo 文件基準，不是 Iris 引擎版本。引擎及模型各自的完整 pin 見 [upstream.lock.json](upstream.lock.json)。外部 source、模型、GPU SDK、實機試跑與部署不包含在本次交付。

## 驗收條件

AC 編號與內容沿用 SDD。`passed` 只表示該列明確範圍；M0 文件檢查不替代 AC-101–106 的真實 runtime 證據。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 指定 Iris 項目，When 建立 lab 規格，Then 用途、M0／M1 邊界、固定引擎與模型 revision、尚未驗證的權重內容均明確。 | passed | [SDD](SDD.md)、[lock](upstream.lock.json)；來源與未驗狀態經獨立文件審查。 |
| AC-02 | Given 上游固定版本，When 整理平台與模型，Then OS／backend、下載／建置／推論依賴及支援限制可分辨且附來源。 | passed | [平台與模型](docs/platform-models.md)；固定版本與官方依據經核對。 |
| AC-03 | Given 後續單次生圖需求，When 閱讀設計，Then 請求、結果、版本驗證、錯誤、取消與實機驗收有具體契約，未實作介面有標記。 | passed | [SDD](SDD.md)、[驗證計畫](docs/verification-plan.md)；來源 digest 契約修正後獨立審查通過。 |
| AC-04 | Given 網路教學研究，When 閱讀來源表，Then 官方與第三方來源、查核日期、可採用內容、版本／硬體限制均可核對。 | passed | [來源索引](docs/sources.md)；八筆主要來源及官方下載完整性補充，含版本／限制。 |
| AC-05 | Given 完整 M0 文件候選，When 執行文件契約／索引／連結與獨立審查，Then 無未解阻擋問題，且實際驗證範圍、PR 交付與合併回讀可以追查。 | passed | [M0 證據](docs/evidence/m0-document-review.md)：候選文件檢查與獨立審查通過；CI／合併實況由交付 PR 與[任務板](docs/tasks/BOARD.md)追查。 |
| AC-101 | Given 固定乾淨 engine checkout 與已驗模型 manifest，When doctor／build preparation，Then 建置來源、平台依賴、binary 與每個模型檔案可核對，缺項在推論前被拒絕。 | pending | 未實作 wrapper、未建置 binary、未下載或驗證權重。 |
| AC-102 | Given Apple Silicon 目標機與固定 4B 模型，When 512×512／seed 42／4 steps txt2img，Then 真實生圖得到可解碼且尺寸正確的 PNG，收據與 artifact 一致，並有可靠 Metal 使用證據。 | pending | 未有實機、圖片或 effective backend 證據。 |
| AC-103 | Given 非法輸入、缺檔／錯 hash、已存在目標及競爭 run，When generate，Then 各案例以契約錯誤退出，既有檔案不被覆蓋，無不該啟動的推論。 | pending | 未有實作及負例結果。 |
| AC-104 | Given 真實運行中的 Iris 子程序，When 取消或 timeout，Then 只清理該作業、釋放鎖、保留失敗收據，不產生成功 artifact；程序死亡殘留另行識別。 | pending | 未有子程序生命週期與實機取消證據。 |
| AC-105 | Given 同一已記錄環境，When 至少 1 次 cold 與 2 次 warm 執行，Then 來源／參數可重現，時間與記憶體有量測方法，圖片可檢查，差異與未知值如實保存。 | pending | 未量測延遲、資源或同環境重跑差異。 |
| AC-106 | Given 已準備 binary／模型及原生依賴，When 在不依賴 Python framework 的推論入口執行，Then 真實生圖成功，準備與測試依賴另列且未藏入 runtime。 | pending | 未執行獨立 runtime 驗證。 |

## 現況與缺口

現有內容是 SDD、來源研究、平台／模型矩陣、版本 metadata 與驗證設計。M0 權重欄位明確為未下載、未驗證；沒有 CLI、Go 模組、C 引擎建置、JSON invocation schema 或真實 PNG。Metal 可觀測方式、目標硬體資源、tokenizer 截斷與實測門檻仍待 M1。

CPU／CUDA／ROCm、Windows／WSL2、圖片編輯、其他模型與部署都沒有本專案驗收結果。其他模型有各自授權條件；不能由 Iris 的 MIT 推導權重可任意使用或散布。教學與上游歷史 benchmark 僅作研究來源。

## 啟動與驗證

目前沒有可啟動的 iris-lab runtime。[README](README.md) 是文件入口；[驗證計畫](docs/verification-plan.md) 是後續執行計畫，並非已完成的 quickstart。

文件檢查從 monorepo 根目錄執行：

```sh
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --cached --check
```

新檔須先加入 Git index，index 與工作樹內容要一致。[M0 證據](docs/evidence/m0-document-review.md) 分開記錄本地文件投影檢查、獨立審查與遠端完整 CI，不能用它們替代模型驗收。

## 可用版本

`usable_tag: none`，`mainline: incomplete`。M0 文件完成不產生可用標記。只有 M1 核心 AC、必要 CI／審查與真實主線驗收通過、合併後，才依共用規範評估經授權的 annotated usable tag；本次不建立 tag。
