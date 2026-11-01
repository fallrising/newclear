# Memvid 上游閱讀與能力對照

本文件對應 [SDD](../SDD.md) 與 [SUCCESS](../SUCCESS.md) 的 AC-01。閱讀與探勘日期為 2026-10-28；這是範圍與限制紀錄，執行結果另由 scenario report 與 SUCCESS 判定。

## 固定基準與閱讀範圍

- 上游：[memvid/memvid `e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813`][source]。
- 該 commit 的 [Cargo.toml][cargo]：`memvid-core 2.0.140`，Rust 最低 `1.85.0`；預設 features 為 `lex`、`pdf_extract`、`simd`。
- 本實驗安裝探勘：Python `memvid-sdk 2.0.160`，其回報的 native core 為 `2.0.140`。SDK wheel 與 Rust repository 是兩個版本／能力邊界，不能只憑 core 版本假定全部 feature 都已編入。
- 使用 v2 `.mv2`。官方已[棄用 v1 QR memory][v1]；本實驗沒有 QR 編碼或影片儲存流程。

本次閱讀 README、Cargo.toml、`examples/basic_usage.rs`、`pdf_ingestion.rs`、`clip_visual_search.rs`、`test_whisper.rs`、`text_embedding.rs`，並定位檢查以下實作的相關段落：`src/memvid/mutation.rs`、`src/memvid/search/api.rs`、`src/memvid/search/time_filter.rs`、`src/memvid/acl.rs`、`src/types/acl.rs`、`src/memvid/replay_ops.rs`、`src/replay/engine.rs` 與 `tests/replay_integrity.rs`。另外核對官方 SDK、模型、examples、memory cards、session replay 文件。**沒有聲稱通讀全部原始碼，也沒有重現上游 benchmark。**

## README 的 11 類場景

[README][readme] 列出的場景是應用分類；本實驗驗證其記憶層，應用流程由 lab 組合。下表是驗收設計，並非執行通過宣告。

| ID | 官方場景 | 本實驗的可觀察行為 | 對應 AC |
| --- | --- | --- | --- |
| UC-01 | 長期執行的 AI Agent | 寫入階段記憶，關閉；新程序讀回舊內容，再追加後續狀態。 | AC-02、AC-08 |
| UC-02 | 企業知識庫 | 收錄多份合成規章，以查詢命中指定內容並保留文件 URI。 | AC-02 |
| UC-03 | 離線 AI 系統 | 準備依賴後，在禁止外部網路的程序中建立、寫入及檢索。 | AC-02、AC-08 |
| UC-04 | 程式碼理解 | 從合成程式碼與設計文件查找符號／行為，結果回到對應檔案來源。 | AC-02 |
| UC-05 | 客服 Agent | 從政策與工單取得附來源的回答依據；此處沒有 LLM 生成器。 | AC-02 |
| UC-06 | 工作流程自動化 | 保存事件、步驟與執行結果，再查回可用步驟；工作排程與執行由應用負責。 | AC-02 |
| UC-07 | 業務與行銷 Copilot | 以合成客戶需求查回相關產品／聯絡證據；沒有連接真實 CRM。 | AC-02 |
| UC-08 | 個人知識助理 | 個人筆記、繁體中文與時間資料持久化後可查詢。 | AC-02、AC-04 |
| UC-09 | 醫療、法律、財務 Agent | 三類合成說明／政策文件各有指定命中來源；不生成專業建議。 | AC-02 |
| UC-10 | 可稽核、可除錯工作流程 | 核對 frame、時間線、新舊內容及可用 session 記錄；明列 replay 邊界。 | AC-02、AC-04 |
| UC-11 | 自訂應用 | 保存自訂欄位與索引；只複製完成提交的 `.mv2` 後仍能讀回。 | AC-02、AC-08 |

命中驗收須核對內容及來源；不存在的查詢應無命中。這些案例不等同 11 個 production 產品，也不驗證醫療／法律／財務正確性、企業合規、推薦品質或上游延遲／準確率宣稱。

## 具名範例與模型能力

README 的四個具名範例，加上本地文字 embedding，對應如下。模型 fixture 可合成，但輸入必須經過真實模型及 Memvid 儲存／查詢。

| 上游入口 | 上游實際行為與依賴 | 本實驗必要證據 |
| --- | --- | --- |
| [basic_usage.rs][basic] | 建檔、寫入 metadata、提交、搜尋、時間線、重開與 verify；可純本地執行。 | 關閉重開後內容／URI 正確，檔案驗證通過，無命中負例成立。 |
| [pdf_ingestion.rs][pdf] | 讀取真 PDF bytes 並送入 core；預設 `pdf_extract` 提供文字擷取。Python `put_file` 另依賴文件解析套件。 | 從真 PDF 抽出的文字可檢索且來源正確；旁置文字檔不算 PDF 成功。 |
| [clip_visual_search.rs][clip] | `clip` feature 與本地 CLIP 權重；實際範例用隨機合成向量演示索引，未把圖片送入 `encode_image`。 | 真圖片與 query 分別經模型編碼；至少兩種不同內容，正確圖片在預期排名命中。 |
| [test_whisper.rs][whisper] | `whisper` feature、真音訊與 Whisper 權重；`transcribe_file` 執行轉錄。 | 轉錄包含預定詞彙，轉錄結果寫入 `.mv2` 後可查回；不可注入參考稿。 |
| [text_embedding.rs][text-embedding] | `vec` feature；本地 BGE 等模型產生真 embedding，範例自行比較 cosine similarity。 | 詞彙不同的 query 經真本地模型，在 Memvid native 向量索引查中預定內容；單獨 cosine 排序不能取代整合驗收。 |

### SDK 探勘已確認的適配邊界

- 此次 `memvid-sdk 2.0.160` wheel 回報 `whisper=False`。不能把 Python 套件已安裝視為已提供 Whisper；須另以編入 `whisper` 的真實 core 路徑完成，或保留具體 `blocked`。
- 該 wheel 的內建本地 BGE 路徑缺少所需 fastembed native 能力。實驗以**真實外接本地 embedder** 產生向量，再送入 Memvid native index；這是 lab adapter，不能宣稱原 wheel 的內建 embedder 已通過。
- 模型名稱、來源 revision、檔案 SHA-256、模型 runtime 與 SDK/core 版本須進證據。隨機向量可測索引 plumbing，但不能計為文字語意或 CLIP 通過。
- 本節只記探勘邊界；其餘場景與模型的執行結果，以正式報告為準，不從依賴可用性推論 PASS。

## 文件與實作落差

### Exit 0 與範例標題不能作為驗收

`pdf_ingestion` 缺參數／檔案時回傳 `Ok(())`；`clip_visual_search` 缺檔或部分模型失敗也可正常返回，且有作者本機的預設 PDF 路徑。`test_whisper` 轉錄失敗只列印錯誤，仍可列印完成訊息。三者均須檢查實際輸出，不能只看 process exit code。[basic_usage][basic] 的印出結果也需要額外 oracle。

PDF 範例註解提到 semantic search，但程式沒有載入 embedding 模型；CLIP 範例用 `random_embedding()` 建假頁面向量，不能證明真圖片檢索。[text_embedding][text-embedding] 只在相似度符合預期時印成功，未將錯誤排名轉成失敗；lab 必須有明確斷言。

### SDK 文件需要固定版本核對

[Examples][examples]、[Python API][python]、[Memory Cards][cards] 的範例混用 `put(dict)` 與 `put(title, label, metadata, text=...)`、`results.hits` 與 `results['hits']`，甚至有不同套件 import 名稱。以固定 wheel 的實際 API 為準，不直接把網頁片段當可執行保證。

Python 文件描述 `OPENAI_API_KEY` 存在時可能自動啟用雲端 embedding。基礎路徑明確設定 `enable_embedding=False`；模型路徑明確指定本地 provider，並移除隱式雲端憑證影響。`ask(context_only=True)` 提供檢索 context，不代表執行過 LLM 生成回答。[來源：Python API][python]。

## 離線、ACL 與 replay 邊界

### 離線與單檔搬移

[模型文件][models] 說明部分 embedding、reranker、Whisper 在首次使用會下載；CLIP／NER 等有獨立模型安裝流程。下載與 runtime 分開，記錄離線限制的實際機制。`MEMVID_OFFLINE=1` 不能單獨證明 native code 沒有網路行為；必要時用 OS／container 層封鎖。

`.mv2` 包含資料與索引，不等於包含所有模型權重和推論 runtime。單檔可攜性測試在 commit／close 後，只複製 `.mv2` 並重新讀取；若要離線語意查詢，模型 cache 也須事先備妥。[replay_ops][replay-ops] 的 active session 可寫 `.mv2.session` sidecar，應結束 session 再驗證完成記憶檔的搬移。

### ACL 是可選的讀取政策，預設不阻擋

[AclEnforcementMode][acl-types] 預設 `Audit`；[apply_acl_to_search_hits][acl] 在 audit 下可保留 deny hits。驗證隔離時須顯式使用 `Enforce` 與 `tenant_id`，配合正確的 `acl_*` metadata。若本實驗只跑文件檢索，不應據此宣稱已驗證租戶隔離或權限控管；這些是上游能力限制紀錄，不額外擴張本次 SDD 範圍。

### 回溯與重播須逐項核對

[search/api.rs][search] 的 `get_replay_frame_ids()` 先挑選目前為 Active 的 frame，再套 `as_of_frame`／`as_of_ts` cutoff；這不是任意已刪除狀態的完整還原。追加相同 URI 後是否能查回指定舊版本，仍需實際查詢與內容斷言。

[Rust replay engine][replay] 對單筆 Put 僅檢查存在 frame，Checkpoint 直接標記 verified；Ask audit 的 matched 也不等於重新呼叫 LLM，模型重跑由 CLI 另行處理。因此 `mismatched_actions == 0` 不能取代內容驗收。Find replay 會重新搜尋目前記憶；session 持久化與任意 snapshot restore 是不同能力。

[replay_integrity.rs][replay-test] 示範結束 session 後提交、保存 replay segment、再次提交，再重開檢查索引與 session。lab 需核對非空 actions、持久化及正常檢索，並將不支援／失敗的能力記為 `blocked`／`failed`；不得縮小原契約以換取 PASS。

[source]: https://github.com/memvid/memvid/tree/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813
[readme]: https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/README.md
[cargo]: https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/Cargo.toml
[basic]: https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/examples/basic_usage.rs
[pdf]: https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/examples/pdf_ingestion.rs
[clip]: https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/examples/clip_visual_search.rs
[whisper]: https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/examples/test_whisper.rs
[text-embedding]: https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/examples/text_embedding.rs
[acl-types]: https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/types/acl.rs
[acl]: https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/memvid/acl.rs
[search]: https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/memvid/search/api.rs
[replay-ops]: https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/memvid/replay_ops.rs
[replay]: https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/src/replay/engine.rs
[replay-test]: https://github.com/memvid/memvid/blob/e6bd9f7b9c38cd8d5370fa0fc936ac1dcd751813/tests/replay_integrity.rs
[v1]: https://docs.memvid.com/memvid-v1-deprecation
[python]: https://docs.memvid.com/python-sdk/overview
[models]: https://docs.memvid.com/installation/models
[examples]: https://docs.memvid.com/examples
[cards]: https://docs.memvid.com/concepts/memory-cards
