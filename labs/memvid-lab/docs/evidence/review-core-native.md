# 核心場景與原生 Whisper 獨立審查

日期：2026-10-28。結論：**ACCEPT，無剩餘阻擋 finding**。

審查者未編寫 `scenarios.py` 或 native Whisper helper。本次唯讀檢查實作，於獨立暫存目錄執行，
只新增此報告；沒有修改實作、commit 或 push。`advanced.py`／`models.py` 由此審查者編寫，
因此明確排除於本獨立審查範圍，由主控另行核對。

## 候選識別

以下 SHA-256 對應實際審查／複驗的內容，不以文件更新日代替來源版本。

| 檔案（相對 lab） | SHA-256 |
| --- | --- |
| `scenarios.py` | `d6a368672473a6ae3eb666dd0d90e39ed743209fec5723b7ca17b5428296456d` |
| `lab.py`（執行入口識別） | `1fb777d22e302206f968cf8cf8206ee7c485c71f01aae38eac0b8f7cf8b918ff` |
| `offline.py`（隔離入口識別） | `dc325a1466950893319d8fd349538d62ce6e47f491bcf648e06ab86dc2183b9c` |
| `native-whisper/Cargo.toml` | `4db30f37b72526ce5bc32e9de4723cd524e5fc3cd0f4858ed6fec8764aa831af` |
| `native-whisper/Cargo.lock` | `0c6a779f79b1993dd2c97dae94e798bd726740a689802f18e8181b41cd256dd1` |
| `native-whisper/rust-toolchain.toml` | `9cbde07377abdce69bc9580adb0315d52e2a09d6494a2005550a7e6733d9688b` |
| `native-whisper/src/main.rs` | `991af72dcc408bab7f2d03b133ccf9d6081ca80201148b8e429afd2489fc8ed8` |
| `native-whisper/prepare_core.py` | `6250a846370fbb7130072edf2fdc9fb011a81dc9381d6831337db92e0c4db944` |
| `native-whisper/prepare_assets.py` | `16c03029a9eb28c655e7e028379c9f2577a02eb4515ce39a0f03b60bafabf02e` |
| `native-whisper/local-cache.patch` | `f35acc683f13ff8bfd31fd38d686236fd2c8ffa73465ae8cc200bdf584609df2` |
| `native-whisper/test_token_guard.py` | `9dbbff83b10b92e61aa5e2e07240ce198ff7f20ad94848891e17286fffbc5e33` |

原生執行檔 SHA-256 為 `edbae860cd5ec8467290ae84e3e683a46ca57f690abba9419928317d71fbe9c5`。
這是本次 Linux build 的識別，不宣稱跨主機編譯會產生相同 binary bytes。

### 最終格式 gate 的最小變更

`git diff --cached --check` 對 patch 的空白 context 行提出 trailing whitespace。
主控只在 `prepare_core.py` 的 `difflib.unified_diff` 加入 `n=0`，並重新產生無 context 的 patch。
審查者與先前保存的副本逐項比較，確認沒有其他準備邏輯、replacement 或推論程式變動；上表已更新兩個檔案的最終 hash。
以相同已核對 crate，在另一個無 `work/` 的乾淨副本重跑 preparation，exit 0，產出與既有準備檔 byte-for-byte 相同的 `whisper.rs`：
`ec807f1192e355fd0a543af19a5827e8e88286576a9557df43438b7c15e551c1`。
binary hash 也維持不變，因此沿用對相同執行 bytes 的 native 成功／失敗控制證據，未重跑無變更的模型推論。
下方獨立 core 報告產生於這次 patch 格式變更前；其 `scenarios.py` 與執行入口 bytes 未變，最終整套 source-hash 對照由主控完整 profile 再核對。

## 核心場景：獨立 12／12 通過

在正式安裝的 `.venv/bin/python` 執行以下命令；公開紀錄將獨立暫存輸出位置表示為 `work/review-core`：

```sh
.venv/bin/python lab.py run --profile core --output work/review-core
```

修正後重跑時間為 `2026-10-28T11:44:41.583130Z` 至 `2026-10-28T11:44:45.402610Z`。
環境為 Python 3.12.14、Linux x86-64、Memvid SDK 2.0.160／native core 2.0.140。
實得 **12 passed／0 failed／0 blocked／3 not_run**，exit 0。
`full_acceptance_passed` 正確為 `false`：本輪沒有把三個模型案例的未執行算成通過。
本次獨立報告 SHA-256 為 `9ebaabda064dac1173f981e40fa7eeba8d598aa18c92721917f8ea3dafcecdb1`。
主控完整模型整合證據另見 [full-run.json](full-run.json)，不以本輪 core 結果取代。

runtime 在匯入 SDK 前安裝 Linux seccomp；實測 IPv4／IPv6 建立 socket 均為 `EPERM`。
拒絕的系統呼叫為 socket、socketpair、connect、sendto、sendmsg、sendmmsg；新程序持久化案例繼承限制。

| 案例 | 獨立觀察與 oracle |
| --- | --- |
| UC-01 | 新程序讀回舊 checkpoint，再追加不同 frame；主程序重開後同時取得舊記憶與 continuation。 |
| UC-02 | scope 命中工程 runbook／unclassified；ACL enforce 只允許工程角色，錯角色、跨租戶、無 ACL metadata 均無命中。 |
| UC-03 | 只複製 `.mv2`，新程序正確檢索並通過完整性驗證；目的目錄沒有必要 sidecar。 |
| UC-04 | `retry` 命中程式與設計兩個來源，原始碼內容斷言成立；`attempt` 命中程式。exact `retry_backoff` 漏程式來源的缺口仍記錄。 |
| UC-05 | 真 `find` 命中政策與工單；動態 scope 取自實得 URI，兩份 context 分別有 URI 與正確事實。未知 query 經明示 guard 回空。 |
| UC-06 | current frame 為 completed，as-of 回 pending；timeline 同時保留 frame 0、1，沒有把追加誤稱 SQL overwrite。 |
| UC-07 | 客戶需求、產品 catalog、共同 `"offline search"` query 均核對來源與原文；手工 cards 的值、source frame、engine 保留。 |
| UC-08 | 真繁中內容可由明確文字片段取得；現行偏好為繁中、as-of 為英文，三個時間 frame 齊全。 |
| UC-09 | medical／legal／financial 三個 scope 各取得正確合成文件；未知 query 無命中，沒有產生專業建議。 |
| UC-10 | 舊 Monday frame 與新 Friday frame 可區分；session 跨開檔持久化，實際 FIND replay 為 1 matched／0 mismatched／0 skipped。 |
| UC-11 | 自訂 metadata 精確 round-trip；soft delete 前有命中、刪除後及重開後均無命中，保留資料仍可讀。 |
| CAP-PDF | 從真正 PDF 檔的 native extraction 取得 Thursday 與 ASTER731，來源與重開斷言通過。AWT 路徑警告仍可見，成功依據是 fallback 的實得內容。 |

### 索引修復與查詢邊界

`checked_hits()` 的預期來源與事實沒有傳入 SDK；它對實得 URI 集合做相等檢查，再逐筆核對內容。
未知來源、漏來源、錯誤事實都會失敗。斷言使用明示 exception，不因 `python -O` 消失。

詞彙索引修復是 `write → seal → close → doctor(rebuild_lex_index=True) → reopen` 的明示步驟。
它只在本 lab 新建檔案的寫入流程執行；`query()` 與唯讀開檔沒有 repair hook。
官方 doctor 實際還執行 vec/header/TOC 等規劃動作，報告保存完整 executed actions 與 `vec_index_corrupt` finding，
沒有把它縮寫成只重建 lexical 的無副作用操作。

本次獨立重現 UC-02 原始三份來源只回兩份，缺少工程 runbook；重建後同一來源／內容 oracle 通過。
沒有把原始寫入路徑的失敗改標為成功。

UC-05 的 raw unscoped ask 只回政策，raw unknown ask 也回一份無關政策；兩者仍在 evidence。
應用層先取得真 lexical hits 再決定 scope，無命中時才由 guard 回空；預期答案表只負責驗證。
這證明本 lab 的受控 context 組合，沒有宣稱修復原生 ask 的 relevance 行為或完成 LLM 生成回答。

## 原生 Whisper：獨立檢查與重跑

讀取 [helper 文件](../../native-whisper/README.md)、Cargo manifest／lock、準備腳本、patch、Rust 入口及錯誤測試。
以只含交付檔案、尚無 `work/` 的乾淨 source 副本執行；沿用已下載的、核對 SHA-256 的 crate 與 Cargo cache：

```sh
python native-whisper/prepare_core.py --archive <hash-verified-crate>
python native-whisper/prepare_core.py --archive <hash-verified-crate>
cargo +1.90.0 metadata --locked --offline --filter-platform x86_64-unknown-linux-gnu \
  --format-version 1 --manifest-path native-whisper/Cargo.toml
python native-whisper/prepare_assets.py <prepared-assets> --verify-only
python native-whisper/test_token_guard.py <built-helper>
```

尖括號表示本次獨立暫存位置；沒有將本機絕對路徑寫入公開紀錄。
這是乾淨 source preparation 與完整 dependency resolution 檢查，**沒有把 metadata 宣稱成再次冷編譯**。

- 首次 preparation、重跑均成功；Cargo path dependency 指向副本內 `work/memvid-core`，不依賴作者原始 checkout。
- Cargo metadata 完整解析 349 個 Linux 相關 packages，exit 0，Cargo.lock bytes 未變；lock 的 420 個 registry entries 都有固定 source／checksum。
- 故意修改準備後 source，重跑會拒絕且不覆寫修改；`native-whisper/work/` 的 Git ignore 規則已實際核對，上游整份 source 不需進 Git。
- archive、原始／patch 後 `whisper.rs` hash 與記錄一致。patch 只改 import 與 API/cache 初始化，沒有變更推論、音訊解碼或轉錄 oracle。
- 四份模型／音訊資產 size、SHA-256、revision 均通過 verify。主 runner 在每次 native 執行前呼叫 verify；helper 自身另外檢查 presence／revision。
- 新版 binary 在獨立 syscall blocker 拒絕 socket／connect、IPv4／IPv6 均確定受阻後，完成一個真實轉錄成功案例。實得 duration 11.0 秒，文字含 `ask not what your country can do for you`，沒有餵入參考逐字稿。
- 新版 binary 的六個負例均通過：缺參數、缺音訊、缺 cache、token 一般檔、token 目錄、token dangling symlink。每案 exit 1、stdout 空、stderr 錯誤 JSON。

原生獨立 runtime 合計 **1 個成功案例＋6 個失敗控制**。轉錄入庫、Memvid 檢索與 reopen 由主控整合案例涵蓋，
不與獨立 native-only 結果混成同一次執行。

來源界線也已確認：crates.io `memvid-core 2.0.140` 的 VCS metadata 為
`92b0ec8a9b5d964f0da5cf7704a67148fba1b5ed` 且 `dirty=true`。
實際 native source pin 是 archive SHA-256 `c1d781d355751509b0a845a9203eb2db5a4e2b9750f193380439378a61080f85` 加明示 patch；
GitHub `e6bd9f7...` 是閱讀基準，沒有用來冒稱 binary 的精確 source tree。

## 已修正 findings

| Finding | 原始問題與修復 | 獨立複驗 |
| --- | --- | --- |
| P2：hf-hub 隱式讀取 token | `ApiBuilder::from_cache()` 在 `.with_token(None)` 之前呼叫 `cache.token()`。作者在 Rust 初始化前新增 `symlink_metadata(HF_HOME/token)` 拒絕任意 token 目錄項。 | 一般檔、目錄、dangling symlink 都在模型初始化前以精確 JSON 錯誤拒絕；同一新版 binary 的離線成功案例再通過。實際準備的 cache 原本沒有 token，沒有觀察到真憑證讀取／傳送。 |
| P2：UC-07 產品文件未被驗收 | 第一個 frozen candidate `8feecb6a9dcd7b6f2503925e9d0845ec180aec356a2057cb2eab3d295b458f8a` 雖有 12 個 pass，但 catalog 只寫未讀，不滿足 SDD 的客戶需求＋產品文件證據。作者保留既有 cards/state/source frame oracle，增加產品能力與雙來源檢索，沒有縮減 SDD。 | 新 frozen candidate `d6a368...` 的 catalog query 回 frame 0，客戶 query 回 frame 1，共同需求 query 同時回兩份正確來源／內容；全部 12 個核心案例重新通過。 |

剩餘上游限制已在 [README](../../README.md)、[來源矩陣](../upstream.md) 與 evidence 清楚界定：
索引原始行為、exact-symbol／中文斷詞、ask context 擴張、Whisper 原版 cache 設定未有效控制離線等，均沒有因本輪接受而被宣稱已修復。
本結論接受此固定範圍實驗與明示適配；GitHub CI、完整整合、Draft PR 與遠端回讀仍由主控交付流程負責。
