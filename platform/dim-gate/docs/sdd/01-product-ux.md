# 01 — 產品範圍、資訊架構與互動

## 1. 需求

| ID | 要求 | v0.1 深度 |
| --- | --- | --- |
| REQ-01 | 統一 App Shell、三中心與演示模式 | 完整，包含角色切換、scope、深連結、reset |
| REQ-02 | 三來源 CMDB、依賴與資產身分 | 完整查詢、手動納管、owner／tag 修改、關係管理、影響拓撲 |
| REQ-03 | RD 應用與環境自助服務 | 完整申請、進度、資源與發布上下文 |
| REQ-04 | CI/CD 與 release | 完整模擬 pipeline、失敗、重試、發布、健康檢查與回滾 |
| REQ-05 | APM 與故障處理 | metrics、trace、log、incident 關聯，認領、處理、觀測恢復 |
| REQ-06 | Ops 審批與作業 | 完整環境交付審批；容量／作業紀錄可下鑽 |
| REQ-07 | Admin 治理 | 選單、服務目錄、固定角色 scope 綁定、CMDB 自訂欄位、整合狀態 |
| REQ-08 | 跨模組一致性與稽核 | 共用 ID、correlation、版本控制與完整因果鏈 |
| REQ-09 | 可重演的展示 | 固定 seed、故障情境、重置、刷新恢復、可驗證導覽 |
| REQ-10 | 可用性與可擴充前端 | 狀態畫面、鍵盤、效能預算、API 邊界 |

第一版不做任意 workflow editor、任意角色 permission code 編輯器、全功能 CMDB schema designer 或真實 APM query language editor。這些入口若出現在能力說明，必須標示後續規劃，不混進可操作主線。

## 2. 全域結構

頂部：dim-gate／中心切換、團隊／專案／環境上下文、全域搜尋、通知、主題、示範身分。側欄：中心內分組導航；主區域：breadcrumb、標題／說明／主要 action、scope chips、內容與右側詳情 sheet。底部或頂部常駐「示範資料」標記。

- 進入 `/` 依目前身分導向第一個可用中心；沒有業務權限時顯示說明與切換示範身分入口。
- 中心切換保留合法的 app/environment 上下文；不合法時清除該條件並提示，不帶著舊 ID 查另一團隊資料。
- role switch 是 demo persona 選擇，不是賦權；選定 persona 後，其 role assignments 由共用 policy 評估。
- URL 保存可分享的 filters、sort、page 與選取 ID；分享只重現視圖，不共享另一個分頁的 demo snapshot。
- 全域搜尋依 scope 查 app／CI／request／release／incident，200ms debounce；不能回傳隱藏實體的名稱或數量。
- 通知由 domain events 衍生；點通知進入可存取的 detail，無權時顯示權限已改變並清除舊 preview。

## 3. 頁面與路由契約

路由以下均為 app-relative path；靜態部署由 basename 統一加前綴。`:id` 必須與資料實體相同，不用 list index。

| Route | 畫面與主要資料 | 可操作範圍 | 完成階段 |
| --- | --- | --- | --- |
| `/rd` | 我的應用、待辦、近期發布、當前告警 | cards 可進 detail，時間與 scope 篩選 | M1 → M4 |
| `/rd/apps`、`/rd/apps/:appId` | 應用 owner、repo placeholder、環境、依賴、發布／觀測 tabs | 篩選、環境切換、關聯下鑽 | M1 |
| `/rd/catalog`、`/rd/catalog/:itemId/request` | 已發布的服務項目、模板、配額預覽 | 多步環境申請 | M2 |
| `/rd/requests`、`/rd/requests/:requestId` | 我的團隊可見請求、狀態與時間軸 | 草稿编辑／提交／撤回／失敗後重試 | M2 |
| `/rd/pipelines`、`/rd/pipelines/:runId` | pipeline runs、DAG stages、log、artifact | 觸發、取消 pre-deploy、重試 | M3 |
| `/rd/releases/:releaseId` | 環境、artifact digest、health、前版本與後續回滾 | 選目標並提交回滾 | M3 |
| `/rd/observability` | app/environment RED 指標、trace、log、incident | 時間窗與維度篩選、trace／log 互跳 | M4 |
| `/ops` | provider 分布、容量、待審、資料品質、active incidents | 篩選與下鑽 | M1 → M4 |
| `/ops/cmdb`、`/ops/cmdb/:ciId` | CI 表格／詳情、共同與 provider 欄位、關係、變更 | 納管、編輯 owner／tags、建立／移除關係 | M1 |
| `/ops/topology` | app／environment／CI 依賴圖與 impact mode | 選起點、逐層展開、邊詳情與表格替代視圖 | M1 |
| `/ops/requests`、`/ops/requests/:requestId` | Ops scope 內待審／已處理請求 | 核准、拒絕、啟動交付、失敗診斷 | M2 |
| `/ops/jobs`、`/ops/jobs/:jobId` | provisioning jobs 的進度、log 與結果 CI | 觀察與導向來源請求；retry 從 request 發起 | M2 |
| `/ops/incidents`、`/ops/incidents/:incidentId` | 告警來源、受影響物件、變更、時序 | 認領、標記處理中、查看恢復證據 | M4 |
| `/ops/capacity` | pool 容量／使用／保留／申請差額 | scope／provider 篩選，導向 CI 和 pending requests | M2 |
| `/admin` | 配置狀態、整合健康、最近 policy／catalog 變更 | 統計可下鑽 | M2 |
| `/admin/access` | 業務線、團隊、專案、使用者與固定角色綁定 | 選 user／role／scope、授予／撤銷、effective preview | M2 |
| `/admin/navigation` | 三中心選單配置 | 標題、分組、排序、可見性編輯與預覽 | M2 |
| `/admin/catalog`、`/admin/catalog/:itemId` | template 與服務目錄版本 | 編輯草稿、發布、停用 | M2 |
| `/admin/cmdb-models` | 固定 CI kinds、自訂欄位定義 | 新增可選欄位、標籤與驗證規則；檢查相容性 | M2 |
| `/admin/integrations` | AWS／Aliyun／IDC／CI／APM adapter 示例 | 查看映射、最後同步與模擬測試結果 | M4 |
| `/admin/audit` | 全企業管理稽核 | 時間／actor／action／correlation 篩選，受限制 payload | M2 → M4 |
| `/guide` | 展示步驟、條件、角色說明、scenario controls | 下一步深連結、注入情境、重置 | M0 → M5 |

RD 與 Ops 的 domain detail 有 audit timeline；不需為稽核強制進 Admin Center。staging／prod 的識別 badge 在所有 mutating dialogs 中固定顯示。

## 4. 關鍵頁面細節

### 4.1 CMDB 列表與詳情

預設欄位：名稱、kind、來源、region／site、lifecycle、health、owner、綁定應用數、freshness。支援搜尋、provider／kind／team／environment／health 篩選、欄位顯隱、穩定排序及分頁。v0.1 不做 bulk mutation；多選只用於比較最多 3 筆 CI。

詳情 tabs：概要、provider attributes、關係、觀測摘要、變更與稽核。未識別／stale／orphan 的資料品質提示獨立於運行健康度。納管表單依 provider 切換必填欄位，不能送出只有名稱的空 CI。

拓撲提供固定層級 layout、legend、edge direction、縮放／fit、選取面板。一般 dependency 與可能影響是不同顯示模式。拓撲的 app/service 是配置關係；APM service map 是 trace 推導的呼叫關係，不能混用「即時發現」措辭。

### 4.2 申請 wizard

步驟：選 template → app 與環境 → provider／pool／規格 → owner／用途 → 檢視與提交。最後一步展示 CPU／memory 差額、approver 類型、是否為示範、需要的時間估計。估計只是 demo 固定值，不使用真實價格。每步驗證；返回保留輸入；離開 dirty form 提醒。

提交後先顯示 submitted，再跳 detail；不能在 request 尚未被受理前顯示「環境建立成功」。拒絕要有理由；quota 不足顯示 requested、available 與可調整項目。

### 4.3 Pipeline／release

stage flow 顯示 queued／running／succeeded／failed／cancelled／skipped，選 stage 看有時間戳的示例 log。Build artifact 可見 digest、source revision 與產物；部署頁另外展示 rollout 與 health gate。回滾 dialog 列出同環境合格的歷史 release、當前 active release、原因欄位與 scope。

### 4.4 APM／incident

上方 app、environment、time range；下方 request rate、error rate、p95 latency 和 samples 時间。chart tooltip 標明單位、採樣窗口及示範來源。trace table 可進 waterfall，span 可跳對應 log；log 的 traceId、releaseId、ciId 是可導航連結。

incident detail 並列「觀測證據」「配置依賴」「最近變更」；推測關係標明「可能相關」，不把時間接近當成根因證明。回滾成功與 incident resolved 分別展示，恢復要有足量健康樣本。

## 5. UI 視覺與狀態契約

控制台以中性色為主，品牌 accent 使用 indigo；red 為失敗／critical，amber 為 warning／等待，green 為 healthy／成功，gray 為 unknown／disabled。顏色之外一定有文字與 icon。大面積空間用於表格、關係與時間軸；每頁一個主要 action，避免 dashboard 只有裝飾數字。

Typography：系統 sans-serif，CJK fallback；ID／digest／log 採 monospace。間距以 4px 基底；側欄 240px／收合 64px，header 約 56px；主內容 padding 24px，table normal row 44px、compact 36px。這些是初始設計 token，可在不影響驗收下微調。

| 狀態 | 必須呈現的行為 |
| --- | --- |
| loading | 局部 skeleton；可用導航保留；未知統計不能先顯示 0 |
| empty | 說明當前 scope 沒資料，給合法的建立／清除篩選 action |
| error | 可讀錯誤、requestId、重新讀取；不自動重送非冪等寫入 |
| forbidden | 中心層顯示禁止；個別 scope 外 detail 404；不能閃現舊資料 |
| stale | 顯示資料時間與重新整理；stale metrics 不推算 healthy |
| mutation pending | 禁用重複按鈕；保留選中目標與環境，不凍結整頁 |
| conflict | 告知資料已更新，重新取得後讓使用者重新確認 |
| success | 畫面可看到新狀態、相應 detail 與 audit；toast 只是補充 |

最低驗收寬度 1280px；1440px 為主要設計尺寸。768px 以收合 sidebar／sheet 提供探索；390px 可讀主要摘要，複雜表格有局部橫向滾動，不保證所有管理編輯適合手機。Dialog focus trap、Esc、focus return、label／error 關聯、skip-to-content 與 reduced-motion 必須支援。圖表／拓撲有文字或表格替代，不以 canvas 作唯一資訊來源。
