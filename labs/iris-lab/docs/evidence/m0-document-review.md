# M0 文件驗證紀錄

日期：2026-10-24。範圍：T-0402／SDD AC-01–05。結果：候選文件檢查與獨立內容審查通過；遠端 CI、合併與回讀以交付 PR 和任務板的實際狀態為準。

## 基準與限制

monorepo 來源基準：`4fc5d9a7b49139115518379bf05e1cfec4fe1bce`。本地採固定來源的文件驗證投影：取得共用 validators、inventory 全部元件 SUCCESS／README／AGENTS、能力檔及其直接連結依賴；549 個基準真實檔案逐一以 Git blob SHA 核對，未用空白替身湊檢查。

投影只用於文件契約及導航驗證，不是完整產品 checkout。新增 iris-lab 檔案與根索引變更在同一投影上檢查；遠端 PR CI 另外使用完整 checkout。沒有模型下載、引擎編譯、GPU 作業或生成圖片。

## 實際候選檢查

| 檢查 | 結果與範圍 |
| --- | --- |
| `python3 scripts/check_project_success.py --write-index` | PASS；43 個項目契約與索引；生成 PROJECTS 後檢視 diff，只新增 iris-lab 列 |
| `python3 scripts/check_indexes.py` | PASS；43 個項目、6 個 llms.txt、0 errors；新增檔已加入 Git index |
| 新增文件相對連結／anchor | PASS；本地目標及指定 heading 存在；外網來源按研究紀錄查核，沒有以全網 link crawler 成功作宣告 |
| Lock／範例 JSON／AC 一致性 | PASS；固定 engine／model 值、未下載／未驗旗標與 null digest 正確；JSON 範例可解析；SDD 與 SUCCESS 共 11 個 AC 編號一致 |
| Staged bytes／whitespace | PASS；預定提交檔的 Git index bytes 與工作樹一致，`git diff --cached --check` 無錯誤 |
| 公開邊界 | 新增文件未發現私人主機、私人帳號／路徑、credentials 或個人 prompt；範例使用合成文字 |

這些檢查未執行產品建置或實機測試。全 repo 的既有 validator 單元測試由必要遠端 CI 執行；不能把本地投影說成完整產品測試。

## 獨立內容審查

作者以外的唯讀 reviewer 審查全部新增文件與根索引變更；修正後結論為 PASS，沒有未解 blocking finding。

發現並修正：原設計要求所有模型檔有來源 SHA-256，與 Hugging Face 一般 Git 檔的物件識別不符。現改為逐檔記 expected algorithm／value／來源；LFS 驗 SHA-256，一般檔驗固定 revision 的 Git blob OID，每個本地下載另算 SHA-256。SDD、lock、驗證計畫與來源說明同步，reviewer 已回讀確認。另精確化同一 OS 使用者／同裝置的互斥範圍，以及子程序 timeout 與端到端 wall time 的起算差異。

審查亦核對 M0／M1 分界、完整 pins、Python 準備與推論依賴、OS／模型限制、未實作介面標記、runtime pending 和沒有 usable tag。這是文件內容審查，不是 GPU 或畫質驗收。

## Git 交付

主文件 PR 以實際 head SHA 執行必要 CI，確認無衝突及審查問題後合併。PR 保存 CI run 與 merge SHA；合併後[任務板](../tasks/BOARD.md)由 board-only PR 補入真實完成時間與交付連結。文件不預填尚未發生的 merge 或實機成果；根代理須回讀最終遠端 SHA／內容才回報本輪完成。
