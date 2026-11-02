# Agent Secrets

> **Spec-only：只有設計文件，沒有可執行服務、部署、真實憑證或可用版本。**
> 主線與驗收：[SUCCESS.md](SUCCESS.md)。主規格：[docs/SDD.md](docs/SDD.md)。

以 meathill/hsm 的 Cloudflare Workers＋KV 加密秘密儲存為參考，規劃可稽核、可撤銷的 Agent 憑證使用方式。這裡的 HSM 是概念來源，不宣稱硬體安全模組、完整 KMS、零知識保管庫或合規認證。

文件明確分為三層：上游既有行為、必須修正的安全／相容性差異、尚待批准的 Agent Credential Broker 設計。後者預設讓 Agent 請求受限操作，而不是把 API key 或密碼交給模型。

## 文件入口

- [SDD](docs/SDD.md)：範圍、模組、資料流、HTTP／MCP、威脅模型、授權、恢復、驗收與里程碑。
- [設計決策](docs/ADR.md)：Accepted 的文件邊界與 Proposed 的開發選擇。
- [來源與版本](docs/SOURCES.md)：固定上游 commit、讀取檔案及官方文件。
- [交接與驗證](docs/HANDOFF.md)：本次完成項、檢查限制與下一輪開發入口。
- [任務板](docs/tasks/BOARD.md)：T-0959 的認領及交付狀態。

## 邊界

本輪僅文件，不安裝依賴、不執行上游服務、不建立 Cloudflare 資源、不接入真實 Agent 憑證、不 merge／deploy。不能執行本目錄來啟動服務。

「合法存取」在本專案指憑證擁有人授權、最小權限、政策約束與可稽核，不是對法律遵循的保證。Secrets Manager 保存憑證；Credential Broker 執行授權；Agent／模型不是授權權威。

未來可被 [Agent Platform](../../platform/agent-platform/README.md) 或其他執行器使用，但不另建任務平台，也不自動改動既有平台。公開文件只使用合成資料與通用角色，不包含個人帳號、主機或秘密。
