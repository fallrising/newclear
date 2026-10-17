# 方案：M4 48GB 單人座位

狀態：文獻方案。第 6 節的驗收還沒有在目標機器上做。通過之前，表上的 tok/s 是別人的碼錶，不是這台筆電的成績。

日期：2026-10-17。

## 1. 這台機器扮演什麼

它是坐在前面、開著蓋、一次服務一個人的推論座位。筆電負責互動模型。整夜開著、70B、或好幾顆大模型同時常駐，換記憶體可以超過 48GB 的 Mac mini，或 128GB 等級的 Max／Studio。

「M4、48GB」有兩種 MacBook Pro。

| 晶片 | 這一代 MacBook Pro 的記憶體 | GPU | 廣告頻寬 |
| --- | --- | --- | --- |
| M4 Pro | 24GB 或 48GB。64GB 是 Mac mini | 14 吋 16 或 20 核；16 吋 20 核 | 273 GB/s |
| M4 Max | 48GB 只配 16 核 CPU／40 核 GPU。14 核 CPU／32 核 GPU 停在 36GB、410 GB/s | 40 核 | 546 GB/s |

基礎 M4 的 MacBook Pro 最高 32GB、120 GB/s。273、410、546 都是 Apple 的廣告規格，這份方案沒有 48GB 筆電的 STREAM 實測可以取代它們。兩檔 M4 Pro 共用同一條匯流排，核心數差在預填，不在解碼的頻寬上。

確認晶片再用第 6 節。下面的 Strata 速度只在「Apple M4 Pro、48 GiB」那組公開計時上成立。

## 2. 三種座位，同時只開一種

### A. 日常寫程式（預設）

引擎用 MLX。模型用 Qwen3.6-35B-A3B 的 4-bit。上下文先開 4K，任務需要再升到 16K。

公開碼錶，都是 M4 Pro、48GB：

| 來源 | 條件 | 預填 | 解碼 | 峰值 |
| --- | --- | --- | --- | --- |
| [oMLX 0.5.4，2026-08-03](https://omlx.ai/benchmarks/performance/ais6hsek) | 20 核 GPU，4K | 834.1 tok/s | 75.4 tok/s | 20.1 GB |
| 同上 | 16K | 737.6 tok/s | 59.1 tok/s | 20.8 GB |
| [Rapid-MLX 語料](https://rapidmlx.com/benchmarks/qwen3.6-35b-4bit/apple-m4-pro) | 核心數未寫 | 959 tok/s | 85.5 tok/s | 20.6 GB |

6-bit、128K 在 16 核上的峰值到過 31.5 GB（[oMLX tok7nh83](https://omlx.ai/benchmarks/tok7nh83)），不作為預設。稠密 27B 4-bit 大約 18 GB、15 tok/s（[Rapid-MLX README](https://github.com/raullenchai/Rapid-MLX/blob/main/README.md)），比這顆 MoE 慢，也不和它一起常駐。

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

規劃用 **25 tok/s**。暖機短提示用 32–33。45 與 8 都留下，不單引其中一個。最快的一整次請求是 3.45 秒，其中提示 0.61 秒、解碼 2.84 秒；0.61 秒沒有對應的提示 token 數，不能換成預填速率。

一次一個請求。官方 Metal 的 `--parallel` 沒有移植到 Mac，strata-mlx 也還沒有把多段對話一起解碼。

Q2_0 是損得多的那一檔。v0.1.44 用 4,995 個教師強制位置對 Q8_0：Q2_0 最高 token 一致率 80.6%、平均 KL 0.315；IQ3_S 是 87.7%、0.144（[v0.1.44](https://github.com/Niko1221/Strata/releases/tag/v0.1.44)）。48GB 沒有 IQ3_S 計時。專案自己的 48GB 列（Q2_0 專家約 82%、IQ3_S 約 51%）是算術，作者寫明不是測試，而且新的預設還沒有在這台 M4 Pro 上重跑（[ROADMAP](https://github.com/yibie/strata-mlx/blob/main/ROADMAP.md)）。

必須從這台的預期裡刪掉的數字：strata-mlx README 的 Q2_0 **68–111 tok/s** 是 M4 Max、128GB。作者寫明那一節沒有跑在小於 128GB 的 Mac 上。

### C. 資料不能出門，判斷要更接近 Jev

Jev 是 TypeSafe 的託管 System One：`choice`、`score`、`noul`，回機率，不生成文章。2026-10-14 的官方價格是每百萬輸入 token 0.042 美元、輸出 0 美元；單次請求上下文 64K、單題 32K；權重不公開（[模型頁](https://docs.typesafe.ai/models)）。資料可以出門、又在意校準時，繼續打這個 API。

本機替身是 [Kev](https://github.com/jaredpalmer/kev)（Apache-2.0）。它實作同一個 `POST /v1/systemone`，TypeSafe Python SDK 把 base URL 改到 `http://127.0.0.1:8009`、模型改成 `kev-latest`。它不是 Jev 的權重。

延遲只有較小的機器：

| 模型 | M4 Pro 24GB Mac mini | 48GB 筆電 |
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
- 70B 不做日常模型。2024-11-09 有人把 wired limit 調到 42000 才在 M4 Pro 48GB 上跑起 Ollama 的 `llama3.1:70b`，短提示 5.69 tok/s、約 1024 token 的提示 5.18 tok/s（[r/LocalLLaMA](https://www.reddit.com/r/LocalLLaMA/comments/1gn3zp8/those_of_you_who_got_the_48gb_m4_macbook_pro/)）。量化未寫明。

四個客戶不會把管子變寬多少。同一台 16 核、48GB 上，gpt-oss-20b 在 1K 上下文的聚合解碼是 1 路 63.1、2 路 83.3、4 路 99.2 tok/s（[oMLX j4lyfik6](https://omlx.ai/benchmarks/j4lyfik6)）。座位按一個人設計。

專家離開 DRAM 就落到 SSD。唯一完整標成 48GB 的讀取，是 14 吋 M4 Pro、2TB 的 Blackmagic 5GB 讀取 5378 MB/s（[Notebookcheck](https://www.notebookcheck.net/Apple-MacBook-Pro-14-2024-review-The-M4-Pro-and-matte-display-are-massive-upgrades.914597.0.html)）。Apple 的電池測試腳註用過 48GB、512GB SSD，所以 48GB 不保證碟是這個速度。B 靠 24GB 上限把新的置換壓住。

同一份 Rapid-MLX 語料裡，35B-A3B 的解碼從 M4 Pro 的 85.5 tok/s 到 M3 Ultra 的 91.9 幾乎沒動；稠密 4B 才沿著頻寬爬（基礎 M4 37.3、M4 Pro 82.8、M4 Max 138）。多出來的頻寬不解決 66GB 的檔案，也不保證 A 的解碼變成兩倍。

## 4. 若這台是 M4 Max 48GB

容量規則整份沿用：Q2_0 仍是 66GB，Kev-27B 仍放不下，A／B／C 仍不能同時開，專家上限仍是 24GB。第 2 節 B 的 tok/s 整欄作廢。用第 6 節的同一組提示重測，再把數字寫回這份文件。不要把 128GB Max 的 68–111，或 546／273 的兩倍，填進空格。

## 5. 筆電不值夜

速度輸的是容量與睡眠，不是 273 GB/s。同檔 M4 Pro 的 Mac mini 匯流排一樣，而且 mini 可以到 64GB。

闔蓋會睡。一則 Sequoia 15.5 的使用者報告裡，M4 Pro MacBook Pro 接電闔蓋，8 小時掉了超過 10% 的電（[Apple 討論區](https://discussions.apple.com/thread/256070788)）。這是一臺機器的報告，不是故障率。方案不依賴 `disablesleep` 把筆電變成伺服器。

生圖與 Whisper 不進座位。這台等級上唯一對得上的生圖碼錶，是 16 核、48GB 的 1024×1024 FLUX.2 Klein，272 秒（[Rapid-MLX README](https://github.com/raullenchai/Rapid-MLX/blob/main/README.md)）。要跑就單飛，不與 A 或 B 並存。Whisper 沒有 M4 Pro 48GB 的碼錶。

## 6. 驗收

尚未執行。每一列都要留下命令輸出或截圖裡的晶片、記憶體、量化、上下文與 tok/s。

1. 硬體。`system_profiler SPHardwareDataType` 與 `sysctl -n hw.memsize`。記錄是 M4 Pro 還是 M4 Max、GPU 核數、48GB。
2. A。4-bit 的 Qwen3.6-35B-A3B、4K、一則寫程式提示。記錄解碼 tok/s、峰值記憶體、`memory_pressure`。沒有新的 swap。
3. Kev-4B 是否並存。機器空著時先載 Kev-4B，再載 A 的 MoE。暖機後打一題 `choice`。出現新的 swap 就把 Kev 卸掉，這一列記「不並存」。
4. B。卸下 A。strata-mlx，專家上限 24GB，三則短提示各 128 token。暖機後專家檔不再每 token 讀碟，而且沒有新的 swap。記錄三個 tok/s。
5. C。卸下 B。只載 Kev-9B。記錄冷啟動、第二題延遲、峰值 RSS。
6. 切換。A → B → A。每一步只留該方案的模型。

第 2 列的規劃對照是約 75 tok/s、峰值約 20GB。第 4 列的規劃對照是約 25 tok/s，暖機短提示約 32 tok/s。差一截就改這份文件的規劃數字，不改模型檔去湊表。
