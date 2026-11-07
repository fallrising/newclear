# 可直接交接給 Grok Bot／其他可執行 Agent 的完整提示詞

以下區塊可完整複製。預設是實作與 Draft PR，不包含 merge、公開部署、付費呼叫或權限變更；owner 的當次明確授權優先。這份提示詞不會自行建立其他 bot 的權限。

---

你是本任務的實作 Agent。請在 `fallrising/newclear/labs/virtual-office-lab` 接續實作可公開展示的 Three.js 虛擬辦公室。

## 先讀與確認

先讀根 AGENTS.md、專案 AGENTS.md、SUCCESS.md、SDD.md、docs/tasks/BOARD.md、docs/evidence/m0.md、docs/API.md、docs/RUNBOOK.md。核對目前遠端 main 與工作分支，不用記憶中的 SHA；先認領與更新 AC 再修改程式。

此目錄已有 CLI 與 Workers/SQLite Durable Object 骨架，不要重寫成另一套 orchestration 平台。HAI 是任務與驗收權威，本辦公室只有公開狀態投影。不要讓裝修／provider 框架／新看板支線阻斷真實上報主線。

僅當資料缺少時詢問以下三件事；已有答案不要重問：
1. 哪些可公開的 agent 別名、角色、顏色與座位？未更動時沿用 roster.json 四個範例，不能自行暴露真實帳號。
2. 辦公室風格與特殊物件？預設低多邊形明亮木質辦公室、植物、白板、咖啡機，首版無自動音樂。
3. 允許在哪裡執行／部署、如何透過 secret manager 或 connector 注入憑證、批准的成本上限？沒有部署授權就只做本機，不索取 plaintext token 到聊天。

## 必須走通的實作順序

A. 先跑 npm run check、npm test，以及可用環境中的實際 workerd smoke；把缺少依賴或網路的情況記錄清楚。
B. 先只接一個真正的 Agent 執行端，以無敏感任務驗證開始→工作→完成上報。你若有本機 shell，就使用既有 office-report；沒有該宿主執行權限，明示缺口，不能以 demo 或自己 curl 冒充 agent hook。
C. 增加 Three.js 場景與唯讀狀態清單，不新增 provider 調度系統。固定依賴版本與 lockfile，將打包資產放獨立 public/dist 目錄，絕不把 repo root 公開。
D. 完成八狀態、協作、stale、夜間 overlay、斷線與 reduced-motion 的實際瀏覽器驗證。先證明真實狀態能驅動畫面，再加裝飾。
E. 只有 owner 明示批准後才部署；先用空白正式 namespace，演示模式獨立且標示「模擬資料」。依 RUNBOOK 做公開邊界、重啟、撤權與回復驗證。

## 場景佈局

世界 24×16，x 向右、z 向前、y 向上；相機 (26,22,26) 看向 (12,0,8)。用原創幾何圖元，無付費或來源不明資產。

- 左後總監室 x1～7/z1～5：Grok Bot 的 director 座位 (4,3)，桌椅與白板，門 (6,5)。
- 右後會議室 x13～23/z1～5：會議桌中心 (18,3)，座位 (15,3)/(17,2)/(19,2)/(21,3)，門 (16,5)。
- 中間工位區 x8～22/z6～10：內容顧問 desk-1 (10,8)、數據顧問 desk-2 (14,8)、媒體製作 desk-3 (18,8)。
- 左前休息區 x1～8/z11～15：沙發、植物，候位點 (3,12)/(5,12)/(7,12)。
- 右前茶水間 x18～23/z12～15：咖啡機 (20,13)，出口 (23,14)。
- 走道沿 z6/z11，經門口 waypoint 進出；不能直穿桌牆。碰撞與走道可達性需要測試。

## 狀態與動畫

coding：工位打字；terminal：終端圖示，不公開命令；browsing：資料圖示，不公開網址；thinking：思考或白板；needs-you：紅色注意提示＋文字，不快速頻閃；error：錯誤圖示但不曝露堆疊；idle：休息區；done：僅新 revision 播放一次撒花。

30 分鐘無新上報：畫面標示 stale／資料過期，保留 reportedStatus 和 alert，不把錯誤隱藏掉。夜間 overlay 預設停用；啟用時 Asia/Singapore 22:00～08:00，只讓 idle/stale 且無 alert 的角色離開，有新鮮工作回報的角色不能假裝下班。

只有雙方互相列出協作、狀態新鮮且未 idle/done，才一起去會議室；固定排序座位避免抖動。多方協作不更改對方真實任務或授權。

## 讀寫、安全與效能

只有 GET /state 是前端資料來源；沒有發命令、批准、取消或寫 token 的按鈕。每 15 秒＋jitter、最多一個 in-flight poll；隱藏頁面停止，恢復時重抓；連線失敗退避至最多60秒並顯示斷線，不自動換成 demo。

所有文字用 textContent 或 Canvas fillText，禁止 innerHTML。支援 reduced-motion、手機相機操作、無 WebGL 文字 fallback。demo 的 mode/simulated 必須在畫面長駐顯示。

只允許任務分類、狀態及公開協作別名。office-report 接受1～80 Unicode code points 摘要，但丟棄自由文字，只傳固定 enum；server 拒絕 summary/prompt/log/url 等未知欄位。禁止帳號、私訊、金額、未公開計畫、原始錯誤與秘密。

沿用每 agent 獨立 Bearer、secret 中的 SHA-256 digest、固定路由、1024-byte 上限、12次/分鐘更新配額、server timestamp、UUIDv4 去重、expectedRevision CAS。409 不可刷新版本後強制覆蓋。不能用 Workers KV 整份讀改寫替代交易持久化。應用配額不是反 DDoS；公開 ingress 另驗收。

不要把 token 寫進前端、Git、指令參數、URL 或 PR；透過 owner-only token file/secret manager 注入。不同 bot 的 shell/工具權限分別驗證，不能假設我在此窗口批准等於其他 bot 自動可執行。

## 上報指令與驗收證據

提供以下形式給每個執行端，摘要維持泛化：

```sh
./bin/office-report grok thinking "規劃一般工作"
./bin/office-report grok coding "進行程式開發" content --task code
./bin/office-report grok needs-you "等待人工確認"
./bin/office-report grok done "本次工作結束"
```

上報失敗不能改寫主要工作的 exit status；不應為了回報而反覆開啟 LLM 對話或無界重試。記錄 endpoint類型、server timestamp、revision、測試版本與公開安全截圖即可，不記錄真實 prompt 或 token。

每項 AC 分成 passed/failed/pending，測試替身、workerd本機、真正Agent與公開部署的證據分開。最後完成 commit、push 工作分支、Draft PR、必要 CI 與回讀，交付真實 SHA／PR網址／測試結果。沒有額外授權，不 merge/deploy/release。SUCCESS 與 BOARD 不得用一個「DONE」取代驗收；合併前任務板仍 in_progress，不建立 usable tag。
