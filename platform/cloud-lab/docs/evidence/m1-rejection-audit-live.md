# RAL：原服務拒絕稽核已接入

範圍：[RAL01–04](../rejection-audit-rollout.md)。Owner在RA交付後同意繼續已提出的原D1新增稽核表／原Worker更新。2026-11-01T04:51:37Z最終核對通過；本輪無新功能source修改、無runner停機／重啟、無續權／付費升級。完整mainline仍incomplete，無usable tag。

## 實際結果

| Gate | 結果 |
| --- | --- |
| RAL-01 固定候選與fresh前態 | PR889 head `b0f8190494177cd2fa7b79a5f804e74112dc4d80`已合併，三項exact-head CI通過；七份候選與remote/source逐byte相同。原Worker三modules符合DI版本、三assets保持；fresh166commands／195firings／160journal／active0，原runner running。 |
| RAL-02 新增schema | 04:49:29Z套用0002、讀回完整sqlite_master確認原10個schema objects不變，只增加rejection_audit與rejection_observed；表初始0列。原部署沒有migration ledger，沿用原direct SQL方式並保存intent／response／SHA256，不創造另一套ledger或重跑0001。 |
| RAL-03 原Worker更新 | 04:49:45Z active version100%，三modules逐byte等於RA候選；三assets以原manifest保留。secret bindings繼承，原settings除provider部署annotations外相等，D1 binding／Access／Cron／4grants／期限保持。 |
| RAL-04 真拒絕與保全 | 04:51:13Z既有runner授權通路GET /api/usage得到403 SCOPE_DENIED、retryable=false、X-Cloud-Lab-Audit=persisted。request_id查到唯一D1列，method GET／route usage／status403／code相同／authenticated=1，schema無身份或request內容欄；沒有提交任務。04:51:37Z最終原166commands整列相同、195firings／160journal保留，active0；runner同PID且NRestarts不變。 |

[去識別receipt](m1-rejection-audit-live.json)保留時間、hash、結果與限制；原始管理／SQL／HTTP及本機service/journal收據保存在私人state，由lead實際讀取核對。公開不放account/domain/command/request IDs、token或secret內容。獨立審查只針對公開文件與去識別證據，不宣稱審查者讀過私人資料。

## 驗證請求的初次失敗

共兩個無副作用GET，一次診斷重試。初次urllib預設請求收到非JSON而在decode報JSONDecodeError；原始status/body未被保存，故不能宣稱確切HTTP碼或Cloudflare攔截原因。其後D1唯讀核對0筆稽核，未據此重跑migration或部署。

第二次將User-Agent對齊原runner的cloud-lab-m1/1.0，並在JSON解析前先私存status／headers摘要與raw bytes；取得上述403/persisted與唯一列。只改這次operator probe，未改產品auth／token／Access或runner；此結果支持一致客戶端設定的接入，不證明初次失敗一定由特定WAF規則造成。原失敗／缺失原body仍明示，不能把兩次請求算成首次成功或零重試。

後續操作沿用原runner transport header；先保留有界原回應再解析，遇非JSON先讀D1對帳，不盲目重送命令或重建憑證。

## 保全、回退與限制

- 最終原unit／runner config／service policy／Grok config／bot config、policy及ledger hash相同，journal device/inode及原列保持。runner保守停止仍2026-11-05T07:24:25Z；runner HMAC/grant仍07:34:26Z，Access machine token仍07:43:27Z。過期human／bot授權沒有延長。
- 拒絕probe及self觀測會按原設計產生nonce／Access last_seen_at；這不是業務命令或續權。原scheduler last_due容許正常Cron推進，但本次前後166commands相同。原closed_unknown結果／歷史未改。
- 原兼容Worker回退request已準備但未執行；若需回退只回Worker，保留新增表及拒絕歷史，不DROP／清空。上線未經重試，初次非JSON只涉及最後讀取驗證。
- 本輪只做一個成功的授權內拒絕案例，未在線上壓滿10000容量、製造DB故障或再次測Safari／手機。滿額／寫入失敗／競爭由[RA434tests及本機workerd](m1-rejection-audit.md)支持；434為RA階段的本機證據，本輪Git CI結果另列。
- Provider費用與用量仍unknown；沒有新增付費方案。稽核容量上限不等同流量／成本限制，Access邊緣攔截與5xx不在表內，不能稱完整安全日誌。

接續unknown/in-flight跨D1與journal的隔離恢復演練；不為驗收中斷原runner，也不自動續任何權限。

## 審查與文件驗證

T859獨立公開證據審查ACCEPT；主導採evidence-gate核對私人收據。50contracts／8llms／task／diff、226相對連結、64份runtime input未變及173項私人literal未出現在公開diff的檢查通過。審查者未讀私人state，也未重跑live probe。Git／CI及任務板結案另有正常交付紀錄。
