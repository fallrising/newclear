# PSL：原看板快照順序修正接入

Owner在PS交付後同意繼續已提出的原服務接入；沿既有明確批准更新原Lab Worker看板、保留D1／Access／secrets／期限／免費方案。只部署已合併PR905候選，三Worker modules不變，三assets中只有dashboard.mjs改變。不增加授權窗口，不要求Safari／手機重測。

| AC | 驗收 |
| --- | --- |
| PSL-01 | 固定PR905與446tests／16browserchecks／T861審查來源；六份候選與git逐byte相同，fresh管理／D1／runner與期限核對。 |
| PSL-02 | 保存原100%版本的回退request；依既有direct upload流程上傳新manifest／缺少資產，保留secret bindings、設定、排程與Access，原runner不停止。 |
| PSL-03 | 回讀新版100%、原modules逐byte保持、settings／routing／grant／Access／期限及原業務列／journal不變；正常Cron新增工作另列，不改原歷史。 |
| PSL-04 | 保存私人原始收據、去識別證據及獨立公開審查，正常PR／CI／merge／回讀與結案。完整mainline及未做的真人下載保持明示。 |

發布前重新讀deployment／settings偵測漂移；未知response先對帳、不重播mutation。原版本含closed_unknown及拒絕稽核，dashboard-only回退保留DB與全部歷史；回退只準備，不為驗收執行。既有機器self只核對授權通路，不偽裝human資產驗收；asset內容由固定source、manifest、upload及發布receipts支持。既有owner取消Console hash／手機必測仍有效。

本輪不執行schema migration、命令提交、歷史清理、服務重啟、token輪替或權限續期。費用仍依現有Free限制；未讀到provider帳單不能填零。
