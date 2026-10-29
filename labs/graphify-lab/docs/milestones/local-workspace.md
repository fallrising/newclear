# T-0439 — M3 本機工作目錄接入

Owner 於 2026-10-29 在 T-0437 交付後要求「好，繼續開發。」；本輪將既有實驗轉成可直接使用的本機入口。
[需求卡](https://github.com/fallrising/desk/blob/main/tasks/T-0439-graphify-local-workspace/task.md)／[任務板](../tasks/BOARD.md)。
本切片不改第一輪 AC-01～09 與 M2 的 P-01～P-05，也不把新能力算作過去驗收。

## 使用與設計

新增 `python -m graphify_lab.workspace --source <directory> [--cache <outside-directory>] <operation>`。
operation 為 `locate`、`query <symbol>`、`explain <id>`、`source <label> [--file] [--lines]`、`serve`。
必須明確提供 source；不掃描任意其他目錄、不修改 reference manifest、不下載來源。

重用 `ensure_index` 與來源 helper，不複製 parser、快取鎖或 Graphify 引擎。
工作目錄可以有未提交變更；身份綁 canonical path、內容、Git／ignore context 與固定工具鏈。
每個短命令先驗證索引，變更時產生新索引，舊索引保留；壞 graph 仍拒絕。
來源 excerpt 在讀取後再比對 fingerprint 與 context，若來源在本次讀取期間改變就拒絕輸出。
本機輸出可含使用者指定的絕對路徑；公開 evidence 必須遮罩。

`serve` 僅在啟動時驗證、交給真正的 stdio MCP；常駐程序固定當次 graph，不自動監控或熱更新。
修改來源後必須結束並重開，不能宣稱同一 session 自動取得最新內容。無 HTTP port、模型 API 或全域 client 安裝。
cache 必須在 source 外；沿用 POSIX、directory symlink 不支援、JS/TS 外部 resolver 邊界。
內容 fingerprint 會讀明確 source 下所有一般檔（除 Git metadata），因此應選元件根目錄，將依賴／建置輸出置於外部，避免索引整個 home。

## 驗收

| AC | Given / When / Then | 狀態 |
| --- | --- | --- |
| W-01 | 明確 source 存在；locate 冷建圖與第二 consumer 開啟時，共用相同 graph，回傳內容 fingerprint／Git provenance；缺目錄、cache 內嵌 source 均失敗。 | local passed；證據見下方 |
| W-02 | query/explain/source 對真 graph 得到正確來源；來源越界、無命中、同名歧義、非法 budget/lines 拒絕；參數錯誤不先建圖；excerpt 讀取變動不回傳舊證據。 | local passed；證據見下方 |
| W-03 | 暫存來源 rename／改動後新索引命中新名稱且無舊名；未變重用、設定變動失效、舊 graph 留存；不改真實元件。 | local passed；證據見下方 |
| W-04 | 實際 tools/codex-usage 的 normalize_rates → norm_window → remaining_percent 路徑、來源行與真 workspace serve 的 MCP initialize/list/query 可核對；保存 corpus hash、實測時間及限制，不執行該元件。 | local passed；證據見下方 |
| W-05 | 新邊界回歸、原 tests／7 scenarios／M2 pilot、repo gates、獨立審查與必要 CI 通過，PR 合併回讀，任務板／帳本同步。 | pending |

## 排除與投入

不新增 runtime dependency、不升級 Graphify、不改 tools/codex-usage、不改全域 AGENTS/MCP、不做 remote service／部署／tag／付費 API。
沒有 provider 計量來源則 tokens、requests、cost 為 null，不以命令數／bytes／程序耗時推算。
開始 2026-10-29T17:33:47Z，主動估計 45–75 分鐘，20 分鐘檢查點，每問題最多兩次有理由修正；每 head CI 有界等待 15 分鐘。

本機驗收證據：[W-01～W-05 對照](../evidence/local-workspace/README.md)。W-05 仍待最終 CI／合併回讀，不提前宣稱完成。
