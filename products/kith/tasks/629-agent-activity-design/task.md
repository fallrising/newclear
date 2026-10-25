# 629 — Agent 活動視圖與辦公室動畫開發文件

Issue: https://github.com/fallrising/newclear/issues/629
Component: products/kith
Owner: ChatGPT 主導，工作識別 `kith-activity-docs-20261025`；單一 writer，來源查核／獨立審查由有界子工作提供。

## 目標與依據

依 owner 直接指示，先在 Kith 撰寫 `whatsmyagentdoing` 參考的活動／動畫展示開發文件，之後才實作。文件需可讓下一個執行者理解狀態來源、點角色查看紀錄及提及對話、展示權限、角色／工位與既有平台邊界。

採用 `newclear@cfc68b97e0ee77a185807cbaf9695a29fcbcc48e` 與上游 `c9dc82f7bca2503fa32fadb40db86cd15946df71`；提交前再核對 main。先讀 root／Kith AGENTS、SDD、DESIGN、SUCCESS、cost-safety、v2 domain／runtime／UX／decisions／verification 及現行 status／RoomSync／composer／runner／MCP／Room 實作。完整來源與差異見[計畫](../../docs/plans/agent-activity-office.md)。

## 範圍

- `products/kith/docs/plans/agent-activity-office.md`
- `products/kith/README.md`、`SDD.md`、`SUCCESS.md`
- `products/kith/docs/v2/README.md`、`docs/tasks/BOARD.md`
- `products/kith/tasks/629-agent-activity-design/task.md`、`report.md`

不修改 runtime、測試、依賴、CI、根治理或其他元件。不建立新的獨立 lab／平台；不把私人專案來源寫入公開文件；不取得真實 session／prompt／credentials。

## 驗收與驗證

沿用計畫 §8 的 AC-AVDOC-01–03，不建立另一份不同定義。文件驗證包含來源固定、相對連結、diff／白名單／公開邊界、`python3 scripts/check_project_success.py --projects products/kith` 與獨立設計審查；現有 PR CI 按原 workflow 執行。

此次不跑未實作功能的 E2E、不用 runtime build 或 mock 當動畫功能完成證據。真實 provider／原生 CLI 的 AC-04 仍 pending。檢查失敗按同一文件範圍修復；外部來源、權限或 CI 若不可得，保存具體缺口，不放寬 gate。

## 操作授權

- Commit／push 工作分支／Draft PR：是，依本輪文件交付與既有工作流程。
- Merge／release／deploy／付費呼叫／權限變更：本工作不執行。
- Issue／board／本 task 與 report：本工作追蹤與交接。

PR 使用 `Refs #629`，不自動關閉 issue。交付後下一步是審閱此計畫，再另立 AV-1 的實作工作。主導 agent 整合子工作與驗證，子工作不取得遠端寫入或擴張範圍權限。
