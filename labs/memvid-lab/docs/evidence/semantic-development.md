# M3 開發證據

## 評估前TDD

`labs/memvid-lab/.venv/bin/python -m unittest discover -s labs/memvid-lab/tests -p test_semantic.py -v` 首輪 exit1：ModuleNotFoundError semantic_models，新增行為測試在實作前揭露缺失。測試涵蓋masked mean排除padding、CLS、模型前綴／維度、無效向量、dev-only threshold選擇與同分、無可行threshold、非有限分數、凍結資料與CLI拒絕覆寫／缺模型。這是預期red，不是模型品質結果。

## 規格審查

T-008初審要求把拒答明確寫成逐hit cosine≥threshold、保留native top5順序、不補位／重查／重排、非有限分數錯誤、null precision不可行。已在任何新模型推論／評估前補齊，不變更已有評估結果。

新增實作後同一命令11 tests passed（0.388s）；尚未執行模型品質評估。原模型與tokenizer下載使用I/O timeout120s加prepare整體600s界線，區分socket timeout與wall-time，不把前者冒稱總耗時上限。
