---

project: labs/agent-office-lab
purpose: 驗證本地優先的 OpenCode、Grok、Pi、Cursor 四工位 Agent Office
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-11-01
source_commit: d6678d4449e24a86dee4ac06103cee2951d4d9cc
---

# Agent Office Lab 驗收

T-0009-02 的第三次獨立授權任務通過 AC-13：Composer 2.5，15.57 秒，Read(input) → Read(result) → Write(result)，原生同 session／model、completed stop、37723 input／424 output tokens、精確產物 hash 與完整清理一致。[成功證據](docs/evidence/cursor-completed-2026-11-01.json)。前兩次失敗保留；本次授權已使用，沒有自動重跑。65 項離線測試通過；PR #878 待 CI／合併，完整 MVP 仍 incomplete。

前次單次批准紀錄：240 秒期限下於 34.05 秒因第二個 Read 被邊界拒絕而停止，沒有產物；session／固定模型／hooks 有證據，清理完整。第二次讀取的目標未記錄，不能確認它是否為輸出檢查。已離線準備最多四次工具規則、預建空 result.json 與檔案分類診斷；65 tests 和無 prompt 啟動通過，尚未再次跑模型。[本輪證據](docs/evidence/cursor-bounded-2026-11-01.json)。AC-13 保持 pending、PR #878 保持 draft；下一次付費任務須新批准。

## 主線與範圍

依 [SDD](docs/SDD.md) 完成單專案、單執行佇列、四 provider 的本機 Office。
本輪 T-0007 接入 Pi + DeepSeek 的單工位合成驗收：固定 Pi 1.4.0，原生 Office PTY／extension／authenticated hooks，以 agent_settled、session、模型與產物 hash 判定結果。
驗證計畫：請求 relay 固定 DeepSeek endpoint／model，最多四次外部請求、每次最多 512 output tokens、每個 payload 最多 32 KiB，180 秒期限；原生工具只允許合成 input.json 的 read 與 result.json 的 write。已完成離線邊界測試與原生啟動，owner 明確授權的一次付費驗收通過；[真實證據](docs/evidence/pi-live-2026-11-01.json)。
現有 local-only OpenCode demo 不變，Grok 仍留後續驗收。`source_commit` 為本輪基準；沒有將單 provider smoke 當成完整 MVP。
T-0008 範圍：接上官方 Grok 1.0.70 的 Office PTY，使用全新合成 workspace、隔離 HOME、不載入 owner 憑證、OS 阻擋外部網路；禁止 prompt／resume／額外工位，驗證原生 session 或明確登入等待以及程序清理。離線測試與實際啟動後記錄結果，不把零推論啟動算成 AC-03 通過。
SDD 原 A01–A11 在公開版統一寫為 AC-01–AC-11，條件未縮減。AC-12 僅為本次匯入驗收。
不包含部署、發布套件、模型權重、私人專案或雲端自動 fallback。

T-0009 依 owner 要求新增第四 provider Cursor Agent；固定官方下載版本與摘要、缺失／版本／能力偵測、獨立 HOME／CURSOR_CONFIG_DIR 與 owner 登入命令，先以 OS 阻擋外網驗證原生啟動及清理。AC-13 的真實任務不以未登入或離線啟動冒充。

T-0009-02：owner 已完成 Cursor 登入，原生 status 回報 authenticated；本輪準備 Composer 2.5 單一合成 prompt、最多一次 input read／一次 result write、120 秒期限、無 host 自動重試。Cursor 不提供可在此保證的請求／token／金額硬上限，配額驗收須另取得一次明確批准。63 項離線測試與[已登入無 prompt 啟動](docs/evidence/cursor-ready-2026-11-01.json)已通過。啟動須允許 HTTPS metadata；原生工具回圈與 AC-13 保持 pending，詳見[待批准的執行範圍](docs/CURSOR-WORK.md)。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 四種 CLI，When detect，Then 正確識別版本／能力，缺失或不相容不啟動。 | pending | [Grok／Pi 固定套件與實際 version/help 已通過](docs/evidence/remote-preflight-2026-11-01.json)；四 provider 統一 launch gate 與完整偵測整合仍待完成。 |
| AC-02 | Given fixture workspace，When OpenCode 執行指定任務，Then 原生事件、session 與檔案 hash 證明成功。 | passed | [本輪實測](docs/evidence/lifecycle.md) 再驗證原生檔案任務；[原歷史摘要](docs/evidence/2026-10-31.json) 保留。 |
| AC-03 | Given 確認版 Grok，When 執行同等任務，Then CLI 身分、session 與產物可核對。 | pending | 官方 Grok Build 1.0.70 相容性與[原生登入等待／隔離／清理](docs/evidence/grok-startup-2026-11-01.json)通過；登入後 session hook 與遠端任務待驗。 |
| AC-04 | Given Pi + DeepSeek，When 執行同等任務，Then provider/model、settled 事件及檔案正確。 | passed | [Pi 原生工位實測](docs/evidence/pi-live-2026-11-01.json)：3 次 DeepSeek 請求、agent_settled、同 session/model、read/write、產物 hash 及清理通過。 |
| AC-05 | Given 原生權限或使用者問題，When 等待與回覆，Then waiting_input 後繼續。 | pending | [OpenCode edit 權限子集通過](docs/evidence/lifecycle.md)；Grok／Pi／Cursor 與其他互動待驗。 |
| AC-06 | Given 執行中任務，When 取消，Then 10 秒 grace 後所屬程序全部退出。 | pending | [OpenCode 歷史子集](docs/evidence/2026-10-31.json) 通過，Grok／Pi／Cursor 待驗。 |
| AC-07 | Given crash／401／429，When 失敗，Then 不顯示成功且最多兩次顯式重試。 | pending | 尚缺故障驗收。 |
| AC-08 | Given browser refresh 或 host 重啟，When 恢復，Then 不重跑、unfinished 標 interrupted。 | pending | [OpenCode 新程序／同 session 與瀏覽器刷新通過](docs/evidence/lifecycle.md)；[host restart 與手動恢復通過](docs/evidence/restart.md)；Grok／Pi／Cursor 待驗。 |
| AC-09 | Given 四 provider 真實 run，When 開啟結果，Then 產物、模型與來源可分辨。 | pending | 尚缺四工位產品流程。 |
| AC-10 | Given 本地 Strata，When 執行公開 GitHub tool loop，Then 真實 tool_call、API 結果與後續回答完成。 | pending | 獨立研究未通過，非 MVP 阻塞。 |
| AC-11 | Given 路徑逃逸、偽造 hook 或金鑰輸出，When 操作，Then 阻擋或遮蔽。 | pending | [OpenCode sandbox probe](docs/evidence/2026-10-31.json) 僅驗證網路／寫入子集。 |
| AC-12 | Given 公開匯入來源，When 執行 publication、policy 與 repo gates，Then 無 runtime 私人資料、導航正確且檢查通過。 | passed | [匯入驗證](docs/evidence/publication.md)；CI／交付另見任務板。 |
| AC-13 | Given 官方 Cursor Agent 與明確登入，When 執行同等合成任務，Then 原生 session、模型來源、完成事件與產物 hash 可核對。 | passed | [Cursor 真實任務](docs/evidence/cursor-completed-2026-11-01.json)：同 session／模型、三次工具、completed stop、用量、產物 hash 與清理全部通過。 |

## 現況與缺口

T-0009-02 前次的 owner 授權單次任務已執行，但[驗收失敗](docs/evidence/cursor-live-2026-11-01.json)：產物正確，loop_limit=0 卻使原生 hooks 整份被忽略，沒有事件／用量證據，AC-13 保持 pending。已修正為 1、增加原生 schema 預檢並補合法讀取回歸；63 tests 與無 prompt 啟動通過。清理正確、沒有追加付費重跑；等 owner 新的一次批准。

T-0009 已固定 Cursor CLI 並完成原生登入等待、workspace hooks 安裝／移除、OS 外網拒絕與程序清理，12.51 秒；55 項離線測試通過。[安裝／owner 登入命令](docs/CURSOR.md)。owner 已登入並由原生 status 核對；有界任務 runner 已準備，待一次配額／付費批准。

T-0008 的無憑證 Grok 原生啟動檢查通過：12.83 秒，實際登入畫面、needs_input、外部 TCP 拒絕與完整清理；47 項離線測試通過。[命令與限制](docs/GROK-STARTUP.md)。沒有 session hook／推論／產物驗收，AC-03 保持 pending。

T-0006 完成遠端 CLI 接入前置與 35 項離線測試；[owner 設定命令](docs/REMOTE-SETUP.md)。Pi + DeepSeek 的 AC-04 已實測通過，Grok 尚未推論；原 local-only demo 不開放遠端 spawn。T-0007 的有界 Pi runner、41 項離線測試、原生零請求啟動與一次付費驗收通過；[命令與限制](docs/PI-REMOTE.md)。
本地 Codex 檔案／合成程式修復、Office 基底及 OpenCode 真實任務已驗證；614 個上游測試不能代替四 provider 整合。
AC-05／AC-08 的 OpenCode [生命週期子集](docs/evidence/lifecycle.md)與[host 重啟](docs/evidence/restart.md)已實測通過；完整 AC 保持 pending。之後處理遠端 provider 與剩餘 MVP；詳見 [任務板](docs/tasks/BOARD.md)。
OpenCode sandbox 仍允許區外讀取；Office／Strata 整棵程序樹尚未做 egress audit。
維持 `strict_network_isolation_verified=false`，僅使用合成資料。

## 啟動與驗證

[安裝與重跑](docs/SETUP.md)、[README](README.md)、[公開證據說明](docs/evidence/README.md)。
元件檢查：`python3 scripts/check_publication.py`、`node --test scripts/local_office_policy.test.mjs`。
Repo 檢查：`python3 scripts/check_indexes.py`。runtime 另需 macOS arm64／Metal／本機模型；Linux CI 不測推論。

## 可用版本

`usable_tag: none`。主線未完成，沒有發布 tag 或部署。
