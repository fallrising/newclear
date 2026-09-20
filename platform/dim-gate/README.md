# dim-gate

以 CMDB 為核心的企業一站式運維自助平台前端，涵蓋 AWS、Aliyun 與自建機房，讓研發、運維與平台管理員透過同一組資料完成各自的工作。

**目前狀態：SDD v0.1 文件基線，尚未開始前端實作。** 本目錄尚無可執行應用、套件安裝命令、線上展示或真實雲端連線。下述功能是已確定的開發目標。

| 工作中心 | 要回答的問題 |
| --- | --- |
| RD Center | 我的應用在哪裡運行？如何申請環境、發布、觀察與回滾？ |
| Ops Center | 哪些資源承載哪些業務？變更與故障影響誰？如何處理？ |
| Admin Center | 誰能看什麼、做什麼？平台目錄與服務能力如何治理？ |

第一版是一個可操作的示範產品：使用可重置、有狀態的模擬資料，不需要 AWS／Aliyun 帳戶或後端服務。主要流程是「目錄與權限配置 → 資源納管 → 環境申請與審批 → 交付 → 發布 → 告警 → CMDB 影響定位 → 回滾」。它展示業務流程，並不執行真實雲端操作。

## 文件入口

- [開發啟動 prompt](DEVELOPMENT_PROMPT.md)：後續agent的固定入口，先核對進度，再接續最早未完成里程碑。
- [開發恢復協定](docs/DEVELOPMENT_PROTOCOL.md)：進度權責、task／evidence、重入、交接及分叉規則。
- [主控計畫](../../.team/PLAN.md)：dim-gate任務與接受決策、目前可恢復位置。
- [SDD 總綱](SDD.md)：目標、範圍、架構、不變量與閱讀順序。
- [詳細規格](docs/sdd/README.md)：頁面、資料模型、流程、權限、前端、API／Mock、驗收與決策。
- [開發狀態](docs/STATUS.md)：目前交付證據與下一個里程碑。
- [開發約定](AGENTS.md)：後續實作的範圍與文件維護方式。

下一個開發session可使用：「請讀取 `platform/dim-gate/DEVELOPMENT_PROMPT.md`，依啟動與恢復協定核對目前進度，接續開發。」若要實驗不同版本，明確提供branch／variant；入口本身不保存會過期的最新進度。這是一套由agent執行的文件協定，目前没有常駐排程器或自動恢復程式。

## 技術方向

React + TypeScript + Vite，shadcn/ui + Tailwind CSS，React Router，TanStack Query／Table，React Hook Form + Zod，React Flow 與 Recharts，MSW 模擬 API。確切版本於 M0 實作時驗證相容性並鎖定；本文件不宣稱已有 build 或依賴驗證結果。

本項目是 `fallrising/newclear` 中獨立的前端 component；未來透過 API adapter 接入後端。`platform/prism`、`specs/fleet` 與 `apps/cloudform` 只作可能的整合參考，不是第一版啟動依賴。授權沿用 repository 根目錄 MIT。
