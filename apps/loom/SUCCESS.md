---
project: apps/loom
purpose: 整合畫布、原生終端、Markdown 與 AI 的本機桌面工作區
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# loom 成功契約

## 主線與範圍

[README](README.md) 將 Loom 定位為整合原型，Tier C dormant；維修不重啟 backlog。
主線包含原生 PTY、文件寫入與衝突、canvas sidecar、Run／Pin、AI 與 session history。
[FREEZE](FREEZE.md) 的 contract／schema 為資料權威，不代表每個 shape 已接入 UI。
MCP host、capability/approval gate、plugin runtime、inbox 仍是未實作產品範圍。
Linux 已驗證切片須與 Windows/macOS、長期可靠性及未完成產品能力分開。

## 驗收條件

本表的 passed 僅表示本次已核對的靜態條件；historical 是既有紀錄，
不表示 2026-10-21 重跑產品。pending／failed 保留其實際缺口。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given Linux 原生 workspace，When 使用終端、文件及畫布，Then 六個指定場景完成且資料權威一致。 | historical | [Linux 六場景](docs/workspace-acceptance-verification.md)，2026-10-04 維修期間證據。 |
| AC-02 | Given 有未存文件及 session metadata，When 關閉／重新啟動，Then 未存保護生效且歷史不自動重跑命令。 | historical | [window close](docs/window-close-safety-verification.md)、[session recovery](docs/session-recovery-verification.md)；不是 crash recovery。 |
| AC-03 | Given OpenCode Go glm-5.3-flash，When 發出一個 Chat Completions 請求，Then 可讀取真實回覆。 | historical | [OpenCode 驗證](docs/opencode-verification.md)；只涵蓋一種 live 模型／協定組合。 |
| AC-04 | Given 支援桌面與其他 AI protocol，When 完整操作主線，Then 原生 UI、契約及跨平台行為一致。 | pending | [development status](docs/development-status.md)：Windows/macOS、其他 live 組合、AI DTO 對齊與壓力驗收仍缺。 |
| AC-05 | Given plugin／MCP 工作流，When 要求能力及審批，Then host、gate、runtime 與 inbox 可依契約運作。 | pending | [README 現況](README.md) 明列 Future capabilities 未實作；維修不自動授權續做。 |

## 現況與缺口

PTY Unicode、文件 create-only、關閉保護與 session store 都有維修回歸證據。
SQLite 保存 metadata；不保存 PTY output、未存 buffer，也不能重接已消失的程序。
正常文件 save 不提供跨程序 CAS；feeds_output_to 畫線不會驅動 Run/Pin。
AI IPC DTO 尚未統一到 frozen generated shape，canvas 沒有正式 LOD／壓力驗收。
舊72通過／1失敗是修補前基線；不能拿舊表覆蓋後續各項驗證結果。

## 啟動與驗證

從本目錄依 [README](README.md) 安裝 npm lock、Rust1.88 與 native Tauri 依賴。
`npm ci` 後 `npm run tauri -- dev`；`LOOM_VAULT` 決定 vault，預設為使用者 loom-vault。
`npm run dev` 只有 browser UI，無 PTY／filesystem／AI native 能力。
驗證入口為 `cargo test --locked --workspace --no-fail-fast`、
`npm run typecheck:contracts`、`npm run typecheck:app`、`npm test`、`npm run build`。
憑證以環境設定；真 provider 呼叫與離線測試分開留證。

本次只核對文件、入口與證據連結；未執行產品建置、服務或外部整合。
未執行的產品驗收不會因本文件通過格式檢查而轉為通過。

## 可用版本

目前 `usable_tag: none`。
Linux 原型可描述為有限已驗切片，完整產品主線仍未完成。
需補已承諾能力、資料／AI 契約、指定平台與核心 native journeys；dormant 恢復另依 owner 決定。

任何未來可用標記都須對應已合併的目標 SHA、必要 CI／審查與核心流程證據。
較早證據須先比對其後程式與設定差異；有關變更補驗後才能沿用。

## T-0380 FE Round2 paired review — in progress

[Approved bounded task](fe-review/tasks/round2/task.md): existing Flowshot shell preload and Loom complete review-only IPC/event fixtures; no product/native/dependency changes. Browser evidence cannot qualify native/Mac/real-vault/AI/mainline. Required frontend/native CI, actual isolated scenarios/cleanup and independent review remain pending.
