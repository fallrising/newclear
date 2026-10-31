---
project: labs/agent-office-lab
purpose: 驗證本地優先的 OpenCode、Grok、Pi 三工位 Agent Office
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-11-01
source_commit: 4bba719822ceb1812e15ab4eba5c9b206693201a
---

# Agent Office Lab 驗收

## 主線與範圍

依 [SDD](docs/SDD.md) 完成單專案、單執行佇列、三 provider 的本機 Office。
本輪 T-0006 完成遠端 provider 的接入前置：專案內固定官方 Grok Build／Pi 套件，核對實際 package、CLI 版本與必要旗標；缺失、錯版、不相容時拒絕通過。提供不含金鑰的診斷及隔離登入／設定入口。
驗證計畫：真實 CLI help／version（不呼叫模型）；離線測試錯套件、版本及缺少能力、私密檔案與環境隔離；保存公開白名單摘要。遠端模型任務需要 owner 登入／金鑰，AC-03／AC-04 不因 CLI 偵測而通過。
既有 OpenCode host 重啟與生命週期證據保持有效，這輪不啟動 Strata。`source_commit` 為本輪開發基準；三 provider MVP 仍 incomplete。
SDD 原 A01–A11 在公開版統一寫為 AC-01–AC-11，條件未縮減。AC-12 僅為本次匯入驗收。
不包含部署、發布套件、模型權重、私人專案或雲端自動 fallback。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 三種 CLI，When detect，Then 正確識別版本／能力，缺失或不相容不啟動。 | pending | [Grok／Pi 固定套件與實際 version/help 已通過](docs/evidence/remote-preflight-2026-11-01.json)；三 provider 統一 launch gate 與完整偵測整合仍待完成。 |
| AC-02 | Given fixture workspace，When OpenCode 執行指定任務，Then 原生事件、session 與檔案 hash 證明成功。 | passed | [本輪實測](docs/evidence/lifecycle.md) 再驗證原生檔案任務；[原歷史摘要](docs/evidence/2026-10-31.json) 保留。 |
| AC-03 | Given 確認版 Grok，When 執行同等任務，Then CLI 身分、session 與產物可核對。 | pending | 官方 Grok Build 1.0.70 相容性 probe 通過；owner 版別確認／登入與遠端任務待驗。 |
| AC-04 | Given Pi + DeepSeek，When 執行同等任務，Then provider/model、settled 事件及檔案正確。 | pending | Pi 1.4.0 probe 與隔離 DeepSeek 設定格式通過；真實金鑰／遠端任務待驗。 |
| AC-05 | Given 原生權限或使用者問題，When 等待與回覆，Then waiting_input 後繼續。 | pending | [OpenCode edit 權限子集通過](docs/evidence/lifecycle.md)；Grok／Pi 與其他互動待驗。 |
| AC-06 | Given 執行中任務，When 取消，Then 10 秒 grace 後所屬程序全部退出。 | pending | [OpenCode 歷史子集](docs/evidence/2026-10-31.json) 通過，Grok／Pi 待驗。 |
| AC-07 | Given crash／401／429，When 失敗，Then 不顯示成功且最多兩次顯式重試。 | pending | 尚缺故障驗收。 |
| AC-08 | Given browser refresh 或 host 重啟，When 恢復，Then 不重跑、unfinished 標 interrupted。 | pending | [OpenCode 新程序／同 session 與瀏覽器刷新通過](docs/evidence/lifecycle.md)；[host restart 與手動恢復通過](docs/evidence/restart.md)；Grok／Pi 待驗。 |
| AC-09 | Given 三 provider 真實 run，When 開啟結果，Then 產物、模型與來源可分辨。 | pending | 尚缺三工位產品流程。 |
| AC-10 | Given 本地 Strata，When 執行公開 GitHub tool loop，Then 真實 tool_call、API 結果與後續回答完成。 | pending | 獨立研究未通過，非 MVP 阻塞。 |
| AC-11 | Given 路徑逃逸、偽造 hook 或金鑰輸出，When 操作，Then 阻擋或遮蔽。 | pending | [OpenCode sandbox probe](docs/evidence/2026-10-31.json) 僅驗證網路／寫入子集。 |
| AC-12 | Given 公開匯入來源，When 執行 publication、policy 與 repo gates，Then 無 runtime 私人資料、導航正確且檢查通過。 | passed | [匯入驗證](docs/evidence/publication.md)；CI／交付另見任務板。 |

## 現況與缺口

T-0006 完成遠端 CLI 接入前置與 35 項離線測試；[owner 設定命令](docs/REMOTE-SETUP.md)。尚未做 Grok／Pi 遠端推論，且原 local-only demo 不開放遠端 spawn。
本地 Codex 檔案／合成程式修復、Office 基底及 OpenCode 真實任務已驗證；614 個上游測試不能代替三 provider 整合。
AC-05／AC-08 的 OpenCode [生命週期子集](docs/evidence/lifecycle.md)與[host 重啟](docs/evidence/restart.md)已實測通過；完整 AC 保持 pending。之後處理遠端 provider 與剩餘 MVP；詳見 [任務板](docs/tasks/BOARD.md)。
OpenCode sandbox 仍允許區外讀取；Office／Strata 整棵程序樹尚未做 egress audit。
維持 `strict_network_isolation_verified=false`，僅使用合成資料。

## 啟動與驗證

[安裝與重跑](docs/SETUP.md)、[README](README.md)、[公開證據說明](docs/evidence/README.md)。
元件檢查：`python3 scripts/check_publication.py`、`node --test scripts/local_office_policy.test.mjs`。
Repo 檢查：`python3 scripts/check_indexes.py`。runtime 另需 macOS arm64／Metal／本機模型；Linux CI 不測推論。

## 可用版本

`usable_tag: none`。主線未完成，沒有發布 tag 或部署。
