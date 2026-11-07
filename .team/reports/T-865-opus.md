<!-- Original model response; findings are not all adopted. Lead disposition: platform/cloud-lab/docs/direction-review.md. Line references refer to the pinned review packet, not later edited files. -->

# Cloud Lab 方向審查（T-865）

**RECOMMENDATION: REPLAN**

**依據範圍：** 只依本次提供的編號 packet（HEAD `8affee1`）。我沒有工具、沒有網路，**未做任何獨立 live 驗證**。下文的「事實」都指 packet 內文件的陳述，不代表我確認了線上現況。

---

## 一、具體發現（依嚴重度排序）

### F1｜原始第二項需求實際上被擱置【事實】

Owner 原話是「把已有的 CF 項目代碼按照框架適合的位置填進去，重複的也可以趁機封存」。目前狀態：

- `docs/migration.md:3`、`:15` 寫明沒有搬遷、沒有接替。
- `SUCCESS.md:36` 寫明「能力整合與遷移候選不代表既有產品已被接管」。
- 遷移被推到 M3（`docs/verification.md:44`），前面還有 G0–G5 六道 gate（`migration.md:43-50`）。

**【推論】** 這不是 vertical slice 的正常延後。38 個里程碑中，沒有任何一個碰到既有 CF 專案。原本「集中＋封存重複」的意圖，被替換成「另寫一個新系統並反覆資格驗證」。

### F2｜Cloud Lab 自己可能就是 Edge Ops 的重複品，但沒有人做這個判定【推論，依據事實】

- `knowledge-tree.md:34`：Edge Ops 是「契約與 mock，真 collector pending」。
- Cloud Lab 的 node-health 已有真 collector，且有 live validated。
- `migration.md:19` 把 Edge Ops 列為「move-candidate；優先評估」。

最該先做的「重複封存」判定就在眼前，卻沒有出現在任何里程碑裡。

### F3｜系統再過約 4 天全面失效，且沒有常態化方案【事實＋推論】

- runner 政策截止 `2026-11-05T07:24:25Z`（`SUCCESS.md:93`），scheduler grant 也被限制不晚於此（`health-schedule.md:38`）。
- human 窗口只有 30 分鐘且不續期（`m1-usage-live.md:7`）。
- bot 窗口已過期。

**【推論】** 每次使用都要「提案→批准→證據文件」，這是一連串受控實驗，不是 owner 想要的「我一個人日常用的雲 lab」。Access 已經是 owner 指定的 zero-trust 入口，在它之上再加 30 分鐘 server-side human grant，等於看板日常不可用。這是**可用性**缺陷，不是安全收穫。

### F4｜「框架」目前是單一用途 app，泛化未被證明【事實】

- 唯一 recipe 寫死成常數：`protocol.mjs:25-26`。
- 准入強制比對它：`index.mjs:16`。
- 全域只允許單一 active：`index.mjs:97`，另見 `m1-implementation.md:61`。
- node-health artifact 驗證內嵌在 report 中：`index.mjs:135`。
- schedule id 寫死為 `'health-minute'`：`index.mjs:44`、`:199`。

「固定套路、靈活生成系統」是原始目標的核心。第二種 recipe 或第二個資源能否不改核心就接入，目前完全沒有證據。

### F5｜文件真實性：多處狀態過時或自相矛盾【事實】

| 位置 | 問題 |
| --- | --- |
| `knowledge-tree.md:3`、`:54-57` | 仍寫「沒有 live_verified」「真實 Access 未驗」「沒有啟用排程」「未接指定遠端節點」，但 `SUCCESS.md:97`、`:143` 已記錄真實 Cron validated 與 Safari 登入。 |
| `SDD.md:4` | 「API、模組與部署均未實作」，只靠 `:3` 一行補註。 |
| `bot-bridge.md:44`、`m1-bot-activation-live.md:27` | 仍把 HL asset-session 500 列為未完成，已被後續修正取代。 |
| `README.md:92` 與 `:94` | 同一事項先寫「尚未部署」、下一段改寫已完成。 |
| `README.md:22` | 首要情境仍以「手機」描述，與 owner 豁免手機測試不符。 |
| `SUCCESS.md` frontmatter | `reviewed: 2026-10-28`、`source_commit 65bbadb`，落後 HEAD。 |

README 第 34–110 行與 SUCCESS 第 57–173 行基本是同一份逐輪 changelog，重複兩次（例如 `SUCCESS.md:149` 等同 `README.md:94`）。導航價值低，維護成本隨里程碑線性增長。

### F6｜AC-06 可能被過度保守地維持 pending【推論】

AC-06 本文（`SUCCESS.md:30`）的條件是：授權 caller＋真實 runner、API／排程提交、可追蹤、去重、驗證、看板顯示。依該列及 `:97`、`:143` 的證據，這些都已有 live 實例。

剩下的缺口寫成「Grok 模型對話」，但這不在 AC-06 的 Given/When/Then 內，而 owner 又明示不強制模型整合。**建議由 owner 決定：要嘛關閉 AC-06，要嘛把模型對話明確改列為新 AC。** 不宜讓它無限掛著。

### F7｜容量的隱性期限【事實】

`retention.md:21` 估算：15 分鐘排程從空庫約 104 天碰到 10000 筆上限。到頂後 Cron 記 `skipped_quota`，且沒有刪除工具（`retention.md:3`）。

**【推論】** 一旦常態化，約三個月後排程會靜默停止。這比 provider 用量更早成為實際問題，但目前只需一個 8000 筆提醒，不需要做 tombstone 系統。

### F8｜「provider 用量觀測」不是下一優先【推論】

- 目前負載：runner 每 5 秒輪詢、15 分鐘 Cron、看板每 5 秒刷新（`health-schedule.md:44`）。單一 operator 用算術就能估出量級。
- 依我的記憶，Workers Free 約 10 萬 requests／日、D1 Free 約 10 萬 rows written／日。**這兩個數字需核對官方。**
- 估算：runner 約 1.7 萬 claim／日（每次另有 nonce 寫入）；看板若整天開著多 3 次 API／5 秒，約 5 萬。合計仍在免費額度內，但兩個分頁全天開著就會逼近上限。
- `m1-bot-activation-live.md:9` 顯示 Billing OAuth 不支援。做成 API 接線可能要新的 token scope，等於擴大權限面。

**建議：** 一次算術估算，加上 owner 在第 7 天看一眼 CF Dashboard，就足夠。不要另開里程碑。

---

## 二、原始目標對照

| 原始目標 | 狀態 | 依據 |
| --- | --- | --- |
| 盤點 fallrising 的 CF 工具 | 文件級完成（私有來源只列角色） | `migration.md:17-31` |
| 在 newclear 開項目、知識樹、介面、文件 | 完成 | `SUCCESS.md:25-29` AC-01～05 passed |
| 既有 CF 代碼歸位、重複封存 | **未開始**，被推到 M3 | `migration.md:3`；`verification.md:44` |
| 日常運維由 CF 覆蓋 | 一種唯讀 load／disk 檢查；已部署但 11-05 到期 | `m1-implementation.md:9`；`SUCCESS.md:93` |
| 異步遠程操作運維平台／agent 平台 | 未開始（M2） | `knowledge-tree.md:35-36` |
| 看板 | 已部署；但 human grant 30 分鐘，日常不可用 | `m1-usage-live.md:7` |
| Grok 調度 | 工具接線與一筆 MCP→validated 通過；bot 過期；模型對話未驗 | `SUCCESS.md:121`；`grok-connection.md:30` |
| 固定套路、靈活生成（Cron＋API） | Cron＋API 範例存在但未模板化，核心寫死單一 recipe | F4 |
| Queues | 依 ADR-03 合理延後 | `SDD.md:69` |
| Zero Trust 封閉入口 | 完成（匿名 302、service token） | `m1-usage-live.md:34` |
| 「我一個人基本夠用」 | 複雜度與流程成本和這句話衝突 | 38 個里程碑、約 100 份文件 |

---

## 三、最強的反對意見（為何這可能不算偏移）

1. **符合授權。** Owner 明說「文檔先行」，M0 完整交付；M1 先做一條 vertical slice，是 SDD 事先寫好的計畫（`SDD.md:23`）。
2. **是為 M2 預付的地基。** 原目標包含異步操作運維平台與 agent 平台，這些有真實副作用。idempotency、unknown 不重做、fence、journal、撤權、還原，正是那一階段必需的；在唯讀 recipe 上先驗證，成本最低。
3. **LLM 當 caller 時，配額與可撤銷是合理的。** Grok 是模型驅動的 caller，限額與可撤銷授權不是過度設計。
4. **每輪都獲批准。** 每次 live 變更都有 owner 批准，維持 Workers Free，沒有越權。
5. **還原演練本來就該做。** 沒做過還原的備份等於沒有備份。

**我的判斷：** 1、3、5 成立；2 只部分成立。

- 副作用安全語義在 M1-I1 與 RF 階段已經足夠（`SUCCESS.md:52`、`:65`）。
- 之後約 25 個里程碑（授權採集、自身查詢、resident 觀測、整合、BP/BR/BA/BT/BI 五層 bot 政策、RA、DI、PS、XR、RX）是在加固一個最壞後果只是「load 數字錯了」的唯讀檢查。邊際價值遞減，卻持續吃掉原始整合目標的時間。
- 這些安全性質應**保留**，但不應再**擴張**。

---

## 四、Stop／Keep／Defer

**Stop（停止新增）**
- 授權生命週期與 bot 政策的新工具層。
- 「每個里程碑都配一份 evidence doc＋同步改 README／SUCCESS／BOARD」的流程。
- provider 用量 API 接線。
- 活躍程序 failover。
- Event／seq 協定。
- 拒絕稽核與成果完整性的延伸工作。
- tombstone／歸檔的實作（等到 8000 筆再說）。

**Keep（保留，不刪）**
- Access＋HMAC＋scoped grant。
- 不可任意 shell、unknown 不重播、單一 writer、journal 先寫後報。
- D1 官方 export 作為週期備份手段（RX 已證明可還原）。
- 現有測試套件。

**Defer（延後）**
- Queues／Workflows。
- agent-platform adapter（排在下方 B、C 之後）。
- Grok 模型驅動對話：owner 想用時試一次即可，不設 gate。
- M3 模板生成。

**流程建議**
- 只有對 live 寫入的動作才需要完整證據文件。
- 純本機里程碑：一行 changelog＋測試數＋commit 即可。
- 獨立 review 保留給 live 變更與新權限，不必每輪都做。

---

## 五、接下來三個小里程碑

### A｜常態化與文件收斂（應在 11-05 前，或接受到期後再開）

**需要 owner 一次性的明確決定，不是自動續權：**
- runner／scheduler 的常態期限（例如 30–90 日）。
- human grant 與 Access policy 對齊，讓看板日常可用。
- bot 維持有界。

**同時進行：**
- 一次算術用量估算，第 7 天由 owner 看一眼 CF Dashboard。
- 在用量畫面加 8000 筆提示。
- 把 `knowledge-tree.md:54-57` 的狀態改為實際的 live_verified。
- 修正 F5 列出的過時文字。
- README 精簡成一頁現況，歷史 changelog 移到單一檔案。
- 由 owner 決定 AC-06 關閉或改寫。

**停止條件：**
- owner 在連續 7 天內任一天都能直接打開看板，看到 fresh 結果，不需新的批准。
- README 一頁內講清楚「現在能用什麼、何時到期」。
- 本里程碑新增的證據文件最多 1 份。

### B｜CF 工具目錄與重複判定（回到原始第二項需求）

- 為 fallrising 每個 CF repo 填一列（RS-02 最小 reference）：用途、部署位置、Cron／API、最近部署、處置。處置只用四種：`keep-in-place`／`reference`／`move`／`archive`。
- 先處理 Edge Ops 與 node-health 的重疊，給出合併或封存的建議，由 owner 拍板。
- 是否實體搬入 monorepo，逐個依「搬過來能不能少維護一份東西」判斷，**預設採 reference／adapter**。

**停止條件：**
- 目錄 100% 覆蓋 owner 的 CF repo。
- 至少 1 個重複項被 owner 決定封存或明確保留。
- 實際搬遷最多 1 個；做不到就記錄原因並停止，不擴大。

### C｜第二種 recipe，證明「固定套路」

- 新增一種與 node-health 形狀不同的唯讀 recipe。建議由 Worker Cron 直接 GET 各 CF 工具的健康端點，不需要 runner。這樣看板就能看到 B 目錄中各服務是否在線。
- 必要時把 `protocol.mjs:25`、`index.mjs:16`、`:44`、`:97`、`:135` 的寫死部分抽成 recipe 註冊表。

**停止條件：**
- 兩種 recipe 共用准入與看板，原有測試全部通過。
- 新增 recipe 時，核心改動控制在約 150 行內；超過就記錄為框架缺陷並停止重構。
- live 跑滿 24 小時。
- 不新增授權層，不新增付費。

---

## 六、未解決的不確定性

- packet 內沒有 2026-11-01 之後的 live 狀態；Cron 與 runner 此刻是否仍在運行，我無法確認。
- 免費額度的數字來自我的記憶，需核對官方。
- RA 拒絕稽核每次 4xx 都會寫入 D1，對寫入額度的實際影響未量測。
- `sources.md` 未在 packet 內，因此「盤點已完整」只能依 `migration.md` 推定。
- `adapters/bot/README.md` 缺失，對 bot adapter 文件導航的影響未知。

---

## Worker handoff

- **Status：DONE**（僅限審查文字）。
- 未寫入任何檔案、未操作 Git／live／測試。本次無工具，因此 journal 流程紀錄未寫入，需由 lead 代記。
- 驗證：
  - 依 packet 引用的行號交叉核對 — passed（未經 lead 複核前）
  - 獨立 live 驗證 — skipped（無工具）
