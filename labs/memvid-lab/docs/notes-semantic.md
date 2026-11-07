# T-0436 M3：繁中語意檢索與拒答評估

## 授權與範圍

Owner 在 M1/M2 結果後接受「比較中文語意檢索模型」建議並回覆「好，繼續開發。」[desk T-0436](https://github.com/fallrising/desk/tree/main/tasks/T-0436-memvid-notes-usability) 後續範圍 PR #305 已合併。本規格追加 M3，不修改 [M2 規格](notes-usability.md)／資料／原始失敗或原場景 AC。交付真實本地模型→Memvid 向量檢索、固定開發集校準、獨立保留集評估與成本證據。低品質結果也可完成研究；不包含產品整合、生成回答、私人資料、付費 API、新 runtime 依賴、release/tag/deploy。

## 評估前固定的模型

沿用 hash-pinned numpy、onnxruntime、tokenizers 與 Memvid SDK2.0.160/core2.0.140，CPU execution provider；下載與 seccomp 禁網 runtime 分離。只評估以下兩個 FP32 ONNX 資產，不在看過結果後換模型或量化版本。

| 代號 | 權重來源與 revision | 表示方法 |
| --- | --- | --- |
| bge_zh | Xenova/bge-small-zh-v1.5 @75c43b069aac4d136ba6bc1122f995fedcfd2781 | 512維，CLS pooling，L2；query前綴「为这个句子生成表示以用于检索相关文章：」，passage無前綴 |
| e5_multi | intfloat/multilingual-e5-small @614241f622f53c4eeff9890bdc4f31cfecc418b3 | 384維，attention-mask mean pooling，L2；query前綴 `query: `，passage前綴 `passage: ` |

兩者最多512 tokens（包含前綴及特殊token），padding採各自tokenizer的 `[PAD]`／`<pad>` ID。只載明示本機路徑，驗證資產size/SHA256及有限、正規化向量，不使用雲端provider或隨機向量。

BAAI 官方 bge-small-zh-v1.5 @7999e1d3359715c523056ef9478215996d62a620 無 ONNX；Xenova 是明示的第三方轉換，不聲稱已證明與官方PyTorch逐值等價。原模型宣告MIT；Xenova metadata未另列license，保留原license來源與exporter差異。E5使用官方ONNX，原模型MIT。

來源：[BGE模型卡](https://huggingface.co/BAAI/bge-small-zh-v1.5/blob/7999e1d3359715c523056ef9478215996d62a620/README.md)、[Xenova模型卡](https://huggingface.co/Xenova/bge-small-zh-v1.5/blob/75c43b069aac4d136ba6bc1122f995fedcfd2781/README.md)、[E5模型卡](https://huggingface.co/intfloat/multilingual-e5-small/blob/614241f622f53c4eeff9890bdc4f31cfecc418b3/README.md)。圖的實際輸入／輸出合約須以準備後 ONNX Runtime 檢查，不能拿模型卡範例當成已實測。

資產固定值：

| 檔案 | bytes | SHA256 |
| --- | ---: | --- |
| bge_zh/onnx/model.onnx | 94851877 | 69a0b846f4f116b5e6aabf9546ea6754d02264f3211a13a1bd69b31b8040749a |
| bge_zh/tokenizer.json | 439125 | 48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26 |
| e5_multi/onnx/model.onnx | 470268510 | ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665 |
| e5_multi/tokenizer.json | 17082730 | 0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39 |

## 資料與資訊隔離

開發集為原 `fixtures/notes.json`（24 notes／30 queries，SHA256 a91ec99c3329ddafdf856aa74a193dcfd5f62e32273ccd4c62d9154855c1f970）。既有題目已公開結果，不能稱為盲測。獨立作者在任何新模型檢索前建立同規模 `fixtures/notes-heldout.json`，五類各六題，至少一題多來源及三題主題相關但所問資訊缺失的無答案題；內容不得與開發集正規化後完全重複。保留集與開發集使用各自的記憶檔，URI命名可相同；以 corpus hash＋split 識別。

保留集SHA256：`75fcd6855b8bffd3d843eb89e2c81782049a2b88dd8ead2ee7d6c9fa4752df5a`。作者／主導均逐題核對，含兩來源hq17與六條無答案的明確缺資訊理由，見 [T-007](../.team/reports/T-007.md)。這是同一作者新增的合成保留題，不聲稱自然流量或完全盲化人群樣本。

保留題與規格先提交凍結，再開始真實評估。模型、前綴、pooling、資料、校準規則、採用門檻均不可看過保留結果後修訂追求通過。保留題若有實質oracle錯誤，保留原FAIL，列出具體差異與影響再處理。

## 排序與拒答分開

每筆文件只用原title＋text產生embedding，沒有query、relevance或人工同義詞擴充；用真SDK `put_many` 寫入真向量，`find(mode="sem", query_embedding=..., k=5)` 取得原生排序。保存原生engine/score、URI/frame、完整返回內容與獨立ingest manifest；採既有嚴格SDK renderer完整比對，不宣稱原始bytes無損往返。

原生top5結果不以標準答案重排。額外計算query與該實得frame的正規化文件向量cosine，作為明示應用層拒答分數；不能假設SDK score公式。逐hit以cosine ≥ threshold過濾，保留原生top5順序；不補位、不重查、不重新排序。非有限cosine或超出[-1,1]的分數視為執行錯誤，不能靜默變成拒答。保留raw與filtered兩組指標、各類別及逐query結果。來源完整性控制必須在raw hits上通過，空的filtered結果不能假裝來源檢查滿分。

拒答校準只用開發集：事先固定threshold grid為0.00、0.01…1.00。依既有URI去重top5公式，選開發集source precision≥0.80且六條無答案false-return=0的候選；precision為null者不可行。依Recall@5、MRR@5、precision、較高threshold依序破同分。無可行候選時固定1.01全拒答，明記no_feasible_threshold；不能以全拒答通過採用。兩個模型各自的threshold及完整候選表先寫入calibration.json並計hash，之後才執行保留集工作；不使用保留標籤選threshold或模型。

Recall/MRR macro、source precision micro、URI先去重再top5、null分母規則沿用M2。開發與保留各自回算，原生lexical/CJK在兩組資料上提供相同題目的對照。原生排序分數只回答「能否找到相關文件」，filtered指標才回答「會不會返回無答案來源」。

探索性採用門檻不降低：保留集filtered Recall@5≥0.90、MRR@5≥0.80、source precision≥0.80、無答案false-return=0；raw來源完整性=1且有實得hits；current view／delete／new-process reopen通過。只稱candidate_for_further_trial，不代表產品採用或全面模型排名。

## 更新與成本

兩模型各測同URI追加新向量、保留原生歷史結果、按frame(uri).id明確過濾current view、native remove，並在新程序重開後查詢。不得宣稱append等同overwrite；語意搜尋舊詞仍可返回語意相近新文件，驗證只要求current view排除舊／已刪frame、正確保留current來源。

手動規模跑100／1000筆：開發24筆＋既有確定性標本干擾資料。分列encoder load、embedding、put_many／seal／close、檔案bytes，以及包含query encode＋SDK search＋來源檢查的首輪10筆與後續3輪30筆warm p50/p95（nearest-rank）。共用主機、每規模一次，首輪不是OS冷快取；不外推production，也不把批次寫入與M2逐筆建檔計時當同條件比較。每job timeout300秒，總CLI由呼叫方timeout1200秒；預備下載I/O timeout120秒，整個prepare命令由呼叫方timeout600秒。品質／更新小場景進獨立CI job；100／1000成本只作本機實測，既有必要CI不削弱。

## 驗收與交付

| ID | Given／When／Then |
| --- | --- |
| NS-01 | Given兩個固定資產及既有鎖檔，When明示prepare與離線encode，Then hash/graph/prefix/pooling/dim可核對，缺檔／錯hash／非有限向量非零，runtime禁網有證據。 |
| NS-02 | Given固定開發與獨立保留集，When先校準再評估兩模型及lexical對照，Then逐query raw/filtered結果及指標可回算，threshold只由dev選，資料hash及時間順序可核對。 |
| NS-03 | Given同URI新舊向量與已刪來源，When新程序重開查詢，Then原生歷史與應用current view分開記錄，current view無stale/deleted/wrong來源。 |
| NS-04 | Given100／1000筆與新輸出目錄，When有界執行，Then成本／樣本／實際筆數保留，拒絕覆寫、失敗非零且partial證據保留，不以品質低分冒充執行錯誤。 |
| NS-05 | Given程式／完整結果／失敗紀錄，When回歸、獨立審查及必要CI通過，ThenREADME提供重現入口、限定採用結論，正常commit→PR→merge→遠端核對並同步BOARD/帳本。 |

先以聚合／拒答、pooling及CLI邊界測試取得預期red，再實作；單元測試不冒充真模型。必要checks：`make check`、完整semantic實跑、既有core與CI完整模型場景、repo index、改動workflow的靜態檢查、獨立審查。每次新輸出目錄，初次失敗及修正理由保留。
