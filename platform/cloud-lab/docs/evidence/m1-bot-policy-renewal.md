# BR01–04 — 顯式 bot 政策續租本機證據

本輪source／local，實作[續租契約](../bot-policy-renewal.md)。沒有修改live安裝、Grok設定、Cloudflare、授權或付費；原HL provider資產session500任務保持open。這不是常態bot已啟用或模型對話驗收。

| AC | 證據 |
| --- | --- |
| BR-01 | 舊／新config-bound private policy、nonoverlap／硬上限、preview保留全部既有table rows且不送HTTP；trusted CLI組合及MCP參數邊界 |
| BR-02 | 舊期到期後才CAS切換；receipt及活動quota切換同transaction；requests原bytes／ACK保留，trigger故障回滾舊budget／reservations |
| BR-03 | 同候選重跑already_applied不補額度；二次續租保留歷史並拒絕舊指令；FLOCK、跨期間隔／high_water、ACK遺失同ID與bootstrap失敗新期占額度 |
| BR-04 | 真實local HTTP／Python CLI及MCP跨期閉環、全套回歸、獨立T843審查及文件／Git gates |

## RGR與失敗紀錄

BR-red：14個tests因未實作renew_policy失敗（16error含subcase）。首次BR-green剩一個重播錯誤：archive中的SQLite REAL時間被既有strict JSON的整數規則拒絕；改以float.hex文字精確保存，未放寬共用JSON解析。BR-green-v2的14tests通過。首次完整BR-full為334tests（64Node270Python）全過。

T843初審REWORK指出非dry-run的already_applied仍須保存觀測時間。BR-replay-clock-red重現「B期已到期時重跑A→B成功，隨後時鐘倒退回B窗口又可准入」。修正為已驗證receipt後保存最大觀測時間；不改calls、reservations、requests或receipt。新增dry-run重播仍不寫入的測試，舊snapshot驗證改成僅high_water可單調前進。

## 實際程序／HTTP驗證

Synthetic local Lab搭配真實Python CLI、MCP subprocess、SQLite及collector，固定8秒舊期／下一期、每期call上限1：初始化與preview不增server nonce；首次POST accepted但ACK延遲被MCP timeout清理；提前續租拒絕；原runner完成工作；實際等待到期後兩個並行續租指令僅一個renewed，另一個already_applied或STATE_BUSY。舊policy的MCP拒絕context mismatch，新policy以原ID重送完全相同payload並取得validated／同command_id。

再重跑原續租指令回already_applied，隨後status仍因新期call額度耗盡拒絕且nonce不增。最後只有一筆command／原body，活動calls1、reservations0、續租歷史1。使用既有fixture僅遮蔽外層Git標記及延遲ACK，未放寬授權、時鐘或政策。

最終BR-final **336tests通過（64Node／272Python），零fail／skip**；T843 focused複審ACCEPT，初審replay時間缺口已關閉。主導檢查全部scoped diff與原始log；文件／task／report／diff檢查及遠端CI／merge回讀為交付gate，結果由任務板補記。獨立審查只讀source與提供的log，未另跑測試或驗live。

## 邊界與後續

原始log保存在既有launcher的BR-red、BR-green、BR-green-v2、BR-full、BR-replay-clock-red、BR-final證據目錄。首輪完整suite有一個非失敗SQLite ResourceWarning（GC時出現在既有service測試），Node既有SQLite experimental warning亦保留；不隱藏warning或改判失敗。Linux、本機Python3.13／Node24；Python3.11未本機執行。

authority_until仍由operator fresh觀測提供，離線工具不驗遠端憑證。preview可過時；執行時重新驗證前態。既有同使用者／整份state回滾防竄改限制不變。receipt為新本機表，不是D1 migration；舊request資料不刪。live候選安裝、原bot有界續權與host切換另行驗收；沒有模型呼叫、usable tag或完整主線完成宣稱。
