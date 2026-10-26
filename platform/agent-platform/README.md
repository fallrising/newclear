# Agent Platform

> 主線、驗收條件、剩餘缺口與可用版本：[SUCCESS.md](SUCCESS.md)。


> **Portfolio doc tier: A (active)** — Runnable entry: [docs/quickstart.md](docs/quickstart.md). Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md). Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).


可自行託管的 agent 工作平台：在伺服器上同時執行多個隔離的 agent 任務，以同一個 Web UI 管理對話、執行狀態、工作檔案、審批與成果。

**目前狀態（2026-10-25）：M0–M2 已驗收，M3/M4 整體仍進行中。工作台已有任務搜尋、篩選連結、修改目標後重跑與安全 diff 下載；正常 Worker 的 mock 工具流程與故障清理已通過真實 KVM 切片驗收。M4 已加入不可變成果封存、明確授權 GitHub export（預設停用、fake GitHub 驗收）、離線 DB 備份／空庫還原與手動封存清理；單節點手冊與隔離演練已有歷史證據。手動事件 GC 已於 PR633 通過必要 CI 並合併；audit90天保留已於 PR641 通過必要 CI 並合併；單一終態 binding 的手動 stale cleanup 已有 focused／native 本機證據，交付狀態見下方；VM state、未知 host residue、實際主機部署與整體 MVP gate 仍未完成。**

模型開發仍用本機 mock，現在不需要 API key。單人版本延後真實計費與硬金額上限，用量金額保持 unknown。已納入 [M3 跨切片 mock 驗收](docs/M3-INTEGRATED-ACCEPTANCE.md)；真實模型自然語言 coding、完整 M3 與 release 前長任務驗收仍未完成。詳見 [GitHub 匯出](docs/GITHUB-EXPORT.md)、[成果封存](docs/RESULT-ARCHIVE.md) 與 [最新交接](docs/HANDOFF.md)。

產品範本選定 **OpenHands Agent Canvas**。2026-09-21 比較了 OpenHands、OpenClaw、Dify、Flowise；選擇依據是與「常駐伺服器、多 agent、Web 工作台」的適配度，不宣稱 OpenHands 的 GitHub 星數最多。

## Agent Computer 實驗（2026-10-03，僅文件）

[Agent Computer 文件](docs/AGENT-COMPUTER.md)保留為**需求與驗收來源**，以 CocoonBox 參考畫面的**功能效果**為目標：外部 Claude Code／MCP client 控制 Cocoon VM 內的可見桌面與 Chromium，operator 同時觀看同一個桌面，並可受控接管、保存、休眠、恢復與銷毀環境。

**實作歸屬（2026-10-23，#395）：AC-1～AC-4 已移交另一個獨立項目，不在 `platform/agent-platform` 實作。** 本次沒有可公開確認的目標項目名稱或程式碼位置，因此不填入推測連結。此處不追蹤該項目的實作進度，也不以移交推導其驗收已通過；coding 主線 M0–M6 的範圍與狀態維持不變。

AC-design-0.3 補充兩張參考截圖的證據與操作流程：中央唯讀桌面、右側歷史工具紀錄、瀏覽器元素與桌面操作、外部／guest agent 選項，以及 End 與 VM 生命週期的區別。§3.1 比較 Cua Driver、Rivet Sandbox Agent、E2B Desktop 與 AIO Sandbox 的可重用部分；第一輪維持 Web、單 computer、單 writer、一種外部 client，未承諾所有選單選項或 4K 效能。

**本文保留 Proposed 設計與歷史未執行驗收，不是本元件可啟動的功能。** Headless browser／CDP smoke 只是前置能力，不能取代完整桌面與真實 Agent 操作驗收。AC 階段與驗收 ID 供獨立實作項目對照；本元件不開啟後續 AC 實作，也不在本次啟動 VM、接入真實模型、變更主機或部署。

## 文件入口

- [單節點操作手冊](docs/SINGLE-NODE.md)：安裝、啟停、觀測、備份還原、升級回滾與隔離演練。

- [Agent Computer 需求與驗收來源](docs/AGENT-COMPUTER.md)：目標效果、控制／觀看契約及供另一項目實作的 AC 驗收；不屬本元件交付里程碑。
- [GitHub 匯出](docs/GITHUB-EXPORT.md)：檢視固定成果後授權新分支／Draft PR；獨立 worker、故障查核與設定。
- [成果封存](docs/RESULT-ARCHIVE.md)：固定 run 的來源、diff 與驗證紀錄，VM 清理後仍可下載。
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

本目錄擁有 coding 平台的設計與實作；Agent Computer 文件僅保留需求／驗收來源，其 AC-1～AC-4 實作屬另一個項目。`platform/fanzloud` 保留既有 personal BYOS／Codex Cloud 邊界；`products/kith` 保留人機群聊邊界；`gateways/pokercase` 不承載任務排程。這些元件都不是第一版啟動依賴。

採用 OpenHands 的使用體驗與 SDK 邊界作為參考，自行實作控制面與 UI；Cocoon／sandbox 作為獨立執行服務，沒有把上游程式碼複製進本項目。新寫文件沿用 repository 根目錄 MIT；第三方元件保留各自授權。

## 開始開發

目前提供 FastAPI／獨立 worker、PostgreSQL schema／queue、operator login、fake／真實 runtime adapters、私有 connector 與 React 工作台。現行操作見 [單節點手冊](docs/SINGLE-NODE.md)，M1 歷史驗收見 [M1 文件](docs/M1.md)。M0 Python CLI、guest rootfs、Docker／KVM 實測工具繼續保留。

瀏覽器驗收只在本機手動跑：`npm --prefix web ci && npm --prefix web run build && web/node_modules/.bin/playwright install --with-deps chromium && make browser-test`。Pull request CI 保留 `make platform-check`。

M2 的 OpenHands profile 會在真實 VM 中執行固定模擬模型的檔案修改驗收，並顯示事件與 diff。它尚不解讀自然語言工作目標、不呼叫付費 provider；專案測試未設定。啟動與能力限制見 [M2](docs/M2.md)。

離線維護工具及操作邊界見 [備份與封存保留](docs/BACKUP-RETENTION.md)。它只在 operator 明確執行時動作；封存清理先預覽、再以 digest 確認，不清理 active/recovery 或 export 引用的成果。

2026-10-25 [手動事件保留](docs/EVENT-RETENTION.md)新增 `event-gc-preview`／`event-gc-apply`，只清理獲明確批准且符合終態／cleanup 證明的連續事件前綴，保留 source dedupe、sequence 與結果。[PR633](https://github.com/fallrising/newclear/pull/633) 已通過必要 CI（45 base／700 platform）並合併，詳見[任務板](docs/tasks/BOARD.md)。[本機交付快照](tasks/379-event-retention/report.md)中的初次644pass/4fail、targeted4pass與未歸因 export-lock 失敗仍保留；後續 CI 成功不改寫歷史。

2026-10-25 [手動 audit 保留](docs/AUDIT-RETENTION.md)提供 `audit-gc-preview`／`audit-gc-apply`，至少90天、明確批准且有界地刪除歷史 audit，保留最小 operation evidence 與獨立控制狀態。本機 focused22 與三項 native roundtrip 通過，另有 pause fixture 修正19項通過；[PR641](https://github.com/fallrising/newclear/pull/641) 必要 CI（45 base／724 platform）成功並合併。初次 hosted722pass／1pause-helper failure 與先前本機失敗仍保留；最新交付紀錄見[任務板](docs/tasks/BOARD.md)，[交付快照](tasks/379-audit-retention/report.md)保留當時狀態。不代表完整 M4 或 live 驗收。

2026-10-25 [手動 stale binding 清理](docs/STALE-CLEANUP.md)提供 `stale-cleanup-preview`／`stale-cleanup-apply`：只對一個有完整原始身分證據的終態 run 批准一次新的 release，保留原本未確認的 intent；既有 recovery 重新證明停止後才釋放容量。本機28 focused、2 HTTP overlap、1 native roundtrip及12相關回歸通過。精確邊界、失敗歷史與必要 CI／交付入口見[本機快照](tasks/379-stale-cleanup/report.md)；不包含未知資源刪除或 live VM 驗收。

### Bounded cross-flow acceptance

[COMP01/02 contract](tasks/379-fake-composite/task.md) and [local delivery snapshot](tasks/379-fake-composite/report.md) join stale recovery, explicitly approved synthetic HTTP export and native restore in one scenario. Production behavior is unchanged; complete fake E2E/live/M4 acceptance remains open.

[BGC01/02 browser/GC/export integration](tasks/379-browser-retention/report.md) adds one
real Chromium/API/SQL retention scenario on synthetic historical data. It verifies
export protection, expired-cursor reconnect and stale archive controls, while full
fake/live/M4 scope remains open. Original failure history is retained.

封存過期的匯出預覽／授權現在會立即更新下載與匯出控制，重新查詢失敗也會保留
已確認的過期狀態與成果摘要。詳見 [EUX01/02修正與驗證](tasks/379-expired-export/report.md)。

下載封存遇到明確 `410 artifact_expired` 時也立即停用該封存的下載／新匯出；
metadata 重新讀取失敗或暫時回傳舊資料時仍保留過期狀態與原始摘要、diff、hash、size。
其他錯誤可明確重試，不推定過期。詳見 [DUX01/02](tasks/379-download-expiry/report.md)。
