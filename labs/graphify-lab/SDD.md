# Graphify lab 設計

## 目標

Owner 直接指示：在 newclear 試用 Graphify，實跑主要開發場景，檢驗參考程式碼只保存一份能否節省空間與查找成本。本實驗採真實 Graphify CLI／MCP，不重新實作 parser 或以 mock graph 代替。

## 範圍與架構

- Python 3.12、固定 Graphify 發布版本與 upstream commit；依賴 hash lock。
- `references.lock.json` 描述公開參考倉 URL、完整 SHA、索引 subdir 與授權來源。
- 共用 cache 按 repo URL／commit 保存一份 Git source snapshot；索引按 source revision、subdir、Graphify 版本與設定分開保存。兩個 consumer 只保存 pointer，不複製 source 或 graph。
- source 是證據、graph 是衍生索引。精確命中後只讀相關來源與行號；graph 不取代 Git，也不保證完整靜態呼叫分析。
- 本機 code-only 分析無 LLM／付費 API；不安裝全域 skill、不修改其他專案 AGENTS、不部署。
- 原始碼留在共用 cache，不 vendor 到 newclear。交付 adapter、可重跑 scenario suite、精簡證據、文件與 Draft PR。

## 場景與驗收

| AC | 場景 | 必須觀察的結果 |
| --- | --- | --- |
| AC-01 | 固定來源、安裝及可重現入口 | 真實 Graphify 版本、完整來源 SHA、依賴 lock、可執行命令。 |
| AC-02 | 新人導覽／符號定位／路徑追蹤 | 合成但真實可解析的 Python／TypeScript source；已知 symbol、source location、關係鏈命中，無命中負例。 |
| AC-03 | 真實專案參考 | newclear 既有元件與固定外部公開參考各自產生非空圖，定位真實函式與來源；不執行被索引專案。 |
| AC-04 | 修改影響／重構與測試線索 | 查得已知 caller／test；保留動態調用與推論邊的限制，不能等同完整回歸測試選擇器。 |
| AC-05 | 更新與失效 | 可變 fixture 修改後 update 反映新符號／刪除舊符號；固定 reference dirty cache 拒絕誤用。 |
| AC-06 | 跨專案組合 | 合併 graph 保留 namespace／provenance；對可支援 typed call 驗證正例，歧義或不相干同名 symbol 不得冒充正確連邊。 |
| AC-07 | 單份共用 | 兩個 consumer 指向相同 canonical source／index；同 commit 重用，版本／設定不同隔離；原子發布、並行寫入與損壞快取有保護。 |
| AC-08 | 效能與空間 | 記錄真實 source／graph bytes、cold／warm 時間與查詢成本；重複份數節省額標示為模型計算；不搬用上游 token 宣稱。 |
| AC-09 | Agent 接入與交付 | 真 MCP stdio 握手及查詢、重新開啟可讀；實際 scenario、邊界測試、repo index／workflow gate、獨立審查與 Draft PR。 |

## 非目標與解讀

本輪不替換既有自製工具、不建立全面的 HTTP 服務依賴圖、不證明所有語言的解析正確性、不提供自然語言問答品質或 token 節省保證。MCP 僅在子程序 stdio 試跑；多台主機共享與遠端 Gateway 後續再設計。速度量測是當前環境結果，不能外推到使用者的電腦。

## 預定驗證

真實 CLI 與 MCP 的整合 suite；cache 的 revision／dirty／並行／損壞負例；根目錄 `scripts/check_indexes.py` 與 `check_workflows.py`；獨立 reviewer 檢查 assertion 是否足以支撐結論。
