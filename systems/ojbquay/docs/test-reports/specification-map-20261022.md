# 規格與程式對照整理：驗證紀錄

任務 T-0374；來源 `6c611778a83b8e2d7198edace1dfc6a04d517516`；2026-10-22。
本次只改文件，產品主線仍 incomplete、usable_tag:none。

## 交付與範圍

[規格對照](../specification-map.md)將既有產品規格、ADR、M2–M6、共同語義與 AC01–11 的程式／測試連結整理在一起，保留原要求及已批准修訂；同步過時批准文字。M2 用詞依既有 M3 與 MessageLimits 澄清，沒有修改值上限。

## 實際驗證

| 命令／檢查 | 結果與界限 |
| --- | --- |
| `./gradlew build --no-daemon --no-parallel`（既有 JDK25，timeout480s） | PASS，10s；44 tasks：25 executed／19 from cache。XML彙總 {'tests': 147, 'failures': 0, 'errors': 0, 'skipped': 0}；包含恢復的快取結果，不是全部新實跑。 |
| `make validate-deploy`（timeout90s） | PASS；namespace、Compose、Prometheus／Grafana、Kustomize模型；不部署。 |
| `python3 scripts/check_project_success.py` | PASS：41個專案契約。 |
| `python3 -m unittest discover -s scripts/tests -p test_project_success.py -v` | PASS：15 tests。 |
| 本地文件連結、AC01–11映射、無runtime變更、diff格式 | PASS：161個本地連結、11個AC映射，tracked diff只有文件；task/report格式驗證通過。 |
| T991 原始碼稽核 | 靜態映射完成；報告PARTIAL保留，未執行的runtime／interop明示。Root核對重要發現。 |
| T992 獨立文件審查 | 初次REWORK：D03的50k來源歸屬；已改連execution-plan M2，root核對原文後接受文件。原審查PARTIAL保留。 |
| 最終來源 PR CI／合併／遠端核對 | 待結果，未宣稱交付完成。 |

嚴格 AC05、Go SDK／跨語言、真十一服務 Compose、雙 viewport、ACK飽和與deadline故障實驗未在本輪執行。這些是產品資格／後續缺口，不以文件檢查代替。

## 失敗與限制

初次 sandbox命令在bwrap初始化失敗；允許的本地執行路徑正常。繼承PATH沒有java，沿用既有JDK25與Docker設定後build成功；未安裝工具或修改認證。原FAIL、PARTIAL、快取與未執行範圍均保留。

## 成本與交接

整輪16:17:34Z開始、16:34:34Z停止新工作、16:37:34Z截止；含所有代理、等待與發布。兩個native只讀角色：T991來源稽核、T992獨立審查；沒有外部CLI模型或遞迴。tokens/provider requests/費用/整輪完整工具數unknown/null；worker局部計數不冒充整輪模型實耗。
[機器摘要](../../../../.team/evidence/ojb-spec-map/verification.json)。

同期差異：16:30Z回讀origin/main96cb12ff包含PR491／02f61e1b；root核對未知reset結果保留pause與lease的源碼，D-02明列起始版本與後續修復。不將另一輪測試冒充本輪執行。
