# Fanzloud 主線重校：Web 操作隔離 coding agents

- 日期：2026-10-31；desk：T-0442；狀態：**Owner approved（2026-10-31「同意，繼續開發。」）；M1 單任務實測通過，交付見驗收紀錄**。
- 本文件與 ADR-0008 的主線方向已批准；不因此宣稱 route 已驗證，不授權新增付費、部署或相鄰專案變更。
- 原始目標：[TD §1](docs/TD.md#1-product-definition)。目前實際能力與歷史證據：[SUCCESS](SUCCESS.md)。

## 1. 使用者最後要得到什麼

**不綁定模型廠商，透過 Web 操作 coding agents，讓工作在各自隔離的環境中執行。**

私人單一 operator 從瀏覽器選專案、固定來源版本及 agent，輸入一個小型修復任務；平台建立獨立執行環境、顯示真實進度，最後提供可下載的 diff 與檢查結果。可以同時處理兩個互不污染的任務，並將固定成果交給另一種 agent 審查。關閉瀏覽器或服務重啟後，工作記錄與成果仍可找回；不確定是否已開始的工作不會自行重送。

「廠商中立」須用兩個不同廠商的真實 agent 接入證明，只有更換模型名稱、假 adapter 或同一供應商兩個型號不算。首選驗證對象為 Codex 與 Claude Code；這是待 qualification 的目標，並非宣稱它們已具備符合本產品秘密邊界的執行方式。

## 2. 為何調整，以及保留什麼

原始 TD 規定 P0 optional、不得阻擋 P1。ADR-0002 選 Codex Cloud，是為了先使用 operator 的既有訂閱並把 repository 工具與本機憑證分離；它不是產品最終定義。如今不能以無止盡修補這條特定廠商路線，取代隔離 coding 工作的產品交付。

- 保留既有 Web／Rust／fake executable 真瀏覽器證據、領域型別與已驗證 store；不重做已接受的前端。
- 舊 AC-04 **live 未跑**，仍是舊 Cloud 路線未完成的驗收，不更名為通過、不刪除失敗紀錄。
- 原 P1 store 尚未接到完整 runtime；程式庫接受不等於持久任務完成。
- 暫停主動投入 Cloud catalog 排查。升級 CLI、重建官方環境、切 app-server 均不能替代新的端到端證據。
- 不再以自建 Rust 原生 agent loop、完成全部 T040 子切片或通用協定框架作為第一個可用任務的前置。

## 3. 建議的產品與執行責任

```text
瀏覽器 → Fanzloud 任務入口／結果呈現
        → 一個已鎖定版本的 agent adapter
        → 一個既有隔離執行後端 → 任務自己的 workspace
        ← 持久狀態、固定成果、diff、檢查結果
```

| 元件 | 本主線責任 | 範圍限制 |
| --- | --- | --- |
| Fanzloud | Web 任務入口、operator 授權、agent 選擇、任務與執行引用、成果展示 | 不自建另一套 VM 管理器、通用 agent loop 或聊天產品 |
| Agent Platform | 既有已接受設計責任：隔離 Run／Cocoon、lease、停止、清理與恢復（[SDD §3–4](../agent-platform/SDD.md#3-使用者故事與成功條件)）；既有證據只覆蓋部分路徑 | 外部 CLI admission、工具／認證分離及其恢復屬待 qualification；需要擴充時是鄰專案變更，未獲批准不實作 |
| Agent Workforce | 參考既有原生 route 與固定 candidate／review 契約；有相容 adapter 才重用 | 不要求整套 worker daemon／多帳號平台先完成；不另造工作完成權威 |
| 外部 coding agent | 在已驗證的權限內讀寫任務工作區並回報成果 | 程式名稱、CLI 成功退出、登入成功都不代表任務通過 |

一個 run 只有一個執行與生命週期權威。若 Agent Platform 承接執行，Fanzloud 保存外部 run ID 與產品引用，狀態投影不得另行觸發執行；由該後端負責其既有契約中的 lease、停止、workspace 清理與執行恢復；不據此宣稱它已支援外部 CLI 原生 session 恢復。Fanzloud 保存自身提交意圖、對帳狀態與成果引用；不能用兩個資料庫各自聲稱有權重試同一個 run。

這是對現有 PORTFOLIO「互相分開」邊界的**明示調整提案**，不是已完成整合或默默合併專案。批准前不得改 Agent Platform／Workforce 的實作；若整合需改其契約或程式，依鄰專案投入狀態由 owner 在 desk 另行批准有界依賴卡；它不是 Fanzloud 可自行啟動的子任務。未獲准則停止受影響的 M1 路線，不啟動其餘未完成里程碑。第一關不相容就停止此執行路線並報告具體缺口，不另起第三套平台。

## 4. 執行與認證第一關

第一個實作之前先鎖定一份 route receipt：agent 精確版本／協定、既有帳號類型與登入狀態（不含秘密）、執行後端版本、隔離單位、工具能力、允許的 repository／base SHA、時間與並行限額。另須記每條 route 的官方支援依據、如何符合 TD §1.6 與 ADR-0002 的個人使用／不得轉包 session 邊界、idempotency key／run 查詢能力及網路出口政策。無法按 client key 對帳者，unknown 只能停在人工確認，不能自動重送。版本更新須明示修訂 receipt 與必要契約驗證；不得悄悄放寬原 P0 的 0.145.0 檢查。

**秘密邊界維持 ADR-0002 的要求**：repository 及其工具不能讀取 operator 登入資料、控制面秘密或其他任務資料。一般容器、工作目錄分開、CLI sandbox 參數、`app-server` 名稱均不構成證明。採用外部 CLI 前必須證明官方受支援的工具執行／認證分離能落在選定隔離後端，並有 canary 與跨任務讀寫拒絕證據。無法做到的 route 不准入。

**O-1 本次決定：沿用既有個人訂閱優先的方案；未授權 API 路線或新增支出。** 尚未指定任何 API credential／provider／額度可供本產品使用；不能從「已登入」推導 API 授權。本次只啟動訂閱路線的 M1 qualification；API 選項仍需另行明確指定。

- 訂閱路線：保持官方認證方式、既有個人使用限制及秘密邊界；先證明受支援的工具／憑證分離，不能先假定 MCP 或 app-server 可行。
- 既有 API 額度路線：需確認 provider／credential reference、允許模型、既有使用授權、由 provider 或可信 proxy 可強制的消費上限及超限拒絕方式；沒有可驗證上限就不啟動計費探針。不得自行開通或增加付費。

不把訂閱轉成 API 額度，不建立付費 fallback。選定路線若不能滿足隔離／授權，集中回報失敗能力、可行官方 route、費用差異與有界方案。新支出或秘密邊界改動須另獲 owner 明確授權；不隱藏在實作中。

## 5. 有限里程碑與停止條件

只有下列三個實作里程碑。文件核對為前置關卡 D0，不算產品交付；子任務只能是所在里程碑的必要實作，不得新增完成前提。

| 關卡 | 使用者可觀察成果 | 必須通過 | 停止／退出條件 |
| --- | --- | --- | --- |
| D0 文件定案（本輪） | 一份決策、三個里程碑、固定最終驗收 | Codex 與 Claude Code 核對，owner 確認重大責任／執行方向 | 不改 production，不把 proposed 寫成 accepted |
| M1 一個真實任務 | 瀏覽器登入，提交一個修復，看到進度並取得真實 diff／檢查結果 | 先做 route／隔離 qualification，隨後在 M1 內寫一份提交／事件／成果／停止／對帳 adapter 契約，接 Web 前審定，再完成 FN-01、FN-03 的單任務部分及 FN-06；無 Node API fixture | 每條 route 的 qualification 一次有界驗證及至多一次有依據修正；仍失敗就提出具體路線決策，不建框架繞過 |
| M2 兩種 agent、兩個隔離任務 | 同一 Web 可選第二廠商 agent；兩任務互不污染 | FN-02、FN-03 全部；重跑 M1 只限相關變動 | 第二個 route 不符契約就標未通過，不能用第二模型名稱代替 |
| M3 恢復與成果交接 | 重新連線／服務重啟後回到工作；另一 agent 可審查固定 diff | FN-04、FN-05、FN-07；在同一候選來源做最終 journey | 最多一次返工與第二次審查，之後停在明確結果；不無限對話或自動重送 unknown |

依 desk「AC 鎖定前以參考實作或現有執行器實跑」規則，目前 FN 是待確認的目標契約，尚無新的 route 實跑證據；D0 可確認產品範圍，不能宣稱執行契約已驗證。M1 先完成有界 qualification 並附版本／命令／輸出，才鎖定該 route 的具體預期輸出與允許實作範圍；不藉此增加里程碑。

M1 的 adapter 契約是同里程碑內的必要交付，不是第四個前置或新框架；M2 第二廠商驗證之前不得宣稱通用後端。

M1 qualification 的第一個可執行驗收：在既有、已授權的隔離後端上，以固定小型 repository／base SHA 啟動一個候選 agent，產生一處可預期修改及檢查結果；證明工具無法讀秘密 canary／主機與另一工作區，保存版本、實際隔離 ID、diff digest、退出與清理結果。通過才接 Web 提交，不能只以 `--version`、mock 或 API health 代替。若環境／route 需要新的安裝、認證或付費，先完成可執行方案並集中列出缺項，不重複要求 owner 嘗試舊 Cloud 設定。

M1 預先鎖定操作目標、一次提交、單任務 10 分鐘、最大並行 1；M2 最大並行 2；M3 handoff 最多 writer 兩次／review 兩次。超時停止新工作並對帳／清理；不能把停止觀察當成已停止遠端工作。不透明 CLI 的 provider request／token／費用記 unknown，不能把 invocation 數宣稱為硬 token 或金額上限。

## 6. 最終驗收（全部必須通過）

2026-10-31：M1 的 FN-01、FN-03 單任務／循序部分與 FN-06 證據見
[M1 實測紀錄](docs/acceptance/M1-isolated.md)。FN-02、FN-03 並行、FN-04/05/07
仍未完成；最終 MVP 的條件不變。

| ID | Given / When / Then | 必留證據 |
| --- | --- | --- |
| FN-01 真實 Web 閉環 | Given 私人登入、固定 repo/base/agent；When 在真瀏覽器提交一次修復；Then 真實後端建立唯一 run，呈現進度、最終 diff、檢查結果／未跑原因，下載 patch 可套用該 base 並得到同一內容 | 來源 SHA、route receipt、submit/run ID、畫面／事件、patch hash、實際驗證結果；任務要求的檢查未跑則此修復不通過 |
| FN-02 廠商中立 | Given 兩個不同廠商真實 agent；When 同一 Web 各交辦一個小修復；Then 兩者均達 FN-01，核心任務／成果流程無 provider 特例分叉 | 兩份 live receipt；不是替身、同廠模型切換或手工補成果 |
| FN-03 隔離 | Given 同時執行的 A/B；When 各自改檔且嘗試越界讀寫／讀秘密 canary；Then 分離的隔離 ID／workspace、越界被拒、B／host／控制憑證不被 A 讀寫，停止一個不終止另一個，清理可核對 | 實際 OS／runtime 邊界、網路出口允許／拒絕範圍、拒絕與清理證據；不得記錄秘密內容 |
| FN-04 持久與未知結果 | Given 已確認事件／提交；When 關閉瀏覽器、重啟控制面及注入提交後回執前中斷；Then 恢復同一任務與已持久事件／成果，未知提交標待對帳，零自動重送 | durable 記錄、事件 cursor、前後 run／invocation 計數、unknown 狀態；不能要求 agent 從任意執行中斷點恢復推理 |
| FN-05 有界交接 | Given writer 固定 candidate hash；When operator 從 Web 交給另一廠商 reviewer；Then reviewer 讀取獨立唯讀成果副本，回覆綁同一 hash 的判定／理由，不能改 writer 成果；最多一次明示返工 | candidate／review hashes、不同 agent receipt、操作與輪數；review 完成不自動等於任務 Done |
| FN-06 權限與失敗 | Given 未登入／越權 target／超時／取消／provider 失敗；When 操作或故障發生；Then 不越權執行，UI 顯示有區分的原因及實際停止／待對帳狀態，沒有秘密外洩 | auth 拒絕、故障與停止／清理 receipt、redaction 檢查；不宣稱未支援的逐工具審批 |
| FN-07 Owner 可操作 | Given 同一已審來源、必要 CI 與操作前置；When owner 依短操作步驟登入→選 agent→提交→看進度→下載 diff→交接審查→重新開啟；Then 不需工程師代貼 CLI、手動修資料或補產物即可完成 | 同來源真瀏覽器 journey、操作入口與限制、owner 操作確認；環境部署與費用仍須既有授權 |

完成定義：FN-01～07 全部有來源綁定的實際證據與獨立審查，必要 CI 通過，正常 PR 合併與遠端回讀後，才稱本私人單 operator MVP 可用。文件合併、單一 demo、測試數量、mock、CLI 登入或 API health 都不代替此條件。usable tag／release／部署仍須各自明確授權。

## 7. 不做與後續

本主線不做 UI 美化／Round3、自建原生推理框架、任意 agent 一鍵相容、多租戶／帳號池、公開服務、多節點、任意 repo／image／host mounts、自動 push／merge／部署、通用 DAG 或無限自主協作。每次新增範圍必須說明哪個既有 FN 驗收無法通過；否則放到 MVP 之後。

AC-05 的最小持久化里程碑落在 M3：將唯一執行權威的 run receipt 與 Fanzloud 提交意圖／成果引用持久化，完成 restart replay 與 unknown-submit 不重送；不先完成整套原始 P1 actor 子任務。這是新主線的整合目標，不能反推舊 AC-05 或整個平台已完成。
