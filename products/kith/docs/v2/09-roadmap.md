# 09 — 里程碑

[回 v2 索引](README.md)

## 1. 工作方式

- **每個里程碑都是：先文件 PR（Phase 2 細化該里程碑），再實作 PR。** 小里程碑可合成一個 PR，但文件 commit 必須在程式 commit 之前。
- 實作中發現文件錯誤：停下，先改文件（同 PR 內獨立 commit，說明原因），再繼續。
- 一個里程碑完成＝該里程碑全部 E2E ID 通過，且證據資料夾的 `summary.md` 貼在 PR。
- 開發期只跑該里程碑的 spec；PR 前跑一次全套（含 v1 `npm test`）。
- 狀態用 `NOT_STARTED` / `DOC_READY` / `IN_PROGRESS` / `VERIFIED`。可編譯、可啟動、E2E 通過是不同狀態。

## 2. 依賴圖

```text
P1 大框架（本 PR）
 └─ W0 E2E 骨架＋web 骨架
     └─ W1 聊天核心（B-01）
         ├─ W2 房間與帳號（B-02, B-04, B-08, B-14）
         │   └─ W3 成員、提及、回覆狀態（B-11）
         │       └─ W4 Providers＋hosted 多格式＋控制台（B-03, B-07, B-09）
         │           └─ W5 串流草稿與 generation 可觀測（B-06?, B-10）
         └───────────── W6 Runner 泛化、trace、thread（B-05, B-12, B-13）［需 W3、W4 的控制台］
                         └─ W7 切換部署、移除舊前端
```

## 3. 里程碑

### P1 — 大框架文件（本 PR）

- 產物：`docs/v2/*`、ADR-0005、ADR-0006（皆 Proposed）、v1 文件指向 v2 的註記。
- 驗收：使用者審閱通過並合併。無程式、無測試。
- 狀態：`IN_PROGRESS`（本 PR）。

### W0 — E2E 與 web 骨架

- 先決：P1 合併；W0 的 Phase 2 文件（harness 細節、seed、manifest schema）。
- 產物：`e2e/`（config、global setup／teardown、seed、evidence、manifest）；`web/` 空殼（Vite、React、路由、token、登入頁）；`npm run e2e`。
- 驗收：
  - `E2E-W0-01` 隔離環境啟動、migration、seed 完成，登入頁可見，operator 可登入並看到空的主畫面。
  - `E2E-W0-02` 證據資料夾結構與 manifest 通過 schema 驗證；遮罩掃描為 0。
- 禁止：任何聊天功能；修改後端。

### W1 — 聊天核心

- 產物：RoomSync、時間線（分組、日期分隔、Markdown）、composer（送出、pending／failed、IME）、房間路由、B-01。
- 驗收：
  - `E2E-W1-01` 舊 `frontend/` 在 B-01 之後仍可登入、收發（V2-INV-04）。
  - `E2E-W1-02` 兩人互發，雙方同順序同 seq（UJ-02）。
  - `E2E-W1-03` 斷線重連補齊、無重複、草稿保留；含 ws-chaos 亂序與丟包（FM-SYNC-01–07）。
  - `E2E-W1-04` 1,200 則長房間：進房即最新頁；往上翻頁到開頭；錨點不跳（UJ-03、FM-SYNC-12）。
  - `E2E-W1-05` Markdown 白名單與 XSS 向量（BR-34、FE-20）。
  - `E2E-W1-06 @mobile` 手機：列表→房間→返回；重新整理停在同一房。
- 禁止：成員面板、agent 相關 UI、控制台。

### W2 — 房間與帳號

- 產物：sidebar（預覽、未讀、排序、搜尋）、建房、房間改名／封存、個人設定、B-02、B-04、B-08、B-14；控制台 People 頁。
- 驗收：
  - `E2E-W2-01` operator 首次登入引導→建房→建人類帳號→邀請→對方登入看得到房（UJ-01）。
  - `E2E-W2-02` 改名後雙方列表更新（重新抓取即可）。
  - `E2E-W2-03` 未讀數與「新訊息」分隔線（UJ-04、BR-37）。
  - `E2E-W2-04` 非 operator 看不到控制台入口，直接開 URL 得到 403 畫面。

### W3 — 成員、提及、回覆狀態

- 產物：右側成員面板、agent detail、@ 補全（沿用 v1 10 章鍵盤規則）、提及高亮、hosted 回覆佔位、typing、B-11 失敗提示；以 v1 hosted（xAI 路徑＋fake）驗證。
- 驗收：
  - `E2E-W3-01` 成員面板分人／AI，限制句正確。
  - `E2E-W3-02` @ 補全：鍵盤、點按、IME、Escape（v1 UI-10-02 的行為）。
  - `E2E-W3-03` `@agent` → 佔位 → 正式訊息；`reply failed` → 失敗提示。
  - `E2E-W3-04` 非 operator @ `operator_personal`：事前可見限制、落盤、無回覆中（UJ-06）。

### W4 — Providers、hosted 多格式、控制台

- 先決：W4 Phase 2 文件含各格式欄位對照（已查證）與 FM-LLM fixtures 清單。
- 產物：migration 0002、B-03、B-07、B-09、`LlmAdapter`（`openai_chat`、`anthropic_messages` 必交；`openai_responses`、`gemini` 可延 W5）、遷移腳本（[03](03-agent-runtime.md) §7）、控制台 Agents／Providers／Tokens。
- 驗收：
  - `E2E-W4-01` 新增連線（fake-provider，`openai_chat`）→ 測試成功→列出模型。
  - `E2E-W4-02` 新增 hosted agent → 邀進房 → @ → 回覆（UJ-07）。
  - `E2E-W4-03` 同一流程用 `anthropic_messages` 格式。
  - `E2E-W4-04` 簽發兩把 token，撤銷一把即 401，另一把可用（UJ-09）。
  - `E2E-W4-05` canary key 不出現在任何 API 回應、WS 封包、server log（V2-INV-01）。
  - `E2E-W4-06` 連線停用後 mention 落盤、不產生 generation、成員格顯示原因（V2-INV-05、BR-53）。
  - `E2E-W4-07` v1→v2 遷移腳本在含 v1 資料的 seed 上執行兩次，結果相同。
- 禁止：串流草稿、runner 改動。

### W5 — 串流與可觀測

- 產物：B-10 草稿、`ff_drafts`、generation 列表頁、錯誤類別顯示、（選做）B-06 使用者事件流、延後的 adapter 格式。
- 驗收：
  - `E2E-W5-01` 串流：佔位內文字逐步增加，最後換成正式訊息（UJ-05）。
  - `E2E-W5-02` 串流前後 D1 訊息列數差恰為 1；`/mcp/events` 未出現草稿（V2-INV-03）。
  - `E2E-W5-03` 串流中斷（fake-provider 中途斷線）→ 失敗提示，不落盤半截（FM-LLM-08）。
  - `E2E-W5-04` operator 在 generation 列表看到失敗類別；一般成員看不到。

### W6 — Runner、trace、thread

- 先決：W6 Phase 2 文件含 `runner.toml` schema、各 CLI adapter 細節（Q-08）。
- 產物：`kith-runner`（由 `sidecar/` 演進，保留 Codex adapter 與 v1 所有安全規則）、`command` adapter、B-05、B-12、B-13、trace 卡片、thread 面板。
- 驗收：
  - `E2E-W6-01` runner（fake CLI）：@ → accepted → running → trace → 摘要訊息（UJ-08）。
  - `E2E-W6-02` 非 operator @ personal runner：CLI 不啟動（UJ-06、FM-RUN-08）。
  - `E2E-W6-03` thread：主時間線只見根訊息＋回覆數；面板內讀寫（UJ-10）。
  - `E2E-W6-04` runner 斷線重連後不重跑已完成 trigger；`replay:true` 不執行（FM-RUN-01、02、05）。
  - `E2E-W6-05` v1 sidecar 既有測試（`npm run test:sidecar`）仍通過。

### W7 — 切換

- 產物：`wrangler.toml` assets 指向 `web/dist`；移除 `frontend/`；v1 09、10 章標 superseded；README 狀態更新；CI e2e job。
- 驗收：
  - `E2E-W7-01` 全套 E2E 通過（唯一一次在里程碑內跑全套），證據資料夾附在 PR。
  - `E2E-W7-02` production build 大小與效能預算（[05](05-frontend-architecture.md) §7）。

## 4. Phase 2 的寫法（給之後的細化）

每個里程碑的 Phase 2 文件放在 `docs/v2/milestones/Wn.md`，固定章節：

1. **範圍**：本里程碑做的 B-xx、畫面、FM。
2. **檔案清單**：要新增／修改的每個檔案路徑與一句用途。
3. **契約**：用到的 API 完整 schema（連到 `contracts/v2/`）。
4. **元件規格**：每個元件的 props、狀態、`data-testid`、文案 key。
5. **任務卡**：按順序編號（`Wn-T01`…），每張卡：輸入、步驟、完成條件、對應 E2E ID。任務卡小到一次 PR 可審。
6. **E2E 腳本**：每個 ID 的逐步操作與斷言。
7. **FM 對照**：本里程碑涉及的每條 FM 由哪個 E2E 或 fixture 覆蓋。
8. **不做**：明確列出本里程碑禁止碰的範圍。

完成標準：一個沒看過前面對話的實作者（包括能力較弱的模型）只讀 `docs/v2/` 與該 `Wn.md` 就能完成，不需要自行做設計決策。遇到需要決策的地方，代表 Phase 2 文件還沒寫完。
