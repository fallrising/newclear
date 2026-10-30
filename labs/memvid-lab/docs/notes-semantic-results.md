# M3 結果：語意排名改善，拒答門檻未能泛化

固定M3評估已完成實跑，兩模型都**不建議直接採用**。本輪先修復固定SDK的向量批次／frame ID與HNSW問題，才按原凍結規格執行dev校準→heldout→更新控制→100／1000規模；沒有調題、改門檻或替換後端。Git交付與必要CI狀態以[任務板](tasks/BOARD.md)為準。

## 品質與採用結論

每split24筆合成筆記、30查詢（24有答案／6無答案）；同一語料作者知舊aggregate成績，不能宣稱完全盲測或真實人口代表性。下面都是heldout，原生排名與門檻篩選分開：

| 模型 | dev固定cosine門檻 | 原始Recall@5／MRR@5 | 篩選Recall@5／MRR@5 | 篩選來源precision | 無答案誤回 |
| --- | --- | --- | --- | --- | --- |
| 中文BGE（Xenova exporter） | 0.73 | 1.000／1.000 | 0.2083／0.2083 | 0.7143 | 2/6（33.3%） |
| 多語E5（官方ONNX） | 0.88 | 1.000／0.9792 | 0.7083／0.7083 | 0.7391 | 5/6（83.3%） |

兩者raw來源完整性1.0、每模型150實際hits；原始top5不拒答，無答案誤回都是6/6。Dev篩選Recall為BGE0.125、E50.7917，precision1.0且未知誤回0；同一門檻移到heldout便失效。E5保留較多相關結果，但不能因此忽略它的高無答案誤回率。兩者都未達Recall≥0.9、MRR≥0.8、precision≥0.8、未知誤回0的全部固定採用要求。

對照原生lexical與CJK二字組的heldout Recall/MRR分別0.25及0.4583，precision1.0、未知誤回0；dev重現原M2分數。這不是跨方法重新選threshold的機會，也沒有改回混合搜尋或重排。完整逐題、分類與cosine／原生score見[原始JSON](evidence/semantic-evaluation.json)。

最終strict-guard版本校準檔於2026-10-30T04:06:57.691722+00:00寫入並保存hash，heldout首job啟動2026-10-30T04:06:57.739160+00:00；完整實跑2026-10-30T04:06:41.652723+00:00至2026-10-30T04:10:33.274458+00:00，exit0、0errors。可核對[calibration](evidence/semantic-calibration.json)與報告hash。原freeze仍為e6ae6274，fixtures bytes與模型資產不變。第一次完整實跑保留在[審查前JSON](evidence/semantic-evaluation-before-strict-guard.json)：因獨立審查要求cosine guard完全符合凍結規格，新增紅綠回歸後重新執行；dev門檻、raw／filtered各項品質值全部相同，沒有利用heldout修改模型、語料或門檻。

## 持久化與來源控制

[修復設計／限制](notes-semantic-repair.md)詳細記錄固定PyPI SDK2.0.160/core2.0.140及hnsw0.11.0本地source patch。[Patch格式等價紀錄](evidence/semantic-build-equivalence.json)保存評估／交付間僅兩份patch文字hash不同、全部prepared源碼與native binary相同的證據。這不是上游已發布修復：原venv SDK不覆寫，M3只明示啟用hash核對的native overlay。

- [24真向量](evidence/semantic-persistence.json)：24/24 seal前後可查，put IDs等於持久frame IDs。
- [追加／刪除／另一程序](evidence/semantic-persistence-updates.json)：新版current正確、舊向量保留、按回傳ID刪除正確、非有限向量批次在寫入前拒絕。
- [1000 HNSW控制](evidence/semantic-hnsw-retention.json)：manifest1000→1001→1000；新程序的24組真向量query／120hits均對應正確完整來源。Manifest由dry_run讀取，file hash未改；未把doctor status當成功，也不宣稱HNSW一次查回所有1000筆。
- 完整評估的兩模型各自通過native更新、刪除、新程序、current view與full renderer/frame/URI完整性。實得float32向量、query vectors與hash在JSON中，不以mock或自算排序代替native搜尋。

## 規模成本（單次本機測量）

| 模型／筆數 | encoder載入秒 | embedding秒 | 寫入／seal／verify秒 | mv2 bytes | warm p50／p95毫秒 |
| --- | --- | --- | --- | --- | --- |
| BGE／100 | 0.573 | 1.269 | 9.351 | 886878 | 12.098／17.960 |
| BGE／1000 | 0.566 | 18.754 | 81.197 | 7870955 | 6.727／11.433 |
| E5／100 | 2.163 | 1.008 | 3.873 | 574690 | 5.219／6.339 |
| E5／1000 | 2.285 | 10.266 | 37.261 | 7374562 | 5.251／5.882 |

每case有10個首輪與30個warm samples；查詢時間含encode＋native search＋來源核對，不含open。共用CPU主機，期間有其他回歸／建置準備負載，無獨占或OS冷cache控制；不能將此表解讀為穩定的模型速度倍率或production保證。1000會啟用原生HNSW，成本與100筆flat index不必單調。完整samples與各階段時間在JSON中。

## 重現與驗證

```sh
make setup
make semantic-prepare
make semantic-sdk
make check
make semantic-native RUN_DIR=work/native-new
make semantic-hnsw RUN_DIR=work/hnsw-new
make semantic RUN_DIR=work/evaluation-new
```

需要Rust1.90、C/C++編譯環境及OpenSSL development headers；下載／build與禁網runtime分開。所有輸出必須用新目錄。CI保留原15場景，另加真向量／更新控制與固定dev-heldout小場景；100／1000成本為手動實測；HNSW持久化控制同時納入CI回歸。

本機37tests＋py_compile、project/index及workflow lint已通過；原full第一次12pass/3missing-assets保留為失敗，補足既有資產／本機build headers後[完整回歸15/15](evidence/semantic-repair-full-regression.json)通過。[T-012獨立審查](../.team/reports/T-012.md)已ACCEPT實作與本機證據；必要CI／合併仍在交付gate，詳見[PLAN](../.team/PLAN.md)。評估完成與「模型可採用」是不同結論；本輪沒有release、部署或產品整合。

## 2026-10-29 阻擋快照（以下原文為歷史）

本節的「尚未／待決策／未修補」描述前輪時點；2026-10-30 owner已明確批准並完成上述修復實跑。所有原始失敗JSON仍保留，不追溯改成passed。

# M3 目前結果：模型準備完成，Memvid 向量持久化阻擋評估

**M3 尚未完成。** 兩個真實本地模型已通過資產、圖合約與禁網推論檢查；固定 SDK 的批次向量寫入／重開行為未通過來源與完整性控制，因此不能把本輪結果當作模型品質比較。保留題尚未執行，沒有校準門檻、保留集品質或100／1000成本結果。

## 已驗證部分

[固定規格](notes-semantic.md) 與24筆／30題保留集在任何新模型評估前於 `e6ae6274` 提交凍結。原開發集／M1/M2結果未改。

- 中文 BGE：明示 Xenova ONNX exporter，512維、CLS、中文query前綴、padding ID0。
- 多語 E5：官方ONNX，384維、masked mean、query/passages前綴、padding ID1。
- 兩者真實CPU推論均有限且L2 norm約1；實得ONNX輸入／輸出、資產size/SHA256與禁網probe保存在 [model probe](evidence/semantic-model-probe.json)。沒有聲稱轉換權重與PyTorch逐值等價。
- 新模型資產合計582642242 bytes，沿用既有依賴；只有明示prepare下載。

## 阻擋證據

完整評估草稿首輪 `make semantic RUN_DIR=work/semantic-final-001` 在兩模型的開發集階段以非零結束：[原始失敗](evidence/semantic-initial-failure.json)。來源guard發現SDK回傳的frame不在以put_many回傳ID建立的manifest中，沒有繼續校準或執行保留題。

獨立於評估器的真SDK對照進一步確認：

1. [批次對照](evidence/semantic-batch-probe.json)：24筆文件的持久frame為0–23；`put_many`回傳1–18及20–25。回傳ID不能直接當持久frame ID。這個不一致不是以相關答案或URI偷偷改寫hit可解決的品質問題。
2. [明示關閉auto-checkpoint對照](evidence/semantic-checkpoint-probe.json)：相同24筆／真BGE向量，seal前查詢找到18筆，重開後只找到最後6筆。以原向量獨立算cosine，第一則筆記對查詢最高；持久索引卻沒有該來源。此觀察揭露完整性缺口，不作一般模型排名結論。
3. SDK公開 `put_many(embedder=...)` 路徑在seal／close／reopen後回報 [MV011：vector index未啟用](evidence/semantic-embedder-failure.json)。此檔是從實得stderr整理，並非成功執行的JSON。
4. 對批次對照檔的副本呼叫官方 `doctor(rebuild_vec_index=True)`：[doctor證據](evidence/semantic-doctor-probe.json) 回報healed及deep verify passed，但實際query為0 hits。沒有把doctor或deep verify的成功當成功能完整。

另發現批次renderer含embedding identity metadata、且不沿用原lexical fixture的label表示；尚未交付的評估器需有自己的嚴格完整renderer檢查，不能直接使用M2 renderer。這個adapter差異與上述獨立重現的向量持久化缺口分開處理。

## 可重現入口

```sh
make setup
make semantic-prepare
.venv/bin/python semantic_models.py verify --cache work/semantic-models
timeout 90 .venv/bin/python diagnose_vectors.py \
  --cache work/semantic-models --output work/semantic-diagnostic-001
```

`diagnose_vectors.py` 使用固定開發集、真BGE向量、官方batch API與新記憶檔；保存put回傳IDs、seal前／重開後的frame與hits。控制不通過時exit1，setup或輸入錯誤exit2，既有輸出拒絕覆寫。本輪正式重現保存於 [diagnostic JSON](evidence/semantic-diagnostic.json)，實得exit1、24筆來源／seal前18 hits／重開6 hits。這是失敗重現工具，不是M3品質評估命令，也不使用保留題。`make semantic` 尚未交付；完整評估草稿保留在本機交接，不能冒稱可用。

## 驗收狀態與下一步

| AC | 現況 | 證據／缺口 |
| --- | --- | --- |
| NS-01 | 模型資產／圖／推論部分通過 | model probe、模型負例單元測試；Memvid持久索引控制未通過 |
| NS-02 | blocked | 未得到可信完整來源索引；沒有threshold或heldout分數 |
| NS-03 | not_run | 正式語意更新／刪除／新程序control尚未執行 |
| NS-04 | not_run | 100／1000實測尚未執行；CLI草稿不是交付 |
| NS-05 | partial | 可驗證的模型準備與診斷證據走PR；完整M3 gate未達成 |

先停止對相同SDK問題增加修正嘗試，保留四條路徑的結果。下一個需決定的範圍是修復固定Memvid SDK的向量寫入／持久化及來源ID合約，取得最小回歸與重開證據後，再回到本規格完成模型比較；另一選擇是另立其他向量後端實驗，不能把它冒充Memvid通過。本輪沒有升級／修補SDK、修改採用門檻或改換模型。
