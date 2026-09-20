# kith

單 operator、自托管的人機群聊：人類與 LLM agent 是同一房間裡的一等成員。瀏覽器、MCP client、本機 Codex sidecar、以及 Cloudflare Workers 上的 hosted conversational agent，寫入同一條 Room Durable Object 訊息匯流排。

對外產品名：**Kith**。目錄與程式 id 為 `kith`。

**狀態：documentation-only；尚無 runtime。** 本目錄目前只有規格與 ADR。沒有 `worker/`、`frontend/`、`sidecar/`、`package.json`、`wrangler.toml` 或 CI workflow。不得把未執行的測試、未建立的命令或預期延遲描述成已完成。精確契約見 [SDD.md](SDD.md)。

## 從這裡開始

1. [產品／架構設計](DESIGN.md)：已批准的模組邊界、schema、協定、資源上限與 PR 切片。與 SDD 衝突時，先修文件再寫程式。
2. [SDD 主文件](SDD.md)：目標、範圍、FR/INV、架構責任、資源預算與文件優先級。
3. [Agent 工作規則](AGENTS.md)：目錄邊界、禁止碰 pokercase/fanzloud 原始碼、禁止 unofficial scraping、禁止共用 `CODEX_HOME`、milestone 交接。
4. [開發里程碑](docs/sdd/07-roadmap.md)：M0–M6，每個階段的輸入、產物、驗收與禁止越界事項。

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

本 pass **只描述、不執行**。實際 `scripts/bootstrap.sql` 與 `kithctl` 屬於 M1（見 [07-roadmap](docs/sdd/07-roadmap.md)）。

1. 在 operator 機器上用未來的 `kithctl hash-password` 產生 WebCrypto **PBKDF2-SHA-256** 雜湊（`iterations ≥ 100_000`）。**禁止** Node `argon2` native addon 與 `m>16 MiB` 的 WASM argon2id。本文件不放雜湊樣本。
2. Seed SQL（M1 才 `wrangler d1 execute`；此處只規定語意）：
   - 插入恰好一列 `members.is_operator = 1` 的 human（`kind='human'`、`password_hash` 為上一步輸出、`handle` 例如 `owner`）。
   - 插入第一個 `rooms` 列；`created_by` 為該 operator `member_id`。
   - 插入 `room_members(role='owner')` 把 operator 加入該房。
   - 可選：再插入第二個人類，之後由 owner 呼叫 `POST /api/rooms/:id/members`。
3. 登入兩個 session，互打一則訊息 → 同一 `seq`（驗收 **M1-US-01**）。

`kithctl` 最小指令（M1）：`hash-password`、`bootstrap`。不進 Cloudflare；只產生 SQL / 本機執行 D1。無公開註冊。

## 明確禁止

- **不要 fork EdgeChat**（GPL-3.0 vs newclear MIT）。只借 operational shape 與「只投影本地原創」不變量；程式與 DDL 自寫。
- **不要 scraping** 非官方 ChatGPT / Grok 網頁或任何 reverse-engineered subscription extractor。pokercase 既有的 OAuth import 仍只存在 Layer A。
- **不要與 `platform/fanzloud` 共用** `CODEX_HOME`、workspace、或同一 CLI 可執行檔路徑（INV-14）。kith 不呼叫 fanzloud HTTP API。
- **不要改** `gateways/pokercase/**` 或 `platform/fanzloud/**` 的原始碼來承載房間。pokercase 維持 Layer A；核心版 Workers 不連 thinrouter。
- **不要復活** `labs/bee-swarm`。

## 授權

與 newclear 根目錄一致：MIT。禁止把 GPL-3.0 原始碼複製進本目錄。
