# 平台、依賴與模型邊界

查核日期：2026-10-24。本文區分上游已有實作與本專案待驗證的能力；M0 只交付文件，沒有任何本地建置、模型下載、GPU 推論或效能驗收結果。

規格與驗收入口：[SDD](../SDD.md)、[SUCCESS](../SUCCESS.md)。來源分級及教學限制見 [來源索引](sources.md)。

## 固定版本與主路線

| 項目 | M1 規劃 |
| --- | --- |
| Engine | antirez/iris.c |
| Engine commit | [ff97831282ecc6691710828604165da84b0616f5](https://github.com/antirez/iris.c/commit/ff97831282ecc6691710828604165da84b0616f5) |
| Model | black-forest-labs/FLUX.2-klein-4B，distilled |
| Model revision | [e7b7dc27f91deacad38e78976d1f2b499d76a294](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/tree/e7b7dc27f91deacad38e78976d1f2b499d76a294) |
| 首要平台 | macOS Apple Silicon／Metal |
| 上游建置入口 | make mps |
| 起始生成設定 | 4 steps；其餘參數與驗收案例依 SDD |
| 本專案狀態 | planned／未驗證 runtime；沒有 usable tag |

本表只固定來源與驗證方向，不保證任意 Apple Silicon 設備具有足夠資源，也不將選定模型等同完成下載。實作時須保存硬體、OS、工具鏈、模型檔案與輸出的實際證據。

## OS 與後端

以下上游能力以固定版本 [Makefile](https://github.com/antirez/iris.c/blob/ff97831282ecc6691710828604165da84b0616f5/Makefile) 和 [README](https://github.com/antirez/iris.c/blob/ff97831282ecc6691710828604165da84b0616f5/README.md) 為據。

| 平台 | 上游建置／運算後端 | 主要準備條件 | iris-lab 承諾與狀態 |
| --- | --- | --- | --- |
| macOS Apple Silicon | make mps；Metal／MPS／Accelerate | C／Objective-C 建置工具、make、xxd 與相容 macOS frameworks；Darwin／arm64 | M1 首要驗證路線；目前未執行 |
| macOS Intel | make blas；Accelerate | C 編譯器、make、系統 Accelerate | 上游路線；不在 M1 硬體驗收範圍 |
| Linux NVIDIA GPU | make cuda；CUDA／cuBLAS | 相容 GPU、驅動、nvcc、CUDA toolkit 與 host compiler | 後續候選；先依 NVIDIA 官方文件核對組合，未驗證 |
| Linux AMD GPU／APU | make rocm；HIP／hipBLAS | 相容 GPU／APU、driver、hipcc、ROCm 與 OS | 後續候選；依 AMD 官方矩陣核對，未驗證 |
| Linux CPU | make blas；OpenBLAS | C 編譯器、make、OpenBLAS | CPU 路線供後續驗證；可編譯不等同有可接受的生圖延遲 |
| 相容 POSIX CPU 環境 | make generic；專案 C 運算路徑 | C 編譯器、make 及原碼所用 OS 介面 | 不依賴外部 BLAS 的候選路線；沒有跨所有 OS 的保證 |
| Windows 原生 | [PR #52](https://github.com/antirez/iris.c/pull/52) 提案為 MinGW-w64／OpenBLAS | 查核時 PR 仍 open，main 未合併該移植 | 不列為已支援；追蹤上游變化後再評估 |
| Windows＋WSL2 | Linux 建置路徑；NVIDIA 情境可參考 [CUDA on WSL](https://docs.nvidia.com/cuda/wsl-user-guide/) | Windows 主機驅動、WSL2、相容 GPU 與 Linux toolkit | 架構上可評估的候選路徑；沒有 Iris／iris-lab 的實測承諾 |

原始碼與相容權重可跨平台共用，執行檔仍受 OS、CPU 架構與後端限制。上游 CPU 編譯帶有 march=native，CUDA／ROCm 預設也針對本機 GPU；搬移 binary 時須重新核對建置目標和 runtime，不能只檢查模型目錄是否相同。

## 準備與推論的依賴分開記錄

| 階段 | 實際依賴／行為 | 本專案要求 |
| --- | --- | --- |
| 取得與編譯引擎 | Git 或受控原始碼包；make、編譯器與所選後端工具鏈 | 核對完整 engine commit，記錄編譯後端及工具版本 |
| 上游 shell 模型下載器 | curl；Python 3 標準庫 json；可能需要 Hugging Face 存取條件及憑證 | 不描述成全流程無 Python；下載前確認來源、目的地、所需空間及存取條件 |
| 上游 Python 模型下載器 | Python 與 huggingface_hub | 屬準備工具；不因此要求推論 runtime 安裝 ML framework |
| 已準備模型的推論 | iris binary、完整相容模型目錄及所選後端 runtime／驅動 | 推論本身不需要 Python／PyTorch／Diffusers；離線可用性仍需實測 |
| 上游參考圖測試 | Python、NumPy、Pillow，以及測試所需模型 | 明確區分文件檢查、測試程式與真正影像推論；未執行時記錄原因 |
| Python reference parity 除錯 | 上游 debug 文件所列 ML dependencies | 不納入一般 runtime 需求；僅在具體差異需要排查時準備 |

依據：[下載腳本](https://github.com/antirez/iris.c/blob/ff97831282ecc6691710828604165da84b0616f5/download_model.sh)、[測試程式](https://github.com/antirez/iris.c/blob/ff97831282ecc6691710828604165da84b0616f5/run_test.py)、固定版本 README／Makefile。

### 模型 revision 與上游下載器的差異

上游 download_model.sh 使用 Hugging Face resolve/main，且直接以 python3 解析權重分片索引。它沒有提供模型 revision 參數。因此：

1. 固定 engine commit 不會連帶固定模型。
2. 直接照上游下載器執行，不能作為已取得 e7b7dc27f91deacad38e78976d1f2b499d76a294 的證據。
3. M1 必須建立使用該 revision 的準備流程，取得完整必要檔案及分片，並核對檔案清單與完整性。
4. 不使用缺檔、部分下載或錯誤 HTML 回應作模型檔案；失敗不進入推論驗收。
5. 本次未實作 revision-aware 下載器，未假設上游存在可用的 revision flag。

## 上游模型矩陣與本專案範圍

下表由固定版本 README、[核心 loader／dispatch](https://github.com/antirez/iris.c/blob/ff97831282ecc6691710828604165da84b0616f5/iris.c) 及官方模型資料交叉核對。表中的「上游實作」不表示 iris-lab 已測試。

| 模型 | 上游預設方式 | 文字編碼器 | 上游任務路徑／限制 | iris-lab 狀態 |
| --- | --- | --- | --- | --- |
| FLUX.2 Klein 4B distilled | 4 steps，無 CFG 雙分支計算 | Qwen3-4B | 文生圖、圖片編輯、多參考圖 | M1 指定模型；固定 revision；runtime 待驗 |
| FLUX.2 Klein 4B base | 50 steps，CFG | Qwen3-4B | 同家族生成／編輯路徑 | 不在 M1 驗收範圍 |
| FLUX.2 Klein 9B distilled | 4 steps | Qwen3-8B | 同家族生成／編輯路徑；權重有另外的存取及授權條件 | 後續候選，未驗 |
| FLUX.2 Klein 9B base | 50 steps，CFG | Qwen3-8B | 同上 | 後續候選，未驗 |
| Z-Image-Turbo 6B | 8 NFE／9 scheduler steps，無 CFG | Qwen3-4B | 此版本只提供文生圖；核心 dispatch 拒絕 img2img／multi-reference | 後續候選，未驗 |
| FLUX.3 Image Klein 5.6B distilled | 預設 16 steps，可用 4–16 | Qwen3-VL-4B 的文字部分 | 文生圖、圖片編輯、多參考圖 | 後續候選，未驗 |
| FLUX.3 Image Klein 5.6B base | 50 steps，CFG | 同上 | README 明示已實作但尚未測試，因作者當時未取得權重 | 不列為已驗證能力 |

M1 僅承諾指定的 FLUX.2 Klein 4B distilled 組合。其他權重、量化版本、模型架構與額外 adapter 不在這次驗收範圍；這個範圍選擇不代表對上游未來能力的斷言。

Qwen 在此作為影像管線的文字編碼器，不因此提供一般聊天服務。影像模型名稱中的參數量也不包含所有外加元件，不能只用 4B／9B 標籤估計完整下載量或執行記憶體。

## 記憶體、效能與結果一致性

本專案不把上游或第三方的記憶體峰值、速度倍數或秒數當成跨硬體保證。mmap 是檔案映射策略，不是權重量化；文字編碼器、影像 Transformer、VAE、GPU 權重與中間資料仍會影響資源需求。應分別記錄下載磁碟用量、系統記憶體、GPU／統一記憶體觀察與生成參數。

驗收結果須附實際 source／model revision、後端、機器與 OS、工具鏈、prompt、seed、尺寸、steps、起訖時間、exit code 和輸出資訊。不同後端的浮點運算及不同程式的亂數實作可能產生差異；固定 seed 是重現條件之一，不是跨後端逐像素一致的保證。詳見 [來源索引的差異記錄](sources.md#歷史-benchmark-與驗證口徑)。

## 授權邊界

Iris 程式碼的 MIT 與模型權重授權分別適用。M1 模型以 [BFL 模型卡](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) 及固定 revision 隨附授權為準；新增模型前另核對該模型的權重授權與存取條件。不得由引擎可載入，推論模型可任意散布或使用。

回到 [專案入口](../README.md)。
