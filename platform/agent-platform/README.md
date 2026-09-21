# Agent Platform

可自行託管的 agent 工作平台：在伺服器上同時執行多個隔離的 agent 任務，以同一個 Web UI 管理對話、執行狀態、工作檔案、審批與成果。

**目前狀態：M0 開發中。已實作 OpenHands Agent Server 的 Docker 契約測試工具；Cocoon／KVM gate 尚未通過，平台 API、Web UI 與排程器尚未開始。**

產品範本選定 **OpenHands Agent Canvas**。2026-09-21 比較了 OpenHands、OpenClaw、Dify、Flowise；選擇依據是與「常駐伺服器、多 agent、Web 工作台」的適配度，不宣稱 OpenHands 的 GitHub 星數最多。

## 文件入口

- [SDD](SDD.md)：產品範圍、使用者流程、架構、資料與 API 契約、故障處理、驗收與里程碑。
- [範本研究與選擇](docs/reference-selection.md)：即時 GitHub 數據、來源 revision、比較與採用邊界。
- [M0 執行與驗收](docs/M0.md)：安裝、實測發現與 KVM 待驗項目。
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

第一個切片提供 Python CLI、事件去重 journal、確定性模型 fixture、真正 Agent Server 的 Docker 整合測試，以及 path-scoped CI。安裝和執行命令見 [M0 文件](docs/M0.md)。

下一個切片是在 KVM 主機完成 pinned OpenHands × Cocoon sandbox 整合，驗證建立 → 指令 → 事件重連 → 結果保存 → 清理。M0 全部 gate 通過後才進入 M1 應用骨架。
