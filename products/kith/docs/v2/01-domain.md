# 01 — 業務模型

[回 v2 索引](README.md)

本章定義 Kith 的業務規則（BR-xx）。規則描述「產品必須怎樣」，不描述實作。每條規則標出它來自 v1 哪一條（沿用）或是 v2 新增。

## 1. 角色

| 角色 | 是誰 | 能做什麼 | 不能做什麼 |
| --- | --- | --- | --- |
| **Operator** | 部署者本人，實例唯一 | 所有成員能做的事；建房、邀請、移出；建 agent、設定 runtime、簽發／撤銷 token；管理 provider 連線；改 attention；喚醒 `operator_personal` agent | 無 |
| **Human member** | 被 operator 建立帳號並邀請的人 | 登入、讀寫自己加入的房間、@ 任何房內成員、改自己的顯示名與密碼 | 建房、邀請、管理 agent 與連線；喚醒 `operator_personal` agent |
| **Agent member** | 一個 AI 身份 | 在自己加入的房間讀寫、回報 status、寫 trace | 當 owner、管權限、簽 token、邀請、改他人 attention（INV-02） |
| **Visitor** | 未登入者 | 看到登入頁 | 其他一切 |

**BR-01**（沿用）實例恰好一個 operator。沒有公開註冊；人類帳號由 operator 建立。

**BR-02**（v2 新增）operator 可在 web 介面建立人類帳號（設定 handle、顯示名、初始密碼），取代只能跑 `kithctl bootstrap`。初始密碼只顯示一次。

## 2. 房間

**BR-10**（沿用）房間是邀請制、私有的。只有成員看得到。

**BR-11**（沿用）每房成員總數（人＋agent）≤ 32。實例房間數 ≤ 64。

**BR-12**（沿用）建房者成為 owner。不可移除最後一個 owner。

**BR-13**（v2 新增）房間可改名。`slug` 建立後不可改（URL 穩定）。

**BR-14**（v2 新增，使用者 2026-09-23 決定做）房間可封存：封存後唯讀（任何人不能送 message／trace，WS `send` 與 REST／MCP `send_message` 回 409 `room_archived`）、不喚醒 agent、`/mcp/events` 不再推 live 事件、從列表預設隱藏（「已封存」分組可展開）。operator 可解除封存。不刪除資料。

## 3. 成員與身份

**BR-20**（沿用）`handle` 格式 `[a-z0-9_]{2,32}`，實例內不分大小寫唯一。`@handle` 是提及的唯一語法。

**BR-21**（沿用）`kind` 建立後不可改。

**BR-22**（v2 新增）每個成員有顯示名；前端**所有地方**用同一個規則顯示名字：`display_name`，缺漏時用 `handle`。時間線、成員列、補全清單一致。

**BR-23**（v2 新增）頭像由前端依 `member.id` 決定性產生（首字＋固定色），v2 不上傳圖片。人類圓形、agent 圓角方形＋runtime 小徽記（見 [07](07-visual-design.md)）。

## 4. 訊息

**BR-30**（沿用）三種訊息：

| kind | 可見 | 寫 D1 | 佔 seq | 喚醒 agent |
| --- | --- | --- | --- | --- |
| `message` | 是 | 是 | 是 | 是（依 attention） |
| `trace` | 摺疊 | 是 | 是 | 否 |
| `status` | 暫時一行 | 否 | 否 | 否 |

**BR-31**（沿用）每房 `seq` 單調遞增、不重用。刪 trace 造成的洞合法。

**BR-32**（沿用）訊息不可編輯、不可刪除（v2 仍是非目標）。

**BR-33**（沿用）`body` ≤ 8 KiB UTF-8；status ≤ 512 bytes；trace 摘要 ≤ 2 KiB。

**BR-34**（v2 新增）訊息以**安全 Markdown 子集**渲染：段落、粗體、斜體、行內碼、程式碼區塊、清單、引用、連結（外開、`rel="noopener noreferrer nofollow"`）。不渲染 HTML、圖片、iframe、表格以外的擴充語法。人類與 agent 訊息用同一套渲染。

**BR-35**（v2 新增）`@handle` 在渲染時標示為提及；提及到自己的訊息整則高亮。

**BR-36**（沿用＋v2 使用）訊息可帶 `thread_id`。v2 前端提供 thread 面板：在主時間線顯示 thread 根訊息與回覆數，點開在側欄讀寫 thread。thread 回覆不出現在主時間線（見 [06](06-ux.md) §5）。

**BR-37**（v2 新增）未讀數由**瀏覽器本機**以「每房最後看過的 seq」計算，不回傳伺服器、不做已讀回執（v1 非目標不變）。

## 5. Agent

**BR-40**（v2 改寫）agent 的執行方式（runtime）有三種；operator 可以事後改變一個 agent 的 runtime（BR-47）：

| runtime | 誰執行 | Kith 做什麼 | 典型例子 |
| --- | --- | --- | --- |
| `hosted` | Kith 自己（Cloudflare 上的 HostedGeneration DO） | 組上下文、呼叫 LLM API、落盤回覆 | 任何 OpenAI 相容／Anthropic／Gemini 模型 |
| `runner` | operator 主機上的 `kith-runner` 程序 | 推送事件給 runner；runner 啟動 CLI，回報 status／trace／message | Codex CLI、Claude Code、Gemini CLI、自訂腳本 |
| `external` | 任何持有 bot token 的 MCP／HTTP client | 提供 MCP tools 與事件流；不管理它何時開口 | Claude Desktop、IDE 裡的 agent、自寫 bot |

細節見 [03](03-agent-runtime.md)。

**BR-41**（沿用）agent 被喚醒的方式由 membership 的 attention 決定：`silent`、`mention`（預設）、`keyword`、`ambient`（需 operator 顯式開啟且有 gate）。

**BR-42**（沿用）agent 不喚醒自己；agent 發言只有明確 @ 另一個 agent 時才喚醒它。

**BR-43**（沿用＋v2 推廣）`quota_class`：

- `api_key`：房內任何人類的 mention 可喚醒。
- `operator_personal`：只有 operator 能喚醒；別人的 mention 照樣落盤但不執行。
- v2：此規則適用**所有 runtime**。hosted 在 dispatch 前檢查；runner 在啟動 CLI 前本地檢查；external 由 Kith 在事件中標示 `wake_allowed`，但無法強制外部 client（見 RT-06）。

**BR-44**（沿用）每房同時最多 1 個 hosted generation、1 個 runner generation；每房每分鐘成功喚醒 ≤ 6。

**BR-45**（v2 新增）agent 回覆失敗時，房內所有人看到一行不落盤的失敗提示（例如「Grok 回覆失敗：上游限流」）；operator 另外看得到錯誤類別與 generation id。不顯示 API 回應原文。

**BR-46**（沿用）房間內容對模型而言是不可信輸入；hosted agent 沒有任何管理工具（INV-09）。

**BR-47**（v2 新增，使用者 2026-09-23 決定）agent 可改 runtime 與 runtime 設定，身份（id、handle、房間成員資格、歷史訊息）不變。規則見 [03](03-agent-runtime.md) RT-01。改動當下的 in-flight generation 被丟棄，不會以新設定落盤。

## 6. Provider 連線（v2 新增）

**BR-50** operator 可建立多個 provider 連線。一個連線 = API 格式＋base URL＋憑證＋預設 `quota_class`。

**BR-51** 憑證只能寫入，不能讀回。介面只顯示末 4 碼與建立時間。

**BR-52** 多個 hosted agent 可共用同一連線，各自選模型與參數。

**BR-53** 連線被停用或刪除時，引用它的 agent 自動變成「未啟用」，成員列顯示原因，mention 落盤但不喚醒。

**BR-54** 如果一個連線背後是**個人訂閱**（例如自架 gateway 轉個人帳號），operator 必須把它標為 `operator_personal`。Kith 無法自動偵測，這是 operator 的申報責任，介面必須在建立連線時明確詢問（見 D-05）。

## 7. 權限矩陣

| 動作 | Operator | Human | Agent（bot token） |
| --- | --- | --- | --- |
| 讀寫自己加入的房間 | ✓ | ✓ | ✓ |
| @ 喚醒 `api_key` agent | ✓ | ✓ | 只能明確 @ 另一 agent |
| @ 喚醒 `operator_personal` agent | ✓ | ✗（落盤不執行） | ✗ |
| 建房、改名、封存 | ✓ | ✗ | ✗ |
| 邀請、移出成員 | ✓ | ✗ | ✗ |
| 建人類帳號、重設密碼 | ✓ | 只改自己的密碼 | ✗ |
| 建 agent、設定 runtime | ✓ | ✗ | ✗ |
| 簽發／撤銷 bot token | ✓ | ✗ | ✗ |
| 管 provider 連線 | ✓ | ✗ | ✗ |
| 改 attention | ✓ | ✗ | ✗ |
| 看 generation 失敗細節 | ✓ | ✗ | ✗ |

## 8. Phase 2 待細化

- [ ] 每條 BR 對應至少一個 E2E ID（寫進 [08](08-testing-e2e.md) 的追溯表）。
- [x] BR-02 的帳號建立流程：欄位驗證、初始密碼長度、是否強制首次登入改密碼（Q-03）→ [W2](milestones/W2.md) §4.2.5、§5.8.3。
- [x] BR-34 Markdown 子集的完整語法表與反例（XSS 向量清單）→ [W1](milestones/W1.md) §5.4、§7.5。本文「不渲染 HTML、圖片、iframe、表格以外的擴充語法」依白名單解讀為：表格也不渲染（顯示為純文字）。
- [x] BR-45 失敗提示的文案表（每個錯誤類別一句，zh-TW 與 en 各一）→ [W3](milestones/W3.md) §5.7。
- [ ] BR-14 封存的完整行為表（哪些 API 回什麼錯誤、成員列與 @ 補全在封存房的表現）。API 與畫面部分已完成（[W2](milestones/W2.md) §4.2.6、§5.5）；成員列與 @ 補全在 W3。
- [ ] BR-47 改 runtime 的確認對話框內容與每種轉換（hosted↔runner↔external）的後果表。
