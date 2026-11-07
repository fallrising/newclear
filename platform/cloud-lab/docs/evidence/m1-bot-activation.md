# BA01–04 — Bot有界啟用準備證據

本輪完成候選／proposal準備及原Lab唯讀核對，未啟用、續權或提交命令。具體窗口／步驟／補償見[啟用方案](../bot-activation.md)。

| AC | 證據 |
| --- | --- |
| BA-01 | 固定BR commit四份Git blob與hash、main祖先；原installed manifest保持；原Grok設定逐byte未改，bot原state一致備份與1筆已ACK request保留，尚無policy |
| BA-02 | 兩輪原部署／settings／D1／Access／Cron共10次metadata讀取，加active version讀取1次；原業務／角色／設定相等；實際runner self／resident可驗證，bot self exit1及過期grant明示 |
| BA-03 | 私人不可執行proposal、未安裝TOML候選、原config／state／client綁定；實際候選stdio initialize／2tools／ping成功，零tools/call；原native doctor仍1tool |
| BA-04 | <=24h／24新ID／240call、外層截止減120秒、單一T0及bot-only補償完整記錄；private回執、公開去敏審查與Git交付 |

## 原Lab觀測

2026-10-29T17:36:12Z觀測：bot grant revision3、到期16:59:16Z；bot自身授權查詢exit1，沒有把失敗當passed。保存的bot HMAC候選亦為16:59:16Z，且目前active deployment與該候選的BL版本一致；這是候選／版本關聯，**不是fresh成功的bot self metadata**。

實際runner self與resident通過，runner HMAC／grant截止2026-11-05T07:34:26Z、實際stop為07:24:25Z（配置07:24:26Z）。Access enabled、到期07:43:27Z。因此本輪觀測的外層保守上限減120秒為 **2026-11-05T07:22:25Z**；首期仍最多自實際T0起24h，以套用前fresh資料重算，不用此快照直接續權。

D1保持4個grant、4筆command（active0）、1個disabled schedule、0個firing；原bot state1筆已ACK request、runner journal3筆completed。前後兩輪管理回讀的grants／commands／schedules／firings／部署／settings／Cron相等；Access只允許last_seen_at因正常使用變動，其餘metadata一致。讀取self可能產生既有nonce等使用量，不宣稱絕對零資料副作用。

## 候選與本機驗證

固定source `f09bfe659dad9c86f25d6fbdae8c600e83924d2d`包含已驗收BR/BP功能。四份候選均從Git blob取出，未安裝或取代原runtime。真正執行候選stdio，initialize回2025-11-25，tools/list回check與status，ping成功；**沒有任何tools/call**。候選的policy路徑不存在，協議發現不證明授權、policy初始化或健康檢查可執行。

原Grok native doctor仍發現1個status工具。未安裝TOML候選僅改具名entry的command／args，其他設定語義一致；實際原client逐byte保持。原SQLite在FLOCK下唯讀採集並一致備份，原檔SHA256前後相同；saved profile／payload digest／scope與原config相符。

首次proposal builder錯把MCP使用的3項capability當成原grant完整scope，assert失敗。查原AL契約及fresh grant，確認既有5項另含cancel-request／artifact:read；修正為完整原scope比對，沒有增減任何權限。首次script／已產生但未安裝的TOML候選保留；v2逐byte核對既有候選後才完成proposal，未重做或覆蓋live操作。

## 交付邊界

Private proposal標示approval_required=true、applied=false、activation_ready=false、T0=null；runtime policy不存在，原state未初始化、client未切換。每期驗證最多1新ID／1check／18status，計入24新ID／240call，不呼叫Grok模型。首次成功後提議保留具名entry供按需使用至E；這項新bot期限仍待owner明確批准。

本輪沒有產品runtime變更，前輪336tests不冒稱本輪本機重跑。實際執行11次管理唯讀、runner/bot self、kernel resident、native doctor、候選stdio／TOML／config-state及前後保全檢查；bot self失敗保留。私人launcher證據為BA-preparation、BA-proposal（失敗）、BA-proposal-v2及原始metadata回執。Python3.11、實際新政策啟用、自然語言模型流程／帳單及完整主線仍未驗；HL provider資產session500另保持open，無usabletag。

[T844獨立審查](../../../../.team/reports/T-844.md)ACCEPT準備文件與去敏回執一致性；未讀私人原件或重跑live檢查。主導已驗私人原件、source/config/state／client及前後metadata；evidence gate只接受BA準備，不接受實際啟用。文件／task／report／diff檢查與Git結果於交付前驗證，任務板記錄遠端回讀。
