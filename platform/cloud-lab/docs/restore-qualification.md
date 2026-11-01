# XR：未知／執行中任務的隔離還原

本輪補AC-07／08與F14的source/local恢復證據，不操作原雲端DB、原runner／journal、Access或期限。用既有Miniflare/workerd、Python標準庫及實際runner子程序，沒有新依賴或付費資源。

| AC | 驗收 |
| --- | --- |
| XR-01 | 從合成source D1邏輯快照及SQLite online backup建立不同目的地；還原前後完整應用schema／rows相同、journal rows與原artifact bytes／digest相同。兩份快照時間獨立，不能只比筆數。 |
| XR-02 | started、explicit unknown及completed但回報未達的任務，還原後以新reconcile_only fence對帳。前兩者保持unknown/active，completed回傳原bytes與原時間；collector不再呼叫、舊fence拒絕。 |
| XR-03 | D1已有attempt但journal較舊而缺row時，只能落unknown，不採集；identity不同時拒絕且不回報；較舊accepted控制面配較新journal時，缺dispatch權限必須阻止領取，不把未見attempt當作從未執行。 |
| XR-04 | 六種隔離案例、SQLite WAL online backup測試、完整回歸、故障偵測／獨立審查及Git交付。保留實際層次與尚未做的remote restore／failover；原服務不受影響。 |

## 邊界與還原順序

source與restore是獨立持久目錄／D1 binding。合成source只用測試身份，worker outbound拒絕外連，loopback proxy僅允許runner的claim/report。本機D1邏輯快照以schema與逐表rows重建新binding，**不是官方遠端export/import API**，也不是跨系統原子快照。先停止本案例的新request／子程序變更再完成D1快照；journal用SQLite online backup保留WAL內已提交資料。目的地完整還原驗證後，另記quarantine delta：撤銷submitter、runner僅runs:reconcile/runs:report、關閉schedule。這是合成隔離授權，不能拿備份中的舊grant復活真實權限。

只在隔離目的地引入驗證proxy；不綁網域、不啟動真Cron、不切換live client。舊lease自然到期後才嘗試reconcile，不用改時鐘／DB時間製造成功。source不接受restored runner回報；逐案核對source business與journal保持。原payload/identity/external_ref/digest為對帳依據，不能用新ID重送、清unknown或改結果為成功。

missing journal必須保守unknown；mismatch停止對帳；舊D1 accepted即使journal有結果也沒有自動補attempt／修復介面。本輪以禁止dispatch驗證隔離安全，不宣稱自動failover能處理任意不一致。正式切換仍需備份來源／fresh授權／owner執行者停寫或隔離／舊fence與in-flight請求對帳的具體方案。兩份都太舊而遺失同一execution時，不可能僅靠資料內容證明未執行。

原始snapshot／restore／journal／子程序log及failure都留在launcher evidence；不把它們放可清理cache。不新增自動清理、權限續租或付費方案。

Schema精確比較只排除sqlite自動物件及明示平台表_cf_KV、_cf_METADATA；後者由已安裝Miniflare D1實作建立。應用六表／四具名index完整比較，不讀取平台metadata內容，不用寬泛prefix隱藏其他表。

## 重現與結果

從repo根目錄使用既有shared launcher及已安裝toolchain；以實際位置設定LAUNCHER、CF_TOOLCHAIN及短的私有磁碟XR_WORKSPACE，避免workerd Unix socket路徑上限。每次用新的task ID，原證據不覆蓋：

```sh
python3 "$LAUNCHER" --root "$XR_WORKSPACE" run cloud-lab XR-new -- timeout --signal=TERM --kill-after=10s 180s node platform/cloud-lab/tools/qualify_restore.mjs "$CF_TOOLCHAIN"
```

最後可加一個具名情境作focused診斷；只有無filter跑完六案的summary才代表完整XR。完整應用回歸沿用`python3 platform/cloud-lab/tools/check.py`，透過launcher執行。結果與初次失敗／兩個mutation見[證據](evidence/m1-restore-qualification.md)；這不是原服務備份或切換命令。
