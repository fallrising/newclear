# 可插拔通知契約

上位：[SDD](../SDD.md)。範圍只有提醒；不實作背景遠端控制、工作排程或可靠人類回覆協定。

## N-01 Intent 與結果

```typescript
// 規格示意；不是已存在的 SDK。
type NotificationIntent = {
  event_id: string;             // immutable, source-generated
  kind: 'completed' | 'failed' | 'attention';
  recipient_ref: string;        // local configuration lookup, not an arbitrary URL
  created_at: string;           // UTC RFC3339
  expires_at: string;
  dedupe_key: string;
  correlation_ref: string;      // opaque, no secret, no identifying filename
};
type PublishResult =
  | { state: 'accepted'; provider_id?: string }
  | { state: 'retryable'; retry_after_ms?: number }
  | { state: 'rejected'; reason: string }
  | { state: 'expired' };
```

固定訊息預設為「有一項工作需要查看」，不包括聊天、prompt、終端輸出、檔名、主機名或批准連結 token。detail URL 僅允許本機設定的可信 origin＋opaque correlation_ref；它沒有執行能力，開啟後重新驗證權限。收到通知不等於讀取或同意。

NotificationPort 是本機業務提供者呼叫的介面；relay 不需解密、監看或理解業務結果。source 若要求與業務交易同成敗，應在自己的 transaction 寫 outbox；本工具不能替外部資料庫保證原子性。

## N-02 Provider adapters

| Provider | 映射 | 安全／能力差異 |
| --- | --- | --- |
| ntfy | 已設定 server/topic；POST + bearer；TTL／priority 映射受限 | 預設 ACL deny-all，topic name 不是完整 auth；依官方 iOS upstream 模式部署 |
| Bark | 已設定 HTTPS server；POST JSON，device key 留本機 provider config | 訊息由 Bark App 接收，仍走 APNs；不用 key-in-URL GET 作預設 |
| webhook | 預先登錄 destination＋認證，受限 payload | 不接受 intent 任意 URL；防 SSRF，不自動 redirect |
| disabled | 丟棄提醒並回本機可見狀態 | 不阻塞正常 tunnel |

ntfy 與 Bark 能替換提醒使用者這個責任，不是把任一官方 App 的 APNs bundle 身分拿來重用。ntfy iOS 自架即時推播會發 poll request 經上游／APNs，再由 App 取實際內容；必須評估手機能否到達自架 server。Bark 自架 server 仍需與已安裝 Bark App 的 APNs 配置匹配；不宣稱為任意自製 App 免費取得推播憑證。[S5–S7](sources-and-decisions.md)

`nfty` 在需求中按 ntfy 專案理解。Android、iOS、web 的背景限制分別驗收，不用 Android 成功代表 iOS 成功。

## N-03 有界 outbox

endpoint-side SQLite（未實作）唯一鍵 `(provider, recipient_ref, event_id)`；狀態 PENDING → SENDING → ACCEPTED／RETRY_WAIT／REJECTED／EXPIRED。SENDING 有 lease，重啟可重試；provider 已收但本機未存成功時可能重複，不能宣稱 exactly-once。

預設 TTL 1 小時、最多 5 次嘗試、backoff 5s/30s/120s/300s（加 jitter）；429 遵守 Retry-After 但不越過 TTL，5xx/timeout 可重試、401/403／非法 recipient 不重試並要求修設定。出站 HTTP timeout 10 秒。

上限 1,000 筆／5 MiB（較先到者）；超限拒絕新通知並寫不含 secret 的本機告警，不刪待審核事件來假裝成功。成功／失敗 metadata 最多保留 24 小時後清理；provider 自己的 cache／歷史另行設定，不受本程式保留策略保證。

可用 collapse/dedupe 只能作 provider-specific 最佳努力，不能抹去不同 event_id 的重要事件。AC 同時測「重試可能重複」與 UI 必須呈現實際 delivery state。

## N-04 隱私與可用性

provider 可看到最小通知與目的地 metadata，即使資料通道 E2EE 也一樣。可選 provider 原生加密不是自動繼承 tunnel E2EE；首版不依賴它來保護敏感摘要，直接不傳摘要。

通知 server 故障不阻塞 session；endpoint 睡眠無法發新通知。外部離線偵測須另有受控 coordinator，不能聲稱此 endpoint-side outbox 自己可即時報告斷電。

真機必驗：前景、鎖屏、網路切換、server 不可達、過期、重複、點擊後重新授權。accepted 只表示 provider 接受，沒有 provider receipt 時不得寫「已送達手機」。
