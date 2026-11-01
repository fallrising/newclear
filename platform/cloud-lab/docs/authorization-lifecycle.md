# Authorization lifecycle — AL01–04

Owner同意從授權生命週期開始，讓短期驗收Lab可逐步成為日用服務。本輪交付離線盤點與變更計畫，不修改真人登入、雲端grant、Worker secrets、Access token、runner服務或排程。

| AC | 驗收 |
| --- | --- |
| AL-01 | 依具時間的嚴格snapshot列出grant、HMAC、Access service token與runner stop期限；過期／撤銷／尚未生效／缺漏／過舊不誤報可用；status不輸出識別值；所有輸入／輸出禁止secret |
| AL-02 | 明確指定新期限才產生單一grant續期計畫；僅修改expires_at，保留principal、scope、capabilities與所有原命令期限；具revision／原policy／無active工作及無enabled排程的SQL條件 |
| AL-03 | 撤銷計畫不刪除資料、不重設unknown、不重新啟用已撤銷grant；機器憑證輪替另有明確步驟；計畫必須另經批准並重新核對，工具沒有apply或網路能力 |
| AL-04 | 嚴格有界JSON與私人檔案邊界、exclusive輸出；真實SQLite測試證明plan的CAS、並行漂移及busy guard；負向案例保留，完整回歸與獨立審查 |

計畫不是續權；snapshot不是live health，沒有登入session證據。真人Access session與grant分開，手機不是必要驗收。未知費用與實際授權期限不由工具推定；不放寬原部署產生器的24小時上限。

## 輸入與輸出

`tools/authorization.py`接受私人0600的`cloudlab.authorization.v1` snapshot，最多32768bytes。snapshot有`observed_at`、`target`（worker_name、database_id）、`active_commands`、`schedules_enabled`與最多四個不重複role的`subjects`。每筆subject包含role、原D1 grant row（policy保留原始JSON字串）、credential metadata或null、access_required、access_service metadata或null、runner_stop_at或null。credential欄位固定為id、generation、principal_id、grant_id、revoked、expires_at，且principal／grant引用須與grant row相符；access_service固定為id、revoked、expires_at。human／scheduler沒有這兩種機器層，真人session另外不作推斷。不得加入secret、cookie、JWT或帳號。

`status --snapshot <private.json>`只輸出role／期限／狀態；超過300秒的snapshot或未知必要層會標unknown。已知過期或撤銷仍保留。`effective_expires_at`是已知期限的最小值；`deadline_complete=false`時只是已知上界，不能作為完整有效窗口。human／scheduler不需要HMAC或service token，真人Access session另標未驗證。`valid`只代表snapshot中的必要期限尚有效，不代表登入、網路或授權策略已驗證。

`plan --snapshot <private.json> --role <role> --action renew --expires-at <UTC> --output <private-plan.json>`要求snapshot新鮮、沒有active commands及enabled schedules、grant未撤銷。新期限必須比原期限晚，且距目前不超過30日；這是計畫上限，不是批准30日授權。`--action revoke`不接受expires-at。輸出含target、snapshot digest、短期審閱期限、parameterized SQL及執行前後檢查清單；stdout僅顯示保存成功與digest。不得把私人snapshot／plan發到公開repo。

## 批准後才可執行的操作

1. 重新讀取原target／grant／所有有效期限，核對snapshot與計畫；過期或漂移就重新產生計畫，不重播未知結果。
2. 取得具體target、role、動作及期限批准。執行器另須檢查計畫有效期限、target及affected rows恰為1；SQL的CAS不取代這些檢查。
3. 使用同一條parameterized SQL原子更新；revision與原policy任何變化、存在active command或enabled schedule均使更新0列。0列必須停止對帳，不放寬條件重試。這不是通用撤權急停工具；有在途工作時先走既有撤權／reconcile流程。
4. 回讀grant及未變scope，重新探測授權／撤權結果。續grant不會延長既有command、HMAC、Access token或runner stop時間。
5. 如需輪替HMAC／Access token，先停用新准入並對帳在途工作；在批准的私人路徑生成新secret，固定新generation與到期，逐步更新Worker和機器端並保留舊值回退。驗證新憑證成功、舊憑證拒絕，再完成切換；不得將秘密放進snapshot／plan。跨Cloudflare與本機不存在原子交易，失敗時依receipt逐項對帳。此工具尚不生成secret或執行輪替。

後續才加入日用授權實際切換、runner恢復、低頻排程與保留／配額。完整mainline仍incomplete。

## 使用例

[合成snapshot](../examples/authorization-snapshot.json)只展示格式，固定日期不是目前live狀態。先從批准的唯讀來源取得當前metadata，再放到repo外、owner私有的0600檔案；不可把此fixture直接當作真實授權證據。

```sh
python3 platform/cloud-lab/tools/authorization.py status --snapshot /private/current-snapshot.json
python3 platform/cloud-lab/tools/authorization.py plan --snapshot /private/current-snapshot.json --role runner --action renew --expires-at 2030-01-02T00:00:00Z --output /private/proposed-renewal.json
python3 platform/cloud-lab/tools/authorization.py plan --snapshot /private/current-snapshot.json --role runner --action revoke --output /private/proposed-revocation.json
```

日期是合成示例，須由owner明確選擇。輸出檔案存在就拒絕覆寫；部分寫入／未知結果均保留原紀錄並先查明，不能換名盲目重播。此版沒有snapshot自動採集、Access session判定、儀表板提醒、secret產生、憑證輪替執行器或遠端apply。
