# T-0436 開發失敗與修正

## 測試先行

`python -m unittest discover -s tests -p test_notes.py -v` 首次 exit 1：`notes_eval` 尚未實作，匯入失敗。實作後四項 NU-02 指標測試通過：macro/micro 分母、排名去重、空結果與 CJK token overlap。

## 第一輪真 SDK：來源核對 FAIL

固定語料 SHA-256：`a91ec99c3329ddafdf856aa74a193dcfd5f62e32273ccd4c62d9154855c1f970`，24 筆／30 query；由獨立作者先凍結，未看任何 retrieval 結果。
`python -m unittest discover -s tests -p test_notes.py -v`：5 passed／1 failed，integration 以非零拒絕來源核對。兩種策略的 quality、updates、scale 都受同一核對錯誤影響；未將此輪視為可用評估。

具體觀察：SDK 返回的是正規化且帶 metadata 的索引文字，並非原始 `put(text=...)` bytes。n01 寫入為標題、換行、正文（含全形逗號）；實得換行變空格、逗號變半形，尾端帶 `title: 桂花烏龍收納 uri: mv2://notes/n01 labels: fixture fixture: "synthetic"`。`frame(uri)` 提供 frame/URI/title，`blob(uri)` 對純文字輸入是空 bytes，不能假裝它保存原始 bytes。

一次針對來源 renderer 的診斷：六個原生 hits 均精確等於 NFKC＋空白折疊後的完整正文，加上明確已知的 title／URI／fixture metadata。原生 recall=0.25、MRR=0.25、precision=1、無答案返回率=0，但首輪錯誤的逐 byte 比較使 integrity=0；這組數字不作最終驗收。
診斷 `_worker` 第一次手動命令漏 size 參數，參數解包錯誤，未進入 SDK；補 `24` 後才得到上述資料。

修正方案先記錄於此：仍核對每個 URI 和 frame，將**完整**來源文字按 SDK 觀察到的 NFKC／空白規則處理，加上精確 metadata 後比較，禁止 substring／模糊相似度通過。保留實得 hit 文字，另測改字、錯 frame／URI、額外文字必須失敗。此為 renderer-aware 引用核對，不宣稱 raw bytes round-trip；不改 relevance、分母或採用門檻。修正後結果另存，不回寫本輪 FAIL。

## 工具環境

workflow validator 首次未提供外部 cache，exit 2；依工具要求指定共用 cache 後，固定 actionlint 1.7.12 驗證 Memvid workflow passed。未修改 validator 或降低 gate。

## 修正後與獨立審查補強

嚴格 renderer 比較修正後 `make check`：15 tests passed。`make notes RUN_DIR=work/notes-final-001` 全部 quality/update/100/1000 jobs 完成、0 errors，兩策略採用門檻均 FAIL（低 Recall/MRR），實驗本身完成。完整中間報告保存於 notes-evaluation-before-manifest.json。

獨立 reviewer 要求將原始 ingest manifest 一起保存，讓 frame→source 可從報告核對；只加 source_manifest、core 版本與量測環境描述，未改資料、演算法或門檻。因報告來源 bytes 改變，重新執行 final candidate，結果另存 notes-evaluation.json。新增固定 corpus 改字節即拒絕的 CLI regression。


最終候選 `make notes RUN_DIR=work/notes-final-002`：兩種 quality、兩種 updates、四組 scale 全部完成，0 errors，兩個採用結論均為 do_not_adopt_directly。最終 `make check`：16 tests passed／py_compile passed。最終報告 source/corpus SHA-256 與工作樹逐一核對一致。NU-02 品質未達門檻與 NU-02 評估實作完成分開，未改寫原失敗。
