# 方案：M4 Max 48GB 單人座位

狀態：文獻方案，目標晶片已由機主確認為 M4 Max。第 6 節的驗收還沒有在這台筆電上做。通過之前，表上的 tok/s 是同配置機器的公開碼錶，不是這台的成績。

日期：2026-10-17。

## 1. 這台機器扮演什麼

它是坐在前面、開著蓋、一次服務一個人的推論座位。筆電負責互動模型。整夜開著、或要把 66GB 的 Strata 權重整份留在記憶體裡，需要 128GB 等級的 Max／Studio。同晶片的 128GB 機器才是 strata-mlx 那些 68–111 tok/s 的出處；這台是 48GB。

48GB 的 M4 Max MacBook Pro 是 16 核 CPU、40 核 GPU，廣告頻寬 **546 GB/s**。14 核 CPU、32 核 GPU 的 M4 Max 停在 36GB、410 GB/s，不是這台。546 是 Apple 的廣告規格，這份方案沒有這台筆電的 STREAM 實測。驗收第 1 步仍要用 `system_profiler` 對上 40 核 GPU 與 48GB。

## 2. 三種座位，同時只開一種

### A. 日常寫程式（預設）

引擎用 MLX。模型用 Qwen3.6-35B-A3B 的 4-bit。上下文先開 4K。

公開碼錶是另一台 M4 Max、40 核 GPU、48GB，oMLX 0.4.4，macOS 26.5.1，2026-06-19（[oMLX dj8wuafo](https://omlx.ai/benchmarks/dj8wuafo)）：

| 上下文 | 預填 | 解碼 | 峰值 |
| --- | --- | --- | --- |
| 1K | 1,322 tok/s | 135.8 tok/s | 19.2 GB |
| 4K | 1,703 tok/s | 132.2 tok/s | 20.0 GB |

規劃用 **4K、約 132 tok/s、峰值約 20GB**。同一頁的批次是 1 路 135.8、2 路 198.7、4 路 273.8 tok/s。四路聚合約兩倍，座位仍按一個人設計。

M4 Pro 48GB 上的 75 tok/s 是另一顆晶片，不作為這台的對照目標。公式站估算的 46 或 120 tok/s 也不採用。

6-bit 不作為預設。同一晶片與 48GB 上有一輪 oQ6 加 MTP，1K 解碼 84.1 tok/s、峰值 28.4 GB（[oMLX 0ffq47uw](https://omlx.ai/benchmarks/performance/0ffq47uw)）。它比 4-bit 慢，而且佔掉 Kev 的餘地。稠密 27B 沒有這台配置的碼錶，不和這顆 MoE 一起常駐。

旁邊只允許兩樣小東西：

- 嵌入：BGE-M3 MLX 4-bit，權重檔約 321 MB（[mlx-community/bge-m3-mlx-4bit](https://huggingface.co/mlx-community/bge-m3-mlx-4bit)）。這是檔案大小，不是聯合 RSS。
- 判斷：Kev-4B。在 M4 Pro 24GB Mac mini 上，穩態占用 8.6 GB、載入峰值 15.6 GB，冷啟動 1.2 秒、暖機 262 ms（[DevelopersIO，2026-09-27](https://dev.classmethod.jp/articles/kev-oss-jev-compatible-mlx-mac/)）。

兩顆模型一起冷啟動的記憶體沒有人量過。順序是：機器上沒有大模型時先載 Kev-4B，等它回到穩態，再載 MoE。出現新的 swap 就把 Kev 卸掉，判斷改走託管 Jev。

### B. 要 Qwen3.8-Flash-Next 時

模型是 Qwen3.8-Flash-Next：125B 總量、每 token 啟動 6B，另加 51B n-gram 表與 4B 草稿頭（[Strata README](https://github.com/Niko1221/Strata/blob/main/README.md)、[模型卡](https://huggingface.co/Qwen/Qwen3.8-Flash-Next)）。公開計時用 ISTA-DASLab 的 Q2_0 GGUF，約 66.4 GB，放不進 48GB。官方把 28.8 GB 的 n-gram 表放在 SSD；GPU 映射包 37.6 GB，加上提示緩衝、KV 與草稿層大約 46 GB，建議從 64GB 起（[docs/MAC.md](https://github.com/Niko1221/Strata/blob/main/docs/MAC.md)）。

切到 B 之前卸下 A 的 MoE 與 Kev-9B。

引擎用 [strata-mlx](https://github.com/yibie/strata-mlx)。專家上限 24GB，推測解碼打開。上限放到約 30GB、只留約 8.5GB 給系統時，啟動就置換約 4.98 GiB，該次被停掉。日常代理用過 20GB 上限。

2026-10-14 至 15 日，同一台 M4 Pro 48GB、macOS 26.7.1、短技術提示、各 128 個輸出 token、溫度 0（[@yuanhao 10/14](https://x.com/yuanhao/status/2110334086426337592)、[10/15](https://x.com/yuanhao/status/2110640238758383692)）：

| 跑法 | 解碼 |
| --- | --- |
| 官方 Strata Metal 0.1.44.1，推測解碼關 | 14 日三次 29.4、25.6、30.3 tok/s。15 日中位數 29.2、23.9、27.6 |
| strata-mlx，24GB 上限，第一輪 | 25.9、32.9、26.8 tok/s |
| 同上，快取暖了，專家檔讀取掉到 0 MB／token | 31.8、45.0、32.5 tok/s。45 是合併程式提示的重複，該輪草稿接受 93／102 |
| 同一人的 yoyo 代理，32K–36K，專家快取 20GB | 自述約 25 tok/s。同日一張截圖頁尾是 8 tok/s，圖上沒有量化與上限（[32K](https://x.com/yuanhao/status/2110809117195702401)、[36K](https://x.com/yuanhao/status/2110850073940697413)） |

這些是 **M4 Pro 48GB** 的碼錶，頻寬 273 GB/s、GPU 至多 20 核。這台是 40 核、546 GB/s，沒有同配置的 Strata 計時，所以不把 25 或 32 寫成規劃速度。暖機且專家已在記憶體裡時，解碼有機會快過那台 Pro；專家一旦回到 SSD，速度由碟決定，546 GB/s 補不上。最快的一整次 Pro 請求是 3.45 秒，其中提示 0.61 秒、解碼 2.84 秒；0.61 秒沒有對應的提示 token 數，不能換成預填速率。

一次一個請求。官方 Metal 的 `--parallel` 沒有移植到 Mac，strata-mlx 也還沒有把多段對話一起解碼。

Q2_0 是損得多的那一檔。v0.1.44 用 4,995 個教師強制位置對 Q8_0：Q2_0 最高 token 一致率 80.6%、平均 KL 0.315；IQ3_S 是 87.7%、0.144（[v0.1.44](https://github.com/Niko1221/Strata/releases/tag/v0.1.44)）。48GB 沒有 IQ3_S 計時。專案自己的 48GB 列（Q2_0 專家約 82%、IQ3_S 約 51%）是算術，作者寫明不是測試，而且新的預設還沒有在 48GB 的機器上重跑（[ROADMAP](https://github.com/yibie/strata-mlx/blob/main/ROADMAP.md)）。

必須從這台的預期裡刪掉的數字：strata-mlx README 的 Q2_0 **68–111 tok/s** 是 M4 Max、**128GB**，整份權重放得進記憶體。作者寫明那一節沒有跑在小於 128GB 的 Mac 上。這台同為 M4 Max，容量仍是 48GB。

### C. 資料不能出門，判斷要更接近 Jev

Jev 是 TypeSafe 的託管 System One：`choice`、`score`、`noul`，回機率，不生成文章。2026-10-14 的官方價格是每百萬輸入 token 0.042 美元、輸出 0 美元；單次請求上下文 64K、單題 32K；權重不公開（[模型頁](https://docs.typesafe.ai/models)）。資料可以出門、又在意校準時，繼續打這個 API。

本機替身是 [Kev](https://github.com/jaredpalmer/kev)（Apache-2.0）。它實作同一個 `POST /v1/systemone`，TypeSafe Python SDK 把 base URL 改到 `http://127.0.0.1:8009`、模型改成 `kev-latest`。它不是 Jev 的權重。

延遲只有較小的機器：

| 模型 | M4 Pro 24GB Mac mini | 這台 M4 Max 48GB |
| --- | --- | --- |
| Kev-4B | 占用 8.6 GB，峰值 15.6 GB；第一次 1200.9 ms，第二次 262.1 ms | 沒有公開計時。24GB 已經放得下，所以 A 直接用它 |
| Kev-9B | 占用 17.4 GB，峰值 30.6 GB；第一次約 30 s，第二次 483.0 ms。作者把冷啟動歸因於峰值超過 24GB | 沒有公開計時。30.6 GB 低於 48GB，應能避開那次超額。這是容量推論。483 ms 發生在剛剛超額的機器上，不能當成這台的下限或上限 |
| Kev-27B | 作者表上 bf16 權重約 51 GB | 進系統之前就超過 48GB，不載 |

品質是作者自測，不是第三方在 Mac 上對打活的 Jev。Decision Index：Kev-4B 38.0、Kev-9B 41.0、Kev-27B 52.3、Jev 54.0。新來源準確率 Kev-4B 0.838、Kev-9B 0.852；Jev 只有開發集 0.857。9B 相對 4B 是幾分的移動。C 的做法是卸下 Strata 與 A 的 MoE，只留 Kev-9B。4B 與 9B 的載入峰值加總沒有被測量，不一起常駐。

Laya 與 laya-mlx 是幾百 MB、十毫秒級的分類器，選項一多品質就掉，也不提供這份方案要的 Jev HTTP 伺服器。不進座位。

## 3. 記憶體怎麼守

Apple 沒有公開這代的 GPU 工作集上限。2026 年被重複引用的規則是 36GB 以上約四分之三，48GB 約 36 GiB；oMLX 在 `iogpu.wired_limit_mb` 未設定時也按約 75% 描述，行程保留另寫 8GB（[oMLX #1463](https://github.com/jundot/omlx/issues/1463)、[oMLX #137](https://github.com/jundot/omlx/issues/137)）。兩條都是規則，不是這台筆電閒置時的快照。

座位因此：

- 預設不調高 wired limit。
- 單一大模型的穩態留在 24GB 以內：A 的 4-bit MoE 約 21GB，B 的專家上限 24GB。
- 第二個模型只允許 Kev-4B 或那顆嵌入模型。一出現新的 swap 就卸掉第二個。
- 70B 不做日常模型。它會吃掉幾乎整段可交給 GPU 的記憶體。唯一找到的 48GB 70B 碼錶是 M4 Pro，不是這台，不引用那個 tok/s。

座位按一個人設計。這台配置上，A 的模型四路一起跑也只到單路的約兩倍（見第 2 節）。

專家離開 DRAM 就落到 SSD。這台的碟速沒有寫進方案；14 吋 M4 Pro 的 Blackmagic 數字不轉過來。B 靠 24GB 上限把新的置換壓住，不靠把 546 GB/s 乘進碟上的專家。

## 4. 這台 Max 改變什麼、不改變什麼

改變的是 A。同配置的碼錶把 4-bit 35B-A3B 放在約 132 tok/s、峰值約 20GB，預填過 1,300 tok/s。M4 Pro 的 75 tok/s 留下只為了說明那是另一顆晶片。

不改變的是容量。Q2_0 仍是 66.4 GB，Kev-27B 仍放不下，A／B／C 仍不能同時開，專家上限仍是 24GB。B 沒有規劃 tok/s。驗收量到之後再寫進這份文件。不要把 128GB 的 68–111，或 546／273 的兩倍，填進 B 的空格。

## 5. 筆電不值夜

這台的頻寬已經是 546 GB/s。值夜輸在闔蓋會睡，也輸在 48GB 放不下整份 Strata。

闔蓋會睡。一則 Sequoia 15.5 的使用者報告裡，M4 Pro MacBook Pro 接電闔蓋，8 小時掉了超過 10% 的電（[Apple 討論區](https://discussions.apple.com/thread/256070788)）。這是一臺機器的報告，不是故障率。方案不依賴 `disablesleep` 把筆電變成伺服器。

生圖與 Whisper 不進座位。要跑生圖就單飛，不與 A 或 B 並存。沒有這台 M4 Max 48GB 的生圖或 Whisper 碼錶；16 核 M4 Pro 上的 FLUX 秒數不轉過來。

## 6. 驗收

尚未執行。每一列都要留下命令輸出或截圖裡的晶片、記憶體、量化、上下文與 tok/s。

1. 硬體。`system_profiler SPHardwareDataType` 與 `sysctl -n hw.memsize`。對上 M4 Max、40 核 GPU、48GB。對不上就停，不沿用這份速度。
2. A。4-bit 的 Qwen3.6-35B-A3B、4K、一則寫程式提示。記錄解碼 tok/s、峰值記憶體、`memory_pressure`。沒有新的 swap。
3. Kev-4B 是否並存。機器空著時先載 Kev-4B，再載 A 的 MoE。暖機後打一題 `choice`。出現新的 swap 就把 Kev 卸掉，這一列記「不並存」。
4. B。卸下 A。strata-mlx，專家上限 24GB，三則短提示各 128 token。暖機後專家檔不再每 token 讀碟，而且沒有新的 swap。記錄三個 tok/s。
5. C。卸下 B。只載 Kev-9B。記錄冷啟動、第二題延遲、峰值 RSS。
6. 切換。A → B → A。每一步只留該方案的模型。

第 2 列的規劃對照是約 132 tok/s、峰值約 20GB。第 4 列沒有規劃 tok/s；量到的三個數字寫回第 2 節 B。差一截就改這份文件的規劃數字，不改模型檔去湊表。
