# Agent Platform

> **Portfolio doc tier: A (active)** — Runnable entry: [docs/quickstart.md](docs/quickstart.md). Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md). Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).


可自行託管的 agent 工作平台：在伺服器上同時執行多個隔離的 agent 任務，以同一個 Web UI 管理對話、執行狀態、工作檔案、審批與成果。

**目前狀態：M0 真實 KVM gate、M2 runtime 與 M3 recovery／cancel／approval／pause、guest 控制憑證隔離、固定節點 egress 已驗收。AT-11-A 控制端 model proxy 與 AT-11-B opt-in guest mailbox／SDK tool-call／短效憑證更新及 request cutoff 已接通；仍為本機固定 fixture。完整 AT-07／AT-11／M3、可信金額預算、付費 provider 與 usage UI 尚未完成。**

產品範本選定 **OpenHands Agent Canvas**。2026-09-21 比較了 OpenHands、OpenClaw、Dify、Flowise；選擇依據是與「常駐伺服器、多 agent、Web 工作台」的適配度，不宣稱 OpenHands 的 GitHub 星數最多。

## 文件入口

- [最新交接](docs/HANDOFF.md)：停止點、升級方式、測試資產與下一步。
- [新視窗接續 prompt](docs/NEXT-PROMPT.md)：每個切片完成時更新的接續指示。
- [M3 guest model transport](docs/M3-GUEST-MODEL.md)：啟用設定、SDK tool-call、credential 更新、cutoff 與真實 KVM 證據。
- [M3 控制端 model proxy](docs/M3-MODEL-PROXY.md)：短效 token、request cap／ledger 與 AT-11-A 歷史邊界。
- [M3 固定節點 egress](docs/M3-EGRESS.md)：sealed node policy、DNS／redirect、政策 digest 與 drain 升級。
- [M3 客體控制憑證隔離](docs/M3-GUEST-ISOLATION.md)：獨立非 root 控制帳號、固定降權與攻擊驗收。
- [M3 輸出安全與歷史隔離缺口](docs/M3-OUTPUT-SECURITY.md)：密鑰防漏、diff 完整性及當時發現的隔離缺口。
- [M3 安全暫停／恢復](docs/M3-PAUSE.md)：工具收尾證據、同 VM 接續與控制佇列。
- [M3 工具審批](docs/M3-APPROVAL.md)：完整動作審閱、一次性核准、拒絕與恢復對帳。
- [M3 安全取消](docs/M3-CANCEL.md)：工作台取消、真實 VM 停止證據與剩餘工作。

- [M3 worker 恢復](docs/M3-RECOVERY.md)：同一 VM 接管、持久 lease fence、故障注入與剩餘工作。
- [M2 真實任務與啟動](docs/M2.md)：私有 connector、固定 repository bundle、真實 VM／模擬模型、事件與 diff 驗收。

- [M1 工作台與啟動](docs/M1.md)：operator 登入、PostgreSQL queue、React UI、驗收與後續邊界。
- [SDD](SDD.md)：產品範圍、使用者流程、架構、資料與 API 契約、故障處理、驗收與里程碑。
- [範本研究與選擇](docs/reference-selection.md)：即時 GitHub 數據、來源 revision、比較與採用邊界。
- [KVM 主機準備](docs/KVM-HOST.md)：硬體條件、版本基準、guest 映像與遠端測試命令。
- [真實 KVM 驗收與限制](docs/KVM-VALIDATION.md)：boot／relay／isolation／TTL／release 證據及重跑命令。
- [M0 執行與驗收](docs/M0.md)：安裝、實測發現與 KVM 驗收狀態。
- [Docker 實測報告](docs/evidence/docker-2026-09-21.json)：固定映像的已執行證據。
- [Portfolio 決策](../../PORTFOLIO.md)：2026-09-21 此項目的開發例外。

## 第一版方向

1. 在 Web 建立任務，選擇 Git repository、固定 base commit、agent profile 與執行環境。
2. 排程器為每次執行分配獨立 Cocoon MicroVM，啟動 OpenHands Agent Server。
3. 在任務工作台查看對話、工具活動、終端輸出與 diff；提交後續訊息、取消或處理審批。
4. 任務結果持久化，瀏覽器關閉後仍可執行；控制面重啟後重新連線並核對狀態。
5. 核心驗收完成後，再加入 ACP agent、排程／webhook 與多節點。

## 專案邊界

本目錄擁有新平台的設計與實作。`platform/fanzloud` 保留既有 personal BYOS／Codex Cloud 邊界；`products/kith` 保留人機群聊邊界；`gateways/pokercase` 不承載任務排程。這些元件都不是第一版啟動依賴。

採用 OpenHands 的使用體驗與 SDK 邊界作為參考，自行實作控制面與 UI；Cocoon／sandbox 作為獨立執行服務，沒有把上游程式碼複製進本項目。新寫文件沿用 repository 根目錄 MIT；第三方元件保留各自授權。

## 開始開發

目前提供 FastAPI／獨立 worker、PostgreSQL schema／queue、operator login、fake／真實 runtime adapters、私有 connector 與 React 工作台。啟動與測試見 [M1 文件](docs/M1.md)。M0 Python CLI、guest rootfs、Docker／KVM 實測工具繼續保留。

M2 的 OpenHands profile 會在真實 VM 中執行固定模擬模型的檔案修改驗收，並顯示事件與 diff。它尚不解讀自然語言工作目標、不呼叫付費 provider；專案測試未設定。啟動與能力限制見 [M2](docs/M2.md)。
