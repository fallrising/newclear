# M0 文件驗證紀錄

日期：2026-10-23。任務：[Issue #514](https://github.com/fallrising/newclear/issues/514)。newclear 基準 `a384d77a7e32f1dc35902eb94e7cf78daf68e367`；上游行為參考 `5e940f6bc1f8aa50ac7fe0e2406baee7ef5ef7e7`。本輪僅分析與 SDD。

## 計畫與範圍

開始 `2026-10-23T06:29:12Z`，截止 `2026-10-23T06:49:12Z`，含主導與協作代理、最後三分鐘收束。預定 scoped 契約、官方根索引比對、修改文件連結與 AC 一致性、staged whitespace、原子提交、Draft PR 和遠端回讀。Token／費用實耗 unknown。

## 實際結果

官方 scoped checker 通過（1 個新專案）；依最新 main 的 42 份 SUCCESS frontmatter 由官方 index_text 產生並精確比對 PROJECTS.md；18 條 SDD／SUCCESS 驗收文字一致；125 個候選 Markdown 相對路徑檢查通過。最終 staged whitespace gate 在遠端提交前執行，失敗即停止提交。遠端 commit、Draft PR 與 CI 結果以 PR 回讀紀錄為準，AC-04 在提交前保持 pending。本輪不聲稱任何網站 runtime、瀏覽器、行動操作、歷史資料品質或性能驗收通過。前輪上游驗證見分析文件，沒有在這輪重跑。

## 環境與紀錄界線

GitHub app 已確認 newclear 讀寫權限。終端 git clone 因 browser-proxy 連線失敗，改用固定 SHA 的 GitHub app 內容與 Git data API。檢查快照只含真正需要的原始文件，不能聲稱完整 checkout 的全庫檢查已在本機通過；遠端既有 CI 另行查詢。

建立本機暫存基準時，檔案寫入多了一個結尾空行，首次 staged whitespace 回報失敗；已恢復來源原始結尾並重驗通過。這些暫存驗證提交不會上傳，遠端候選仍以固定 newclear main 為 parent。公開文件提交必須在最終 staged 檢查通過後才進行。
