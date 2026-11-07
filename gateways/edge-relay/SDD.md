# Edge Relay — Software Design Document

- Status: **Draft / M0 spec-only**；2026-11-02。
- 路徑：`gateways/edge-relay`；分類：service；文件檔位未分級。
- 本次輸入：owner 直接要求，把 Alma Relay 的 CF 反向通道抽象為通用新項目，通知可換成 ntfy／Bark。
- Repo 基準：`244c7f7b416508aedd8f5f8d4a082ae2bb17d022`；上游參考與查核日期見 [來源](docs/sources-and-decisions.md)。
- 驗收權威：[SUCCESS.md](SUCCESS.md)。本文件描述計畫，不是已建成的能力。

## 1. 問題與核心抽象

端點位於 NAT、防火牆或動態網路後面時，業務程式不應各自重做路由、配對、取消、背壓及通知。抽出 **outbound rendezvous + authorized routing + multiplexed streams + local adapters**。

保留 Alma Relay 的「兩端向外連、relay 配對轉送、CF 分片」；不保留它的 Alma API、專用 hreq/wopen frame、連接碼推導、iOS App 假設或 APNs 金鑰模型。[S1]

**通用的是邊界，不是無協定。** endpoint 與 relay 仍需共用版本化 transport；HTTP/SSE/WS adapter 將既有服務映射到 transport。多端不是任意 IP 網路，也不代表建立全網 mesh。

## 2. 目標、非目標與授權

### 2.1 首個可用主線（M1–M3，尚未授權實作）

- 由不同網路上的 CLI／web client 經 CF，存取指定 endpoint 的已登錄本機 HTTP、SSE、WebSocket 服務；終端端無入站公開 port。
- 一個租戶多個 endpoint，endpoint 可兼任 client；每次 session 有單一 target，其他方向另開 session。
- 端到端識別與授權、撤銷、有限記憶體、多工公平性、取消與故障可觀測性。
- ntfy／Bark 可互換，獨立失敗，僅發送最小通知；真機驗收涵蓋 iOS 限制。
- 敏感業務資料啟用 E2EE；安全實作選型與獨立審查是可用版本的硬門檻。

### 2.2 本次交付

只做 M0 的架構、契約、安全模型、驗收、來源與任務／索引；不寫 Worker／connector runtime，不建立雲資源、不使用真推播金鑰、不合併或部署。

### 2.3 明確非目標

不是 VPN、TCP/UDP 通用代理、公開網站發布器、完整遠端桌面、Agent orchestrator、可靠工作佇列、檔案同步產品或 TURN server。首版不提供 SSH／shell adapter、不接受任意內網 URL、不做遠端喚醒。大量檔案、WebRTC 媒體、跨區 HA、第三方登入／計費、離線任務續跑另案處理。

## 3. 使用情境

| ID | 操作 | 成功觀察 | 失敗邊界 |
| --- | --- | --- | --- |
| U1 | 手機瀏覽器讀取電腦上 allowlist 的工作狀態 HTTP API | 經配對後收到完整 status/body | 電腦離線回 ENDPOINT_OFFLINE，不排隊 |
| U2 | CLI 訂閱本機程式的 SSE 進度 | 首個事件及後續事件逐段到達 | 斷線可由應用選擇 Last-Event-ID；relay 不保證補播 |
| U3 | 一個服務端與一個控制端做 WebSocket 互動 | 保留 text/binary 及 message 邊界 | 不暴露任意 port；重連建立新 session |
| U4 | 工作完成／待人審核，由 endpoint 發提醒 | ntfy 或 Bark App 顯示泛化通知，點開後重新授權讀詳情 | provider accepted 不等於手機已顯示；不包含批准指令 |
| U5 | 被撤銷的 client 或被替換的 connector 重送訊息 | 不能建立或延續未授權通道 | route_id 即使洩漏也不能存取服務 |

## 4. 分層架構

文字拓撲（箭頭表示資料方向，不表示入站連線）：

```text
Client SDK / browser adapter / another endpoint
    <--- outbound HTTPS/WSS --->
Worker ingress [auth, origin, limits]
    <--- bound internal request --->
EndpointDO [tenant_id + endpoint_id, session/epoch routing]
    <--- connector-initiated WSS --->
Endpoint Connector [local grants, allowlist, crypto, adapters]
    <--- loopback / Unix socket --->
Local HTTP / SSE / WebSocket application

Local application event -> local notification outbox
    -> ntfy | Bark | webhook adapter -> notification App
```

| 模組 | Port／contract | 責任 | 資料與信任 |
| --- | --- | --- | --- |
| RelayCore | RelayDriver、TransportFrame | session、stream、flow budget、routing epoch | 不解讀業務 payload；E2EE 時只有 metadata/ciphertext |
| CFDriver | Worker + EndpointDO | ingress、DO 分片、hibernation attachments、durable control state | CF 是基礎設施信任邊界；不是零第三方 |
| Connector | ServiceRegistry、LocalGrantStore | 主動連線、私鑰、服務授權、撤銷、local I/O | 最小權限程序，不以 root 執行 |
| Client SDK | Connection、Request、Stream | pairing、crypto、session、取消、使用者重新連線 | 不能以 route 知識代替身分 |
| ServiceAdapter | open(context, spec, duplex, abort) | 邊界正規化、HTTP/SSE/WS 映射 | 只存取固定設定的 service_id |
| NotificationPort | publish(NotificationIntent) | TTL、去重、重試、結果分類 | provider 金鑰與投遞狀態留 endpoint |
| NodeDriver（後續） | 同一 RelayDriver | 用 VPS 替換 CF runtime | 通過同一 conformance suite 才稱相容 |

`RelayDriver` 是生命週期／socket/storage/clock 介面，不讓上層依賴 DO 類別；無需抽象每一個 Web API。Node edition 延後，不為未授權工作建立假 stub。

## 5. CF 佈局與狀態分離

Worker 僅處理入口驗證、origin／size/rate limit 與轉送；路由權限在 EndpointDO 再驗一次。以 `tenant_id + endpoint_id` 建穩定 DO ID，一個 target 一個 DO；不把所有設備放進單一全球物件。

連線均由外端發起，由 DO 使用 Hibernation API 接受。休眠後記憶體會重建，不能把 session 正確性只放 Map。[S2/S3]

| 狀態 | 位置 | 存活／處理 |
| --- | --- | --- |
| device/grant、revocation version、epoch | endpoint 本機；DO 僅必要的控制投影 | durable；不存業務 body |
| socket role、session/stream routing key、expiry、counter | WebSocket attachment | 隨 socket 存活，可由 constructor 重建；總量須有硬上限 |
| 尚未完成的 HTTP response、暫存 chunk／credit waiter | 活動 request 的記憶體 | 不聲稱休眠可保留；重啟後失敗並由 client 重新授權 |
| 停用裝置／密鑰狀態 | 本機管理入口及 DO control state | 撤銷有持久化版本，不可休眠後復活 |
| push intent、retry schedule、dedupe | endpoint local SQLite outbox | 只影響通知；不在 relay 保存業務事件庫 |

閒置時不用持續 setInterval 或高頻 storage heartbeat；利用 protocol ping／固定 auto-response。活動串流、alarm、pending I/O 仍有 CPU／duration／message 成本，不能寫「永遠免費」。[S2–S4]

DO 儲存只承載控制 metadata；備份／刪除策略及 retention 要清楚。這與 Alma Relay 的特定不落盤實作不同，是本設計為 durable revocation/epoch 作的選擇。

## 6. 控制面、資料面與服務映射

完整 wire 與錯誤規則見 [protocol.md](docs/protocol.md)。API 是本項目的新契約，不相容 Alma。

控制面處理 enrollment、credentials、短效 WebSocket ticket、session authorization；資料面只承載有界 stream。所有 service_id 必須事先在 connector 的本機設定檔中存在，不從 client 取得 host/port。

```typescript
// 契約草案，不是可執行 SDK。
interface ServiceAdapter {
  open(ctx: AuthorizedContext, spec: OpenSpec,
       channel: BoundedDuplex, signal: AbortSignal): Promise<void>;
}
interface NotificationPort {
  publish(intent: NotificationIntent): Promise<PublishResult>;
}
```

HTTP adapter 允許 method/path/headers/body 的受限子集合；SSE 是 streamed HTTP，保留事件 bytes 並禁止合併成完整 body；WS adapter 保留訊息邊界及 text/binary。下游 application 的權限仍須保留，connector 不把 tunnel token 當作業務 token。

## 7. 安全與加密 profile

詳見 [security.md](docs/security.md)。區分三種東西：**routing identifier、relay admission credential、endpoint capability/grant**。知道第一種不能取得後兩種。

- `trusted-relay-lab`：逐跳 TLS；relay 能看明文，只允許已明示接受風險的合成資料驗證。不是 E2EE，不可取得全項目 usable tag。
- `e2ee-v1`：正式主線要求。client/endpoint 端上驗證配對身分，內層加密 service/path/body，relay 只路由外層；禁用明文 fallback。

D-01（加密實作／wire profile）是未解決的工程 gate，不是假設現成：在 M2 以既有、可維護且有測試向量的協定／library 做選型 spike，確認 browser/native/CLI interoperability、獨立 review、nonce/replay/rekey/恢復。**不能僅憑本 SDD 宣稱已有安全 E2EE。** 若選型不通過，主線保持 incomplete，不偷偷降低成 TLS-only。

配對用短效單次邀請＋endpoint 本機批准＋OOB 指紋確認；不是 URL 裡一個永久 bearer。細節、撤銷、信任 browser bundle 與最小權限見安全契約。

## 8. 故障與一致性

本項目提供連線與串流，不保證 business transaction exactly-once。relay 不自動重播有副作用請求。上游可能已提交但回覆遺失，結果為 UNKNOWN_OUTCOME；client 應查詢業務 request_id／idempotency key，由業務服務定義去重保存週期。

connector 重連增加 connection_epoch；舊 connector 被 fencing，舊 session/stream frames 不得路由到新 connector。session ID、stream ID、seq 的作用域要明確；任何新連線重新授權。

| 故障 | relay／connector 行為 | 業務責任 |
| --- | --- | --- |
| target 離線／睡眠 | 立即 ENDPOINT_OFFLINE；不代執行或落盤排隊 | 喚醒與 durable job 是外部系統 |
| client 中止 | CANCEL／AbortSignal；丟棄後到 chunks | 已完成副作用不能 rollback |
| connector 斷線 | 終止該 epoch 的 streams，回結果未知或中斷 | 決定是否重讀／人工重試 |
| DO 重建／部署 | 重建有效 socket routing；無法重建的 stream fail closed | 重開 session，不透明延續 mutation |
| consumer 慢 | per-stream credit；總記憶體受限；stall 超時 | UI 顯示取消而非無限等候 |
| ntfy/Bark 故障 | local outbox 有界重試／到期；不阻塞資料面 | 人工查看狀態 |
| 授權控制面不可用 | 不建立新 session；已知到期／撤銷照規則關閉 | 不降級成匿名存取 |

## 9. 通知作為可插拔旁路

詳見 [notifications.md](docs/notifications.md)。採 endpoint-side outbox：完成、失敗、待審核等是上層業務產生的 NotificationIntent，而不是 relay 讀取 payload 猜測。

ntfy／Bark 能替換「提醒使用者」；不能把我們的 App 變成有推播權限，也不能代替 WSS、喚醒睡眠電腦或保證喚醒任意 iOS App。自架 ntfy 的 iOS 即時通知仍有 upstream/APNs 依賴；Bark 則把通知交給 Bark App，依然走 APNs。[S5–S7]

## 10. 與既有 newclear 的邊界

以下僅依 repo catalog 做責任切分，未宣稱有可重用 runtime 或已完成整合。

| 元件 | 保留責任 | Edge Relay 僅提供 |
| --- | --- | --- |
| platform/cloud-lab | 工具／inventory 的整合入口 | 未來可消費的連線 substrate |
| platform/edge-ops | 監控與受控作業政策 | 受授權的串流傳輸，不取得執行權 |
| platform/signal-hub | 事件庫、規則、持久訂閱投遞 | 最小 notifier adapter；不複製事件中樞 |
| platform/agent-workforce | 任務／工作者協調 | 不理解任務的資料通道 |
| gateways/pokercase | LLM provider/protocol routing | 裝置與本機 service 路由，不代理模型帳號 |

同一私網已能直接連通時，可直接使用原服務，不強制繞 CF。只需發布標準 HTTP 網站時應先評估現成 tunnel；只有需要自己的 endpoint grants、opaque transport、多工及生命週期時，才承擔自製 relay 的成本。這是選型準則，不宣稱取代所有通道產品。

## 11. 里程碑與停止條件

| 里程碑 | 輸出 | 對應 AC | 狀態／門檻 |
| --- | --- | --- | --- |
| M0 | 本 SDD、分契約、來源、索引、驗收、Draft PR | AC-001–005 | 本次授權；文件驗證與 CI 才能判定 |
| M1 | CF + connector + SDK 的合成資料閉環、HTTP/SSE/WS、流控與撤銷 | AC-006–010 | 未授權；僅 trusted-relay-lab，不可用標記 |
| M2 | D-01 選型、固定 E2EE profile、browser 信任模型、互通及安全 review | AC-011 | 未授權；失敗不得放寬安全承諾 |
| M3 | ntfy/Bark 真機、真 CF 恢復與成本／操作證據 | AC-012–014 | 未授權；前項全過且必要審查、合併、owner release 授權後才能 usable tag |
| M4 | Node driver conformance、選配 WebRTC／大檔 adapter | 新里程碑另編 AC | 非原定主線，不因主線完成自動開始 |

Implementation order：freeze schema/test vectors → bounded codec/state machine → fake-driver deterministic tests → CF real networking → local allowlist adapters → E2EE profile → notification adapters → cross-network/device acceptance。M1 必須預留加密承載，不能讓業務依賴 relay 可讀明文。

## 12. 可衡量目標與未解決事項

所有數值是設計預算，不是 benchmark：個人規模 10 endpoints、每 endpoint 4 sessions／合計 32 streams；per-stream 未消費資料 256 KiB、每 endpoint application-owned buffer 16 MiB；詳細 limits 見協定。負載須含慢 client 與斷線，不只 echo happy path。

D-01 加密 library／profile；D-02 真 CF hibernation/reconstruction 邊界；D-03 ntfy/Bark 部署版本與 iOS 實測；D-04 browser session authority與簽名 bundle 的供應方式，均須在對應里程碑關閉。可用主線固定，不以「先有 demo」取代。來源過時、host API 限制改動需重新核對並用 ADR 更新；不把日期當安全保證。
