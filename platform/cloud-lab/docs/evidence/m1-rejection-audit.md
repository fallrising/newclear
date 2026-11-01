# RA：有界拒絕稽核證據

範圍：[RA01–04](../rejection-audit.md)。本輪source／local qualification；沒有原Cloudflare D1遷移、Worker發布、Access／grant／secrets／runner變更、真人測試或付費服務。完整主線仍incomplete／usable_tag none。

## 實際驗證

| 檢查 | 結果與實際邊界 |
| --- | --- |
| 新測試RED | RA-red：7項皆失敗；舊Worker無header／新表，原log保留。 |
| Core GREEN | RA-green-fixed：51項通過（control44＋audit7），無失敗或跳過；包括wrong-holder、exact lease expiry、quota429、artifact410的request_id對應及原command整列保全。 |
| 完整回歸 | RA-full：130Node＋304Python＝434項通過、0skip；原SQLite ResourceWarning保留，非測試失敗。 |
| 最終持久性加強 | RA-final-focused：7項通過；所有DB連線關閉後重新開啟，拒絕列仍存在，從原0001升級的原表列保持。此test-only修正晚於full，另有針對性驗證；runtime未再變動。 |
| 真本機workerd/D1 | RA2：[原始公開receipt](m1-rejection-audit-workerd.json)9checks通過，Miniflare5.20261019.2-beta。原HMAC/JWT/ASSETS/claim/report/ACL流程，以及拒絕correlation／去敏、最後容量並發、歷史與命令保全、滿額仍可成功讀取、缺表回401＋unavailable。6份來源SHA256與候選相符。 |
| 文件與審查 | index50contracts／8llms、task／diff檢查通過；T858最終source/local ACCEPT，獨立核對6個來源hash。Git交付見任務板，不由本列推定雲端部署。 |

實際命令均由既有shared launcher從source目錄執行：

```sh
node --test --test-isolation=none platform/cloud-lab/tests/rejection-audit.test.mjs
node --test --test-isolation=none platform/cloud-lab/tests/rejection-audit.test.mjs platform/cloud-lab/tests/control.test.mjs
python3 platform/cloud-lab/tools/check.py
node platform/cloud-lab/tools/qualify_runtime.mjs <existing-toolchain>
```

最後命令實際以timeout90s包裝並使用既有toolchain；尖括號為公開去識別表示。實際執行Node24.14.0／Python3.13.5，不冒稱本機跑過Python3.11。核心測試用NodeSQLite，workerd是實際本機CF runtime與D1 binding；不等同雲端／多region／實機Access或Safari驗收。本輪無UI行為變更，不要求owner重測。

## 修正與保留的失敗

- 首次GREEN的兩個測試失敗：合成grant漏resource_ref／recipe_ref導致self response503；補齊fixture後51項通過，未更改production授權語義。
- RA1 workerd的業務保全assertion錯把D1 response的last_row_id／size_after metadata一起比對；新增稽核必然改變這些metadata。改為比較commands/grants/schedules/firings的完整results列，RA2通過；原失敗receipt/log保留。未放寬業務欄位比較，也未修改生產Worker來通過測試。
- 缺表場景只在隔離fixture把稽核表改名preserved_audit，全部10000列保留；不是live DROP／清理方案。

## 可宣稱的行為與缺口

await完成且header為persisted才表示本次Worker4xx的最小metadata已寫入。full／unavailable代表未保存，原error status/code/retryable保持。successful和5xx不進表，5xx明示not_applicable。未驗證caller不取得身份歸屬；authenticated=0可能包括有效憑證但grant被撤銷。只有request_id關聯，無actor或command ID可搜尋。

表上限限制儲存，不能限制到達Worker的流量成本；滿額不刪／覆寫、後續仍可能讀D1。Access邊緣拒絕、程序中斷、5xx與未到達handler的流量不在此稽核；不是完整exactly-once安全日誌／防竄改帳本。實際provider帳單維持unknown。

0001原bytes、auth/protocol、runner與看板資產保持；0002僅新增表／索引。實際部署需先schema後Worker，回退保留表／歷史；未部署前原線上仍無此功能。未續任何授權期限。下一項接續unknown/in-flight跨D1/journal的隔離恢復，不能用此次metadata稽核替代恢復證據。

## 後續實際接入

上述source/local里程碑之後，owner同意繼續原服務接入；[RAL實際證據](m1-rejection-audit-live.md)記錄已完成的新增schema、原Worker更新、真拒絕對帳與歷史／期限保全。source階段的「未部署」為當時邊界，不能替代後續live證據。
