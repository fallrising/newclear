# 設計決策紀錄

狀態只有 Accepted／Proposed／Superseded。Accepted 只涵蓋其明示範圍，不等於授權開發或部署。

| ID | 狀態 | 決策 | 理由與影響 |
| --- | --- | --- | --- |
| ADR-001 | Accepted（owner 本次文件指示） | 新建 `systems/agent-secrets`，主規格置於 `docs/SDD.md`，本輪 docs-only | 保留上游概念並提供後續開發入口；不稱作已完成服務 |
| ADR-002 | Proposed | 分開兼容參考 Store 與受控 Credential Broker | 存得安全不等於用得有授權；原版 API／MCP 不能直接成為不可信 Agent 的安全邊界 |
| ADR-003 | Proposed | Agent 預設 use-without-reveal；raw export 為獨立管理端例外 | 模型只持有有界 grant handle，不持有長期憑證；仍須保護代理程序、輸出及下游服務 |
| ADR-004 | Proposed | M1 保留 Workers＋KV 參考；M2 授權與撤銷必須使用強一致權威 | KV 只作密文資料層，不能作一次性 grant 消耗／即時撤銷唯一依據；控制儲存選型待 M2 批准 |
| ADR-005 | Proposed | 可信本機 Broker 為第一個 Agent 整合方向，不重建 Agent 平台 | 控制 adapter、身份綁定與憑證邊界；既有平台僅是未來消費端，沒有本輪整合承諾 |
| ADR-006 | Proposed | 明確分開 server-decrypt 與 local-first P0 profile | 原版 Worker 處理明文；P0 必須在本機完成加解密、遠端不獲得解密材料；本輪不宣稱支援 P0 |
| ADR-007 | Proposed | 使用符合固定 MCP 規格的 SDK／transport，不原樣複製上游 framing | 來源橋使用 Content-Length framing；需以 newline-delimited stdio 互通測試驗證新橋 |

## 開發前必須定案

M1：授權／第三方程式重用方式、runtime 版本與 lockfile、路徑正規化、管理端入口驗證、錯誤碼兼容範圍。

M2：第一個固定 connector/action、可信 principal 來源、人工核准通道、控制儲存與序列化邊界、稽核保留期、P0 是否另開里程碑。未定案前不能啟用真實憑證或宣稱 Agent 存取可用。

改變公開介面或密文格式時新增 ADR／規格版本，不覆寫既有資料格式的解釋。詳見 [SDD](SDD.md) 與 [來源](SOURCES.md)。
