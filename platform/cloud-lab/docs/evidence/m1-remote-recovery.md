# M1 remote isolated recovery evidence — 2026-10-28

本輪[RF-01～04](../remote-recovery.md)在真實Cloudflare完成，結束時間2026-10-28T04:27:56Z。另建一組短期Worker／D1／精確hostname／Access app與service token；產品Worker三個module、migration及runner未修改。僅機器API，沒有ASSETS或human入口，不能當成看板／手機驗收。

## 遠端結果

| 場景 | 故障與恢復證據 | 結果 |
| --- | --- | --- |
| 回報送達前斷線 | 本地completed先持久化，代理未轉交report；撤銷測試submitter及runner grants後兩身份均403；自然lease到期，獨立reconciler取得新fence／reconcile_only並補報 | result_recorded、validation passed；artifact完整bytes／SHA-256、原時間、external_ref及identity digest相符；journal不變，採集1次 |
| 保存後ACK遺失 | Worker先回200並保存terminal結果，代理才切斷；新程序claim為空 | 控制列及journal不變；沒有再report或採集，採集總數1 |
| started後SIGKILL | collector邊界marker完整落盤，journal started／result null後終止本次子程序；自然lease到期，新reconcile_only fence回報unknown | reconciling、active1、result null；journal不變，未再採集，呼叫總數1 |

獨立reconciler的grant僅有`runs:reconcile`及`runs:report`，沒有`dispatch:claim`。撤銷的兩個grant仍revoked，未恢復或延長。額外以有效reconciler提交舊fence得到409／STALE_FENCE；相同命令原bytes重送得到202及原command ID。D1前後整列相等，最終3commands／2terminal／1active unknown；沒有清除unknown或延長命令deadline。

## 入口與隔離

初始匿名bootstrap為403，有效observer為200且scope一致。最後只停用本次新建Access token；管理API回讀enabled=false、duration與expiry不變。使用原Access pair及新HMAC簽名、無cookie、不跟redirect的新請求得到401。這證明本次service-token入口撤權，不代表所有瀏覽器session撤銷。

workers.dev及preview始終關閉，Cron為空、D1 schedule disabled／last_due null、firings為空。三個原有Worker的完整settings及schedules與部署前receipt相等，原custom-domain bindings完整保留；僅增加本次新domain。原Lab服務、憑證窗口及linger未調整。新資源與證據保留，無刪除或既有產品遷移；沒有付費升級，不以此保證未來用量帳單為零。

## 驗證與審查

共用launcher執行`python3 platform/cloud-lab/tools/check.py`，RF-transport-final的保護日誌為31 Node＋84 Python＝115 tests全過。新增工具有14項回歸，覆蓋relay／profile、父目錄、逾時、延遲connect及取消時隱式重連；三個真實遠端案例由私人operator載入`run_case`執行，不冒充單元測試涵蓋了雲端。

[T-822](../../../../.team/reports/T-822.md)初審及focused review要求修正關閉期限、父目錄保護與取消後重連。主導修正後，另具名且有界的[T-823](../../../../.team/reports/T-823.md)檢查最終程式及115項證據並ACCEPT。審查未操作雲端；主導負責遠端receipt、D1／journal與隔離比對。兩個私人operator呼叫均有240秒host timeout，子程序及HTTP另有有界期限。

收尾`check_indexes.py`、`check_project_success.py`、M1 scope/link audit、兩份task／report validator及working/staged diff檢查通過：44專案契約、7 llms、35文件／270連結／12固定來源。最初index檢查因新證據檔未進Git index而失敗；明確stage後重跑通過，沒有忽略壞連結。公開邊界及product runtime無修改亦已核對。

公開內容僅放去識別摘要；原始API request／response、設定、intent、admission、fault／recovered、SQLite journal、marker、來源hash及操作腳本保存在Git外的私人持久目錄。Git交付沿用正常PR／CI／merge／remote readback。

## 保留的失敗與限制

- 初始RED是新增工具尚未存在。T822後的首次82項Python回歸有一項fixture錯誤：共用工作區在Git下，先觸發checkout guard。修正單元測試只隔離另一個guard，保留產品兩層檢查；最後84項全過。原失敗日誌未覆寫。
- T822 focused review讀到舊失敗日誌，仍保留其REWORK；T823明確改讀最終證據。初審三個`git diff --no-index --check`以1表示有diff，無whitespace診斷；沒有工具拒絕或模型turn失敗。
- 首次遠端preflight將Access拒絕HTML交給受限JSON client，因頁面超過32768bytes而停止。當時沒有提交命令或撤銷grant；先確認TLS及signed200，再改私人operator只讀拒絕status，重新讀D1確認仍空。原失敗receipt保留，沒有重播create／submit。
- Node測試仍有既有experimental SQLite提示。未測整機斷電、systemd強制中斷重啟、手機互動、實際配額耗盡、Grok或長期排程。完整AC-06～08、T-0003-4及mainline仍未完成，沒有usable tag。
