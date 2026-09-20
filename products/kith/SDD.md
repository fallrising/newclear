# kith — Software Design Document

- Version: 0.1.0
- Date: 2026-09-20
- Status: proposed implementation baseline; documentation only
- Repository: `fallrising/newclear`
- Component: `products/kith`
- Language: 繁體中文，保留必要英文術語

## 1. 目的與設計立場

從零建立一個單 operator、自托管的群聊產品：人類與 LLM agent 是同一房間裡的一等成員。成果不只是「能把模型輸出貼進 Webhook」，而是能回答：誰是成員、哪一則訊息擁有穩定 `seq`、何時可以喚醒訂閱配額、generation 失敗後鎖如何釋放、以及 replay 事件為什麼不能當工作佇列。

本規格把已批准的 [DESIGN.md](DESIGN.md) 收成可實作契約：Given/When/Then、FR、INV、DDL、協定錯誤、attention 演算法與 milestone gates。不是 EdgeChat 的 fork，不是 fanzloud 的聊天室外殼，也不是 pokercase 的 Layer A 擴充。來源與邊界完整列於 [00](docs/sdd/00-purpose.md) 與 [08](docs/sdd/08-decisions-sources.md)。

對外產品名：**Kith**。目錄與程式 id 為 `kith`。

## 2. 使用者故事與成功標準

完整 Given/When/Then 見 [01](docs/sdd/01-user-stories.md)。此處列出可驗證成功條件。

| ID | 使用者故事 | 可驗證成功條件 |
| --- | --- | --- |
| US-01 | 作為 operator，我建立一個私有房間並用瀏覽器說話，另一個人類即時看到同一 seq 的訊息 | 兩 session 收到同一 `id/seq`；重啟後 D1 仍可讀（M1-US-01） |
| US-02 | 作為 operator，我建立 `kind=agent` 成員並簽發 scoped bot token；token 可列出、撤銷；撤銷後立即 401 | 明文只顯示一次；SHA-256 入庫；撤銷後 MCP/HTTP 401 |
| US-03 | 作為 Codex/Claude Code/Grok CLI，我用 MCP 列出房間、讀歷史、送訊息、以 `post_status` 回報；sidecar 另以 GET `/mcp/events` 收推播 | 四個互動 tool 單一 request 結束；無 `subscribe_events`；events splice 見 EV-01 |
| US-04 | 作為房間內人類，我 `@grok ...`；`quota_class=api_key` 時 hosted agent 在 cooldown 後回覆並帶同一 `generation_id`。`operator_personal` 時非 operator 的 mention 不喚醒 | fake LLM 回覆綁定 generation；非 operator → `subscription_operator_only` |
| US-05 | 作為 **operator**，我 `@codex` 修一個本機問題；sidecar 以 ephemeral status / durable trace 回報，完成後在 thread 摘要。其他人類的 `@codex` 在 `quota_class=operator_personal` 時不消耗訂閱 | fake CLI 恰好對 live mention 啟動一次（EV-02）；SEC-013 非 operator 不 exec |
| US-06 | 作為 operator，我把某 agent 設為 ambient；它只在分類器通過且無人搶話時發言一次；agent 不會被自己或其他 agent 的非 @ 訊息喚醒 | `notify()` 不跑 heuristic；CAS + `releaseAmbient` finally；self-wake / cross-agent 非 mention drop |

核心版完成定義為 M0–M6 全部 `VERIFIED`（M7 觀測／GC／可選加密不阻擋核心）。本次文件提交不是任何功能 milestone 的完成證明。

## 3. 範圍與非目標

### 核心版 v0.1

Cloudflare Workers Paid + Hono + Durable Objects + D1 + KV + R2；React + Vite 前端；operator 主機上的官方 Codex sidecar。邀請制私有房間；人類 bootstrap + `POST /api/rooms/:id/members`；agent 為 `kind=agent` 一等成員；單一 Room DO 匯流排；MCP 2025-03-26 四個互動 tool + `GET /mcp/events`；hosted Grok 直連 `https://api.x.ai/v1` 且 `quota_class=api_key`；Codex sidecar 獨立 `CODEX_HOME`；attention `silent \| mention \| keyword \| ambient`（ambient 最後）。

單實例恰好一個 `operator_member_id`。每房成員總數 ≤ 32。無公開註冊。

### 刻意不做

Fork 或 copy EdgeChat；非官方 ChatGPT/Grok 網頁 scraping；多租戶 SaaS、公開註冊；pooling 個人 subscription；與 fanzloud 共用 `CODEX_HOME`／workspace／executable；把 kith 做成 agent-to-agent 排程器或第二套 grok-team-delivery；Telegram / 跨 instance 橋；E2EE 當賣點；在 Workers 上跑 Codex/shell/git；擴充 fanzloud 或 pokercase 原始碼承載房間；復活 `labs/bee-swarm`；核心版 Workers 連 thinrouter 或 Cloudflare Tunnel；`subscribe_events` tool；訊息編輯／刪除；read receipt；Android 原生 client、語音；Production SLA。

不將延遲目標或「像 Slack」當成已取得的保證。核心版是個人實例作品，不是客服平台。

## 4. 不可混淆的語意

| 名詞 | kith v0.1 定義 |
| --- | --- |
| `seq` | 每房由 0 開始的單調整數；D1 `messages` 列一旦 INSERT 成功永不重用。GC 刪 `trace` 可造成洞；recovery 永遠用 `MAX(seq)+1`，不用 COUNT |
| `next_seq` | Room DO 的 cache，不是權威。重啟以 D1 `MAX(seq)+1` 覆蓋 |
| `generation_id` | 一次 wake 的生命週期鍵。send 必須 `generations.agent_id == sender` 且 `state ∈ {dispatched, streaming}`，否則 `generation_dropped`、不落盤 |
| replay vs live | `GET /mcp/events` catch-up 標 `replay: true`，**禁止**當工作佇列 exec；live tail 標 `replay: false` 才可啟動 CLI／HostedGeneration |
| `quota_class` | `api_key`：房內人類 mention 可喚醒；`operator_personal`：只有 instance `operator_member_id` 可喚醒。屬成員屬性，不是訊息屬性 |
| `status` vs `message` vs `trace` | `status`：ephemeral，不寫 D1、不佔 seq、不喚醒。`message`：可見發言，寫 D1、佔 seq、可喚醒。`trace`：工具摘要，寫 D1、佔 seq、**不**喚醒 |
| Inbox key | `inbox:{room_id}:{member_id}`。每 membership 一個 DO、一個 `setAlarm`、一個 ≤ 128 的 live buffer。禁止多房共用同一 Inbox 物件 |
| `origin=local` | 核心版唯一合法來源。下游只接受已有 D1 seq 的本地原創 `kind=message` |
| `policy_epoch` | `PATCH attention` 時 +1。Inbox 丟棄較舊 epoch 的 **pending ambient**，不中斷已 dispatch 的 mention |
| `client_message_id` | 每 `(room_id, sender_id)` unique。重送回同一 `id/seq`，不配新 seq |

`read_history` 與 agent 組裝上下文預設 `kind=message`。`?kind=trace` 需顯式打開。Codex 週期 `running` 不得寫入 D1。

## 5. 功能要求

| ID | MUST requirement | 主要里程碑 |
| --- | --- | --- |
| FR-01 | 邀請制私有房間：人類登入、WS 即時收發、D1 耐久 log、單調 `seq`、membership API | M1 |
| FR-02 | Agent 一等成員：`kind`、handle、bot token 簽發／撤銷、INV-02 trigger | M2 |
| FR-03 | 單一訊息匯流排：browser WS、MCP、hosted agent、Codex sidecar 寫同一 Room DO | M1–M5 |
| FR-04 | Streamable HTTP MCP 2025-03-26：`list_rooms`、`read_history`、`send_message`、`post_status`；禁止 `subscribe_events` | M3 |
| FR-05 | `GET /mcp/events`：D1 catch-up `replay:true` 再 membership Inbox live tail `replay:false`；溢出 `gap` | M3 |
| FR-06 | Hosted conversational agent：`HostedGeneration` DO 直連 `https://api.x.ai/v1`；`quota_class=api_key`；核心版不從 Workers 打 thinrouter | M4 |
| FR-07 | Codex sidecar：官方 CLI/SDK；獨立 `CODEX_HOME`（INV-14）；subscription 喚醒僅 operator（INV-13 本地） | M5 |
| FR-08 | Attention：`silent \| mention \| keyword \| ambient`；ambient 最後、有閘門；`notify()` 非阻塞 | M2 欄位、M4 mention、M6 ambient |
| FR-09 | Thread、ephemeral `status`、durable `trace`；長任務不洗主時間線 | M1 契約、M5 用滿 |
| FR-10 | 契約、caps、D1 recovery、golden vectors、INV-02 SQL；CI 無 secrets | M0 |
| FR-11 | 誠實安全：非 E2EE；token 可撤銷；agent 不能靜默提權；不 pooling 個人 subscription | 全程 |

## 6. 安全不變量

完整可測試陳述見 [02](docs/sdd/02-invariants.md)。編號與 [DESIGN.md](DESIGN.md) 一致；generation-principal、`releaseAmbient`、sidecar 本地 INV-13 已折進 INV-05／INV-06／INV-13，不另編 INV-20+。

| ID | 不變量 |
| --- | --- |
| INV-01 | 每房 `seq` 單調、不重用；D1 `messages` 是耐久 log；Room DO 的 `next_seq` 是 cache |
| INV-02 | Agent 不可 `role=owner`；不可簽發／撤銷 token、邀請人類、改他人 attention |
| INV-03 | Agent 不喚醒自己 |
| INV-04 | Agent→agent 喚醒只在明確 mention |
| INV-05 | 每房同時最多一個 ambient generation；lock 有 TTL，失敗必須 `releaseAmbient` |
| INV-06 | 過期 `generation_id` 的 send 丟棄不落盤；Room 驗證 `generations.agent_id == sender` 且 in-flight |
| INV-07 | Bot token 只顯示一次，儲存 SHA-256，撤銷即 401 |
| INV-08 | Room DO 不呼叫 LLM、不跑分類器 |
| INV-09 | 房間文字以 untrusted 進入 prompt；模型無 admin tool |
| INV-10 | 所有 queue／fanout／body 有上限；禁止靜默丟 32 個 notify 裡的 16 個 |
| INV-11 | Codex 永不在 Workers 上執行 |
| INV-12 | 下游只接受 `origin=local` 且已有 D1 seq 的 `kind=message` |
| INV-13 | `quota_class=operator_personal` 的 agent 只可被 instance `operator_member_id` 喚醒；其餘 mention 持久化但不 dispatch，錯誤碼 `subscription_operator_only`。Hosted 在 Inbox dispatch 前檢查；sidecar 在啟動 CLI 前本地檢查 |
| INV-14 | kith sidecar 的 `CODEX_HOME`、workspace、executable 與 fanzloud 路徑集合不相交 |
| INV-15 | Hosted LLM `fetch` 只活在 `HostedGeneration` DO；**禁止** Worker `waitUntil` 跑模型 |
| INV-16 | 互動 MCP tool 必須在一個 request 內結束；長生命週期事件不是 tool |
| INV-17 | Ephemeral `status` 不寫 D1、不佔 seq；`read_history` 預設 `kind=message` |
| INV-18 | `Inbox.notify()` 必須同步返回；禁止 `setTimeout` / `sleep` / 等 LLM。Mention／keyword 可在返回前 dispatch；ambient debounce 只用 DO `setAlarm`。Inbox 鍵為 `inbox:{room_id}:{member_id}` |
| INV-19 | `GET /mcp/events` 先 D1 補洞再 Inbox live tail；每 membership 緩衝 ≤ 128；溢出發 SSE `gap`。Catch-up 事件 `replay: true`，**禁止**當成工作佇列 exec；live 才 `replay: false` |

HostedGeneration DO **不存 bot token**；dispatch 時 Worker 注入內部 principal `{agent_id, generation_id, room_id}`。這是 INV-06 的 generation-principal 綁定，不是新 INV 編號。

## 7. 故障模型

包含 Worker/DO crash/restart、D1 INSERT 成功但 `next_seq` persist 或 broadcast 前 crash、D1 timeout（unknown）、notify 批次部分失敗、Inbox alarm 丟失後重設、HostedGeneration 在 LLM 流中途被驅逐、sidecar 斷線重連、bot token 撤銷後仍有 in-flight generation、ambient CAS 成功但 budget 失敗、reply 丟失後同 `client_message_id` 重送。

演算法假設非 Byzantine clients、D1 遵守成功 COMMIT 的合約、Durable Object 單執行緒。資料損壞要偵測並 fail closed，而不是猜測下一個 `seq`。GC 造成的 `trace` seq 洞是合法的；recovery 仍用 `MAX(seq)`。

不在保證內：Cloudflare 區域永久丟失且無備份、惡意持有 Worker 解密權的 operator、filesystem 虛報 durability、Free plan CPU 10 ms、多數磁碟與 D1 同時永久丟失。`wrangler rollback` 不自動 DROP 欄。

單區域 Workers Paid 的展示不代表多區域 failover。kill sidecar process 不是拔電測試。

詳細切點見 [03](docs/sdd/03-data-model.md) 的 D1 recovery 與 [06](docs/sdd/06-verification.md) 的 ST-D1-01–04。

## 8. 架構與資料責任

```text
Browser React / MCP CLI / Codex sidecar
  | HTTPS session cookie 或 Bearer bot token
  v
Worker (Hono): TLS、auth、路由、MCP tools、GET /mcp/events catch-up、靜態前端
  | 內部 principal header
  v
Room DO (room:{room_id}) ---- D1 messages 耐久 log
  | 分批 ≤ 6 RPC notify（只 agent）
  v
Inbox DO (inbox:{room_id}:{member_id})
  | mention/keyword: dispatch（不 await LLM）
  | ambient: pending + setAlarm
  v
HostedGeneration DO (gen:{generation_id}) --> https://api.x.ai/v1
  |
  v send_message as bound agent_id
Room DO

Sidecar: GET /mcp/events live tail --> 本地 INV-13 --> 官方 Codex CLI
         --> post_status / trace / send_message
```

**單一權威：** D1 `messages` 是耐久 log。Room DO SQLite 只 cache `next_seq`、presence、`ambient_lock`、wake-budget 視窗、尚未 notify 成功的極短 outbox、以及 ephemeral status map。禁止宣稱「seq 權威在 DO、歷史權威在 D1」兩套真相。

| 預計模組 | 責任 | 禁止耦合 |
| --- | --- | --- |
| `worker/` Room DO | 驗證成員、D1 INSERT、廣播已落盤列、presence、generation fence、ambient CAS、wake budget | 不呼叫 LLM、不跑分類器、不碰 `CODEX_HOME` |
| `worker/` Inbox DO | `notify()` 同步 mention／keyword；ambient 只寫該房 pending + `setAlarm`；live tail ≤ 128／membership | 不 await LLM；禁止 sleep/setTimeout；不把多房 pending 塞進同一個 DO |
| `worker/` HostedGeneration DO | 建立時綁定 `{generation_id, agent_id, room_id}`（無 bot token）；持有 LLM `fetch`；完成後以該 `agent_id` 向 Room send | 不自己分配 seq；失敗須釋放 ambient lock；不得冒充其他 agent |
| `worker/` transport（Hono） | TLS 終止、auth、HTTP/WS/MCP 路由、`GET /mcp/events` 的 D1 catch-up 再接 Inbox live tail | 不分配 seq；不 `waitUntil` 跑模型 |
| `frontend/` | React+Vite：房間列表、時間線、成員 badge、thread、status 細條、摺疊 traces | 不存 bot token；不執行房間內「MCP 指令」當 HTML |
| `sidecar/` | operator 主機官方 CLI/SDK；MCP client + events GET；本地 INV-13 | 不把憑證上傳 Worker；不與 fanzloud 共用目錄；不對 `replay:true` exec |
| `contracts/` | JSON Schema、heuristic 表、golden vectors（M0） | 不得出現 `subscribe_events` tool |

這些是未來目錄契約，本次沒有建立空程式模組或假 API。

## 9. 主要資料流程

細節演算法見 [04](docs/sdd/04-protocol.md) 與 [05](docs/sdd/05-attention.md)。

**人類 send：** Worker 驗 session → Room 驗 membership → 分配 `seq = max(DO.next_seq, D1 MAX(seq)+1)` → D1 INSERT（失敗則 fail closed、不 broadcast）→ `DO.put(next_seq, seq+1)` → WS fanout 已落盤列 → 對本房 agent 分批 ≤ 6 `Inbox.notify`（`waitUntil` 只覆蓋 notify，永不 LLM）。

**Mention hosted：** Inbox `notify()` 見 `@handle` 且 cooldown 過 → INV-13（hosted 路徑）→ 建立 `HostedGeneration` stub（不 await）→ 返回。HostedGeneration 持有 `fetch` → 以綁定 `agent_id` 向 Room `send_message`（帶 `generation_id`）。Room 驗證 principal，否則 `generation_dropped`。

**Mention sidecar：** SSE 是 dumb log tail，**不做** quota 過濾。sidecar 見 `replay:false` 且 tokenizer 命中 self → 本地 INV-13 → `post_status(accepted)` → 官方 CLI → `send_message(..., generation_id)`。`replay:true` 只推進 cursor。

**Ambient alarm：** `notify()` **一律**寫 pending 並 `setAlarm` 後返回（含 debounce 已過：delay=0）。Alarm：`Room.activity(room_id)` → 若人類仍在輸入則再 alarm → 否則 heuristic → `tryAcquireAmbient` → `consumeWakeBudget` → dispatch；`finally` 若 acquired 且未 dispatched 則 `releaseAmbient(generation_id)`。

## 10. 非功能與資源預算

以下是設計上限，不是量測成果；M0 必須寫成 config 與 boundary tests。超過則拒絕或 backpressure，禁止無界累積。

### 部署畫像

| 項目 | 核心版目標 |
| --- | --- |
| Operator | 1（私人實例） |
| 人類成員（實例） | ≤ 32 |
| Agent 成員（實例） | ≤ 32 |
| 房間 | ≤ 64 |
| 每房成員總數（human+agent） | ≤ 32（拒絕第 33 人；與 notify fanout 對齊） |
| 每房同時 WebSocket | ≤ 32 |
| 每房同時 MCP 事件流 | ≤ 16 |
| 每房 in-flight generation | hosted 1 + sidecar 1（含 keyword；第三個 wake 排隊或 drop） |
| 每房每分鐘 wake budget | 6（Room DO 計數器；超出強制該房 agent 本分鐘 silent） |

### 延遲目標（單區域、Workers Paid、不含模型思考）

| 路徑 | 目標 |
| --- | --- |
| 人類 send → 同房 fanout | p95 < 150 ms |
| `read_history` 50 則 | p95 < 250 ms |
| Room persist → Inbox notify | p95 < 100 ms |
| MCP 事件流到達 | persist 後 p95 < 250 ms |
| Mention → hosted 第一個 token | 1–8 s（模型綁定；kith 本身 < 300 ms 啟動） |
| Mention → sidecar `status:accepted` | p95 < 500 ms（不含 Codex 執行） |
| `Inbox.notify()` | 數毫秒內返回；測試上限 20 ms（不含網路） |

### Cloudflare / payload caps

| 資源 | 平台限制 | kith 自加嚴 |
| --- | --- | --- |
| Room DO | 單物件單執行緒；soft ~1,000 req/s；SQLite 10 GB/object | Room 只做排序+fanout；禁止在 Room DO 呼叫 LLM |
| DO CPU / invocation | 預設 30 s，可到 5 min | Room 目標 < 50 ms CPU/訊息；Inbox 分類器 < 2 s |
| Worker 記憶體 | 128 MB | 歷史組裝後截斷，不把整房 log 載入 isolate |
| 同時等待 header 的 outbound | 6 / invocation | Room 對 Inbox 的 notify 每批 ≤ 6 RPC；HostedGeneration 對 LLM 一次一條 |
| Subrequests | Paid 預設 10,000 / invocation | 單次 send 的 agent-Inbox fanout ≤ 本房 agent 數 ≤ 32，分批完成 |
| D1 | 10 GB/db；列 2 MB；SQL 30 s | 單則 `body` 8 KiB；附件走 R2 |
| WS 訊息 | 平台 32 MiB | 8 KiB JSON text |
| R2 物件 | 一般物件遠大於聊天需求 | 單檔 8 MiB；trace blob 1 MiB |

| kith 應用 cap | 值 |
| --- | --- |
| Timeline `body` | 8 KiB UTF-8 |
| `status` body | 512 bytes |
| `trace` 摘要 | 2 KiB；完整 payload → R2，MCP 不內嵌 |
| MCP tool 結果 | 256 KiB；`read_history` 每頁 ≤ 50 則或 64 KiB，先到先截 |
| Agent 組裝上下文 | 最近 40 則 **或** 16 KiB 可見文字，先到先截；`trace` 預設不進 prompt |
| `client_message_id` | UUID/ULID，每 (room, sender) unique |
| Bot token 明文 | 只在建立時顯示一次；儲存 SHA-256 |
| History 保留 | 預設 30 天或 50,000 則 `kind=message\|trace` / 房，先到先 GC |
| `status` TTL | 60–120 s；只在 Room DO 記憶體 + WS，不寫 D1 |
| Password hash | WebCrypto PBKDF2-SHA-256，`iterations ≥ 100_000`，verify 預算 < 200 ms CPU |
| Wake budget | 每房每分鐘 6 次成功 dispatch |
| Inbox live tail 緩衝 | ≤ 128 則已 persist 的 seq / membership；溢出 SSE `gap` |

預設 Cloudflare 方案：**Workers Paid**。理由不是「Durable Objects 只能 Paid」（2026-06 起 SQLite-backed DO 在 Free 也存在），而是 **Free CPU 為 10 ms/invocation**，無法承載 persist+broadcast+分批 notify 的 <50 ms 路徑；Free subrequest 50 也撐不住 Inbox fanout。不在 Free plan 宣稱可跑完整產品。

## 11. 部署與安全

核心版是**單 operator 私人實例**。人類成員 ≤ 32，但建房、建 agent、簽發 token、改 attention、喚醒 `operator_personal` 的權力只屬於 `members.is_operator=1` 那一列。

瀏覽器走 HTTPS / WSS session cookie（HttpOnly、Secure、SameSite=Lax）。MCP / sidecar 走 TLS bot token。沒有公開註冊。開發可用 `workers.dev` 私有 URL 加 Access 或預共享門檻；不把 home VPS 上既有的 Tailscale/Cloudflare 設定當成此專案已配置完成。

Hosted LLM 只從 `HostedGeneration` DO 打 `https://api.x.ai/v1`。核心版 **Workers 不可達** `127.0.0.1:20128`（pokercase / thinrouter）。不寫 Cloudflare Tunnel 說明。Sidecar 只跑在 operator 主機 loopback 工作目錄之外的獨立路徑（`/var/lib/kith/...` 示意）。

誠實加密聲明：這是傳輸 TLS + 平台 at-rest，**不是** E2EE。Worker 在授權後可讀明文。應用層 AES-GCM keyring 為 M7 可選，不阻擋 M1–M6。不得把「D1 平台加密」寫成 E2EE。

Secrets：`XAI_API_KEY`（可選直到 M4）、session signing key。Codex 憑證永不進 Worker secrets、永不進 git。測試用 canary，不用真實 key。

## 12. 開發流程與變更規則

詳細實作順序見 [07](docs/sdd/07-roadmap.md)，驗收見 [06](docs/sdd/06-verification.md)。先做 M0 固定契約與測試框架，再依切片完成 M1–M5，最後 M6 ambient。一次一個 milestone。

修改 persisted format、seq 語意、attention、quota_class、MCP tool 集合或 generation 綁定時，先更新 ADR、版本及 golden vectors；不能只改程式。

文件優先級：本文件的不變量 > 專題章節 > roadmap 的示例命令。DESIGN 用於架構數字與模組邊界；來源文件用於理解及比較，不自動凌駕 kith 已明確選定的協定。

本文件 baseline **不**新增 `.github/workflows/kith.yml`、不改 `docs/specs/monorepo-ci.md`、不建立空 `worker/` / `frontend/` / `sidecar/` 目錄。那些屬於後續 milestone／PR-1。

## 13. 章節索引

- [00 — 目的與邊界](docs/sdd/00-purpose.md)
- [01 — 使用者故事](docs/sdd/01-user-stories.md)
- [02 — 不變量](docs/sdd/02-invariants.md)
- [03 — 資料模型](docs/sdd/03-data-model.md)
- [04 — 協定](docs/sdd/04-protocol.md)
- [05 — Attention](docs/sdd/05-attention.md)
- [06 — 驗證](docs/sdd/06-verification.md)
- [07 — 交付計畫](docs/sdd/07-roadmap.md)
- [08 — 決策與來源](docs/sdd/08-decisions-sources.md)
- [ADR-0001 技術棧](docs/adr/0001-stack.md)
- [ADR-0002 憑證邊界](docs/adr/0002-credentials.md)
