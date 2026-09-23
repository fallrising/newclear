# 06 — 驗證

[回主 SDD](../../SDD.md)

**執行狀態：** M0 vitest 在 `products/kith/test/`（契約、純函式、INV-02 SQL）。本檔仍是 acceptance contract，不是測試報告。測試名稱／ID 必須出現在測試程式或 evidence mapping，不能只存在文案中。M1+ 的 miniflare／MCP／fake LLM 測試尚未建立。

Fake LLM 與 fake Codex executable 是正確性證明的預設；live xAI / 真 Codex 是 operator smoke，**不進 CI**、不需要 secrets。

---

## 1. 測試層級

| 層級 | 用途 | 何時 |
| --- | --- | --- |
| Schema / golden | JSON Schema、DDL 正反例、heuristic 表、SSE splice vectors | M0 |
| Pure unit | tokenizer、keyword matcher、notify 決策、quota gate、seq recovery 函式 | M0 |
| Trigger SQL | INV-02 agent owner INSERT/UPDATE 拒絕 | M0（sqlite fixture） |
| Miniflare / DO fake | Room persist+broadcast 切點、Inbox alarm、fanout 6 批 | M1+ |
| MCP fake client | 四 tool + method-not-found + events splice | M3 |
| Fake LLM | HostedGeneration 不 await、generation 綁定、NO_REPLY | M4 |
| Fake Codex | EV-02、SEC-013、argv 不內插、canary | M5 |
| Ambient 整合 | CAS、兩房 alarm、notify < 20 ms | M6 |

所有時鐘可注入。Safety 不以 elapsed time 推斷 `notify()` 正確性（除 ATT-03 的 20 ms 上限量測）。失敗必須保存 fixture 與 generation_id。

測試資料不得含真實 credentials。Canary secret 字串固定為測試夾具（例如 `CANARY_NOT_A_REAL_TOKEN`），不得檢入真實 key。

---

## 2. Requirement → acceptance mapping

### M0 契約：FR-10，INV-01/02/03/04/13/17/18/19

| ID | Given / When | Then |
| --- | --- | --- |
| ST-D1-01 | D1 INSERT 成功，persist `next_seq` 或 broadcast 前 crash | 重啟 `next_seq = MAX(seq)+1`；不重用 seq |
| ST-D1-02 | D1 timeout unknown，同 `client_message_id` retry | 不先 broadcast；UNIQUE 命中回原列 |
| ST-D1-03 | harness 試圖在 INSERT 前 broadcast | 被 API 拒絕；無 event |
| ST-D1-04 | 刪一則 `trace` 造成洞，再 send | 新 seq = 舊 MAX+1，不是 COUNT+1 |
| INV-02-SQL | `INSERT room_members(role='owner')` 對 `kind=agent` | trigger ABORT；UPDATE 同樣 |
| ATT-01 | tokenizer 表（見 05） | 與 golden 完全一致 |
| ATT-02 | keyword CJK/ASCII 表 | 與 golden 完全一致 |
| ATT-03 | `notify()` 含 ambient、debounce 已過 | < 20 ms 返回；無 `sleep`/`setTimeout` |
| ATT-04 | ambient 且 debounce 已過 | 只 `setAlarm(0)`，不跑 heuristic |
| ATT-05 | sender_id == self | drop（INV-03） |
| ATT-06 | sender.kind=agent 非 mention | drop（INV-04） |
| ATT-07 | envelope `kind=status` 或 `trace` | 不進 Inbox 決策（或立即 drop） |
| MCP-SCH-01 | `contracts/mcp-tools-v1.json` | 恰四 tool；無 `subscribe_events` |
| EV-01 | splice 演算法 fixture：D1 5 列 + live 2 列 + 中間洞 | 先 replay:true 再 live:false；洞 → gap |
| CAP-CONST-01 | config 常數 | body 8 KiB、status 512、fanout 6、members/room 32、wake 6、buffer 128 |

### M1 人類房間：FR-01，US-01

| ID | Given / When | Then |
| --- | --- | --- |
| M1-US-01 | 兩個 bootstrap 人類 WS send | 同一 `id/seq`；D1 可讀 |
| M1-MEM-01 | `POST /api/rooms/:id/members` 加入既有 human；第 33 人 | 前 32 成功；第 33 → 409 `room_full` |
| M1-MEM-02 | 同一路由以 `handle` 邀請未入房的 human；兩識別並存或皆無；agent／不存在／停用的 handle；guest 呼叫 | 200 且 `member_id` 為該人；400 `invalid_request`；404 `not_found`；guest 403 |
| M1-GAP-01 | WS 丟包（中間 seq 未送達） | client `after_seq` 補洞，不重用 |
| M1-IDEM-01 | 同 `client_message_id` 重送 | 不配新 seq |
| M1-CAP-01 | body 8 KiB+1 | `payload_too_large`，不 INSERT |
| ST-STATUS-01 | WS `type=status` typing | D1 COUNT 不變；對端可收無 seq status |

### M2 agent／token：FR-02，US-02

| ID | Given / When | Then |
| --- | --- | --- |
| M2-US-02 | 建 agent、簽發、列出、撤銷、再用 | 明文一次；SHA-256 入庫；撤銷 401 |
| TOK-01 | 建立 token | response 有明文；GET 列表無明文；D1 無明文 |
| TOK-02 | 撤銷後 MCP/HTTP | 立即 401 |
| INV-02-HTTP | agent token 呼叫 admin | 403 |

### M3 MCP：FR-04，FR-05，US-03

| ID | Given / When | Then |
| --- | --- | --- |
| M3-US-03 | 四 tool 各一 call | 單一 request 結束；send 有 seq；status 無 D1 |
| MCP-01 | 四 tool schema round-trip | 通過；結果 ≤ 256 KiB |
| MCP-02 | 呼叫 `subscribe_events` | `method-not-found` |
| EV-02 | D1 10 則舊 `@codex` + 1 則 live；sidecar 無 cursor | fake CLI **恰好一次**（live）；`after_seq=0` dump 的 10 則 `replay:true` 且 CLI=0 |
| FAN-01 | 32 agent 成員一則 human message | fake Inbox notify 計數 = 32；每批 ≤ 6 |

### M4 hosted：FR-06，US-04，INV-06/13/15

| ID | Given / When | Then |
| --- | --- | --- |
| M4-US-04a | `@grok` 且 `api_key` | fake LLM 回覆同一 `generation_id`；`notify()` 不 await |
| M4-US-04b | 非 operator mention `operator_personal` hosted | 訊息落盤；不 dispatch；`subscription_operator_only` |
| SEC-013-hosted | 同上 | HostedGeneration DO 未建立 |
| GEN-01 | 正確 principal send | 落盤 |
| GEN-02 | 錯 agent_id 或 completed 後 send | `generation_dropped`，不落盤 |
| HOST-NOREPLY | fake LLM 回 `NO_REPLY` | 不 INSERT message；若持有 ambient lock 則釋放 |
| HOST-MODELS | 啟動 `GET /v1/models` 不含設定 id | 拒絕啟動 |

### M5 sidecar：FR-07，US-05，INV-11/13/14

| ID | Given / When | Then |
| --- | --- | --- |
| M5-US-05a | operator `@codex` live | status WS + trace D1 + thread message |
| SEC-013 | 非 operator mention `operator_personal` | fake CLI 啟動次數 0 |
| SEC-014 | `codex_home` 與 fanzloud 路徑相交 | sidecar 退出非 0 |
| SEC-CANARY | 房間要求貼出 CODEX_HOME 假 token | prompt／trace／send／log **不主動**附上 canary；不把 `open()` 失敗當 pass |
| ARGV-01 | 任意房間文字 | argv 陣列不含該文字；prompt 走 stdin 或 workspace 檔 |

### M6 ambient：FR-08，US-06，INV-05/18

| ID | Given / When | Then |
| --- | --- | --- |
| M6-US-06 | heuristic 通過、無人 typing | 一次 ambient 發言；self-wake / cross-agent 非 @ drop |
| ATT-08 | 7 次成功條件的 dispatch | 第 7 次 budget 失敗並釋放 lock |
| ATT-09 | CAS 成功、budget 失敗 | `releaseAmbient`；lock 空 |
| ATT-10 | 同一 agent 兩房 ambient | alarm 互不覆蓋（兩 Inbox 物件） |
| ATT-H4 | 最近 10 則已有 agent 發言 | heuristic 否決 |

---

## 3. Fake LLM / Fake Codex

- Fake LLM：可注入延遲、`NO_REPLY`、token 流、錯誤。CI 禁止真實 `XAI_API_KEY`。
- Fake Codex：可執行檔記錄 argv／stdin／呼叫次數／exit code。EV-02 與 SEC-013 必須打 fake CLI，不是 mock 函式裡偷偷 return。
- Canary：固定字串寫入測試用 `CODEX_HOME` 檔案；斷言 outbound 事件不含該字串。誠實範圍見 ADR-0002——**禁止**測試名 `tools_cannot_read_codex_home`。

---

## 4. 安全與禁止事項（測試必須守）

- 不把真實 API key、bot token、ChatGPT session 寫進 fixture。
- 不掃描非官方 ChatGPT/Grok 網頁。
- 不對 fanzloud 目錄寫入或刪除。
- 不宣告 E2EE。
- 不在 CI 加 deploy secrets。
- `sleep` 不能當正確性證明（ATT-03 的 20 ms 是上限量測，決策表仍是同步 golden）。

---

## 5. Evidence 與 CI

每次 milestone 驗收保存 manifest：milestone、commit、Node 版本、commands/exit codes、assertion IDs、限制。small summaries 可放 `docs/evidence/`（實作階段）；本 pass 不建該目錄。

Root workflow 位於 `.github/workflows/kith.yml`，paths `products/kith/**` + 該 workflow，`contents: read`，Node **24.18.0**，無 deploy secrets。`docs/specs/monorepo-ci.md` 列出 goku、phark、cloudform、aweshore、streaming-converter、ojbquay、prism、kith。未建立的 gate 不准以空 target／固定 exit 0 冒充通過。
