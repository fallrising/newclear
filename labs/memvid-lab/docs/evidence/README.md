# 執行與驗收紀錄

日期：2026-10-28。範圍是固定 Memvid 的 11 類官方場景記憶層，加上 PDF、BGE、CLIP、Whisper，
不包含生成式 LLM 或 production 部署。AC 對照見 [SUCCESS](../../SUCCESS.md)。

## 結果

主控在乾淨安裝的 Python 3.12.14 venv 執行完整 profile，**15 passed／0 failed／0 blocked**。
[full-run.json](full-run.json) 是實際程式產出的報告；執行時間為 2026-10-28T11:47:45Z～2026-10-28T11:47:53Z，
各案例計時合計約 8.20 秒，這不包含依賴／模型下載與 Rust 建置，也不是效能 benchmark。

報告的 15 份 runtime source／lock 檔 SHA-256 已逐項比對工作樹相同。Git commit 在交付時另記於 SUCCESS；
後續純文件更新不變更這些 runtime bytes。Python SDK 2.0.160、native core 2.0.140，Linux x86-64。

| 檢查 | 實得 |
| --- | --- |
| UC-01～UC-11 | 11／11 passed，含新程序持久化、ACL、單檔搬移、歷史／session、metadata 及刪除 |
| CAP-PDF | 真 PDF 擷取、來源與代碼命中、重開／deep verify passed |
| CAP-SEMANTIC | 兩個 lexical 無命中的同義 query 均由真 BGE 向量命中；另驗 mixed query |
| CAP-CLIP | 兩張圖片由真原生 image/text encoder 命中；沒有索引 caption 或答案檔名 |
| CAP-WHISPER | 真 11 秒音訊轉錄，實得文字入庫／查詢／重開；六項 native 失敗控制 |
| Runtime 網路 | 匯入 SDK 前載入 Linux seccomp，IPv4／IPv6 實測 EPERM，規則由子程序繼承 |
| CLI regression | 八項 passed：唯讀、不存在／損壞檔、無命中、拒絕覆寫、子程序網路、錯誤模型、完整 profile 缺模型 |
| 核心最小依賴 | [core-only.json](core-only.json)：只裝 memvid-sdk 與 typing-extensions，12 passed／3 not_run；後續 UC07 只補資料／oracle，無新增 import |
| 安裝 | `make setup` 從兩份 `--require-hashes` lock 在新的 venv 成功安裝 |
| Workflow 靜態驗證 | actionlint 1.7.12，全部 39 個 root workflows passed |

完整 profile 的實際入口（路徑以可重現相對工作目錄表示）：

```sh
.venv/bin/python lab.py run --profile full --output work/run-001 \
  --models work/models \
  --whisper-bin work/whisper-build/release/memvid-lab-whisper \
  --whisper-assets work/whisper-assets
```

另外執行 README 的兩個唯讀 query，確認 checkpoint 與 country 均帶正確 URI／內容。
權重、音訊與 `.mv2` 為可重建的本機產物，不提交到 Git。

## 未掩蓋的失敗與適配

[initial-integration.json](initial-integration.json) 保留實作中的第一輪 **10 passed／5 failed**。
它是當時未凍結的開發候選，不是最終版本；只有本機 run-root 路徑替換成 `<run>`，觀察及來源雜湊未改。

1. **詞彙索引。** UC02 最終報告仍保存重建前的原始觀察：三份預期來源只回兩份，缺少 runbook。
   `seal`、reopen 或 `put_many` 在探勘中也不能保證消除；因此在自己新建的資料上明示執行
   `doctor(rebuild_lex_index=True)`。官方 doctor 還會執行它自行規劃的 vec/header/TOC 修復，
   各個 actions、finding codes 及 verify 都如實記錄。它不是唯讀 query 的隱式副作用。
2. **查詢語義。** `retry_backoff` 原字串只回設計文件，漏掉程式來源；驗收使用有效 lexical token 加完整原始碼內容斷言，
   同時保存 exact-symbol 缺口。中文同樣不保證自然斷詞。同 URI 追加用目前 frame、版本專屬詞與 as-of／timeline 核對，
   不假定一般 find 等同 overwrite。
3. **Native ask。** 未知詞的原始 `ask(context_only=True)` 仍回了一份無關政策。應用層先 `find`；沒有來源就回空，
   有來源再按真命中的 URI 動態 scope。原始 unscoped／unknown ask 觀察均保留，沒有宣稱修復 upstream ask。
4. **PDF。** extractous 在本環境印出 AWT library 失敗，後續 native fallback 擷取成功。驗收依實得 PDF 內容，沒有吞成單純 exit-code pass。
5. **Whisper。** 原始 Rust cache 設定無效而在網路封鎖下失敗，明示本地 cache 初始化 patch 後成功。
   [native evidence](../../native-whisper/evidence.json) 保留原版失敗、版本、音訊及 binary hash。
6. **模型 adapter。** BGE 使用真本地 ONNX provider；CLIP 使用真 Memvid encoder 加一般 vector index。
   不把隨機向量、手工 memory cards 或外部 PNG 說成原生生成、抽取或封裝圖片能力。

## 獨立審查與交付

- [CLI／離線邊界審查](review-runner.md)：未編寫這些檔案的 worker 進行唯讀審查與獨立操作。
- [核心場景與原生 helper 審查](review-core-native.md)：另一 worker 重跑並檢查 oracle、索引修復、語意邊界與 native source 重現。
- 主控核對 `advanced.py`／`models.py`：固定 revision／雜湊、真模型輸入、互斥新檔、未索引答案線索、lexical 控制及重開斷言。

所有觀察均為合成／公開 fixture。GitHub Actions 與遠端回讀狀態以 Draft PR 的最後 head 為準；
本機通過不能冒充遠端 CI，Draft 也不等於已合併、release 或部署。

## Git source qualification

驗證 source commit：[`7d0c0bf5f9c6bbc0c4058cb4d53ac001be7d39c2`](https://github.com/fallrising/newclear/commit/7d0c0bf5f9c6bbc0c4058cb4d53ac001be7d39c2)。
這個 commit 保留最初認領 `d2e02c37e74e102007280c3516f148da19e9bd00` 及最新 main `fb58656083231c282a64baf20602aa662caf4eee` 為 parents。
GitHub app 建立的完整 tree `b0440255c81297399ed259c904e6a3da3813a381` 與本機已驗證 index 完全相同。
終端 `git push` 缺少 HTTPS 認證（could not read Username），因此使用 GitHub app 的 create_tree → create_commit → update_ref，`force=false` 並核對 expected SHA；未直接更新 main。
後續只補本段、SUCCESS／inventory source 及任務時間；runtime source hashes 不變。最終分支、Draft PR 與 CI 結果以該 PR 最後 head 為準。

## 2026-10-29 狀態回讀

以上 Draft／未合併敘述為原執行時點的歷史紀錄。後續 [#709](https://github.com/fallrising/newclear/pull/709) 與 [#733](https://github.com/fallrising/newclear/pull/733) 已合併，任務板八項 done。主導再次回讀驗證 head 的四項 workflows 均 success；相對本輪 base，runtime／locks／workflow bytes 未變。M1 只核對並同步文件，不冒充重跑 15 項模型測試；本次 PR 的 CI 另行回讀。

## 2026-10-30 M3持久化修復與固定模型比較

Owner已批准修復後承接原凍結M3。[修復設計](../notes-semantic-repair.md)記錄pinned source、SDK/core/HNSW本地補丁、stock red與兩次有依據correction；[比較結果](../notes-semantic-results.md)區分工程實跑完成和模型未達採用要求。原2026-10-29失敗JSON全部保留。

- `semantic-sdk-build.json`：最終opt-in native build的source／lock／patch／library hashes，不代表上游已發布修復。
- `semantic-persistence.json`、`semantic-persistence-updates.json`：24真向量、frame IDs、無效批次、追加／刪除／新程序。
- `semantic-hnsw-retention.json`：真BGE payloads重複於1000不同URI的儲存control，manifest1000→1001→1000與24組native來源query。不是模型品質語料或全量近鄰recall保證。
- `semantic-evaluation.json`、`semantic-calibration.json`：最終凍結評估與dev-only門檻；含逐題hits、float32原向量、來源manifest、資產與程式hash、成本samples。
- `semantic-evaluation-before-strict-guard.json`、相對應calibration：審查前版本完整實跑；cosine邊界後來按原規格嚴格化，不修改其歷史來源hash。
- `semantic-repair-stock-failure.json`、`semantic-hnsw-retention-failure.json`、`semantic-hnsw-short-result-failure.json`：明示未通過，對應stock18→6、v1 HNSW1000→1、v2數量保留但native搜尋panic。

完整Git／CI／審查狀態見[任務板](../tasks/BOARD.md)。不包含模型權重、native binaries、私人內容或本機路徑；raw可重建runtime資料保留於指定本機backup。
