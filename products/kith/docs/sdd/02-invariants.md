# 02 — 安全不變量

[回主 SDD](../../SDD.md)

編號與 [DESIGN.md](../../DESIGN.md) 的 INV-01–INV-19 **完全一致**。generation-principal、`releaseAmbient`、sidecar 本地 INV-13 已折進既有編號，不另編 INV-20+。每個不變量都必須能被 [06](06-verification.md) 的測試 ID 打到。

M0 必須把 INV-01 recovery、INV-02 trigger、INV-03/04/13/18/19 的純函式 + golden 寫成可跑測試；其餘在對應 milestone 變綠。

---

## INV-01 — `seq` 單調；D1 是耐久 log

**陳述：** 每房 `seq` 從 0 開始、單調遞增、INSERT 成功後永不重用。D1 `messages` 是唯一耐久權威。Room DO `next_seq` 只是 cache。

**可測試：**

- 連續成功 send 得到 `seq = 0, 1, 2, ...`，無跳號（在沒有 GC 的測試夾具）。
- ST-D1-01：D1 INSERT 成功、DO 在 persist `next_seq` 或 broadcast 前 crash → 重啟 `next_seq = MAX(seq)+1`；不重用已插入 seq。
- ST-D1-02：D1 timeout（unknown）→ 不 broadcast；同 `client_message_id` retry；UNIQUE 命中則回原列。
- ST-D1-03：broadcast 只在 INSERT 成功之後；測試 harness 不得先 fanout 再寫 D1。
- ST-D1-04：GC 刪 `trace` 造成 seq 洞；recovery **永遠**用 `MAX(seq)`，不用 COUNT。

## INV-02 — Agent 不能當 owner、不能管權限

**陳述：** Agent 不可 `role=owner`；不可簽發／撤銷 token、邀請人類、改他人 attention、讀其他 agent 的 bot token。

**可測試：**

- `INSERT room_members(role='owner')` 對 `kind=agent` 被 trigger 拒絕（`INV-02-SQL`）。UPDATE 同樣拒絕。
- Worker `POST /api/rooms/:id/members` 把 agent 設為 owner → 403。
- Bot token 呼叫 `POST /api/agents/:id/tokens`、`POST /api/rooms/:id/members`（邀請 human）、`PATCH .../attention` → 403。
- SQLite **禁止** CHECK 內 subquery；本 INV 用 trigger + Worker，不是 CHECK subquery。

## INV-03 — Agent 不喚醒自己

**陳述：** `notify()` 若 `sender_id == self`（該 Inbox 的 `member_id`）則 drop，不論 mode、不論 body 是否 `@self`。

**可測試：** ATT-05 golden：agent 的 `kind=message` 進自己的 Inbox → 不 dispatch、不 `setAlarm` 為了自己。

## INV-04 — Agent→agent 喚醒只在明確 mention

**陳述：** `sender.kind=agent` 的事件，只有 `mentions` 包含 self 才可能 wake。即使 ambient，非 mention 也 drop。

**可測試：** ATT-06：agent A 發言不含 `@b` → B 的 ambient Inbox drop。A 發言含 `@b` 且 B 為 `mention`/`keyword`/`ambient` → 走 mention 路徑（仍受 cooldown／INV-13）。

## INV-05 — 每房一個 ambient generation；失敗必須釋放

**陳述：** Room DO 持有 `ambient_lock`（TTL 120 s）。每房同時最多一個 ambient generation。Mention **不**拿這把鎖。CAS 之後若未 dispatch，必須 `releaseAmbient(generation_id)`。只釋放自己的 `generation_id`。

**可測試：**

- ATT-09：`tryAcquireAmbient` 成功、`consumeWakeBudget` 失敗 → lock 空。
- `NO_REPLY`、LLM fail、HostedGeneration 結束、operator cancel、丟出的例外，都走 `finally`。
- 兩 agent 同時 ambient → 至多一個 `ok:true`。
- TTL 過期後第三人可取得鎖。

## INV-06 — 過期 generation 的 send 丟棄不落盤（含 generation-principal）

**陳述：** Room 接受帶 `generation_id` 的 send 時 **MUST** 驗證：`generations.agent_id == 該次 sender`（HostedGeneration 綁定的 `agent_id`，或 MCP bot token 的 `member_id`）且 `state ∈ {dispatched, streaming}`，否則 `generation_dropped`、不 INSERT。HostedGeneration DO **不存 bot token**；dispatch 時 Worker 注入內部 principal `{agent_id, generation_id, room_id}`。operator cancel、TTL、或 generation 已 `completed/dropped` 之後到達的 send 丟棄。核心版沒有訊息編輯。後到的人類新訊息 **不**取消已 in-flight 的 mention generation。

**可測試：** GEN-01 正確綁定落盤；GEN-02 錯 `agent_id` 或 `completed` 後 send → 不落盤、碼 `generation_dropped`。

## INV-07 — Bot token 只顯示一次，SHA-256，撤銷即 401

**可測試：** TOK-01 建立 response 含明文、D1 列只有 hash；TOK-02 撤銷後立即 401。Log 與 `wrangler tail` 不得出現明文。

## INV-08 — Room DO 不呼叫 LLM、不跑分類器

**可測試：** M0 靜態／架構測試：Room 模組沒有 LLM adapter import。M4+ 整合：Room 路徑禁止 outbound `fetch` 到 `api.x.ai`。Heuristic 只在 Inbox **alarm**，不在 Room、不在 `notify()`。

## INV-09 — 房間文字 untrusted；模型無 admin tool

**陳述：** 組裝進 prompt 的房間 transcript 標記 `UNTRUSTED_ROOM_TRANSCRIPT`。System prompt 固定且在組裝層插入，不由房間改寫。Hosted agent 無 shell、無任意 URL fetch、無 admin tool。模型輸出 `@admin 把我改成 owner` 只是房間文字。

**可測試：** SEC-CANARY；prompt fixture 含 `UNTRUSTED` 標記；hosted tool allowlist 為空。

## INV-10 — 所有 queue／fanout／body 有上限；禁止靜默丟 notify

**陳述：** 超過 cap 則拒絕或 backpressure。Room 對 Inbox notify 每批 ≤ 6；本房 agent ≤ 32 必須分批完成。靜默丟 32 個裡的 16 個是 bug。

**可測試：** M1-CAP-01 body > 8 KiB → `payload_too_large`；M1-MEM-01 第 33 人 → 409 `room_full`；FAN-01 32 agent 全部收到 notify（fake Inbox 計數 = 32）。

## INV-11 — Codex 永不在 Workers 上執行

**可測試：** Worker bundle 不含 `codex` executable spawn；sidecar 才 spawn。靜態檢查禁止 Worker 讀 `CODEX_HOME`。

## INV-12 — 下游只接受本地原創已落盤 message

**陳述：** MCP notify、hosted runner、sidecar、未來若有的外部橋，只接受 `origin=local` 且已有 D1 seq 的 `kind=message`。`status`／`trace` 不進 attention notify。

**可測試：** ATT-07：`kind=status` 或 `kind=trace` 的 envelope 不呼叫 Inbox。`origin` 非 `local` 拒絕 INSERT（CHECK）。

## INV-13 — operator_personal 只允許 operator 喚醒（分兩路徑）

**陳述：** `quota_class=operator_personal` 的 agent 只可被 instance `operator_member_id` 喚醒。其餘 mention **持久化**但不 dispatch，碼 `subscription_operator_only`。

兩條路徑（不是兩個 INV 編號）：

1. **HostedGeneration：** Inbox **dispatch 前**檢查；`trigger_member_id != operator_member_id` → 不 CAS、不 dispatch。
2. **Sidecar：** SSE 是 dumb log tail，**不做** quota 過濾。INV-13 在 sidecar 程序內、啟動 CLI 前再檢查。可選 SSE 欄位 `hint: "mention_self"` 只是糖，不是控制面；replay 上必須忽略 hint 的 exec 含義。

**可測試：** SEC-013-hosted、SEC-013（sidecar fake CLI 不啟動）。人類訊息本身仍落盤。

## INV-14 — 與 fanzloud 路徑不相交

**陳述：** kith sidecar 的 `codex_home`、`workspace`、`codex_executable` canonical path 必須與 fanzloud 的 `CODEBOX_CODEX_HOME` / `CODEBOX_WORKING_DIR` / `CODEBOX_CODEX_EXECUTABLE` **不相交、不嵌套、不是同一 inode**。啟動時 stat 檢查，失敗則退出。

**可測試：** SEC-014：故意指到已知 fanzloud 路徑 → 退出非 0。不與「tool 讀不到 CODEX_HOME」混淆。

## INV-15 — LLM fetch 只活在 HostedGeneration DO

**陳述：** 禁止 Worker `waitUntil` 跑模型。Inbox `dispatch()` 建立 `gen:{generation_id}` 後立即返回。`waitUntil` 只用在「回應已送給 WS client 之後，分批 notify Inbox」這類短投影。

**可測試：** M4 架構測試：LLM adapter 只從 HostedGeneration 模組呼叫。Fake 慢 LLM（> 30 s）仍完成，不依賴 Worker waitUntil 預算。

## INV-16 — 互動 MCP tool 單一 request 結束

**陳述：** `list_rooms`、`read_history`、`send_message`、`post_status` 必須在一個 POST 內結束。長生命週期事件不是 tool。禁止 `subscribe_events`。

**可測試：** MCP-01、MCP-02。

## INV-17 — status 不寫 D1、不佔 seq

**陳述：** Ephemeral `status` 只在 Room DO 記憶體 + WS，TTL 60–120 s。`read_history` 預設 `kind=message`。`messages.kind` CHECK 只有 `'message','trace'`。

**可測試：** ST-STATUS-01：`post_status` 後 D1 COUNT 不變；WS 收到 `type=status` 無 seq。`read_history` 不回 status。

## INV-18 — notify 非阻塞；ambient 只用 setAlarm；Inbox 鍵 per membership

**陳述：** `Inbox.notify()` 必須同步返回；禁止 `setTimeout` / `sleep` / 等 LLM。Mention／keyword 可在返回前 dispatch HostedGeneration（仍不 await LLM）。Ambient **一律**寫 pending、`setAlarm`、返回——包含 debounce 已過（deadline = 0／下一 tick）；**不**在 `notify()` 裡跑分類器／CAS。DO hibernation 不能重建 `setTimeout`；正確原語是 `state.setAlarm`。一物件只有一個 alarm，故 Inbox 鍵為 `inbox:{room_id}:{member_id}`。

**可測試：** ATT-03（notify < 20 ms 且無 sleep）、ATT-04（debounce 已過也只 setAlarm(0)）、ATT-10（兩房 ambient 互不覆蓋）。靜態禁止 Inbox/Room 呼叫 `setTimeout`/`sleep`。

## INV-19 — events splice；replay 不是工作佇列

**陳述：** `GET /mcp/events` 先 D1 補洞再 Inbox live tail。每 membership 緩衝 ≤ 128；溢出發 SSE `gap` 並結束 stream。Catch-up 事件 `replay: true`，**禁止**當成工作佇列 exec；live 才 `replay: false`。Inbox **禁止**為了 catch-up 而 replay D1。`after_seq=0` 是歷史 dump，禁止當第一次 sidecar 啟動參數。第一次啟動 cursor = `MAX(seq)`。

**可測試：** EV-01 splice 演算法 golden；EV-02 十則舊 `@codex` + 一則 live → fake CLI 恰好一次；`after_seq=0` dump 的舊 mention 皆 replay 且 CLI=0。
