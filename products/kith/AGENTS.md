# kith — Agent development contract

## Scope and authority

本文件適用於 `products/kith/**`。先讀 `SDD.md`、本次 milestone 所引用章節及 `docs/sdd/08-decisions-sources.md`。目前只有規格；不要把未執行的測試、未建立的命令或預期延遲描述成已完成。

文件優先級：`SDD.md` 的安全不變量（INV）> 專題章節（`docs/sdd/00`–`08`）> roadmap 的示例命令與 PR 切片。發現互相矛盾時，先提出修訂及測試反例，不能挑較容易的版本實作。架構數字與協定以 [DESIGN.md](DESIGN.md) 為準；文風與章節形狀以 mkfk 為準。與 DESIGN 衝突時，先修文件再寫程式。

## Change boundary

- 預設只改本目錄（`products/kith/**`）。
- 明確必要的例外（須在 PR／task 說明）：根 [`README.md`](../../README.md) 的產品列、[`PORTFOLIO.md`](../../PORTFOLIO.md) 的 owner override 節、以及**之後**根 `.github/workflows/kith.yml` + [`docs/specs/monorepo-ci.md`](../../docs/specs/monorepo-ci.md)（屬 M0／PR-1，本文件 baseline **不**新增）。
- **MUST NOT** 碰 `gateways/pokercase/**` 原始碼。pokercase 是 Layer A；kith 是 Layer B client。不得在 gateway 裡長出聊天室。
- **MUST NOT** 碰 `platform/fanzloud/**` 原始碼。kith 只引用 ADR-0002 憑證邊界，不呼叫 fanzloud HTTP、不共用 runtime。
- **MUST NOT** 碰 `labs/bee-swarm/**`。不得復活該 lab。
- 不改其他 component 的程式、依賴、release、部署、秘密或資料。
- 不把 sibling project 的 `AGENTS.md` 當成此目錄的繼承規則；開始工作仍須檢查當時存在的 ancestor 規則。
- 不 force-push、不刪 branch、不合併其他 PR、不自動部署。
- **沒有 commit / push / deploy**，除非當前 task 檔或使用者明確授權。本文件 baseline 的 task **沒有**授權。

## Forbidden implementations

- **MUST NOT** 實作非官方 ChatGPT 網頁、Grok 網頁、或任何 reverse-engineered subscription scraping。沒有 `chatgpt_web` / `grok_web` adapter。
- **MUST NOT** 與 fanzloud 共用 `CODEX_HOME`、workspace、或同一 CLI 可執行檔（INV-14）。啟動時路徑必須不相交、不嵌套、不是同一 inode。
- **MUST NOT** 在 Cloudflare Workers 上跑 Codex、shell、或 git workspace（INV-11）。
- **MUST NOT** 從核心版 Workers 連 thinrouter 或寫 Cloudflare Tunnel 把 `127.0.0.1:20128` 打到公網。
- **MUST NOT** fork 或 copy EdgeChat 原始碼、schema 名稱（`cfchat`、`ChannelRoom` 類名可概念借鏡，不得原樣搬）。
- **MUST NOT** 把個人 Codex/ChatGPT/Claude/Grok CLI subscription 池化、轉售、借出，或讓第二個自然人透過 `@agent` 喚醒該訂閱（INV-13）。文件禁令不算實作；必須有 API 閘門與測試。
- **MUST NOT** 在文件或測試名裡寫「tools cannot read CODEX_HOME」。核心版接受 same-uid 殘餘風險（見 [ADR-0002](docs/adr/0002-credentials.md)）。
- **MUST NOT** 新增 `subscribe_events` MCP tool。
- **MUST NOT** 在 Room DO 呼叫 LLM 或跑分類器（INV-08）。
- **MUST NOT** 用 Worker `waitUntil` 跑模型（INV-15）。
- **MUST NOT** 在 `Inbox.notify()` 裡 `setTimeout` / `sleep` / 等待 LLM（INV-18）。

## Implementation discipline

一次實作一個 milestone。M0 通過前不做 M1；M1 通過前不做 agent runtime；M2 通過前不做 MCP；M3 通過前不做 hosted LLM；ambient **最後**（M6），且 `ff_ambient` 預設 off。不得因另一個 agent 提前完成某個函式，就跳過其依賴的驗收。

M0 必須交出已填滿的 attention 純函式、mention tokenizer、keyword matcher、quota gate、D1 recovery vectors、MCP schema（不含 `subscribe_events`）、以及 INV-02 trigger SQL 測試——不是空殼。禁止在 M0 實作 Durable Object 或真 LLM。

密碼：WebCrypto PBKDF2-SHA-256，`iterations ≥ 100_000`。禁止 Node `argon2` native addon 與 `m>16 MiB` 的 WASM argon2id。

所有 timer、隨機數、網路與 LLM 錯誤都要有可注入介面。Attention 核心必須是純函式 + 少量持久狀態。測試使用 fake clock、fake LLM、fake Codex executable、固定 golden vectors；`sleep` 不能作為正確性證明。

不得把 timeout 當成沒有寫入；不得以改 `quota_class`、降低 cap、共用 `CODEX_HOME`、或清空 D1 來讓測試通過。

## Parallel work and review

Planner 維護里程碑與 acceptance IDs。Room、Inbox、HostedGeneration、sidecar、frontend 分別限定目錄。先固定跨模組介面及 golden vectors，再平行實作。Reviewer 不得只看 happy path；必須追蹤至少一次「D1 INSERT 成功但 broadcast 前 crash」及一次非 operator mention `operator_personal` agent 的完整事件序列。

單一 writer 擁有同一份格式／協定規格。跨模組改動由整合者合併，不能讓多個 agent 同時改寫契約而互相覆蓋。

## Required handoff

每個 PR／task 報告必須列出：

1. 對應 **milestone**、requirement/test IDs、實際變更與未做範圍。
2. 執行 **commands**、工具鏈版本（Node **24.18.0** 當 CI 存在時）、exit code、測試輸出位置；未執行要明說原因。
3. **evidence**：故障注入結果、已知風險、ADR 變更及下一個可執行任務。

程式階段的基本 gate 是格式、靜態檢查、unit、對應 integration tests。命令契約見 `docs/sdd/07-roadmap.md`；在 M0 建立前不能假裝已存在。

若建立 GitHub Actions，必須放在 repository 根 `.github/workflows/kith.yml`，遵守 `docs/specs/monorepo-ci.md`：path-scoped（`products/kith/**` + 該 workflow）、`contents: read`、timeout、concurrency cancellation、action immutable SHA、checkout 不保留 credentials，**不新增 publish/deploy 或 secrets**。Node **24.18.0**。Deploy 不是 CI job。本文件 baseline 不新增該 workflow。

## Safety and evidence

故障測試只對本次建立的 child processes、暫存目錄及隔離 miniflare 操作。禁止用廣域 `pkill`、主機防火牆重設或刪除使用者既有 volume／`CODEX_HOME`。測試資料不得包含真實 credentials 或私人資料；log 不記錄 body、token、API key、prompt 全文。Canary secret 用於紅隊測試，不得檢入真實 key。

每次交接更新 milestone 狀態，保留 `NOT_STARTED` / `IN_PROGRESS` / `VERIFIED` 的區分。可編譯、可啟動、測試通過及完整 milestone 驗收是不同狀態。本文件提交不是任何功能 milestone 的完成證明。
