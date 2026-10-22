# 閱讀快記私人試用準備

Owner 2026-10-22 直接授權；issue #473。這是階段0–2完成後的新里程碑，不是原規格階段3。只證明本地準備能力；正式私人內容、憑證、migration、部署、排程啟用與手機真人驗收尚未執行。

## 範圍與驗收

| AC | Given / When / Then |
| --- | --- |
| PT-01 | Given 指定內容repo完整commit與registry，When 準備web＋bundle，Then 先建候選完整版本、驗證bundle非空及來源SHA和靜態資產，再原子選用；任何失敗保留上一完整版本，不能發布純web空白閱讀版本 |
| PT-02 | Given 私有本地設定，When offline preflight，Then 檢查Node24.18.0、Git、路徑、registry、checkout/branch/remote與token檔權限；不連網、不輸出秘密；連外fetch/export另有明確命令 |
| PT-03 | Given Linux單次exporter，When 依範本排程與操作手冊，Then 失敗可見、停止恢復、撤銷與Git衝突處理明確；本里程碑不安裝啟用服務 |
| PT-04 | Given 隔離Cloudflare、合成內容repo與本地bare remote，When 快記、notes、export、內容更新及故障建置，Then 全程資料與權威邊界成立，舊版仍可讀，RC與W0–W7原斷言預算保留 |
| PT-05 | Given owner要正式接線，When 讀操作手冊，Then 有具體部署前檢查、備份、回復、手機清單與最少owner資料；本地結果與正式未驗證明確區分 |

## 重用與設計

保留 reading/build.ts、bundle.ts、export.ts：固定Git blob讀取、原子bundle、Linux單例鎖、journal recovery與ACK前遠端確認不重寫。新增 preparation orchestration與offline preflight；所有內容與憑證都由repo外設定指定，不預設回退到合成內容。

候選版本與active指標位於指定私有release root。web build輸出候選的assets，bundle生成於assets/_reading/current.json；完整性manifest記錄來源commit與所有檔案hash。驗證通過才切換active symlink；保留歷史版本供回復。驗證命令必須能拒絕缺bundle、空bundle、來源不符、缺檔／損毀；不提供自動部署命令。

離線preflight只讀本地Git資料與檔案，不fetch、ls-remote或HTTP；拒絕repository attributes與partial/promisor clone，Git物件讀取停用lazy fetch與replacement refs；現有exporter會fetch/push和呼叫HTTPS，操作說明明示此界線。D1仍是captures/notes權威、Git仍是AI正文權威。

## 驗證計畫

新增行為先RED再GREEN。Node/Git負例涵蓋完整產物、失敗保留、路徑/permissions/remote/registry錯誤與遮罩；本地Cloudflare完整流程；全套backend、web build/type checks、完整E2E與manifest validator、project-success/llms/diff與task/report validators。最終head CI無pending、不同模型家族唯讀PASS、最新main整合後才merge。不得使用正式資料或付費模型API。

## 交付狀態

本地結果見[報告](../../tasks/473-private-trial/report.md)。PT-01～05只驗收準備工具、操作範本及合成環境；正式接線、遠端權限、token有效性、服務啟用、正式備份回復與手機真人試用均待owner，不能由合成結果替代。
