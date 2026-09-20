# 07 — Milestones and implementation handoff

[回主 SDD](../../SDD.md)

Milestone 狀態：M0–M6 核心與可選 M7（GC／metrics／AES-GCM keyring）在 local working tree（尚未 merge）。不得把平台 at-rest 寫成 E2EE。未宣稱 live smoke。

## 1. Dependency map

```text
M0 contracts / testkit / attention 純函式
 -> M1 人類私有房間（WS + D1）
 -> M2 agent 成員 + bot token
 -> M3 Streamable HTTP MCP + GET /mcp/events
      ├─> M4 HostedGeneration mention Grok
      └─> M5 Codex sidecar on mention   （可與 M4 平行：sidecar/ vs worker/hosted/）
           └─> M6 ambient（依賴 M4 與 M5 皆可被同一 Inbox 規則驅動）

After M6 only: M7 observability / GC / optional keyring
```

不得因另一個 agent 提前完成某個函式，就跳過其依賴的驗收。M0 通過前不做 M1。

對應 merge 單位見 [DESIGN.md PR Plan](../../DESIGN.md)。實作再切 `.team/tasks/T-###.md`。

---

## 2. M0 — Contract and engineering foundation

**目標：** 把本 SDD 轉成開發可依賴的格式／介面／測試骨架，而不是一次寫完聊天室。

**讀取：** 全部 `SDD.md`、本章、[02](02-invariants.md)、[03](03-data-model.md)、[04](04-protocol.md)、[05](05-attention.md)、[06](06-verification.md)、[08](08-decisions-sources.md)、ADR-0001/0002。

**輸入：** 本文件 baseline（無 runtime）。

**產物：**

- `products/kith/package.json`（Node **24.18.0**）、vitest、JSON Schema
- `contracts/`：`mcp-tools-v1.json`（**不含** `subscribe_events`）、`mcp-events-v1.json`、`ambient-heuristic-v1.json`、HTTP/WS schemas、D1 recovery vectors
- 純函式：attention、mention tokenizer、keyword matcher、quota gate、seq recovery
- INV-02 trigger SQL 測試
- 根 `.github/workflows/kith.yml` + 同步改 `docs/specs/monorepo-ci.md`（列出既有全部根 workflow 再加 kith；**不要寫「七個」**；`contents: read`；無 secrets）

**驗收：** CAP-CONST-01、ST-D1-01–04（函式級）、INV-02-SQL、ATT-01–07、MCP-SCH-01、EV-01 golden。monorepo 路徑邊界通過。root workflow 靜態 policy 合格（若此階段加入）。

**禁止：** 實作 Durable Object、真 LLM、frontend 畫面、sidecar 二進位、fork EdgeChat、改 pokercase/fanzloud 原始碼、deploy、把尚未提供的功能接成固定成功 stub。M0 產物見 `products/kith/{package.json,contracts,src,test,sql}` 與根 `kith.yml`；仍禁止聊天室 runtime。

---

## 3. M1 — 人類私有房間

**輸入：** M0 VERIFIED。

**產物：** Hono、Room DO、D1 migration **v1 已含 human|agent enum**、session、PBKDF2、React 登入／一房／時間線、`scripts/bootstrap.sql`、`cmd/kithctl`（`hash-password`）、`wrangler.toml`。Feature flags 全關。

**驗收：** M1-US-01、M1-MEM-01、ST-D1-01–04（miniflare）、M1-GAP-01、M1-IDEM-01、M1-CAP-01、ST-STATUS-01。

**最小 demo：** 兩個 bootstrap 人類互打一則訊息，同一 seq。

**禁止：** hosted runner、Inbox fanout、LLM、agent 列（除 schema 允許的零列）、改其他 component。

---

## 4. M2 — Agent 身份與 bot token

**輸入：** M1 VERIFIED。

**產物：** 建 agent（`quota_class`）、簽發／撤銷 token、REST send as agent、INV-02 HTTP、membership 可加 agent、前端 badge。Attention 欄位預設 mention，行為仍未接 runner。D1 只追加 `bot_tokens` 列（表若已在 v1 則不 rebuild）。

**驗收：** M2-US-02、TOK-01、TOK-02、INV-02-HTTP、INV-02-SQL regression。

**禁止：** MCP server、LLM、ambient dispatch。

---

## 5. M3 — Streamable HTTP MCP

**輸入：** M2 VERIFIED。`ff_mcp=on`。

**產物：** `POST /mcp` 四 tool、Inbox DO（事件緩衝）、`GET /mcp/events` splice、resource URI、假 client 整合測試。

**驗收：** M3-US-03、MCP-01、MCP-02、EV-01、EV-02（fake CLI 計數；此時 CLI 可為測試 harness）、FAN-01。

**禁止：** hosted LLM、`subscribe_events`、把 replay 當工作佇列。

---

## 6. M4 — Hosted mention-only Grok

**輸入：** M3 VERIFIED。`ff_hosted_agent=on`。

**產物：** `HostedGeneration` DO、Inbox mention 分支、LLM adapter（只 `https://api.x.ai/v1`）、prompt 組裝、generation 表、quota 閘門、啟動 `GET /v1/models`。

**驗收：** M4-US-04a/b、SEC-013-hosted、GEN-01、GEN-02、HOST-NOREPLY、HOST-MODELS。Fake LLM 必過；live xAI 為 operator smoke，不進 CI。

**禁止：** thinrouter / Tunnel 設定；Worker `waitUntil` 跑模型；Room 呼叫 LLM；第二個 hosted profile；ambient。

---

## 7. M5 — Official Codex sidecar on mention

**輸入：** M3 VERIFIED（MCP）。**不**依賴 M4。路徑：`sidecar/` vs `worker/hosted/`，可與 M4 平行。

**產物：** 官方 CLI/SDK sidecar、獨立 `CODEX_HOME`、sidecar.toml、pin 版本（當時仍受支援的 release，不把 fanzloud `0.145.0` 當永久真理）、fake executable 測試、長任務 WS status + D1 trace。

**驗收：** M5-US-05a、EV-02、SEC-013、SEC-014、SEC-CANARY、ARGV-01。ADR-0002 寫死 same-uid 殘餘風險。

**禁止：** unofficial web；與 fanzloud 共用目錄；在 Workers 上跑 Codex；測試名宣稱 tools cannot read `CODEX_HOME`；對 `replay:true` exec。

---

## 8. M6 — Ambient attention

**輸入：** **M4 與 M5 VERIFIED**（hosted 與 sidecar 都要能被同一 Inbox 規則驅動）。`ff_ambient` 預設 off。

**產物：** Inbox ambient、heuristic、Room `ambient_lock` CAS、wake budget、`releaseAmbient` finally。

**驗收：** M6-US-06、ATT-03、ATT-04、ATT-08、ATT-09、ATT-10、ATT-H4；EV-02 不因歷史 @ 啟動 CLI。無 `sleep` in `notify()`。

**禁止：** 在 `notify()` 跑 heuristic／CAS；多房共用 Inbox 物件；用 sleep 模擬 debounce。

---

## 9. M7 — 觀測、GC、可選加密（非核心完成條件）

**輸入：** M6 或至少 M4。metrics、`trace` GC（seq 洞合法）、可選 AES-GCM keyring、README 狀態句。不阻擋 M0–M6 核心完成定義。不得把平台 at-rest 寫成 E2EE。

**狀態（working tree）：** 可選 AES-GCM keyring 已落地、預設 off、**不是**端對端（not E2EE）。metrics／GC 另切片。不宣稱 live smoke。

---

## 10. 禁止在早期 PR

Telegram、跨 instance 橋、fanzloud API 整合、pokercase 原始碼改動、bee-swarm 復活、E2EE 宣稱、ChatGPT 網頁 adapter、核心版 Workers 連 thinrouter。

---

## 11. Planned command contract

下列命令是未來應建立的介面，**目前檔案／targets 尚不存在**：

| Milestone 起 | 命令 | 必須執行的工作 |
| --- | --- | --- |
| M0 | `npm test`（working directory `products/kith`） | 本階段實際存在的非空 unit/schema tests |
| M0 | `npm run lint` | 靜態檢查 |
| M1 | `kithctl hash-password` | 只產生雜湊，不連網 |
| M1 | miniflare 整合測試 | ST-D1、M1-US-01 |
| M3 | MCP fake-client 測試 | MCP-01/02、EV-01/02 |
| M4 | fake LLM 測試 | M4-US-04* |
| M5 | fake Codex 測試 | SEC-013、EV-02 |
| M7 | 可選 live smoke | 不進 CI secrets |

CI 使用根 workflow，不在 component 內建立以為會自動執行的 nested workflow。任何 target 的 missing dependency 要報錯，不准回固定 success。

---

## 12. Copyable first implementation task

> 在 `fallrising/newclear` 的 `products/kith` 實作 M0。先讀 `AGENTS.md`、`SDD.md` 及 `docs/sdd/` 的全部章節，檢查當前 branch/ancestor 規則。只固定 Node 24.18.0、JSON Schema、attention 純函式與 golden vectors、D1 recovery 函式、INV-02 SQL fixture、非空的基本 gates；不要提前實作 Durable Objects、真 LLM、frontend、sidecar 或 UI。維持本文所有不變量，新增需要的 ADR。若加 CI：根 `.github/workflows/kith.yml` + 更新 `docs/specs/monorepo-ci.md`，`contents: read`，無 secrets。PR 說明列出執行命令、exit codes、實際驗證項目、未做事項，以及 M1 的明確交接；不修改 pokercase/fanzloud/bee-swarm，不部署、不合併其他 PR。
