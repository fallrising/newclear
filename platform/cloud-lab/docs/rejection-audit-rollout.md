# RAL：原服務拒絕稽核接入

Owner在RA source/local交付及「下一步原D1新增稽核表並更新Worker、保留原期限與免費方案」之後指示繼續開發。沿該具體下一步接入原服務，使用PR889已合併候選；不新增服務或擴大權限。

| AC | 驗收 |
| --- | --- |
| RAL-01 | fresh原部署／schema／業務與本機service/journal快照，七份候選逐byte符合PR889；確認原grants／Access／Cron與期限。 |
| RAL-02 | 僅套用0002新增稽核表／索引；保留原schema與所有歷史，依原遷移記錄方式登記；不確定結果先readback、不盲目重跑。 |
| RAL-03 | 原Worker新版本100%，三modules吻合候選，三assets保持；secret bindings繼承、設定與Access／grants／Cron／期限不變，runner不重啟。 |
| RAL-04 | 一次既有機器通路的無副作用拒絕，原status/code及persisted header、request_id對應D1列；前後業務／journal保全、獨立公開證據審查及正常Git交付。 |

先schema後Worker。Fresh檢查若發現未完成命令仍可正常觀測，不以部署為由改寫；若原terminal資料／authority或候選不相符，停止相依寫入並對帳。回退只回原compatibleWorker，新增audit表與資料保留，不DROP／DELETE。多statement遷移遇未知結果先查schema與記錄，不把工具失敗當成未寫入。

既有機器通路只做一個會被原scope拒絕的GET，不提交健康任務、執行故障、重開真人窗口或呼叫Grok模型。若通路不可用則明示缺口，不自行續權。Provider費用仍unknown；不升級Workers Free或新增付費資源。
