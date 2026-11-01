---
project: labs/token-economizer-lab
purpose: 實跑 TokenEconomizer 三種成本控制機制的固定版本離線實驗
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-11-01
source_commit: 8ede33258dbda7cedc5220829c8b3745224304e0
---

# TokenEconomizer lab 成功契約

## 主線與範圍

[SDD](SDD.md) 定義真 upstream＋合成 session 的有界 lab；不是 live agent／provider savings benchmark。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定 upstream，When prepare/run，Then pin 與內容核對，污染拒跑。 | passed | [實跑報告與紀錄](docs/evidence/README.md)。 |
| AC-02 | Given 重複環境失敗與修復，When 真 session fold，Then fact 形成／注入／退休、session 去重。 | passed | [實跑報告與紀錄](docs/evidence/README.md)。 |
| AC-03 | Given 工具使用歷史，When 真提案／apply／restore，Then 門檻與保護規則成立。 | passed | [實跑報告與紀錄](docs/evidence/README.md)。 |
| AC-04 | Given 冷／暖 envelope，When 失敗循環與有進展的長 turn，Then backstop redirect／notice 邊界正確。 | passed | [loop-guard report](docs/evidence/report.json)：25 redirect／36 notice；paused judge fixture，未測模型判斷。 |
| AC-05 | Given 合成 usage，When 真 pricing／CLI，Then cache-aware 算術與 CLI 可核對。 | passed | [accounting report](docs/evidence/report.json)：去重、明示權重算術與 CLI；不代表 savings。 |
| AC-06 | Given 乾淨環境，When 重跑與 checks，Then scenarios、安全負例、repo gates、CI 與獨立審查通過。 | pending | [本機 gates](docs/evidence/README.md) 通過；[獨立 ACCEPT](docs/evidence/review.md)；遠端 CI 待完成。 |

## 現況與缺口

已實作並實跑真 upstream：4 scenarios／36 assertions、18 lab tests 與本機 repo gates 通過。獨立審查 ACCEPT；剩餘：遠端 CI。合成輸入不取代 live provider／host 安裝或 savings 證據；這些未授權範圍不宣稱通過。

## 啟動與驗證

見 [README](README.md)。執行入口為 `make prepare`、`make run`、`make check`。

## 可用版本

`usable_tag: none`；本輪僅 Draft PR，未授權 merge／release／deploy。
