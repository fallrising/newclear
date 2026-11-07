# Iris 教學與原始來源索引

查核日期：2026-10-24。本文屬 M0 文件研究；未下載模型、未編譯 Iris、未在任何 GPU 上執行推論。專案範圍與驗收以 [SDD](../SDD.md) 和 [SUCCESS](../SUCCESS.md) 為準。

## 使用方式與版本基準

技術結論優先採用固定版本的上游原始碼、官方模型資料及硬體供應商文件。第三方文章只提供操作經驗，不能取代本專案的驗收結果。

| 項目 | 固定值 |
| --- | --- |
| Iris repository | [antirez/iris.c](https://github.com/antirez/iris.c) |
| Iris source commit | [ff97831282ecc6691710828604165da84b0616f5](https://github.com/antirez/iris.c/commit/ff97831282ecc6691710828604165da84b0616f5)，commit 日期 2026-10-23 |
| M1 模型 | [black-forest-labs/FLUX.2-klein-4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)；distilled |
| M1 模型 revision | [e7b7dc27f91deacad38e78976d1f2b499d76a294](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/tree/e7b7dc27f91deacad38e78976d1f2b499d76a294) |
| 首要驗證環境 | macOS Apple Silicon／Metal；實機驗證待 M1 |

固定 source commit 與固定模型 revision 是兩個獨立要求。後續還須記錄實際檔案清單、完整性驗證資料、建置工具與機器環境；本頁的版本選定不等於權重已下載或可用驗收已完成。

## 八筆主要來源

| ID | 來源 | 日期／適用版本 | 可學到的內容 | 採用限制 |
| --- | --- | --- | --- | --- |
| R01 | [Iris 官方 README](https://github.com/antirez/iris.c/blob/ff97831282ecc6691710828604165da84b0616f5/README.md) | 固定於上述 engine commit；查核 2026-10-24 | 建置選項、模型準備、文生圖／編輯／多參考圖、CLI 及 C API 範例，是操作入口 | 原始碼與文件有差異時逐項記錄；不把下載大小、記憶體或 benchmark 摘要當成所有環境的保證 |
| R02 | [MPS Speed Optimization Log](https://github.com/antirez/iris.c/blob/ff97831282ecc6691710828604165da84b0616f5/SPEED.md) | 文件內基準日期 2026-02-06；M3 Max 40-core GPU／128GB | 分階段量測、GPU 資料常駐、減少同步和批次提交的優化思路 | 歷史工程紀錄；部分命令仍使用舊名稱 ./flux，應依當前入口確認；數值不是 M4 的驗收門檻 |
| R03 | [M1 Max 上以 mflux 與 iris.c 執行 FLUX.2 Klein 4B](https://lilting.ch/en/articles/flux2-klein-4b-mflux-iris-m1-max)（[日文原文](https://lilting.ch/articles/flux2-klein-4b-mflux-iris-m1-max)） | 刊登 2026-04-30、更新 2026-07-24；作者使用 M1 Max 64GB，未固定 Iris commit | 第一手 Metal 建置、模型下載、文生圖及編輯操作；模型快取位置不同造成重複占用的經驗 | 僅作補充。文中的 Python 敘述須依現行下載器訂正；機器、版本及量測口徑不同，不能直接移植效能結果 |
| R04 | [BFL 官方 FLUX.2 Klein 4B 模型卡](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) | 動態模型卡；查核 2026-10-24。下載另固定上列 revision | 模型定位、4-step distilled 參考設定、生成／編輯能力與 Apache 2.0 授權 | 官方參考管線的速度與顯存說明不等於 Iris 的實測；模型卡與實際下載 revision 分別留痕 |
| R05 | [NVIDIA CUDA Installation Guide for Linux](https://docs.nvidia.com/cuda/cuda-installation-guide-linux/) | 動態官方文件；查核 2026-10-24 | Linux、GPU、編譯器與 toolkit 前置相容性、安裝及驗證入口 | 供後續 NVIDIA 路線使用；latest URL 不是可重現版本，實作時記錄所選 driver／toolkit／編譯器 |
| R06 | [NVIDIA CUDA on WSL User Guide](https://docs.nvidia.com/cuda/wsl-user-guide/) | 動態官方文件；查核 2026-10-24 | Windows 主機驅動與 WSL2 Linux CUDA 工具的分工和平台要求 | 平台支援不代表 Iris 已在 WSL2 通過驗收；本專案目前沒有 WSL2 執行證據 |
| R07 | [AMD ROCm compatibility matrix](https://rocm.docs.amd.com/en/latest/compatibility/compatibility-matrix.html) | 查核頁面日期 2026-08-26；查核 2026-10-24 | 依 GPU／APU、OS、driver 及 firmware 核對 ROCm 組合 | 不能由「AMD CPU／顯示晶片」推論 ROCm 可用；應保存所選版本相容性依據。舊 system-requirements 頁面已指向此入口 |
| R08 | [Windows support: build with MinGW-w64 and OpenBLAS — PR #52](https://github.com/antirez/iris.c/pull/52) | 查核 2026-10-24：open，尚未合併 | 原生 Windows 所需的檔案映射、系統呼叫、檔案模式調整；MSYS2 UCRT64／BLAS 提案 | 不是 main 已有能力；提案排除依賴 termios 的互動 REPL，不代表完整 Windows／GPU 功能一致 |

R01、R02、R04–R08 為上游或供應商原始資料；R03 為第三方第一手操作紀錄。檢索未找到可確認且足以取代官方文件的 Iris CUDA／ROCm 端到端教學，因此這兩條路線採用「供應商準備環境文件＋上游建置規格」，仍待實機驗證。

## 文件與程式差異

### 準備模型仍會使用 Python

[download_model.sh](https://github.com/antirez/iris.c/blob/ff97831282ecc6691710828604165da84b0616f5/download_model.sh) 第 157–169 行使用 python3 與標準庫 json 解析文字編碼器分片清單；第 191–198 行處理分片 Transformer。推論執行檔不依賴 Python ML 框架，不能因此把官方 shell 下載流程說成完全不需要 Python。R03 的相關敘述以此實碼訂正。

### 上游下載器目前使用 resolve/main

同一下載腳本的下載基底指向 Hugging Face 的 resolve/main，沒有模型 revision 參數。即使固定 Iris source commit，直接使用該腳本也不能保證下載到本專案指定的模型 revision。

M1 的模型準備流程必須依固定 revision 取得完整檔案並驗證；可採明確的 revision-aware 下載實作或受控人工準備。本次尚未實作該流程，不虛構上游已有 revision 選項，也不把執行成功當成版本固定的證據。

### 模型檔案的來源 digest 不是全部 SHA-256

[Hugging Face 官方下載 API 文件](https://huggingface.co/docs/huggingface_hub/package_reference/file_download)（查核 2026-10-24）說明一般 Git 檔與 LFS 檔的物件識別不同。M1 需按固定 revision tree／LFS metadata 核對來源 digest：一般 Git 檔驗 Git blob OID，LFS 權重驗 SHA-256；所有本地檔案再統一計算 SHA-256 作 receipt。不能把 ETag 一律當作裸檔 SHA-256，也不能把未知來源 digest 虛構成已驗證。

### 建置選項與平台能力以 Makefile 為準

[Makefile](https://github.com/antirez/iris.c/blob/ff97831282ecc6691710828604165da84b0616f5/Makefile) 限制 MPS 建置為 Darwin／arm64。CUDA 與 ROCm 分別使用 nvcc／hipcc 及對應函式庫；它們不因移除 Python ML stack 就免除 GPU 工具鏈與驅動需求。原生 Windows 狀態另外由 R08 追蹤。

### 歷史 benchmark 與驗證口徑

R02 為歷史優化紀錄，R03 為作者自己的 M1 Max 測試；本專案不沿用其秒數作為驗收承諾。[run_test.py](https://github.com/antirez/iris.c/blob/ff97831282ecc6691710828604165da84b0616f5/run_test.py) 容許浮點與 GPU 非決定性造成的圖像差異，所以也不承諾跨後端逐像素一致。成功與否應依 SDD 的輸出、版本、失敗處理與證據要求判斷。

## 閱讀順序

1. 先讀 R01，確認使用形態，再讀 [平台與模型邊界](platform-models.md)。
2. 用 R04 確認 M1 模型資料；準備模型時處理固定 revision 與檔案完整性。
3. R03 只補充 Apple Silicon 操作經驗；有衝突時回到上述原始碼。
4. 實測有瓶頸後再參考 R02；擴充其他平台時才讀 R05–R08。

回到 [專案入口](../README.md)。
