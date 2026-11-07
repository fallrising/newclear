# T-0436：繁中筆記搜尋評估結果

結論：**兩種策略均不建議直接用作繁中筆記的自然語句搜尋。** 原實驗的記憶、持久化與模型能力已跑通；本次固定語料揭露檢索適用性的缺口，不將低召回率當成 SDK 故障或整個 Memvid 的通用評分。

## 問題與資料

依 [固定規格](notes-usability.md)，先由獨立作者建立 24 則合成繁中日常筆記與 30 條人工 relevance query，再執行真實 SDK；每類六條 exact／partial／paraphrase／mixed／unanswerable，其中一條需找回兩個來源。三條無答案問題與既有筆記共用關鍵詞，但所問資訊確實不存在。

語料：[notes.json](../fixtures/notes.json)，SHA-256 `a91ec99c3329ddafdf856aa74a193dcfd5f62e32273ccd4c62d9154855c1f970`。作者沒有執行 retrieval，也沒有按結果改標籤。這是合成小樣本，未使用私人筆記、真實流量或付費 API。

策略為固定 SDK `2.0.160`／core `2.0.140` 原生 lexical，及明示應用層 CJK 二字組索引預處理。後者只從輸入原文與 query 自己產生 token，沒有語意模型或人工同義詞擴充。

## 品質

| 指標 | 原生 lexical | CJK 二字組 |
| --- | ---: | ---: |
| Recall@5（有答案 query macro） | 0.2500 | 0.4583 |
| MRR@5（有答案 query macro） | 0.2500 | 0.4583 |
| 返回來源精確率（全部 query micro） | 1.0000 | 1.0000 |
| 無答案錯誤返回率（6 條） | 0 | 0 |
| 來源完整性（原始 hit） | 6/6 | 11/11 |
| 完整詞／標題（6 條） | 6/6 | 6/6 |
| 局部詞（6 條） | 0/6 | 5/6 |
| 自然問句／改述（6 條） | 0/6 | 0/6 |
| 中英數混寫問句（6 條） | 0/6 | 0/6 |

這裡的 precision=1 只描述少量已返回來源，不能解讀為能回答全部問題。兩者都未達預先固定的 Recall≥0.90／MRR≥0.80，故採用判斷為 `do_not_adopt_directly`。二字組改善部分局部詞，仍不足以解決改述與自然問句。沒有修改資料或門檻追求通過。

來源核對是完整 SDK-rendered 內容與 URI/frame 比對，具體 renderer 正規化和首次失敗見 [開發紀錄](evidence/notes-development.md)。它不等於原始文字 bytes 無損保存。品質分數與 `evaluation_completed` 分開：後者表示實驗完整執行、來源與更新控制正確，不表示採用門檻通過。

## 更新、歷史與刪除

同 URI 追加後，`frame(uri)` 指向新 frame，timeline 保留新舊版本；兩種策略的原生 `readingclub` query 都返回 frame 0 和 frame 2。舊版專屬詞 `amberold` 仍找到 frame 0。
應用層明確按 `frame(uri).id` 過濾後只保留新 frame，舊版專屬詞在 current view 為空；`remove` 的筆記不再返回。以上在新的 Python 程序重開檔案驗證，不能宣稱原生 append 等同 overwrite。

## 規模與成本

100／1000 筆由固定小語料加確定性的岩石標本干擾筆記組成；這不是自然資料分布。每次建置含逐筆 put、seal／close、顯式 doctor 重建；每策略／規模只做一次量測。查詢使用固定前十條，首輪另存，後續五輪共50樣本，以 nearest-rank 算 p50/p95。計時包含來源核對、排除開檔；首輪不是 OS 冷快取。

最終實跑：`2026-10-29T17:08:37.195880+00:00` 至 `2026-10-29T17:12:24.314753+00:00`，Python 3.12.14、Linux x86_64。完整 [JSON](evidence/notes-evaluation.json) 保存逐 query hits、ingest manifest、來源 hash、全部計時樣本與判斷。

| 策略 | 筆數 | 建置總秒數 | 檔案 bytes | warm p50 ms | warm p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| native | 100 | 8.679 | 835317 | 0.216 | 0.280 |
| native | 1000 | 96.799 | 12132175 | 0.428 | 0.522 |
| cjk_bigrams | 100 | 7.454 | 1028983 | 0.295 | 0.398 |
| cjk_bigrams | 1000 | 104.670 | 15776925 | 0.522 | 0.571 |

這是共用主機單次實測，沒有排他 CPU 或 OS cache 控制；不可用亞毫秒結果承諾真實資料下的延遲。建檔是逐筆寫入加重建，未測批次 ingestion 優化。先前 metadata 完善前的完整 run 保存在 [中間結果](evidence/notes-evaluation-before-manifest.json)，兩次品質結論一致。

## 驗收與下一步

M2 的目的為取得可重現的採用答案。NU-02–05 證據由完整 JSON、十六項 unit／真 SDK integration、獨立 metric 重算與必要 CI 支持；實際交付狀態以 [任務板](tasks/BOARD.md) 為準。

依目前結果，下一輪若要繼續，應另立範圍比較適合中文的 embedding／檢索策略，沿用同一固定 query 集再增加獨立保留題；先解決改述與自然問句，再評估產品整合。本輪不宣稱任何尚未測過的模型能解決問題。
