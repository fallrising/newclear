# T-0437 — 文件結案與真實開發任務試點

Owner 2026-10-29 接受「先文件收尾，再真實開發任務試點」並授權逐里程碑 commit／PR／merge。
需求入口：[desk T-0437](https://github.com/fallrising/desk/blob/main/tasks/T-0437-graphify-development-pilot/task.md)；進度：[任務板](../tasks/BOARD.md)。
本文件是 [SDD](../../SDD.md) 原實驗之外的後續設計，不改動 AC-01～09 的定義與既有證據。

## M1：一致的已合併狀態

同步 README、SUCCESS 與根 PROJECTS：第一輪有界實驗完成、#759/#760 已合併；沒有 tag／部署。
保留原始執行報告、Draft 歷史與所有未驗邊界。驗證 runtime diff 為空、索引與必要 CI、獨立審查。

## M2：在真實元件上完成可驗證的重構

選用本元件 `graphify_lab` 的來源定位邏輯：`node_at` 與 `source_excerpt` 目前放在 CLI 模組，
測試或其他本機工具要重用它們時需 import CLI。將其抽到專用 `source.py`，CLI 保留相同介面，
維持歧義拒絕、來源範圍、行號與讀取上限的行為。這是實際程式碼的維護任務，不注入假 bug。

先凍結 pre-change Git SHA。透過真 Graphify `--code-only` 建圖及 CLI/MCP 查詢找到定義、caller 與相關測試，再回讀原碼。
以同一來源的 `rg`＋局部 source read 作可重跑對照；正確答案由 source AST／既有測試及獨立審查核對。
查詢流程是已知任務的有界回放，不宣稱隨機對照、盲測或一般 agent 生產力排名。

交付本機 recipe 與可重跑 pilot 命令；不安裝全域設定。先建立重構邊界 regression，再抽模組，
以相同命令驗證外部行為與舊 import 相容性。所索引的來源只限明確指定的公開本元件，
不執行外部 reference 專案、不調用模型 API。

| AC | 驗收條件 | 初始狀態 |
| --- | --- | --- |
| P-01 | 固定來源 SHA／fingerprint；真 graph query 能定位兩個 helper、已知 caller／tests，來源行可核對，錯誤候選不計成功。 | passed |
| P-02 | CLI 與測試使用抽出的共用來源模組；原 import 相容，來源越界／歧義／行號／讀取上限的回歸及完整既有 suite 通過。 | passed |
| P-03 | 本機 agent recipe 可執行，不改全域設定；真 stdio MCP 至少完成 initialize、工具列舉與本任務查詢。 | passed |
| P-04 | 報告分開列 build、query、source read、命令耗時、輸出 bytes、已觀測工具計數、agent elapsed；tokens／provider requests／費用未知為 null，不能由 bytes 或工具數推算。 | passed |
| P-05 | 報告有結果、失敗／未驗及後續建議；必要 CI、獨立審查通過，各里程碑正常合併並回讀，帳本同步。 | passed |

## 邊界與判讀

這次只回答「真 Graphify 能否在一項實際重構中提供正確導航，以及付出多少可觀測本機成本」。
沒有 token／provider 計量來源就不宣稱節省；沒有盲測就不宣稱比純 rg 更快。人工／agent 決策品質不以毫秒或輸出大小代替。
沿用 Graphify 0.9.97 與 hash lock；不新增 runtime dependency、不升級上游、不部署、不發布 tag、不付費 API。
HTML 互動、離線 viewer、其他語言、遠端多機共享仍為候選後續，需按試點證據另定範圍。

## 驗證與投入

M1：`python3 scripts/check_indexes.py`、workflow static gate、runtime-identical diff、獨立審查及必要 CI。
M2：聚焦 source regression → 全部 cache/CLI tests → 真 pilot 與 MCP → 原 7 場景 → repo gates → 獨立審查及 CI。
開始 2026-10-29T16:53:01Z；估計總主動投入 60–90 分鐘，每 20 分鐘檢查；每問題至多兩次有理由的修正；每 head CI 最多等待 15 分鐘。
超出範圍、沒有新進展或超過重試界線時保存證據並停下該部分。成功的試點也不自動啟動第三里程碑。

## 本輪結果入口

[實測、回歸、失敗與判斷](../evidence/development-pilot/README.md)。P-01～P-05 已有實作與驗證證據；M1 #775、M2 #778 正常合併並回讀，三項 M2 CI success，獨立 ACCEPT。任務板保留實際合併時間；owner 驗收與發布／部署分開。
