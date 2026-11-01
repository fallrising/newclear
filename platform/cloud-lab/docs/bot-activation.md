# Bounded bot activation preparation — BA01–04

Owner繼續首個有界啟用方案準備。使用已合併BR/BP候選接回獨立工具host，先核對原資源與期限、保存候選／私人proposal及切換／補償計畫。本輪不啟用、不初始化原bot政策、不改Grok／Cloudflare／授權，不呼叫模型或新增付費。

| AC | 驗收 |
| --- | --- |
| BA-01 | 固定已合併MCP／bridge／private transport／runner候選及hash；核對原client entry、bot／runner config與原durable state，不移除原requests |
| BA-02 | fresh管理部署／settings／D1／Access／Cron與bot／runner self、實際resident觀測；過期與未知分開，確認既有上限及active／schedule狀態 |
| BA-03 | 產生不可執行的私人24h proposal、用量上限、原state綁定與候選協議檢查；不以tools/list當有效授權或提交成功 |
| BA-04 | 具體啟用／停止／補償與再觀測gate、私人回執／公開去敏證據、獨立審查及Git交付；續權另行批准 |

## 提議範圍

首次政策最多24小時，24新ID／240call，call間隔至少5秒、新ID至少60秒。T0為實際寫入前fresh核對後固定的時間；bot HMAC及原bot grant截止E=min(T0+24h, fresh原runner實際stop、runner HMAC/grant及Access最早截止減120秒)。若不足10分鐘則不開始。原runner、Access、human、scheduler期限完全不延長；不開Cron、不改scope、ID、generation或secret、不新增付費。

本機policy的not_before=T0、expires_at=E，authority_until取實際回讀的bot HMAC／grant／runner／Access最早上限。首次初始化須證明原state尚無政策；若已有政策或來源漂移就停止，不能再次初始化、換state或刪DB。原requests／ACK完整保留。

成功後保留Grok具名MCP entry指向固定新版source、原config／state及新policy，顯式allow-submit，供operator使用至E；不增加permissions／autoapprove。這是按需工具端，無自動輪詢／提交／續租／模型呼叫。工具catalog發現不代表模型自然語言已驗收。

240call最多480次本入口HTTP請求，不包含既有runner／其他流量／D1列讀寫；不是帳號帳單保證。實際啟用驗證最多一個新的durable ID、一次check及最多18次status（5秒間隔／90秒），都計入首期額度；不因timeout換ID或自動重送POST。

## 已固定候選與來源

Candidate固定BR feature `f09bfe659dad9c86f25d6fbdae8c600e83924d2d`，四份Git blob：mcp_stdio.py、bot_bridge.py、live_probe.py、node-health/runner.py。私人manifest逐檔SHA256核對，source為main祖先。準備了未安裝的具名Grok entry：command／args指向候選及原config／state，加入policy與allow-submit；其他TOML語義、permissions及10秒startup／20秒tool timeout保留。政策檔仍不存在，不能把proposal直接當runtime policy。

原bot grant既有五項capabilities：commands:read、commands:submit、commands:cancel-request、artifact:read、node:health:read。與原AL契約一致，這次只續expires_at，不增減scope；MCP只暴露health.check／health.status兩個固定操作。直接使用原憑證的API範圍與本機MCP工具範圍不同，不能把本機限制當作帳號／同OS使用者的安全隔離。

私人proposal標示approval_required=true、applied=false、activation_ready=false、T0=null，保存source／config／原state與client digest、grant前態revision／policy digest、原caller／target、相對窗口及補償順序。原client備份、SQLite一致備份、前後管理回執保留；不公開私人IDs或憑證。觀測資料會過時，套用前必須重新採集，不能因已核對而跳過下一輪漂移檢查。

## 批准後啟用順序

1. fresh核對原active版本與保存MACHINE_KEYS候選版本、settings、D1四角色／commands／schedules／firings、Access enabled及client綁定；runner self／resident、原unit／service上限與journal仍可驗證。要求active0、schedule off、runner journal無started／unknown，原bot state／config／Grok entry與proposal一致；任何漂移先停止對帳，不覆蓋其他修改。
2. 重新計算唯一T0／E並保存intent與原值；E不能晚於外層期限減120秒、也不能大於T0+24h。不因失敗或重試刷新T0。需確認保留Free、不新增付費；不再重試已知不支援的Billing OAuth端點。
3. 原bot grant仍過期時，更新原MACHINE_KEYS的bot expires_at=E，其他角色／secret／generation逐欄相等。Secret更新可能產生新Worker version；回讀原script／runtime／bindings／settings保持，不上傳assets或改HL排程。若active版本不再對應保存候選，停止，不能用舊整份秘密覆蓋。
4. 使用原grant revision／policy／revoked／active0／schedule off的CAS，只改bot expires_at及revision+1，affected rows恰為1；回讀其他roles及原資料保持。以實際bot self核對HMAC／grant到期均為E，不能拿本輪舊候選或管理metadata代替成功驗證。
5. 從實際期限生成owner-only runtime policy，綁完整原config digest。取得原state FLOCK後依BP一次初始化，保留原request／payload／ACK。若初始化結果未知，先唯讀查帳本digest／rows，不重跑初始化或刪state。
6. 以原client digest／entry CAS換成已核對候選；保留其他entry／permissions／timeouts，不新增autoapprove。若別人修改整份config，先對帳或重新構造只改本entry的候選，不覆蓋整份舊備份。Native doctor須發現2tools；已有Grok session需reload／新session，但不呼叫模型。
7. 使用從實際登記argv讀出的MCP，一個持久ID提交一次；由原runner完成，在90秒總deadline及18次status上限內取fresh validated。每個call也受剩餘總deadline限制，逾時停止並保留ID；unknown／denied／stale都不能算passed。最後核對原requests保留＋最多一個新ID、D1一筆對應command、runner結果、quota計數及其他資源未變。
8. 成功後保留Grok新entry供日用至E；到期是拒絕新bridge呼叫，不保證idle MCP程序自行退出，也不保證Grok在整段窗口常駐。日後只能按BR顯式續租並重新核對實際雲端期限，沒有自動續權。

## 停止、異常與補償

批准範圍包含下列bot-only補償。先停止具名MCP新提交；若client entry仍匹配本次安裝候選，以CAS還原原status-only entry或停用具名server，保留其他設定。若entry已被別人改動，不盲覆蓋，保留差異待處理。任何timeout先保存請求／回覆、查實際狀態，不重放mutation、不換ID重提交。

若grant已續期但本機／驗證失敗，重新讀取當前grant與工作狀態；僅在仍匹配本次scope／revision且無在途工作時，用新CAS恢復原過期期限（revision再增加）或撤銷原bot grant，其他角色不動。若有在途／unknown或併發授權改動，先停本機新提交並對帳，不立即覆寫。

若僅bot HMAC延長、grant仍過期，原grant仍拒絕；可保留該已隔離狀態至E並記錄，或在active版本及所有原值仍可證明一致時恢復原bot HMAC期限。不能為回退盲目覆寫共享MACHINE_KEYS／部署舊版本；Access及runner絕不因bot失敗而停用或延期。

原requests、已初始化policy、quota及歷史一律保留，不能回復初始化前DB或刪政策來重置額度。若要重試，只能在原intent／T0／E範圍內對帳後恢復；過期後另做BR及新的授權決定。這份方案不批准無限重試或重新起算24小時。
