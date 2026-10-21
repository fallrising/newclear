---
project: labs/openviking-context
purpose: 以來源校驗與 byte 預算驗證共享 context 投影服務
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# openviking-context 成功契約

## 主線與範圍

[SDD](SDD.md) P0以兩份合成文件驗證seed→scoped find→L2回讀→hash→有界bundle。
OpenViking固定v0.4.23；canonical文件與人類決策仍留原來源，索引／摘要只是投影。
adapter不授工具權限，server key不得進agent sandbox；未接agent-platform runtime。
不自動上傳聊天、私人repo、整個工作目錄，不啟用session memory。
ACL／品質／memory／平台接線保留P1–P3獨立範圍，不能用離線P0代替。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 是已有紀錄，並非本次重跑。
產品未驗項與後續失敗均保留；文件格式通過不能代替runtime驗收。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given approved fixture manifest與lexical fake，When demo查backup，Then 回傳來源revision/hash且完整JSON不超byte budget。 | historical | [2026-10-04 evidence](docs/evidence.md)：19tests與demo；512bytes案例保留metadata。 |
| AC-02 | Given 越界URI、撤銷候選或hash mismatch，When query/seed，Then 拒絕不合格L2且create-only不覆寫、不未知重播。 | historical | [evidence](docs/evidence.md)：client/mock opener回歸，沒有真TCP/server。 |
| AC-03 | Given 真v0.4.23與核准模型，When seed/find/read並由兩個獨立client查詢，Then hash相符、結果一致且index lag可診斷。 | pending | [SDD P0-live](SDD.md)、[evidence](docs/evidence.md)：server/provider未選定，live install/doctor/seed/query skipped。 |
| AC-04 | Given 跨使用者共享，When ACL跨界與撤銷後preview/read/cache，Then 零洩漏並符合後續品質與恢復範圍。 | pending | [SDD P1–P3](SDD.md) 未實作／未驗；不得由client allowlist推導server ACL。 |

## 現況與缺口

Python HTTP consumer、fixed fixture與provenance／budget防線均存在。
`make demo` 明示lexical fake，不能當semantic retrieval品質或模型能力。
mock opener只驗request/response契約，沒有真server身份、ACL或索引證據。
目前最早缺口為P0-live；還未到正式共享服務准入。
AGPL upstream與本repo新寫adapter授權邊界保留，未vendor上游。

兩份合成文件的create-only seed也不等於完成正式corpus同步與刪除政策。

## 啟動與驗證

本目錄 [Makefile](Makefile) 提供 `make check`、`make demo`。
[context_lab.py](context_lab.py) 是HTTP adapter與CLI，
[quickstart](docs/quickstart.md) 才是live安裝、provider/key、seed/query的完整入口。
server版本由 [requirements-server.txt](requirements-server.txt) 固定。
先用核准合成corpus，不把真私有資料當預設測試輸入。

本次只核對文件、程式入口與既有證據；未執行產品建置或外部整合。
歷史命令與結果保留原來源，不以文件盤點日期覆蓋實測日期。

## 可用版本

目前 `usable_tag: none`。
至少補P0-live真server/model、雙client、回讀hash與index lag證據，才能關閉當前核心試驗。
若宣稱共享／平台可用，還須按P1–P3補ACL、撤銷、品質與恢復接線；不能只標離線demo為全項目可用。

標記前須核對已合併目標SHA、必要CI／審查與核心流程證據。
沿用較早結果須比較其後程式及設定差異，相關變更必須補驗。
