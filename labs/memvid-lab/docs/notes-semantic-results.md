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
