# M3 開發證據

## 評估前TDD

`labs/memvid-lab/.venv/bin/python -m unittest discover -s labs/memvid-lab/tests -p test_semantic.py -v` 首輪 exit1：ModuleNotFoundError semantic_models，新增行為測試在實作前揭露缺失。測試涵蓋masked mean排除padding、CLS、模型前綴／維度、無效向量、dev-only threshold選擇與同分、無可行threshold、非有限分數、凍結資料與CLI拒絕覆寫／缺模型。這是預期red，不是模型品質結果。

## 規格審查

T-008初審要求把拒答明確寫成逐hit cosine≥threshold、保留native top5順序、不補位／重查／重排、非有限分數錯誤、null precision不可行。已在任何新模型推論／評估前補齊，不變更已有評估結果。

新增實作後同一命令11 tests passed（0.388s）；尚未執行模型品質評估。原模型與tokenizer下載使用I/O timeout120s加prepare整體600s界線，區分socket timeout與wall-time，不把前者冒稱總耗時上限。


## 真實推論與SDK持久化失敗

兩模型的固定資產／圖合約／CPU推論及IPv4／IPv6禁網probe通過，原始 [model probe](semantic-model-probe.json) 保留。完整評估草稿首輪 `make semantic RUN_DIR=work/semantic-final-001` exit2（內層CLI exit1），兩模型皆在開發集階段因來源manifest不符失敗；沒有threshold、heldout、update或scale結果。獨立批次、關閉auto-checkpoint、公開embedder與doctor對照詳見 [結果](../notes-semantic-results.md)。停止新增SDK修復嘗試，不降低完整性guard。

可交付的獨立診斷 `timeout 90 .venv/bin/python diagnose_vectors.py --cache work/semantic-models --output work/standalone-diagnostic-final` 實得exit1：24來源、seal前18 hits、重開6 hits、put IDs不符持久frame IDs；[JSON](semantic-diagnostic.json)。這是成功保存失敗現象，不是M3通過。完整評估器、未交付CI草稿及其校準測試移到本機 `work/pending-m3`，未提交，現行workflow未改。

## 審查修正與來源版本

獨立審查T-008發現有限float32值 `[3e38,3e38]` 的norm溢位可能產生零向量。先加 `test_NS01_overflowing_norm_cannot_produce_zero_vector`，9項測試中該項實得FAIL（ValueError not raised）；再拒絕非有限norm並檢查最後有限單位向量。這是數值邊界修正，不是SDK索引修復。

歷史模型probe／diagnostic JSON未重寫：其中encoder SHA256 `64e9d99fea7bc928fa080f195c096154b638c5c83c9cb1786cba8c7d002188ce` 指向修正前實際執行版本；精確原檔保留於本機交接。最後encoder SHA256 `3ddcdc737bb23086f8b16c122b429d2c5c00d698722a5def383404af827054d6` 僅新增上述數值guard；本次不把舊推論聲稱成最後版本重跑。回歸測試直接覆蓋新guard。


Final local checks: `make check` passed25 tests in16.064s plus py_compile. `python3 scripts/check_indexes.py` passed47 project contracts／8 llms files／0 errors; `python3 scripts/check_project_success.py` passed47. Existing `make core RUN_DIR=work/core-m3` passed12 scenarios／3not_run (model profile not selected); full15-scenario suite remains required in CI. `git diff --check` passed. Independent T-008 limited-scope review ACCEPT after guard fix; M3 remains PARTIAL.
