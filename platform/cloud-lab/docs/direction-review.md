# 2026-11-01：方向審查與近期計畫

Owner指定 **Claude Opus 5.5** 審查原始需求、計畫與成果，結論為 **REPLAN**。主導採納「方向失衡，需要回到整合與日常可用性」，保留已完成的安全性質，不再以更多node-health驗證作為下一步。

[Opus原文](../../../.team/reports/T-865-opus.md)／[執行與主導驗收](../../../.team/reports/T-865.md)。這是產品方向審查，不是新的live驗收。

## 審查如何進行

- 實際CLI2.1.307，指定及事件回讀均為`claude-opus-5-5`、high effort；一次呼叫、一次model turn，124.48秒正常完成。
- 只提供原始owner需求、限制、18份編號公開來源、檔案清單與任務標題。來源為本機merge HEAD（原文8affee1），其完整tree等同當時main `882ccb000fdae8654bec636b70816d12699fc49c`。model tools與MCP均為空；safe-mode關閉自訂hooks等，沒有檔案操作、網路工具、測試或子代理。這是CLI工具限制，不宣稱整個程序OS唯讀。
- 原始事件／prompt／完整結果保存在受保護evidence；實際模型與exit、無tool_use／permission denial已核對。CLI回報list-price估值USD0.8600896，不是訂閱實際新增帳單；沒有調整付款方案。
- packet含未存在的`adapters/bot/README.md`候選，已明列缺檔；實際工具在`tools/bot_bridge.py`，不是產品檔案遺失。未提供完整sources.md，不能由此審查宣稱GitHub盤點100%覆蓋。主導另讀來源表與Edge Ops成功契約核對。

## 採納的發現

| 發現 | 主導核對與處置 |
| --- | --- |
| 原始需求的「既有CF工具歸位／去重」沒有落地 | [遷移表](migration.md)仍是候選；38個既有任務節點後仍只有node-health。將來源盤點與重複判定移回近期工作，停止把所有整合往M3推。 |
| 早期vertical slice合理，但後續投入失衡 | 已有API／Cron／runner／看板／bot閉環和恢復能力；保留成果與測試，暫停繼續擴張授權工具層、故障演練、Event/seq或provider API接線。 |
| 短期驗證窗口不等於日常工具 | human／bot已到期，resident最後政策截至2026-11-05T07:24:25Z；列明當前可用性與下一次批准需求，避免把「曾部署」寫成「現在可用」。不自動續權。 |
| 單一固定recipe尚未證明框架可擴充 | [protocol](../apps/control/worker/protocol.mjs)／[control](../apps/control/worker/index.mjs)寫死recipe、單槽與health artifact。以第二種實際唯讀能力驗證必要共用邊界，先有使用者再抽象。 |
| 入口文件過時、重複changelog淹沒現況 | README／SUCCESS已改為當前摘要，歷史移到[單一歷史頁](milestone-history.md)；知識樹改為具名live子集且標明期限。歷史證據不刪除或冒充重跑。 |
| AC-06混入Grok模型對話門檻 | owner已選獨立工具端；原AC只是API／排程→runner→結果／看板。現列historical閉環證據，模型對話另列未驗，不再阻擋該技術閉環，也不把全平台升成complete。 |

## 不照單全收的部分

- 「11-05全面失效」過度概括：截止的是受限runner／schedule政策；Worker、D1及歷史不會因此消失，human／bot也不是同一到期時間。本次未新查live存活。
- Edge Ops與node-health有重疊，但Edge Ops還有不同的註冊、歷史與後續運維責任；不能未比較行為／caller就宣稱完全取代或封存。
- 原文免費額度與每日請求估算明示來自模型記憶，不當作已核實用量或帳單；nonce、掃描、分頁和其他流量也會影響成本。不因此新開provider API里程碑。
- 10000列上限會拒絕／skip新工作，但應用用量與firing已有可見狀態，不能一概稱「靜默停止」。8000列提醒是可選小改進，不先引入tombstone系統。
- 不新增固定7天／24小時等待、Console hash或手機驗收。15分鐘排程也不保證30秒freshness一直為fresh；保持原觀測時間與stale誠實可見，不以放寬健康門檻造綠燈。
- 不採用「超過150行就失敗」當產品品質門檻；以明確變更邊界、必要測試及實際兩種能力能否共用入口判斷。
- Opus的減少文件／review建議是方向建議，沒有修改根或元件AGENTS.md。現有必要審查／Git規則繼續遵守；本輪把證據與處置集中於本頁／team報告，不再複製長篇成果到每個入口。

## 接下來三個有界工作

### A：現況收斂與日常使用方案

本輪完成文件收斂、歷史／當前可用性區分及原始需求對照。下一份日常使用提案只需一張表：reader／bot／runner／scheduler的scope、期限、限額、撤銷方式與操作入口；由owner一次批准具體變更後執行，不自動續權。

停止條件：owner能從一頁看懂現在能用什麼、何時到期、怎麼恢復；實際變更只做一次相符功能檢查和權限讀回。日常使用觀察可以自然累積，不要求人在固定驗證窗口待命，不增加七天人工測試gate。沒有批准的授權變更保持未執行，並不阻塞B的唯讀盤點。

### B：既有CF工具目錄與重複判定

2026-11-01盤點結果與下一項選擇見[CF工具目錄](tool-catalog.md)；保留以下原停止條件。

重新用GitHub／現有來源盤點CF相關repo，逐列記用途、程式位置、API／Cron、部署證據、原owner、建議處置與缺口。私人部署資料只進私人目錄；公開知識樹保留通用角色。處置可選keep-in-place、reference、adapter、move-candidate、retire-candidate，候選不是已遷移／封存。

先比較Edge Ops與node-health的實際行為、不可替代部分與維護成本，產出一個可批准的具體決定。暫不寫第二套inventory同步器，不為湊數搬程式。

停止條件：記錄盤點範圍、完整分頁與無權限／未知項，不能只憑關鍵字搜尋聲稱100%；至少一個重疊來源得到具體保留／整合／退役建議。至多一個遷移候選，破壞性封存仍需具體批准。目錄能回答「現有什麼、去哪裡用、還缺什麼」。

### C：接入第二種有用的唯讀能力

從B選已有穩定介面的能力：例如已登記CF服務的狀態，或既有agent平台的run狀態。依實際消費者決定reference／adapter／recipe；不接管外部run生命周期，也不要求先完成通用plugin框架。

停止條件：兩種能力可從同一入口找到／查詢，具來源、時間與錯誤狀態；有界API／排程只接已登記目標，不接受任意URL或shell。必要變更測試與一個真實閉環通過後停止，不追加任意長度觀測窗口。新權限／live寫入先給具體變更方案，不新增付費。

## 暫緩與保留

暫緩provider用量API、更多授權生命週期層、active failover、Event/seq、Queues/Workflows、模板生成與自動歸檔。它們不是永不做；須由新的真實需求或實際容量問題重新排序。

保留Access／HMAC／scoped grants、未知不重播、單一writer、journal、已有備份／還原流程與測試。沒有新增週期備份排程、刪除備份、續權、封存專案或修改任何live服務。整個Cloud Lab主線仍未完成。
