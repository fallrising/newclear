---
project: tools/cc-quota
purpose: 保存已封存 Claude 額度採集與通知來源，後繼為 Agent Usage
kind: archived
mainline: not-applicable
usable_tag: none
reviewed: 2026-10-23
source_commit: b7f2a4311d1135977ba273efba8e77702b908036
---

# cc-quota 成功契約

## 主線與範圍

**2026-10-23 owner 直接指示封存**：停止獨立開發，後繼入口為 [Agent Usage](../codex-usage/docs/agent-usage.md)。
結束條件為原地保留來源、測試、文件與既有安裝相容性，將活動導覽轉向後繼工具；不搬資料、不讀憑證、不操作排程。
封存不是完成原主線。下列 AC-01–04 與歷史缺口保留，不把 pending 改 passed；重新開發需 owner 新指示。
以下舊開發範圍、提交授權與待驗步驟皆為歷史背景，不構成本次恢復開發／發布授權。


[README](README.md) 主線是單機單帳號collect→SQLite→唯讀report，macOS每小時採集及通知。
採集單元無狀態；歷史留DB，不經模型、也不替人自動調度任務。
只涵蓋five_hour、seven_day及來源提供的seven_day_opus；local tokens只是本機資料。
不刷新或轉存憑證、不做多帳號／雲端／分析平台。
真實額度端點、Keychain及launchd是原使用情境的必要驗收，不能只以離線計算通過結案。

## 歷史開發工作（封存前，2026-10-23）

Owner 已啟用 START_DEVELOPMENT_PROMPT；恢復既有 AC-01–04，不新增 quota-signal 提案功能。
先修復並驗證 readonly report、缺欄位／異常資料與失敗落庫、本機去重，再核對安裝／通知。
驗證採 RED→GREEN、完整離線 suite、CLI／SQLite流程、installer syntax與隔離安裝替身、repo契約。
AC-03／04 必須另有真實已登入 Mac、Keychain、launchd與通知證據；Linux或mock不能替代。
初輪只做本機修復；owner後續已明確授權commit／push／PR／merge。release／正式部署不在授權內。進度見 [任務板](docs/tasks/BOARD.md)。

## 歷史 M2里程碑：macOS邊界與Python3.11 CI

Owner要求持續開發，完成里程碑即提交並合併PR。範圍：Mac Keychain失敗不得切換檔案來源、憑證schema／token驗證與安全診斷；Python3.11 Linux／macOS CI，以及原生AppleScript編譯、plist解析與不存在的合成Keychain service查詢。
先用失敗案例再修正，保留Linux與macOS各自的實際結果。CI不登入Claude、不讀真人憑證、不呼叫usage、不安裝真launchd工作或發送通知；原AC03／04的真實使用者驗收不變。

## 驗收條件

passed 表示下列本次實際驗證範圍；historical 是已有紀錄，並非本次重跑。
產品未驗項與後續失敗均保留；文件格式通過不能代替runtime驗收。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 額度快照與reset時間，When collect計算及存SQLite再report，Then remaining/pace/預估正確且report不寫庫。 | passed | 2026-10-23：離線 regression＋實際 CLI fixture→SQLite→report 通過；report 前後 DB hash／mtime 不變。見[本次證據](docs/tasks/verification-20261023.md)。 |
| AC-02 | Given 重複本機JSONL及採集失敗，When 去重與記error，Then 不重算token且缺資料不偽造正常快照。 | passed | 2026-10-23：跨檔 ID 去重、異常 JSONL、缺 utilization、無效 schema、HTTP401／通知失敗與同秒重採回歸通過；raw／errors 保留且無部分正常快照。見[本次證據](docs/tasks/verification-20261023.md)。 |
| AC-03 | Given 目標macOS已登入Claude，When Keychain取憑證並collect/report，Then 真實usage欄位可用且與可見額度相符。 | pending | blocked：目前 Linux；SSH 設定的 8 個候選條目全部回報 Linux。缺已登入 Claude 的授權 Mac及可見額度對照；未讀真憑證／呼叫真usage。見[目標機步驟](docs/quickstart.md#目標-mac-驗收尚未執行)。 |
| AC-04 | Given 安裝launchd且額度偏離，When 每小時觸發，Then DB新增快照並按門檻通知，睡眠缺口明示。 | pending | blocked：無目標 Mac。installer／plist／Unicode通知／stale-gap 僅離線替身通過；真 launchd 每小時採集、可見通知與睡眠後恢復仍未驗。 |

## 現況與缺口

[cc_quota.py](cc_quota.py) 是stdlib實作；[install.sh](install.sh) 提供macOS排程安裝。
README明列離線計算、SQLite、token去重與失敗處理測試，但真live仍未驗。
內部usage端點無公開契約；schema可變，raw JSON保存供核對。
通知無狀態，不去重；睡眠不採集，不能視為連續完整歷史。report 將超過 90 分鐘的歷史間隔標 GAP、舊快照／已重置視窗標 STALE，不補造資料。
採集先驗證所有提供的視窗，缺／錯 utilization 或 reset 會記 errors；原始 JSON 留 raw。
report 使用 SQLite mode=ro；同秒重採成功會完整取代該秒快照。通知失敗記 errors，不丟棄已提交快照。
Linux可手動採集／stdout通知，不能拿Linux測試替代macOS使用主線。

## 啟動與驗證

以下是保留的歷史操作資料，不是新安裝建議；本次只驗封存與後繼工具相容性。

依 [quickstart](docs/quickstart.md)，本目錄離線命令為
`python3 -m unittest discover -s tests -v` 與 `bash -n install.sh`。
`bash install.sh` 只允許 macOS，會寫使用者bin與LaunchAgents並載入排程；本次僅隔離替身執行，未真安裝。
`python3 cc_quota.py collect -v` 會讀真憑證並連額度端點；`report`讀SQLite。
DB預設 `~/.local/share/cc-quota/quota.db`，可由CC_QUOTA_DB指定。
真憑證與raw資料不應放入公開驗收證據。

M1由7項baseline擴充至28項離線測試，已合併PR502／503；另跑CLI fixture、bash syntax與repo契約。
M2本機及Python3.11 Linux／macOS各35項測試通過，Mac另3項原生邊界通過；結果見[M2證據](docs/tasks/macos-boundaries-20261023.md)。
M1與M2本機執行版本為Python3.13.5（Linux）；M1沒有3.11／Mac runtime證據。M2的CI證據另列，不能把平台工具測試當成真人主線驗收。
[本次證據](docs/tasks/verification-20261023.md)列出 RED／GREEN、命令與未跑原因；獨立審查結果同處更新。
歷史命令與結果保留原來源，不以文件盤點日期覆蓋實測日期。

## 可用版本

目前已封存，`mainline: not-applicable` 不代表 complete。原缺口只保存，不繼續推進可用標記。

目前 `usable_tag: none`。
當前離線檢查已補；仍須目標macOS的Keychain、真usage、collect/report、排程及通知證據。
M1已合併，M2依owner指示完成里程碑即提交／合併；發布結果見[任務板](docs/tasks/BOARD.md)。Mac真人驗收未完成，不建立usable tag或部署。
不因CI只驗離線種子而建立完整額度監控可用標記。

標記前須核對已合併目標SHA、必要CI／審查與核心流程證據。
沿用較早結果須比較其後程式及設定差異，相關變更必須補驗。

## 統一入口整合（2026-10-23 owner 直接指示）

多來源查詢整合至 [Agent Usage](../codex-usage/docs/agent-usage.md)，唯讀沿用本工具的 SQLite 快照；本工具既有 collect／歷史／launchd／通知不複製、不移除。M2 Agent Usage 的 AU 驗收由 [codex-usage SUCCESS](../codex-usage/SUCCESS.md) 統一管理；本文件原 AC-01–04、已合併證據及待驗 Mac 情境均保留。舊階段「不啟用 quota-signal」是歷史範圍，本次直接授權已更新[共用規格](../../docs/specs/quota-signal.md)。

## 封存交接

本次保留檔案 hashes 見 [manifest](../codex-usage/docs/evidence/2026-10-23-cc-quota-archive-hashes.json)。
封存與後繼歷史查詢驗證由 [Agent Usage M3](../codex-usage/SUCCESS.md) 管理；不另開第二條 cc-quota 開發主線。
