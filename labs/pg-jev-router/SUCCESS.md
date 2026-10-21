---
project: labs/pg-jev-router
purpose: 以真 PostgreSQL 擴充套件和合成 provider 驗證輸入路由政策接線
kind: lab
mainline: complete
usable_tag: usable/pg-jev-router/v0.1.0
qualification: docs/project-success/qualifications/pg-jev-router.md
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# pg-jev-router 成功契約

## 主線與範圍

完成範圍嚴格依 [SDD lab-v1](SDD.md)：固定pg-jev0.2.1／PostgreSQL16／PLPython，
用exact-match provider驗證allow/block/review與small/coding/reasoning建議。
這是已完成的有界合成接線實驗，不是已完成真模型分類或正式平台整合。
不生成回答、不執行工具、不授權、不dispatch、不切換run已固定profile。
Jev語意品質、中文校準、真實成本／延遲及正式tenant/RLS屬另外實驗。

## 驗收條件

passed 表示本次有實際證據；historical 保留原有逐項報告。2026-10-21 補驗結果另見本頁可用版本資格紀錄。
產品未驗項與後續失敗均保留；文件格式通過不能代替runtime驗收。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 非空UTF8等輸入限制與policy，When 無效文字或未知合成案例，Then 無效輸入零呼叫block，未知／灰區回review。 | historical | [2026-10-04 evidence](docs/evidence.md)：15unit tests，九案subtests與zero-call precheck。 |
| AC-02 | Given 真PostgreSQL16/pg-jev0.2.1與loopback mock，When 九案及特殊SQL literal，Then policy符合預期且sentinel不被修改。 | historical | [evidence](docs/evidence.md)：run37189529551，head0b1e44ac2e37577259be63b50332abcd1697cc97，PR261。 |
| AC-03 | Given provider422、missing answer、非法機率或timeout，When extension回傳，Then fail closed為review且不dispatch。 | historical | [evidence](docs/evidence.md) 記6integration tests全部通過；真extension搭合成provider。 |
| AC-04 | Given 表格九列及同session重複查詢，When batch/cache/spend guard驗證，Then 九列一次request、第二次cache命中且上限有效。 | historical | [evidence](docs/evidence.md)：BATCH rows9 requests1；CACHE before1 after1 hits1。 |

## 現況與缺口

主線complete只適用上述固定合成provider的contract／policy／extension實驗。
真extension曾在hosted Docker成功建置執行；編輯環境Docker缺失仍保留skipped歷史。
這兩件事不矛盾：hosted實測補足當時本機未具備的integration gate。
Mock以完整文字查表，沒有語意；15+6成功不能當分類準確率或prompt-injection防禦。
匿名record與bounded DB呼叫是lab選擇，不證明共享表外層WHERE提供tenant isolation。
SDD真模型評估段落屬後續具名實驗，不反向改寫已完成lab-v1邊界。

## 啟動與驗證

本目錄依 [README](README.md)、[quickstart](docs/quickstart.md) 與 [Makefile](Makefile)：
`make check` 跑stdlib policy／HTTP tests及Bash syntax；`make demo` 為純合成結果。
`make integration` 透過Docker建立真PostgreSQL／pg-jev並執行測試。
[pg_adapter.py](pg_adapter.py) 固定loopback mock URL、timeout及fixture-not-jev模型。
執行container時network none、無host port／volume／secret；外部模型不在此路徑。
Docker仍需可用daemon及build依賴，不應把離線demo當integration替代。

本次已重跑 make check／demo 與真 PostgreSQL／pg-jev 整合；外部 provider 仍為原規格的合成 fixture。
歷史命令與結果保留原來源，不以文件盤點日期覆蓋實測日期。

## 可用版本

本次資格通過，預定標記 `usable/pg-jev-router/v0.1.0`，範圍與逐命令證據見[資格紀錄](../../docs/project-success/qualifications/pg-jev-router.md)。
必要 PR CI／獨立審查通過並合併後才發布；不外推 production 或原範圍以外能力。
