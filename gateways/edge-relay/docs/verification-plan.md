# 驗證與運維計畫

權威：[SUCCESS](../SUCCESS.md)。以下分清 M0 文件檢查與尚未執行的 runtime 驗收；不存在產品啟動命令。

## M0 文件驗證

- `python3 scripts/check_project_success.py --projects gateways/edge-relay`：frontmatter、必要章節、Given/When/Then、導航。
- `python3 scripts/check_indexes.py`：完整 checkout 的 repo inventory/index/llms 驗證；CI 必須以候選 SHA 回讀結果。
- 全部新 Markdown 的本地連結存在、code fences 成對、AC ID 唯一且任務／證據可追蹤；確認沒有部署檔、runtime binary 或假 PASS。
- 新索引沿用既有 renderer 的格式，不修改其他產品狀態；完整 clone 不可得時要在 PR 說明使用 GitHub app，依 CI 做全庫驗證。

## Runtime conformance matrix（全部 NOT RUN）

| AC | 情境與輸入 | 觀察及失敗注入 | 真實驗證門檻 |
| --- | --- | --- | --- |
| AC-006 | 兩個 NAT 網路、1 connector、1 client | 無入站 port 仍可 GET status；睡眠後 ENDPOINT_OFFLINE | 真 CF + 兩個不同網路，不是同機 echo |
| AC-007 | HTTP body、10 個 SSE event、text/binary WS | headers/status、event 到達順序／時序、訊息邊界；中途 cancel | 真本機 HTTP/SSE/WS services，三 adapter 各有 evidence |
| AC-008 | 兩 tenant／兩 client、撤銷／過期／route 洩漏 | 不越權、不跨租戶、撤銷即拒絕端上 OPEN；DO 重建仍拒絕 | grant/store/version 和已開 stream 終止皆覆蓋 |
| AC-009 | 32 streams，其中 1 慢讀；超額 frame／credit | budget 內、其他 streams 可前進；stall 與過量被中止 | 測 application-owned buffer 與 process/runtime memory；記錄差異 |
| AC-010 | connector 在 side effect 後、response 前斷線 | UNKNOWN_OUTCOME；不自動重播；新 epoch 排除舊訊息 | service counter 不因 relay 重連加一；人工重試由業務判定 |
| AC-011 | 惡意 relay：換 key、重播、改 ciphertext、明文 OPEN | 都不能導致 local service side effect；browser bundle 信任另外測 | 固定 crypto profile/library/test vectors + 獨立 security review |
| AC-012 | ntfy 與 Bark 真 self-hosted server＋手機 | completed/attention、鎖屏、點擊重驗權、失敗 retry/TTL | 兩 provider 都要實測；accepted 與 displayed 分列，不用 mock 代替 |
| AC-013 | 閒置、DO hibernation、deploy、restart、節流 | routing 能重建；活動 stream 不可恢復時明確失敗；舊授權不復活 | 真 CF 紀錄，不以 local emulator 聲稱有生產休眠語義 |
| AC-014 | 乾淨環境、撤銷 key、版本 rollback、關停 | 按 runbook 可操作，沒被允許的 service 保持關閉；費用／資料去向可說明 | 啟動／關停／復原 evidence 與 limit dashboard，無自動升級費用 |

測試分層：schema/codec unit → deterministic state machine/fault tests → CF/connector integration → cross-network acceptance。假的 timer、provider、driver 可驗契約，但不是 runtime acceptance 證據。

## 安全與負向測試集

未授權 enrollment、未知 route enumeration、跨 tenant/epoch/session frame、ticket 重用、過期 grant、取消後 late frame、重複 END、window overflow、unknown version、WS fragment bomb、HTTP encoded traversal/redirect/credential forwarding、非法 notification destination、provider timeout/429/401、outbox crash-after-send。每個 seed／fixture 固定且不含真秘密。

## 預定運維 runbook（未建置／未執行）

1. 實作前固定 Node/TypeScript/Wrangler／crypto library 版本與 lockfile，查看根 CI 觸發與官方限額。不得用本 SDD 的日期替代版本鎖定。
2. 經另行部署授權才建 CF Worker、SQLite-backed DO namespace、secrets、domain；不預設需要 D1/R2/Queues，避免為抽象而擴張依賴。
3. 本機 connector 設 service allowlist、權限隔離與 admission；只用合成服務開始，完成安全 gate 才接敏感服務。
4. ntfy/Bark 分開部署與 provision；topic/device key 不入 repo。單獨測手機可達性及 iOS notification path。
5. 觀察 session/streams、buffer bytes、限流／cancel／reconnect、DO requests/duration/storage、通知 retry/expire；不收集 payload。
6. 先對部署設定 CPU／request／byte/session caps，達到設定用量閾值時停新連線；預算告警不等於 hard spending cap，持續監控且不自動付費升級。
7. 升級先發 GOAWAY，不接新 stream，5 秒 drain 後終止；rollback 使用相容 schema/code，控制狀態 migration 須可逆且先備份必要 metadata，不覆寫 opaque 業務資料。
8. 災難恢復：重新啟動服務、重新授權，不恢復已失去的 in-flight mutation；device private key 遺失要重新配對。全域關停先撤銷入口再關 connector/outbox；刪 CF 資源另需 owner 批准。

## 性能／成本實驗

個人規模目標 10 endpoints、每 endpoint 4 sessions／32 streams；這是配置上限不是容量證明。記錄 idle、active、slow-consumer 三組 CPU/duration/message/storage 指標。成本公式以當時官方價格帶入 `Worker requests + DO requests + DO active duration + control storage + notification hosting`；不在本案承諾固定零成本或 SLA。

原生 WS frame／auto-response heartbeat 可減少 idle 喚醒，但頻繁訊息、活動 HTTP stream 與其他 pending I/O 會增加成本。[S2–S4](sources-and-decisions.md)
