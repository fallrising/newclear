# kith

單 operator、自托管的人機群聊：人類與 LLM agent 是同一房間裡的一等成員。瀏覽器、MCP client、本機 Codex sidecar、以及 Cloudflare Workers 上的 hosted conversational agent，寫入同一條 Room Durable Object 訊息匯流排。

對外產品名：**Kith**。目錄與程式 id 為 `kith`。

**狀態：M0–M6 核心路徑與可選 M7（GC／metrics／AES-GCM keyring）在 working tree（尚未 merge）。** **不是**端對端加密（not E2EE），也不是 SaaS。不得把未執行的測試描述成已完成。精確契約見 [SDD.md](SDD.md)。

## 從這裡開始

1. [產品／架構設計](DESIGN.md)：已批准的模組邊界、schema、協定、資源上限與 PR 切片。與 SDD 衝突時，先修文件再寫程式。
2. [SDD 主文件](SDD.md)：目標、範圍、FR/INV、架構責任、資源預算與文件優先級。
3. [Agent 工作規則](AGENTS.md)：目錄邊界、禁止碰 pokercase/fanzloud 原始碼、禁止 unofficial scraping、禁止共用 `CODEX_HOME`、milestone 交接。
4. [開發里程碑](docs/sdd/07-roadmap.md)：M0–M6，每個階段的輸入、產物、驗收與禁止越界事項。
5. [本機 Wrangler 開發](#本機-wrangler-開發l1)：先 `wrangler dev`，再談上線。

## 規格章節

| 文件 | 開發時解決的問題 |
| --- | --- |
| [目的與邊界](docs/sdd/00-purpose.md) | 問題、非目標、2026-09-20 freeze override、與 EdgeChat / fanzloud / pokercase 的邊界 |
| [使用者故事](docs/sdd/01-user-stories.md) | US-01–US-06 的 Given/When/Then |
| [不變量](docs/sdd/02-invariants.md) | INV-01–INV-19 可測試陳述 |
| [資料模型](docs/sdd/03-data-model.md) | DDL、trigger、D1 recovery、v1 enum、GC |
| [協定](docs/sdd/04-protocol.md) | HTTP（含 membership）、WS、MCP 2025-03-26、events splice、錯誤碼 |
| [Attention](docs/sdd/05-attention.md) | notify envelope、CAS、tokenizer、keyword、heuristic、wake budget |
| [驗證](docs/sdd/06-verification.md) | requirement → test ID、fake LLM/Codex、canary secrets |
| [決策與來源](docs/sdd/08-decisions-sources.md) | EdgeChat GPL、ADR-0002、MCP、xAI、Cloudflare limits |

## Bootstrap 食譜（第一個 owner + 第一個房間）

`scripts/bootstrap.sql` 與 `cmd/kithctl.mjs` 屬 M1。從 `products/kith`：

```text
node cmd/kithctl.mjs hash-password
node cmd/kithctl.mjs bootstrap --operator-id ... --operator-hash ... --second-hash ...
```

1. 用 `kithctl hash-password` 產生 WebCrypto **PBKDF2-SHA-256** 雜湊（`iterations ≥ 100_000`）。**禁止** Node `argon2` native addon 與 `m>16 MiB` 的 WASM argon2id。本文件不放雜湊樣本。
2. Seed SQL（M1 才 `wrangler d1 execute`；此處只規定語意）：
   - 插入恰好一列 `members.is_operator = 1` 的 human（`kind='human'`、`password_hash` 為上一步輸出、`handle` 例如 `owner`）。
   - 插入第一個 `rooms` 列；`created_by` 為該 operator `member_id`。
   - 插入 `room_members(role='owner')` 把 operator 加入該房。
   - 可選：再插入第二個人類，之後由 owner 呼叫 `POST /api/rooms/:id/members`。
3. 登入兩個 session，互打一則訊息 → 同一 `seq`（驗收 **M1-US-01**）。

`kithctl` 最小指令（M1）：`hash-password`、`bootstrap`。不進 Cloudflare；只產生 SQL / 本機執行 D1。無公開註冊。本機第一次進房間屬 **L2**，不在 L1。

## 本機 Wrangler 開發（L1）

從 `products/kith`（Node **24.18.0**）。**不必** `wrangler login` 就能本地跑。功能開關在 `wrangler.toml` 預設全 `off`。

```text
cp .dev.vars.example .dev.vars   # gitignored；L1 可留空 XAI_API_KEY
npm run db:migrate:local         # wrangler d1 migrations apply kith --local
npm run dev                      # Worker http://127.0.0.1:8787
npm run dev:frontend             # Vite http://127.0.0.1:5173 代理 /api 與 /mcp
```

L1 驗收：`GET /api/csrf` 回 JSON。還沒有 seed 帳號，登入會失敗（屬 L2）。不要把 `.dev.vars` 或密碼雜湊提交進 git。

## 本機兩個帳號（L2）

```text
npm run db:migrate:local
npm run db:bootstrap:local    # 印出 owner/guest 密碼；寫入 gitignored .dev.accounts
npm run dev
npm run dev:frontend          # 另開終端；瀏覽器 http://127.0.0.1:5173
```

預設 handle：`owner`（operator）、`guest`。兩者都已加入 `lobby`（`room-1`）。密碼只在本機 `.dev.accounts`，不進 git。可用環境變數 `KITH_OWNER_PASSWORD` / `KITH_GUEST_PASSWORD` 覆寫後再跑 bootstrap。

兩個瀏覽器（或無痕視窗）分別登入後進 Lobby，互打一則訊息應看到同一 seq。

## 本機 MCP 與 @grok（L3）

`npm run dev` 會把本機 `ff_mcp` / `ff_hosted_agent` 打開（`wrangler.toml` 預設仍 off，給之後上線用）。`.dev.vars` 留空 `XAI_API_KEY` 時 hosted 走 `FAKE_LLM_TEXT`；填了 key 則打 `https://api.x.ai/v1`。

```text
npm run db:bootstrap:local   # 一併 seed grok agent + bot token（寫進 .dev.accounts）
npm run dev
```

在 Lobby 打 `@grok hello`：fake LLM 預設回 `hello from grok`。MCP：`Authorization: Bearer $KITH_GROK_BOT_TOKEN` 打 `POST /mcp`。

## 本機 Codex sidecar（L4）

預設 **fake CLI**（`sidecar/fake-cli.mjs`），路徑在 `~/.local/kith-dev/`（與 fanzloud 不相交）。`quota_class=operator_personal`：只有 `owner` 的 `@codex` 會啟動 CLI。

```text
npm run db:bootstrap:local
npm run dev                  # 已開著可略過
npm run dev:sidecar          # 另開終端；讀 .wrangler/sidecar.local.toml
```

在 Lobby 用 **owner** 打 `@codex please look`。guest 的 `@codex` 會落盤但不啟動 CLI。

之後若要官方 CLI：編輯 `.wrangler/sidecar.local.toml` 的 `executable` 成絕對路徑，保持 `codex_home` / `workspace` 不與 fanzloud `CODEBOX_*` 重疊。不要把 token 寫進 toml。

## 本機 ambient（L5）

`npm run dev` 本機也開 `ff_ambient`。bootstrap 把 **grok** 設成 `attention_mode=ambient`、`debounce_ms=0`（仍可用 operator `PATCH /api/rooms/room-1/members/grok/attention` 改回 `mention`）。

空房間打一句通過 heuristic 的話（例如 `are you there?`，不必 @）：alarm 後 grok 應回 fake LLM。若最近 10 則已有 agent 發言，H4 會否決，這是規格不是故障。`@grok` 仍走 mention，不經 heuristic。

## 明確禁止

- **不要 fork EdgeChat**（GPL-3.0 vs newclear MIT）。只借 operational shape 與「只投影本地原創」不變量；程式與 DDL 自寫。
- **不要 scraping** 非官方 ChatGPT / Grok 網頁或任何 reverse-engineered subscription extractor。pokercase 既有的 OAuth import 仍只存在 Layer A。
- **不要與 `platform/fanzloud` 共用** `CODEX_HOME`、workspace、或同一 CLI 可執行檔路徑（INV-14）。kith 不呼叫 fanzloud HTTP API。
- **不要改** `gateways/pokercase/**` 或 `platform/fanzloud/**` 的原始碼來承載房間。pokercase 維持 Layer A；核心版 Workers 不連 thinrouter。
- **不要復活** `labs/bee-swarm`。

## 授權

與 newclear 根目錄一致：MIT。禁止把 GPL-3.0 原始碼複製進本目錄。
