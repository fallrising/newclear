---
project: tools/cc-quota
purpose: 採集 Claude Code 額度並用本機歷史呈現 pacing 與偏離通知
kind: tool
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# cc-quota 成功契約

## 主線與範圍

[README](README.md) 主線是單機單帳號collect→SQLite→唯讀report，macOS每小時採集及通知。
採集單元無狀態；歷史留DB，不經模型、也不替人自動調度任務。
只涵蓋five_hour、seven_day及來源提供的seven_day_opus；local tokens只是本機資料。
不刷新或轉存憑證、不做多帳號／雲端／分析平台。
真實額度端點、Keychain及launchd是原使用情境的必要驗收，不能只以離線計算通過結案。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 是已有紀錄，並非本次重跑。
產品未驗項與後續失敗均保留；文件格式通過不能代替runtime驗收。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 額度快照與reset時間，When collect計算及存SQLite再report，Then remaining/pace/預估正確且report不寫庫。 | pending | [tests](tests/test_cc_quota.py) 已覆蓋離線情境；README記offline-tested，但本次無新執行結果。 |
| AC-02 | Given 重複本機JSONL及採集失敗，When 去重與記error，Then 不重算token且缺資料不偽造正常快照。 | pending | [README](README.md)、[tests](tests/test_cc_quota.py)；須保留當前命令／exit證據。 |
| AC-03 | Given 目標macOS已登入Claude，When Keychain取憑證並collect/report，Then 真實usage欄位可用且與可見額度相符。 | pending | [quickstart](docs/quickstart.md) 明列真實端點與Keychain路徑skipped。 |
| AC-04 | Given 安裝launchd且額度偏離，When 每小時觸發，Then DB新增快照並按門檻通知，睡眠缺口明示。 | pending | [quickstart](docs/quickstart.md) 的install／launchctl未在目標機驗證。 |

## 現況與缺口

[cc_quota.py](cc_quota.py) 是stdlib實作；[install.sh](install.sh) 提供macOS排程安裝。
README明列離線計算、SQLite、token去重與失敗處理測試，但真live仍未驗。
內部usage端點無公開契約；schema可變，raw JSON保存供核對。
通知無狀態，不去重；睡眠不採集，不能視為連續完整歷史。
Linux可手動採集／stdout通知，不能拿Linux測試替代macOS使用主線。

## 啟動與驗證

依 [quickstart](docs/quickstart.md)，本目錄離線命令為
`python3 -m unittest discover -s tests -v` 與 `bash -n install.sh`。
`bash install.sh` 會寫使用者bin與LaunchAgents並載入排程，非本次執行範圍。
`python3 cc_quota.py collect -v` 會讀真憑證並連額度端點；`report`讀SQLite。
DB預設 `~/.local/share/cc-quota/quota.db`，可由CC_QUOTA_DB指定。
真憑證與raw資料不應放入公開驗收證據。

本次只核對文件、程式入口與既有證據；未執行產品建置或外部整合。
歷史命令與結果保留原來源，不以文件盤點日期覆蓋實測日期。

## 可用版本

目前 `usable_tag: none`。
須補當前離線檢查與目標macOS的Keychain、真usage、collect/report、排程及通知證據。
不因CI只驗離線種子而建立完整額度監控可用標記。

標記前須核對已合併目標SHA、必要CI／審查與核心流程證據。
沿用較早結果須比較其後程式及設定差異，相關變更必須補驗。
