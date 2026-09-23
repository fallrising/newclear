# 10 — 決策、對 v1 的修訂、開放問題、來源

[回 v2 索引](README.md)

## 1. 決策（D-xx）

| ID | 決策 | 理由 | 狀態 |
| --- | --- | --- | --- |
| D-01 | 新前端放 `products/kith/web/`，與 `frontend/` 並存到 W7 | 可逐步驗收；隨時可比對；切換風險集中在一個 PR | Proposed（使用者 2026-09-23 同意方向） |
| D-02 | v2 文件放 `docs/v2/`；v1 SDD 保留為既有後端契約 | 不打斷 v1 的權威鏈；v2 只加不改 | Proposed（同上） |
| D-03 | 視覺方向：溫暖、親近（紙白、陶土、鼠尾草） | 產品名「Kith」＝親友；與 Slack／iOS 設定頁區隔 | Proposed（同上） |
| D-04 | 所有訊息渲染安全 Markdown 子集 | agent 輸出幾乎都是 Markdown；v1 純文字可讀性差 | Proposed（同上） |
| D-05 | hosted 支援 `openai_chat`、`anthropic_messages`（P0），`openai_responses`、`gemini`（P1）；不偏好任何供應商 | 使用者要求「支援流行的 LLM API 格式」；OpenAI 相容格式涵蓋大多數供應商 | Proposed，見 ADR-0006 |
| D-06 | agent runtime 三種：`hosted`、`runner`、`external` | Codex 不再綁 sidecar；任何 CLI 都可以是 runner；任何 MCP client 都可以是 external | Proposed |
| D-07 | 上下文以單一「不可信逐字稿」輸入送給模型（RT-04） | 多人房間不適合映射成一對一多輪；集中防注入；各格式通用 | Proposed |
| D-08 | 字型：Figtree（打包）＋系統 CJK | 溫暖的幾何無襯線；CJK 打包成本過高 | Proposed |
| D-09 | 前端技術棧（[05](05-frontend-architecture.md) §1） | 見該表 | Proposed，見 ADR-0005 |
| D-10 | provider 憑證以 AES-GCM 存 D1，key 來自 Worker secret；另支援 env 引用 | 讓 operator 在介面新增連線，不用每次改 Worker secret 與重新部署 | Proposed |
| D-11 | E2E 為主要測試手段；v2 不新增單元測試；FM 清單先行 | 使用者開發規則 | Accepted（使用者指定） |
| D-12 | 未讀以本機 cursor 計算 | 不違反 v1「不做已讀回執」；零後端成本 | Proposed |
| D-13 | 介面雙語：zh-TW＋en（FE-05） | 使用者決定 | Accepted（使用者 2026-09-23） |
| D-14 | 房間可封存與解除封存（BR-14） | 使用者決定 | Accepted（使用者 2026-09-23） |
| D-15 | agent 可改 runtime，以 `runtime_epoch` 丟棄舊 in-flight generation（RT-01、BR-47） | 使用者決定；保留身份、歷史與成員資格 | Accepted（使用者 2026-09-23） |
| D-16 | 像素比對（`toHaveScreenshot`）不在 W0–W7 範圍；所有里程碑只截圖當證據。整體施工完成後另立工作 | 使用者決定（Q-11） | Accepted（使用者 2026-09-23） |
| D-17 | Playwright 鎖定 1.56.1（Chromium revision 1194） | 與預裝瀏覽器一致；使用者決定（Q-12） | Accepted（使用者 2026-09-23） |
| D-18 | Phase 2 由 agent 逐里程碑細化，每個里程碑開 PR 並自行合併，不停下來詢問；遇到需要使用者決定的事，採文件中的預設並記為 Q-xx | 使用者 2026-09-23 指示 | Accepted（使用者 2026-09-23） |

## 2. 對 v1 的修訂

v2 批准並落地後，下列 v1 條文被修訂。其餘 v1 條文不變。

| v1 位置 | v1 內容 | v2 修訂 | 何時生效 | 依據 |
| --- | --- | --- | --- | --- |
| SDD FR-06；DESIGN LLM adapter；[04 協定](../sdd/04-protocol.md) §7 | hosted 只直連 `https://api.x.ai/v1`；允許清單只有官方 xAI；不呼叫 Anthropic `/v1/messages` | hosted 經 `LlmAdapter` 呼叫 operator 設定的連線；格式見 D-05；V2-INV-02 取代白名單 | W4 | ADR-0006 |
| [ADR-0002](../adr/0002-credentials.md) Hosted default | 核心版 hosted 只直連 xAI；Secret `XAI_API_KEY` | xAI 成為 preset 之一；`XAI_API_KEY` 經遷移變成 env 連線 | W4 | ADR-0006 |
| SDD §3 刻意不做；[08](../sdd/08-decisions-sources.md) | 核心版 Workers 不連 thinrouter | Kith 不內建個人訂閱轉 API 的 preset；operator 自接者必須標 `operator_personal`（BR-54、RT-11） | W4 | ADR-0006 |
| SDD FR-07；[ADR-0003](../adr/0003-codex-pin.md) | personal agent＝Codex sidecar | runner 泛化（Codex 是 adapter 之一）；INV-13、INV-14 推廣到所有 adapter（RT-06、RT-07） | W6 | 本文件 |
| [09 UI](../sdd/09-human-chat-ui.md)、[10 UI](../sdd/10-members-and-mention.md) 視覺與鎖字；[11 房間畫面](../sdd/11-room-screen.md)（#48 起取代 09、10 的畫面部分） | 11 的深色 rail／暖白紙面色票與版面；固定英文字串；`live` pill；不做 Markdown | v2 [06](06-ux.md)、[07](07-visual-design.md) 取代；09、10 的行為規則保留 | W7 | ADR-0005 |
| SDD §3 刻意不做 | Markdown | 安全子集（BR-34） | W1（新前端） | D-04 |

**不修訂**：INV-01–INV-19 全部保留。尤其 INV-08（Room 不呼叫 LLM）、INV-09（模型無管理工具）、INV-13（operator-only personal 配額）、INV-15（LLM fetch 只在 HostedGeneration DO）、INV-19（replay 不是工作佇列）。

## 3. 開放問題（Q-xx）

| ID | 問題 | 預設（未回答時採用） | 需要在何時前決定 |
| --- | --- | --- | --- |
| Q-01 | 是否需要 `openai_responses` 與 `gemini` 在 W4 就交付？ | 否，延到 W5 | W4 Phase 2 |
| Q-02 | 介面語言 | **已決定（2026-09-23）：繁中＋英文**，見 D-13、FE-05 | — |
| Q-03 | operator 建的人類帳號，首次登入是否強制改密碼？ | 是 | W2 Phase 2 |
| Q-04 | 房間封存 | **已決定（2026-09-23）：做**，見 D-14、BR-14 | — |
| Q-05 | 每連線每日 token 預算要不要做？ | W5 之後再議 | W5 Phase 2 |
| Q-06 | agent 能否改 runtime | **已決定（2026-09-23）：可以**，見 D-15、RT-01、BR-47 | — |
| Q-07 | 上下文要不要支援多輪映射（把 agent 自己過去的回覆標成 assistant）？ | 否（RT-04） | W5 之後 |
| Q-08 | 各 CLI（Claude Code、Gemini CLI、Codex）的非互動旗標與輸出格式 | 查官方文件後鎖定 | W6 Phase 2 |
| Q-09 | hosted agent 之後要不要開放受限工具（例如只讀的網頁搜尋）？ | 否；需另立 ADR 並修 INV-09 | 未排程 |
| Q-10 | 手機是否做 PWA（可安裝、推播）？ | 不在 v2 範圍 | 未排程 |
| Q-11 | 何時啟用 `toHaveScreenshot` 像素比對？ | **已決定（2026-09-23）：整體施工（W0–W7）完成後才做**，見 D-16 | — |
| Q-12 | Playwright 維持 1.56.1 還是升級？ | **已決定（2026-09-23）：維持 1.56.1**，見 D-17 | — |

## 4. 來源

v1 來源見 [v1 08](../sdd/08-decisions-sources.md)。v2 新增的外部來源在 Phase 2 查證；狀態不是「已查證」的列都**不是**已驗證事實。

本環境的網路政策擋掉 `playwright.dev`、`www.w3.org`、`developers.cloudflare.com`；已查證的列改讀各官方文件的原始碼倉庫（`raw.githubusercontent.com`，固定到 tag 或 commit）或 npm 發行套件本身。

| ID | 來源 | 要確認的事 | 狀態 |
| --- | --- | --- | --- |
| S2-01 | OpenAI API reference：Chat Completions、Responses、Models | 請求／回應欄位、串流事件、錯誤碼、`retry-after` | 待查證 |
| S2-02 | Anthropic API reference：Messages、Models、Streaming、Errors | `anthropic-version` 現行值、SSE 事件類型、529 | 待查證 |
| S2-03 | Google Gemini API：generateContent、streamGenerateContent、OpenAI 相容端點 | base URL、認證 header、串流格式 | 待查證 |
| S2-04 | xAI API docs | 仍為 OpenAI 相容；模型列表端點 | 待查證 |
| S2-05 | DeepSeek、OpenRouter、Mistral、Groq API docs | base URL、相容程度、特殊 header | 待查證 |
| S2-06 | Claude Code、Gemini CLI、Codex CLI 文件 | 非互動模式、結構化輸出、登入方式 | 待查證 |
| S2-07 | Cloudflare Workers：outbound fetch 限制、SSE 讀取、Durable Object alarm | 串流在 DO 內的可行性與 CPU 計費 | 待查證 |
| S2-08 | WCAG 2.2 對比與目標尺寸 | 07 的對比表 | 已查證 2026-09-23：W3C `w3c/wcag` 倉庫 commit `71c891a`：[relative-luminance](https://raw.githubusercontent.com/w3c/wcag/71c891a49f50f58766597a8980f6b2d2eedd5679/guidelines/relative-luminance.html)（係數 0.2126／0.7152／0.0722，sRGB 門檻 0.04045）、[contrast-minimum](https://raw.githubusercontent.com/w3c/wcag/71c891a49f50f58766597a8980f6b2d2eedd5679/understanding/20/contrast-minimum.html)（4.5:1、大字 3:1、門檻不四捨五入）、[non-text-contrast](https://raw.githubusercontent.com/w3c/wcag/71c891a49f50f58766597a8980f6b2d2eedd5679/understanding/21/non-text-contrast.html)（3:1）、[target-size-minimum](https://raw.githubusercontent.com/w3c/wcag/71c891a49f50f58766597a8980f6b2d2eedd5679/understanding/22/target-size-minimum.html)（24×24 CSS px）。結論寫入 [07](07-visual-design.md) §2.5 |
| S2-09 | Playwright：clock、trace、`toHaveScreenshot` | 08 的決定性作法 | 已查證 2026-09-23：`microsoft/playwright` tag `v1.56.1` 的文件原始檔 [clock.md](https://raw.githubusercontent.com/microsoft/playwright/v1.56.1/docs/src/clock.md)（建議 `setFixedTime`；`install` 讓時間繼續走）、[class-websocketroute.md](https://raw.githubusercontent.com/microsoft/playwright/v1.56.1/docs/src/api/class-websocketroute.md)（`connectToServer` 轉送）、[class-reporter.md](https://raw.githubusercontent.com/microsoft/playwright/v1.56.1/docs/src/test-reporter-api/class-reporter.md)（`onEnd` 可覆寫狀態與 exit code）、[test-global-setup-teardown-js.md](https://raw.githubusercontent.com/microsoft/playwright/v1.56.1/docs/src/test-global-setup-teardown-js.md)（setup 設的環境變數只在 `test()` 內可見）、[test-snapshots-js.md](https://raw.githubusercontent.com/microsoft/playwright/v1.56.1/docs/src/test-snapshots-js.md)（基準圖依瀏覽器與平台區分）。另以 1.56.1 實測，見 [W0](milestones/W0.md) §10。結論寫入 [08](08-testing-e2e.md) §2.2、§5.2 |
| S2-10 | wrangler 4.135.0、miniflare 5.20260918.0-alpha（npm 發行套件的程式碼） | E2E 隔離：`.dev.vars` 載入規則、對外連線開關 | 已查證 2026-09-23：`wrangler-dist/cli.js` 的 `getVarsForDev`（給 `--env-file` 時不讀 `.dev.vars`）、`WRANGLER_SEND_METRICS`；`miniflare/dist/src/index.js` 的 `CLOUDFLARE_CF_FETCH_ENABLED`（值為 `false` 時不下載 `cf.json`）；`wrangler dev --help` 列出 `--assets`、`--persist-to`、`--inspector-port`、`--env-file`、`--var`。另以實測確認，見 [W0](milestones/W0.md) §10 |
| S2-11 | npm registry（`registry.npmjs.org`） | web／e2e 套件精確版本與 peer 相容 | 已查證 2026-09-23：各套件版本與 peer 範圍見 [05](05-frontend-architecture.md) §1.1；`playwright-core@1.56.1` 的 `browsers.json` 綁定 Chromium revision 1194（`141.0.7390.37`），1.57.0 為 1200 |

## 5. Phase 2 待細化

- [ ] 每個 Q 取得使用者答案或採用預設，寫回 D 表。
- [ ] S2 各來源查證，附 URL 與查閱日期，並把結論寫回 03、04、07、08。S2-08、S2-09 已完成（W0）；新增 S2-10、S2-11（W0）；S2-01–S2-07 在 W4、W6 前完成。
