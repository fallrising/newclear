# 05 — Attention

[回主 SDD](../../SDD.md) · Requirements: FR-08 · Milestones: M0（純函式 + golden）、M2（欄位）、M4（mention）、M6（ambient）

Attention 是 **Inbox DO 的純函式 + 少量持久狀態**，不是「每則訊息都打一次 grok-4.5」。Room DO 不跑分類器（INV-08）。M0 必須交出 tokenizer、keyword matcher、notify 決策表、heuristic 表與 quota gate 的 golden vectors，不是空殼。

預設：hosted Grok 與 Codex sidecar 皆 **`mention`**。`ambient` 要 operator 顯式打開，且 M6 之前程式路徑不存在。

---

## 1. 資料結構

```ts
type AttentionMode = "silent" | "mention" | "keyword" | "ambient";

interface AttentionPolicy {
  mode: AttentionMode;
  keywords: string[];       // mode=keyword
  cooldown_ms: number;      // 預設 15_000
  debounce_ms: number;      // 人類優先，預設 2_000
  classifier?: "heuristic" | "llm";  // ambient only；MVP heuristic
  quota_class: "api_key" | "operator_personal";
  policy_epoch: number;     // PATCH attention 時 +1
}
```

Inbox 鍵：`inbox:{room_id}:{member_id}`（INV-18）。僅 agent membership 有 Inbox。人類未讀不走 fanout。

---

## 2. Notify envelope

`PATCH attention` 遞增 `policy_epoch`。Inbox 丟棄較舊 `policy_epoch` 的 **pending ambient**，不中斷已 dispatch 的 mention。Inbox 不另查過期 policy。

```json
{
  "room_id": "01J...",
  "event": {
    "id": "...",
    "seq": 42,
    "kind": "message",
    "sender_id": "...",
    "sender_kind": "human",
    "body": "...",
    "mentions": ["01J..."],
    "thread_id": null,
    "origin": "local"
  },
  "policy": {
    "mode": "mention",
    "keywords": [],
    "cooldown_ms": 15000,
    "debounce_ms": 2000,
    "quota_class": "api_key",
    "policy_epoch": 7
  },
  "operator_member_id": "01J...",
  "trigger_member_id": "01J...",
  "last_human_seq": 42,
  "last_human_at": "2026-09-20T12:00:00.000Z",
  "humans_typing": false,
  "wake_budget_remaining": 4
}
```

`last_human_*` / `humans_typing` 由 Room 在 notify 當下從 DO 記憶體填入（typing 是 INV-17 的 WS status）。Alarm 回呼若要最新值，Inbox 對 Room 做一次便宜 RPC `activity(room_id)`，不重放 envelope 裡的過期 typing。

`kind=status` / `kind=trace` **不**呼叫 Inbox（INV-12）。`origin` 必須 `local`。

---

## 3. Fanout（6 連線上限）

M1–M6 **只 notify 本房 `kind=agent` 成員**。每房成員總數 ≤ 32，故 agent 數 ≤ 32。同一 Worker 內用 Durable Object RPC stub（仍算 subrequest）。Room 不得 `Promise.all` 超過 6 個 in-flight。靜默丟 notify 是 bug（INV-10）。

```
const agents = roomAgentIds() // ≤ 32
for (const chunk of chunks(agents, 6)) {
  await Promise.all(chunk.map(id =>
    inboxStub(`${room_id}:${id}`).notify(envelope) // class Inbox, name inbox:{room_id}:{member_id}
  ))
}
```

`waitUntil` 可覆蓋第二批以後，但每批仍 ≤ 6。Room 的 p95 < 150 ms 預算不含 ambient 等待。

---

## 4. `notify()` — 必須非阻塞（INV-18）

必須在數毫秒內返回。測試上限 **20 ms**（純函式／fake DO，不含真實網路）。**禁止** `setTimeout`、`await sleep`、等 LLM。DO hibernation 不能重建 `setTimeout`；正確原語是 `state.setAlarm`。

```
notify(envelope):
  if event.kind != message or origin != local: return drop
  if sender_id == self: return drop          // INV-03
  switch policy.mode:
    silent: return drop
    mention:
      if self not in event.mentions: return drop
      if not cooldown_elapsed: return drop
      return dispatch_mention(envelope)      // 可在返回前建立 HostedGeneration stub；不 await LLM
    keyword:
      if not keyword_hit(body, keywords): return drop
      if not cooldown_elapsed: return drop
      return dispatch_mention(envelope)      // 與 mention 共用 hosted in-flight cap
    ambient:
      if sender_kind == agent: return drop   // INV-04；即使 mentions 含 self，ambient 路徑也不在 notify 裡 dispatch
      write pending (replace if same membership)
      if pending.policy_epoch is stale: drop pending
      remaining = debounce_ms - (now - last_human_at)
      setAlarm(remaining > 0 ? now+remaining : 0)  // 已過也走 alarm，delay=0
      return
```

Mention／keyword 的 INV-13（hosted）在 `dispatch_mention` 內、建立 DO **前**檢查。Sidecar 不在此檢查。

Keyword 與 hosted 共用 in-flight cap：每房同時 hosted generation = 1。第二個 keyword/mention hosted wake 排隊（Inbox 最多 1 pending）；sidecar 另計 1。不得讓兩個 hosted keyword agent 並行打 LLM。

---

## 5. Alarm 處理器（唯一跑 heuristic／CAS 的路徑）

debounce 已過也走這裡。**不**在 `notify()` 裡跑 Clf／CAS。

```
onAlarm:
  pending = load; if none: return
  if pending.policy_epoch < current envelope epoch: drop; return
  act = Room.activity(this.room_id)
  if act.humans_typing or (now - act.last_human_at) < debounce_ms:
    setAlarm(now + debounce_ms); return
  if Room.ambient_lock held (expires_at > now): drop pending; return
  if not heuristic(pending) [or optional cheap llm classifier]: drop; return
  acquired = false
  dispatched = false
  try:
    r = Room.tryAcquireAmbient(room_id, agent_id, generation_id)
    if not r.ok: return
    acquired = true
    if not Room.consumeWakeBudget(): return
    if quota_class == operator_personal and trigger != operator: return  // hosted 路徑
    dispatch(...)
    dispatched = true
  finally:
    if acquired and not dispatched:
      Room.releaseAmbient(generation_id)   // 只釋放自己的 generation_id
```

`Room.tryAcquireAmbient`：

```
if (lock && lock.expires_at > now) return { ok:false }
lock = { generation_id, agent_id, expires_at: now+120s }
return { ok:true }
```

TTL 120 s。Mention **不**拿這把鎖。

`NO_REPLY`、LLM fail、HostedGeneration 結束、operator cancel、budget 用盡、cooldown 競態、丟出的例外，都走 `finally`（INV-05）。

可選 `classifier=llm` 同樣只在 alarm（獨立小模型，不得預設 grok-4.5 / grok-4.6；`max_tokens ≤ 8`；失敗 = 不喚醒）。

---

## 6. Mention tokenizer

掃描 body 中 `@[a-z0-9_]{2,32}` 與全形 `＠[a-z0-9_]{2,32}`，前後為字串邊界或 ASCII 標點。對照本房 handle（NOCASE）。不成員 handle 忽略。沒有 `@all` mention type；「@all」只是 heuristic 表裡的求助短語，不展開成全體 mentions。

M0 golden（ATT-01）至少含：

| 輸入 | 本房 handles | mentions |
| --- | --- | --- |
| `hello @grok` | grok, codex | grok |
| `＠codex please` | grok, codex | codex |
| `email foo@bar.com` | bar | （空；`.` 不是 handle 字元，且非邊界+handle+邊界的成員） |
| `@all` | grok | （空；不展開） |
| `@nobody` | grok | （空） |
| `a@grok` | grok | （空；前綴字母不算邊界） |
| `@Grok` | grok | grok（NOCASE） |

精確邊界規則：handle 的前一個字元須為字串開頭、空白、或 ASCII 標點 `[!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~]`；後一個同理或字串結尾。`@` 本身不算 handle 的一部分。

---

## 7. Keyword matcher

- **ASCII token：** Unicode letter/digit 邊界（`\b` 等價）；大小寫不敏感僅適用 ASCII。
- **CJK（Han/Hiragana/Katakana）：** **substring**，最短 2 個 code point。大小寫不適用。
- 關鍵字來自 `policy.keywords`；空陣列 = keyword mode 永不命中。

M0 golden（ATT-02）：

| keywords | body | hit |
| --- | --- | --- |
| `["deploy"]` | `please Deploy now` | yes |
| `["deploy"]` | `undeployed` | no（ASCII 非邊界） |
| `["部署"]` | `今晚部署嗎` | yes（CJK substring） |
| `["部"]` | `部署` | no（短於 2 個 code point 的 CJK 關鍵字在載入時拒絕） |
| `["gpt"]` | `GPT-4` | yes（ASCII 邊界 + 大小寫） |

---

## 8. Heuristic 表

完整列在 M0 `contracts/ambient-heuristic-v1.json`。節錄：

| id | 條件 | 通過 |
| --- | --- | --- |
| H1 | body 含 `?` 或 `？` 且長度 ≥ 8 | yes |
| H2 | 含短語 `有人`、`幫我`、`can someone`、`please look`（表驅動） | yes |
| H3 | 含字面 `@all` / `＠all` | yes |
| H4 | 最近 10 則 `kind=message` 已有任一 agent 發言 | **否決** H1–H3 |
| H5 | sender.kind=agent | **否決**（規則 INV-04 已 drop） |

H4 所需「最近 10 則」由 alarm 路徑向 Room 要 `activity` 的延伸欄位或一次有界 D1 讀（≤ 10 列），**不**在 `notify()` 做。M0 純函式測試把「最近 10 則是否含 agent」當輸入布林，不打 D1。

---

## 9. Wake budget

Room DO 滑動 60 s 視窗，成功 dispatch 計 1，上限 **6**。Inbox 在 **CAS 成功之後、dispatch 之前** `consumeWakeBudget()`；失敗不計、走 `finally` 釋放 lock。用盡則本分鐘該房 ambient/keyword hosted 視為 silent，metric `ambient_budget_exhausted`。Mention 的 hosted dispatch 也計入同一預算（DESIGN：成功 dispatch 計 1）。

測試 ATT-08：連續 7 次本應成功的 dispatch → 第 7 次不 dispatch、lock 釋放。

---

## 10. `releaseAmbient` finally

```
acquired = false
dispatched = false
try {
  r = tryAcquireAmbient(...)
  if (!r.ok) return
  acquired = true
  if (!consumeWakeBudget()) return
  dispatch(...)
  dispatched = true
} finally {
  if (acquired && !dispatched) releaseAmbient(generation_id)
}
```

只釋放自己的 `generation_id`。不得清空別人的 lock。測試 ATT-09。

HostedGeneration 結束（completed / failed / dropped / `NO_REPLY`）也必須釋放自己持有的 ambient lock。Mention generation 不持有此鎖。

---

## 11. Generation 生命週期與回覆綁定

```
queued → dispatched → streaming → completed
                    ↘ dropped（late / cancel / superseded）
                    ↘ failed（LLM/sidecar error；可 status，不重試無限）
```

Room 在 agent 開始 streaming 時可 fanout `status:streaming`（無 seq）。最終 `message` 必須帶同一 `generation_id`。Room **MUST** 驗證 `generations.agent_id == sender` 且 state 為 `dispatched` 或 `streaming`（INV-06）。失敗 → `generation_dropped`，不落盤。HostedGeneration DO 內無 bot token。

後到的人類新訊息 **不**取消已 in-flight 的 mention generation。

---

## 12. 迴圈防護

沿用 EdgeChat 精神：下游只接受 `origin=local` 且經 Room seq 的 `kind=message`。禁止「agent 回覆 → 另一 agent ambient → 再回覆」。分類器輸入標記 `untrusted_room_text`。Cheap gate 先於貴模型，且不在 `notify()`。
