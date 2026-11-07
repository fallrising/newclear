# T-0436 M4：查詢級拒答與新保留集

## 目標與範圍

Owner在M3完成後回覆「好，繼續開發。」本輪由[desk #325](https://github.com/fallrising/desk/pull/325)承接拒答缺口；不改M1–M3規格、固定資料或原始結果。交付兩個既有固定本地模型／明示SDK patch上的可解釋查詢級拒答、dev-only校準與新保留集實驗。結果可以是不採用，不以全部拒答或放寬門檻製造成功。沒有生成回答、產品整合、新runtime依賴、私人資料、付費API、release/tag/deploy。

## 評估前固定的資料與模型

沿用M3的bge_zh、e5_multi全部權重hash／prefix／pooling／dimension與SDK/core/HNSW source patch；不增加模型或調整encoder。下載與runtime分開，真SDK／CPU／seccomp禁網，原始hits完整來源核對。新的dev和heldout各24筆繁中合成筆記、48題：24題單一正確來源（exact／partial／paraphrase／mixed各6）、24題無答案（out_of_domain／near_miss／missing_attribute各8）。每題附人工oracle理由，不能把文字明示可否定的錯誤前提誤標成無答案。

由獨立資料作者在無模型檢索的情況同時寫兩split；實體／文字跨split及舊fixture不重複，不能宣稱真實人口代表性或雙盲。Root人工核對完整資料，再將本規格及兩個JSON的hash提交凍結，**任何M4模型評估均在freeze commit之後**。兩個split內容均可被作者／root看到，但校準只讀dev檢索與gold；heldout的檢索、分數、gold不可用來選模型／策略／門檻。之後只能修合約bug並保留原證據，不能見到heldout結果後改規則或資料。

## 固定候選與決策

每query使用Memvid原生sem top5，按原排序去除重複URI，不重新排序、不補搜。採用者最多返回第一個來源，否則返回空集合；沒有答案生成。計算第一名cosine s及第一、第二個不同來源的差距m=s1-s2，cosine沿用原始float32 query/document vector dot；任何非有限／超出[-1,1]、缺欄或來源完整性錯誤必須非零，不轉為正常拒答。Score與policy數值不接受bool／字串；t、g必須屬於固定grid，family僅score_only或score_margin，enabled必須是真bool；score_only的g固定0。Disabled仍保留合法family/grid且enabled=false（無可行時t=1、g=0），不是數值sentinel。所有raw hits先驗證，包含較後／重複URI的hits，再去重／判斷disabled或early-abstain；frame ID必須非負整數且非bool。

固定兩種候選：`score_only`在s>=t時接受；`score_margin`必須有兩個不同來源且s>=t及m>=g才接受。無hit拒答no_candidates；margin缺第二來源拒答insufficient_candidates；再依序判定below_score、below_margin；接受為accepted。等於門檻算接受。負gap可正常被門檻拒絕，不重排native結果。決策函式只接hits與policy，不能接query gold。兩模型各自比較兩候選；另報同模型原生top1不拒答對照。

t與g固定為0.00至1.00、step0.01，score_only使用g=0。對每個模型／family枚舉全部候選，只以dev結果選擇：至少返回一個來源、returned-source precision=1、無答案誤回=0才可行；最大化正確回答的有答案題數，再依序最大化t、g。無可行候選時採disabled policy，全部拒答且明示no_feasible_policy，不算採用成功。完整候選計數與score/gap、metrics、可行性可回算。

四個候選policy之間只用dev選一個primary：正確回答數較多優先、同分優先score_only（較簡單）、再依固定模型順序bge_zh、e5_multi。每family已唯一選定門檻；全不可行則primary disabled。calibration.json含候選、選定policy、dev與protocol hash及時間，持久化並hash後才啟動heldout；之後不得改寫。Heldout展示全部四個預選policy與primary結果，但不事後改primary。

## 指標與採用界線

每split／模型／family保存逐query raw hits、s／m、決策原因、returned URI、gold、source manifest、實得向量、來源／資產hash及時間。逐類型報告：answerable_hit_rate（有答案題正確返回第一來源／該subset有答案題數，完整split為24、正類別各6）、returned-source precision（正確返回／全部返回，零返回為null）、unknown false-return rate、abstention rate、wrong-source count（只計有答案題返回錯誤來源，未知誤回另計）。所有率以當前subset為分母：precision用已返回題數、unknown false-return用無答案題數（完整split24／各負類型8）、abstention用全部題數；分母0為null。單一gold且最多一個返回時MRR@1與hit rate相同；不是M3每hit門檻的Recall@5，不混稱相同量測。

探索性採用要求保持嚴格：primary heldout hit_rate>=0.90（亦滿足MRR>=0.80）、source precision>=0.80、unknown false-return=0、實得raw來源完整性=1且非空、既有真SDK持久化／更新控制通過。達標僅candidate_for_further_trial；否則do_not_adopt_directly。模型／其他family事後較好不改primary結論。24個unknown零誤回只描述這組題，不代表母體零風險。

記錄真實encode／index／query成本、校準耗時與決策函式逐query耗時（p50/p95，nearest rank）；小樣本共用CPU，不作production效能保證。M3的100／1000成本保持歷史，本輪不重跑規模曲線。

## 驗收與驗證

| ID | Given／When／Then |
| --- | --- |
| NR-01 | Given完整資料與本規格，When任何M4推論前凍結，Then兩split schema、唯一性、單一gold／無答案理由及hash／commit可核對，舊fixtures未變。 |
| NR-02 | Given真native hits及policy，When決策，Then最多第一個來源或空集合、門檻邊界／ties／缺候選／非有限／來源錯誤有測試，gold不進policy。 |
| NR-03 | Given兩模型dev，When枚舉與選primary後持久化calibration，Thenheldout才開始且校準hash不變，完整指標／選擇可獨立重算。 |
| NR-04 | Given固定新heldout與預選policy，When完整真SDK禁網實跑，Then逐題來源／原因／成本與採用結論可回算，失敗非零保留partial、舊輸出拒絕覆寫。 |
| NR-05 | Given完整程式與報告，When必要回歸／獨立審查／CI通過，Then正常commit→PR→merge→遠端回讀，再BOARD-only結案及desk/journal交接。 |

Red-Green-Refactor先測policy／校準選擇／指標／資料guard與CLI失敗邊界，再接真SDK。`make check`、`make rejection`、既有`make core`、repo indexes及workflow靜態檢查；CI保留原15真模型場景、原M3品質與24／1000控制，新增M4完整96query×2模型的小場景。新輸出目錄、每job300秒／整體1200秒、CI每head25分鐘；同題最多兩次有新依據修正，heldout品質低分不觸發調參重試。
