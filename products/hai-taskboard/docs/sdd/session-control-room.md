# Mini-SDD：Session-first Agent 角色控制室

日期：2026-10-30。任務：T-1030／SC-DOC-01。來源基準：`1181db123f108ab096bbc1ae9a4e804097d939ca`。
狀態：**Proposed；文件整合，不是已接受的 runtime 契約或執行授權。全部功能 oracles 為 Proposed/NotRun。**

Parent：[HAI SDD](../SDD.md)、[executor/security](executor-and-security.md)、[ADR-003](../adr/ADR-003-execution-and-recovery.md)。
現況／排程：[SUCCESS](../../SUCCESS.md)、[唯一任務板](../tasks/BOARD.md)、[provider 主線診斷](../plans/provider-critical-path-20261030.md)。
本提案不變更 P0-A Fake-only、既有產品 AC 或 G2 門檻；其合併也不授權讀取憑證、啟動 agent、擴權或付費。

## 1. 產品目的與最小切片

讓 operator 看見「哪些已註冊 Session 在哪裡、在做什麼、需要誰處理」，並在明確能力與授權內派工。
不是把訂閱品牌畫成五個吉祥物，也不是為動畫另建 Agent Runtime、記憶平台或通用編排器。

第一個實作目標是：**單一 provider、單一核准 project、單一 runner、一個受管 Session，由 HAI 派出一件真實工作，取得產物、呈現 Session 細節，經獨立證據與人工完成；重啟／不確定結果不重複執行。**
簡單角色卡與資訊抽屜即可驗收此目標。辦公室地圖、第二 provider、多機聚合、MCP、Prism 整合與訂閱帳單不是它的前置條件。
此目標的啟動仍需主線診斷文件所列的一次有界授權與契約變更，不由本文件自行生效。

## 2. 與既有 HAI 模型的接點

**HAI-SC-001 — Authority。** Board、角色視圖、Session 細節與 Attention 都是 application projection。
所有控制由已授權的 application command 進入；Renderer、Collector、Provider Adapter 不可直寫 domain tables。
Telemetry 可以有自己的有界觀測儲存與重建快照，但不取代 SQLite operational state、transactional outbox 或既有 audit authority；不藉此改成全系統 event sourcing。

| 既有物件／規則 | 控制室的使用方式 | 禁止混同 |
| --- | --- | --- |
| Project／WorkItem | 角色展示它目前的工作與 accepted scope | Session 不是 WorkItem，未綁工作不表示可任意執行 |
| Run | 一次 HAI 執行嘗試；以 execution binding 連到 Session／Turn | CLI session、程序存活、成功回覆都不是 Run acceptance |
| Candidate／artifact store | 接收經 scope、size、digest 驗證並封存的產物 | terminal 文字或角色「慶祝」不是 Candidate |
| Review／Evidence／CompletionRecord | 沿既有 exact-subject、independence 與 Done gate | successful Run 不等於 Done |
| Approval | 既有 workflow approval 保留；工具審批須另定 action/request binding | 回答問題、看過通知、delegate result 不是批准 |
| ExecutorAdapterV1 | 沿用 dispatch／lookup／cancel／observation 與 capability seam | 不另開繞過 outbox 的角色派工捷徑 |
| BOARD／SUCCESS | 仍分別記錄 bootstrap 任務狀態與產品驗收 | 本文件的階段表不是第二份可編輯任務板 |

## 3. 身分與執行模型

**HAI-SC-002 — Identity。** 新增物件是 Proposed logical model，尚非 migration/API。

| 物件 | 必要欄位／語意 |
| --- | --- |
| AccountRef | provider、非秘密帳號別名、授權來源；不存登入秘密於前端或 public repo |
| AgentProfile | 穩定 ID、名稱、avatar seed、工作指令版本、宣告能力；稱號／外觀與 instructions 分離 |
| Session | HAI 產生的 ID、profile/account/adapter reference、原生 session/thread reference、建立／首次觀測時間、history completeness |
| ExecutionInstance | runner ID、程序／容器參照、started_at、last_seen_at、execution generation；PID 不是持久身分 |
| Turn／ModelCall | 原生與正規化 ID、開始／結束、計量範圍、去重 key；一個 Turn 可含多次模型／工具呼叫 |
| RunExecutionBinding | Run、Session、Turn、ExecutionInstance、input digest、lease epoch、restore generation 的受控關聯 |

原生 ID 必須至少在 provider instance／account scope 內命名空間化；不假設不同 provider 的 ID 全域唯一。
同一 Session 可跨程序續接；每次新程序有新 ExecutionInstance。換 provider 或原生 context 另開 Session，保留 predecessor／continuation 關係，不悄悄冒充同一段原生歷史。

一個 Profile 可有多個 Session；角色預設代表 Session，輪廓來自 Profile，另標 session short ID、project 與 runner 別名。
觀測既有外部 Session 可先沒有 Run；它保持 observation-only。轉成 managed 前須明確接管與驗證權限，不能自動補造已執行的 Run。
首片限制一個 Session 同時最多綁一個 active HAI Run；不同 Run 不共用可寫 workspace。

## 4. 事件與狀態投影

**HAI-SC-003 — Observation。** Adapter 正規化原生事件，再交 application 驗證與投影：

```text
原生 hooks／structured stream／受允許的 transcript
  → 本機 Collector／Adapter（去敏、schema、source identity）
  → 有界 observation ingress（去重、epoch／generation 驗證）
  → Session projection + 既有 Run observation 處理
  → SSE snapshot／delta
  → 角色卡、細節、Attention；最後才是地圖動畫
```

事件 envelope 至少有 schema_version、event_id、adapter/version、runner、session、execution generation、
source sequence（若有）、occurred_at、received_at、可選 run/turn/model-call、payload quality。
可綁 Run 的觀測還須符合 input digest、lease epoch 與 restore generation；來源自報 ID 不能代替授權。
以來源事件 ID／原生 message ID 去重；沒有穩定 ID 的來源只能降級，不能承諾精確累計。
重連以權威快照與游標恢復；有 gap 就顯示 incomplete，不能補畫假事件。禁止用跨主機 wall-clock 做唯一排序。

**HAI-SC-004 — State。** 不用一個表情 enum 承擔所有狀態：

| 維度 | 投影例子 |
| --- | --- |
| lifecycle | starting／idle／running／ended／unknown |
| activity | generating／tool_running／compacting／none／unknown |
| attention | none／waiting_input／waiting_approval／failed／outcome_unknown |
| connectivity | online／stale／disconnected |

原生事件可信時優先於 PTY 推測。沒有輸出不等於 idle；lease 過期不等於程序已停；失聯不能被 idle 動畫蓋掉。
無任何可信來源時為 unknown，不為零、成功或已停止。stale 門檻由 adapter heartbeat profile 宣告並在驗收前固定，不能套全 provider 共用的靜默秒數。
Snapshot version 或 execution generation 不符的操作一律拒絕／重新確認，不把過期角色的指令送進新程序。

## 5. 資訊抽屜與量測語意

**HAI-SC-005 — Metrics。** 每個量測值攜帶 `value | null`、unit、scope、source、observed_at、
quality（native_reported／derived／estimated／unavailable）與 completeness。native_reported 不是跨 provider 語意一致的保證。

| 使用者要看的欄位 | 設計定義 |
| --- | --- |
| 啟用時間 | Session created_at、first_seen_at、本次 execution started_at、last_resumed_at 分開；不把首次看到當真實建立時間 |
| 在哪台機器 | runner／CLI host 與 tool sandbox 分開；只用非敏感別名；模型推理服務位置若未知就不填 |
| 對話幾輪 | user turns、assistant/model calls、tool calls 分開；只收集到後半歷史時標「已觀測 N 輪」 |
| Context 占用 | 當次 context token snapshot、window limit、有效百分比、量測時間；不是累積 Token 或程序 RAM |
| 最後輸入／輸出 | last model-call 與 last completed turn 分欄；某一粒度未提供不可拿另一粒度冒充 |
| 累積用量 | 顯示統計區間與去重方式；input/output/cache read/cache write/reasoning 保留 provider 欄位語意 |
| 訂閱額度／成本 | Account 層級原生回報；估計 API 等值成本不等於訂閱剩餘額度或帳單 |
| 控制能力 | observe/send/queue/steer/interrupt/resume/approve 各自宣告；未知即不可操作 |

不得把每次累計 usage snapshot 相加；cache 是否包含於 input 由 adapter profile 明示，不能重複計量。
Context 經 compaction／切換模型／新 Session 時更新獨立的 context_revision（不冒充 execution generation），舊讀值保留時間或轉 stale；未知上限不計算百分比。
串流佔位值、不完整輸出與重播訊息不得進入精確 totals。只有終端文字／只有網頁的來源，可以只有 presence；不能因使用者有訂閱便承諾可讀全部 Session 與 Token。
取得訂閱 CLI 的原生資料與 API 金鑰接入是不同 adapter/access profile；禁止提取或轉用訂閱憑證到未授權用途。

## 6. 角色與空間的業務映射

**HAI-SC-006 — Presentation。** 形象、人設、執行狀態與協作關係分層。外觀／工作稱號不得改變權限，
也不得讓沒有執行中的工程師角色顯示「正在工作」。動畫採確定性狀態映射，不輪詢 LLM 生成表情。

| 視覺元素 | 真實依據 |
| --- | --- |
| 房間／分組 | runner 或 project；切換分組只改 projection |
| 工位 | workspace；不是權限隔離的替代品 |
| 角色輪廓／色彩 | 穩定 Profile；Session 用獨立標籤區分 |
| 執行動畫／活動標籤 | 最近有效 activity event；排隊不能畫成正在用工具 |
| 舉手／警示 | waiting input／approval／failed／unknown；attention 優先於忙碌動畫 |
| 信封／連線 | 有 event ID 的真實訊息或 delegation；不以角色靠近推論協作 |
| 裝飾動畫 | 眨眼、看滑鼠、休息；不更新 domain state、不暗示工作完成 |

角色點擊打開 Session drawer，包含目前工作、時間、機器、回合、Context、最後用量、事件與授權操作。
保留可搜尋列表、鍵盤焦點、文字狀態及 reduced-motion；狀態不能只靠顏色／動畫辨識。
離開畫面暫停純視覺更新，但不能停 heartbeat、命令或事件接收。初版不要求 Pixi.js、遊戲地圖、尋路或美術素材。

## 7. 從角色派工的命令邊界

**HAI-SC-007 — Control。** observation-only 不等於可接管；受管模式才暴露已支援操作。
以下是 Proposed command intent，未宣稱現有 REST endpoint 已存在：

| 意圖 | 必須綁定／行為 |
| --- | --- |
| New session work | Project／WorkItem、accepted input、adapter capability、runner scope；沿現有 dispatch outbox 建立 Run |
| Queue next turn | 指定 Session generation／work binding；等待安全邊界，不變成往 terminal 任意貼字 |
| Steer active turn | expected session／turn／execution generation；版本不符即拒絕，不默默改為新對話 |
| Interrupt | 明確 request 與 acknowledgement；未確認仍 Unknown／CancelRequested，不標 stopped |
| Resume | 經 lookup/reconciliation 確認原 execution 結果；不確定副作用禁止自動重跑 |
| Resolve tool request | request/action digest、scope、actor、expiry、single-use；不等同 CompleteWorkItem 授權 |

每個 intent 必須有 idempotency key、expected aggregate version、可撤銷 principal scope 與 audit。
拒絕 unsupported capability；只在 renderer 隱藏按鈕不算權限控制。
互斥控制 lease 防止兩個控制器同時寫入同一 Session；首片不用 PTY send-keys 接管未知 TUI。
transport ACK、provider start ACK、turn result、Run terminal、WorkItem completion 分別呈現。
Steer 只能在原 accepted input／權限內引導；改 Goal、AC、workspace 或政策必須回到既有規格變更與失效流程，不能以聊天覆寫不可變輸入。
新工作／下一輪／引導本輪是不同操作；不可用同一個模糊「送出」按鈕默默選擇。

## 8. 安全與最小部署

**HAI-SC-008 — Security。** 保持 local-first、單 operator、既有 Go/React/SQLite。首片 runner 同機，
後續私網 Collector 使用已核准 Gateway；本提案不開公開 listener、不改防火牆、不授權直接 SSH。
憑證留在已核准 runner；中央及 public repo 只存非秘密 reference。原始對話、shell args、環境變數與主機識別
預設不外送；最小 metadata 足以驅動角色。截斷／去敏先於傳輸、持久化與 UI；artifact 按既有保護處理。

每個 observer token 只有指定 scope，不能升成 executor／human operator；簽章／來源驗證不讓 payload 變成可信指令。
機器名稱使用合成別名，驗收用測試 workspace。Token、context、人物動畫不授權 merge/deploy。
Prism 可在之後接收去敏遙測；HAI 保留工作權威，不以 Prism 完整交付阻擋單機 Session 閉環。

## 9. 分階段落地與不新增前置工作

以下只是 scope references，未在 BOARD 建立新的 Ready 任務。

| 階段 | 可驗收成果 | 不包含 |
| --- | --- | --- |
| SC-0：本輪文件 | 既有契約映射、單 provider 臨界路徑與 Proposed oracles | 任何 runtime／新 schema／外部憑證 |
| SC-1：有界真實閉環 | 一個受管 provider、角色卡／drawer、真產物與人工驗收、故障恢復 | 第二 provider、跨機、MCP、動畫地圖、訂閱 quota 聚合 |
| SC-2：可選外部觀測 | 已存在 Session 的唯讀註冊、來源與歷史完整性、明確 takeover | 自動接管所有 CLI／IDE／網頁 |
| SC-3：可選空間視圖 | 既有事件驅動地圖，列表與減少動畫模式 | 新的執行 authority、遊戲經濟或自治社交模擬 |

SC-1 先用首 provider 的最小 adapter，經第二個具體 provider 需求才抽共享抽象。
本輪不依新設計要求先實作 SC-2/3；[主線方案](../plans/provider-critical-path-20261030.md)管控 G2／順序決策。

## 10. 條款與未來驗收追蹤

下表全為 **Proposed/NotRun**，不是已建立測試 skeleton，也不新增或改寫 SUCCESS AC-01..04。
當 runtime 契約被接受時，才將確切行為／測試路徑納入現行 traceability；不可把這張表當 PASS。

| Oracle | Given／When／Then 摘要 | 條款 |
| --- | --- | --- |
| HAI-SC-T01 | 同一 Profile 的兩個 Session、跨 provider 相同 native ID；註冊／續接後保持正確歸屬，程序重啟有新 generation | HAI-SC-001/002 |
| HAI-SC-T02 | 重複、亂序、缺口與舊 epoch 事件；重連後不重複計量／不回退狀態，缺口可見 | HAI-SC-003 |
| HAI-SC-T03 | 長時間無 stdout、斷線、lease 過期；不推斷 idle、成功或已停止 | HAI-SC-004 |
| HAI-SC-T04 | native/estimated/unavailable、cached/累計 usage、compaction；不重算、不把未知畫零，顯示範圍與來源 | HAI-SC-005 |
| HAI-SC-T05 | pending approval 與 active turn 同時存在；角色、徽章與 drawer 一致，裝飾不遮蔽 attention | HAI-SC-004/006 |
| HAI-SC-T06 | 角色點擊與鍵盤操作；定位同一 Session 並展示時間／機器／回合／Context／最後用量；reduced-motion 仍可用 | HAI-SC-005/006 |
| HAI-SC-T07 | observation-only、unsupported、過期 turn、重複命令、雙控制器；拒絕越權且不重複派工 | HAI-SC-007 |
| HAI-SC-T08 | cancel ACK 遺失、runner crash、restore generation 變更；Unknown 保留且不自動再執行未知副作用 | HAI-SC-003/007 |
| HAI-SC-T09 | 秘密 canary／跨 project／惡意 log；外送與 UI 無秘密、不執行內容、不擴權 | HAI-SC-008 |
| HAI-SC-T10 | 真 provider 產出 Candidate；只有 exact independent evidence＋operator command 才能 Done，CLI exit 0 不足 | HAI-SC-001/007 |

## 11. 上游實作借鏡與界線

這是前次研究的 pinned code reading，不是本輪實機測試；不搬上游程式碼或美術資產。

| 專案／快照 | 具體參考 | 本設計取捨 |
| --- | --- | --- |
| Munder Difflin `f797048cc88ca2ff94bfc6c8c93b16f47a201f15` | [OfficeFloor](https://github.com/HarnessMD/munder-difflin/blob/f797048cc88ca2ff94bfc6c8c93b16f47a201f15/src/renderer/src/scene/office/OfficeFloor.tsx)、[hooks](https://github.com/HarnessMD/munder-difflin/blob/f797048cc88ca2ff94bfc6c8c93b16f47a201f15/src/main/hooks.ts) | 事件與終端分離、空間投影；不以靜默推斷閒置，不把裝飾當真實活動 |
| OpenMausBot `d124292a2aafcbed61f7ac58a0b975231df92da2` | [runtime events](https://github.com/milind-soni/OpenMausBot/blob/d124292a2aafcbed61f7ac58a0b975231df92da2/shared/runtime-events.ts)、[mascot](https://github.com/milind-soni/OpenMausBot/blob/d124292a2aafcbed61f7ac58a0b975231df92da2/src/lib/mascot.ts) | capability 與 usage 粒度；不讓職稱推導出的表情冒充執行狀態 |
| Open Duet `29a639d0d60914a8b10e9a2c4cfa75b3dea35d81` | [team jobs](https://github.com/Anil-matcha/open-duet/blob/29a639d0d60914a8b10e9a2c4cfa75b3dea35d81/backend/app/team/jobs.py)、[Avatar](https://github.com/Anil-matcha/open-duet/blob/29a639d0d60914a8b10e9a2c4cfa75b3dea35d81/frontend/components/ui/Avatar.tsx) | 持久身分與委派回報分開；回報不是授權 |
| Rakazo `a277342b42b68d652099c33ba586ba49ead070ca` | [avatar life](https://github.com/elie222/rakazo/blob/a277342b42b68d652099c33ba586ba49ead070ca/packages/core/src/avatar-life.ts)、[Pi runtime](https://github.com/elie222/rakazo/blob/a277342b42b68d652099c33ba586ba49ead070ca/packages/adapters/src/pi-runtime.ts) | Runtime／動畫分層與減少動態；不為畫面遷移全部 runtime |
| OpenBot `3d7328dbd2cda7f791d39668f4b1494c22d84366` | [avatar mood](https://github.com/nightly-labs/openbot/blob/3d7328dbd2cda7f791d39668f4b1494c22d84366/packages/ui/src/features/agents/agent-avatar-mood.ts)、[context view](https://github.com/nightly-labs/openbot/blob/3d7328dbd2cda7f791d39668f4b1494c22d84366/packages/ui/src/features/conversation/ContextUsage.tsx)、[license](https://github.com/nightly-labs/openbot/blob/3d7328dbd2cda7f791d39668f4b1494c22d84366/LICENSE) | attention 優先與缺值可見；不複製受非商業授權限制的碼或資產 |

未來 adapter 實作須鎖定實際 CLI／protocol 版本，重新查核原生 API、usage 語意、登入方式、授權條件與資產授權；此表不是跨版本相容性保證。
