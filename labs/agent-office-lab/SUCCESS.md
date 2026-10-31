---
project: labs/agent-office-lab
purpose: 驗證本地優先的 OpenCode、Grok、Pi 三工位 Agent Office
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-31
source_commit: 5da594c1d87a33a7ce3a2eb98d9690652a608973
---

# Agent Office Lab 驗收

## 主線與範圍

依 [SDD](docs/SDD.md) 完成單專案、單執行佇列、三 provider 的本機 Office。
公開匯入已完成。本輪 T-0004 驗證 OpenCode 權限等待／PTY 回覆、browser refresh 不重跑及程序終止後原 session 恢復；使用本機 Strata 與合成 fixture。
已核對原生 needs_input → working → done、回覆前產物未寫入、刷新前後 PID／session／產物不變，以及恢復後新 PID／同 session／新產物與增加的 usage。
Office host 重啟不在本輪通過範圍：固定上游會自動 wakeAll，尚不符合手動恢復契約，AC-08 保持 pending。
`source_commit` 是本輪開發基準；本輪實測的確切 runtime bytes 另附於生命週期證據的 SHA-256 清單，包含此基準之後的修正。
SDD 原 A01–A11 在公開版統一寫為 AC-01–AC-11，條件未縮減。AC-12 僅為本次匯入驗收。
不包含部署、發布套件、模型權重、私人專案或雲端自動 fallback。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 三種 CLI，When detect，Then 正確識別版本／能力，缺失或不相容不啟動。 | pending | 尚缺 Grok／Pi 真實 CLI 偵測。 |
| AC-02 | Given fixture workspace，When OpenCode 執行指定任務，Then 原生事件、session 與檔案 hash 證明成功。 | passed | [本輪實測](docs/evidence/lifecycle.md) 再驗證原生檔案任務；[原歷史摘要](docs/evidence/2026-10-31.json) 保留。 |
| AC-03 | Given 確認版 Grok，When 執行同等任務，Then CLI 身分、session 與產物可核對。 | pending | 待確認版別與顯式遠端接入。 |
| AC-04 | Given Pi + DeepSeek，When 執行同等任務，Then provider/model、settled 事件及檔案正確。 | pending | 未接入或實測。 |
| AC-05 | Given 原生權限或使用者問題，When 等待與回覆，Then waiting_input 後繼續。 | pending | [OpenCode edit 權限子集通過](docs/evidence/lifecycle.md)；Grok／Pi 與其他互動待驗。 |
| AC-06 | Given 執行中任務，When 取消，Then 10 秒 grace 後所屬程序全部退出。 | pending | [OpenCode 歷史子集](docs/evidence/2026-10-31.json) 通過，Grok／Pi 待驗。 |
| AC-07 | Given crash／401／429，When 失敗，Then 不顯示成功且最多兩次顯式重試。 | pending | 尚缺故障驗收。 |
| AC-08 | Given browser refresh 或 host 重啟，When 恢復，Then 不重跑、unfinished 標 interrupted。 | pending | [OpenCode 新程序／同 session 與瀏覽器刷新通過](docs/evidence/lifecycle.md)；Office host restart 自動喚醒仍待修。 |
| AC-09 | Given 三 provider 真實 run，When 開啟結果，Then 產物、模型與來源可分辨。 | pending | 尚缺三工位產品流程。 |
| AC-10 | Given 本地 Strata，When 執行公開 GitHub tool loop，Then 真實 tool_call、API 結果與後續回答完成。 | pending | 獨立研究未通過，非 MVP 阻塞。 |
| AC-11 | Given 路徑逃逸、偽造 hook 或金鑰輸出，When 操作，Then 阻擋或遮蔽。 | pending | [OpenCode sandbox probe](docs/evidence/2026-10-31.json) 僅驗證網路／寫入子集。 |
| AC-12 | Given 公開匯入來源，When 執行 publication、policy 與 repo gates，Then 無 runtime 私人資料、導航正確且檢查通過。 | passed | [匯入驗證](docs/evidence/publication.md)；CI／交付另見任務板。 |

## 現況與缺口

本地 Codex 檔案／合成程式修復、Office 基底及 OpenCode 真實任務已驗證；614 個上游測試不能代替三 provider 整合。
AC-05／AC-08 的 OpenCode [生命週期子集已實測通過](docs/evidence/lifecycle.md)；完整 AC 保持 pending。之後處理遠端 provider 與剩餘 MVP；詳見 [任務板](docs/tasks/BOARD.md)。
OpenCode sandbox 仍允許區外讀取；Office／Strata 整棵程序樹尚未做 egress audit。
維持 `strict_network_isolation_verified=false`，僅使用合成資料。

## 啟動與驗證

[安裝與重跑](docs/SETUP.md)、[README](README.md)、[公開證據說明](docs/evidence/README.md)。
元件檢查：`python3 scripts/check_publication.py`、`node --test scripts/local_office_policy.test.mjs`。
Repo 檢查：`python3 scripts/check_indexes.py`。runtime 另需 macOS arm64／Metal／本機模型；Linux CI 不測推論。

## 可用版本

`usable_tag: none`。主線未完成，沒有發布 tag 或部署。
