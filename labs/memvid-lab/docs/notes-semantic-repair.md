# M3 固定SDK向量批次修復

Owner於2026-10-30明確批准先修復持久化與來源ID，再完成凍結M3。保留原失敗，不變更語料／門檻／模型或採用條件。

## 根因與修復邊界

來源為PyPI memvid-sdk2.0.160 sdist，9880521bytes，SHA256 8eab5aec9a30eb459f553ed091038b6916d02a2f33569b32a7aee1b556820243；包含Python binding與memvid-core2.0.140。官方core crate另經既有source pin核對。初步commit_skip_indexes假說已排除：實際binding走put_parallel_inputs。

1. binding的put_many把core put_parallel_inputs回傳的WAL sequences當frameIDs；core實際frameIDs是TOC索引，lexical WAL會佔用sequence。修復必須在每個新parent寫入前讀next_frame_id，不能以固定offset或查詢答案重映射hit。
2. put_many忽略disable_auto_checkpoint（BuildOpts只帶compression），逐筆put觸發普通commit，最後卻commit_parallel。前段向量在monolithic index，後段在segments，cache／manifest可能只看到一段。保持同一批次的寫入與完整commit路徑，避免混用兩種表示；不以doctor成功替代query完整性。
3. public embedder的small-document路徑只傳chunk embeddings、parent_embedding=None，沒有chunk時parent向量未保存；這條未使用路徑保留為既有失敗，不納入本修復候選。

第一個候選只修Python binding的explicit-vector batch：先驗證所有向量，begin_batch採用原PutManyOpts，逐筆記錄next_frame_id並put_with_embedding_and_options，end_batch後commit()，不使用parallel builder。其他SDK行為不變；不覆寫原venv SDK。固定sdist加可審閱patch與Cargo.lock編譯為明示opt-in overlay，runtime核對原SDK／Python wrapper及本機build manifest/library hash。

## 驗收

先以既有24真BGE筆記回歸取得red；修正後返回ID等於持久frameID、seal前後及另一程序可檢索完整24來源，append與remove(returnedID)對應正確且舊向量保留。維持真SDK／真模型及禁網；禁止mock或以自算排序代替native搜尋。修復通過後才執行M3 dev校準、heldout、更新與100／1000規模。Stock失敗與patched成功分開保留，明示本地補丁，不能冒稱上游已修。

預估本輪aggregate active60–90分鐘，20分鐘檢查；一個candidate加至多兩次有新證據correction。build timeout1200s，實驗120s；規模既定300s/job。若根因／編譯／控制仍未收斂，保留精確failed/not_run與唯一下一步。

## 可重現建置

官方sdist的Cargo.lock仍包含未打包的memvid-cli、memvid-node workspace entries，初次`cargo build --locked`以101失敗。使用Cargo1.90.0離線重新解析只刪除93個不再引用的package identities，沒有新增／改變registry套件版本、來源或checksum；離線check隨後因未快取adobe-cmap-parser0.4.1而失敗，未宣稱編譯成功。`semantic-sdk-lock.patch`固定此裁剪，原lock SHA256為43cbd08f2ea7ee24b6dac987e14a8880fa6dec2fb20c772a27746e758dc4127d，建置lock為80e7f63d82520603fb801565909612d86b58eb119c494980974f1ed3c17d306c；後續仍使用`--locked`。第一次建置由rustup自動取得缺少的1.90.0工具鏈，未改runtime套件。

此主機有OpenSSL runtime3.0.13-0ubuntu3.16但缺development headers，第二次locked build因此101。只下載同版libssl-dev deb（2409kB，SHA256 2b4734df0475e305ac03abb0a2cc5659651ed37ef02d967a1c4033a154cf714b）解壓到ignored work/semantic-sdk/build-prerequisites，未安裝系統套件；OPENSSL_INCLUDE_DIR／LIB_DIR與CFLAGS指向該build-only目錄，動態連結既有libssl.so.3/libcrypto.so.3。這些是建置前置，不是新增runtime或模型依賴。

## 第一個有依據的修正：HNSW持久化

T-011指出≥1000 vectors切換HNSW後`entries()`回空iterator；`build_vec_artifact`只從entries複製舊向量，追加／刪除的完整commit會丟失舊資料。實際v1 regression：1000真BGE payload vectors初建manifest count1000，追加1筆後只剩1（expected1001），非零失敗。這不是模型品質或HNSW approximate recall問題。

v2只再修core的HNSW entries：`ids`與`graph.insert`同步追加，利用固定hnsw0.11.0的`feature(i)`回傳原向量；既有builder仍過濾deleted frame。獨立review核對兩端順序。另修loader失敗清除本次載入的整個package namespace，並以測試驗證。沒有變更PQ路徑；產品量化索引與任意舊segment檔遷移不在本實驗支援範圍，使用本runner新建檔案。批次非transactional，flush失敗不保證rollback，須拋棄該失敗實驗輸出。

1000控制只用24個真模型payload向量重複入1000個不同合成URI，測儲存而非品質。以doctor dry_run讀manifest count（前後file hash不變）配合24組native query來源核對及新程序重開；不把doctor status當檢索成功，也不以k1000宣稱全量搜尋（HNSW ef_search固定50）。原frozen100/1000不同筆記成本仍另跑。

測試開發錯誤如實保留：v1 small control已有24/24及ID通過，但append fixture漏label而中止；large control讀doctor可空detail時AttributeError。修正harness後在原initial檔案副本證明1000→1，未改舊輸出。v1 binary、manifest及patch保存在ignored candidate-v1以便還原。

## 第二個有依據的修正：HNSW短結果panic

v2已保留1000→1001→1000個persisted vectors，且24筆append/delete/child reopen通過；然而1000控制的真native搜尋在子程序觸發hnsw0.11.0 panic：source slice33與destination50長度不同。該固定依賴`search_layer`兩處先算found=min(dest.len,nearest.len)，卻對整個dest呼叫copy_from_slice。v3把目的slice也限為`[..found]`，不改ef、k、排名、資料或任何品質門檻。

使用原lock中已存在的hnsw0.11.0 crate：26780bytes，SHA256 2b9740ebf8769ec4ad6762cc951ba18f39bba6dfbc2fbbe46285f7539af79752。prepare將它解壓至SDK source/vendor/hnsw，精確核對兩處byte replacement；workspace以path patch取代同版本依賴，鎖檔只改該來源為local path，其他版本不變。這是同一既有依賴的明示本地補丁，不是新增runtime依賴；不動全域Cargo registry。v2 source/binary/manifest保留。

這是本輪native持久化路徑的第二次、最後一次correction。若修補後相同控制仍未收斂，停止該路徑並保存交接，不能更名重開額度。未執行保留題。

v3固定建置lock SHA256 f3270621bd0e67786a8d21363d3f038c9accbc80069fe11627581d7f92e795e1；相對官方lock刪除93個unused identities，將hnsw0.11.0同版本registry identity替換為已核對原crate的local patch，沒有registry版本／checksum升級。v3成功編譯耗時56.61秒，僅原依賴dead-code warning；runtime結果另列，不以build成功代替驗收。

## 評估器獨立審查修正

T-012獨立重算202校準候選、600actual quality hits、完整來源／向量cosine、更新與4規模結果，確認低分不採用結論。找到評估器guard允許±1.00001並clamp，與原凍結[-1,1]嚴格要求不符。新增±1.000001回歸先失敗兩次，再改strict[-1,1]不clamp。原實測600hits都在範圍內，分數不受影響；仍保留before-strict-guard完整JSON／calibration及原source，對最終guard重新跑完整評估，不用新結果調門檻。這是評估器合約修正，不是第三次nativeSDK修復。1000HNSW持久化control亦加入CI；規模成本仍只手動。

## 最後的patch格式修正

首次staged diff check把unified diff中單一空格的空白context行視為trailing whitespace，commit／push未執行。改以zero-context格式表達完全相同差異；沒有關閉或放寬check。prepare重套hash-pinned來源後，逐檔比較全部prepared source bytes相同；locked build輸出的native library hash仍9b200a81ee94835051d891cc36d3dcf0442a6e8fba2fb62a080441b353c9eec9。只有patch與lock-patch檔案hash改變，Rust／Python／lock內容、模型／語料／threshold都不變。

[等價證據](evidence/semantic-build-equivalence.json)保存評估時兩份patch的原始base64 bytes、前後manifest及對應hash，因此不改寫已審查的evaluation JSON。最終`semantic-sdk-build.json`是shipping格式manifest；完整手動評估引用其等價的舊patch格式／同一binary。CI會直接以shipping格式重建與執行。沒有因格式變化重複模型實驗。
