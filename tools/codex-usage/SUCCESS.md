---
project: tools/codex-usage
purpose: 透過官方 Codex App Server 單次唯讀採集訂閱用量
kind: tool
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# codex-usage 成功契約

## 主線與範圍

[README](README.md) 限短生命週期唯讀acquisition，初始化後僅查account/read、
account/rateLimits/read、account/usage/read；不建立thread或啟動model turn。
部分失敗保留，缺值為null；cycle tokens沒有完整對齊quota window就不得推算。
排程、SQLite、通知、多帳號、login/logout、私有網頁cookie scraping及任意RPC都不在範圍。
完成條件包含目標CLI/schema/身份與真snapshot，不只是純函式測試。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 是已有紀錄，並非本次重跑。
產品未驗項與後續失敗均保留；文件格式通過不能代替runtime驗收。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given collector source，When 核對RPC與輸出契約，Then 只有固定唯讀方法且cycle_tokens不以百分比推算。 | passed | [codex_usage.py](codex_usage.py)、[README](README.md)；僅靜態來源核對。 |
| AC-02 | Given 缺值、重複bucket、身份不符或CLI缺失，When 離線測試，Then null／partial／fail-closed符合契約。 | pending | [tests](tests/test_codex_usage.py) 存在；舊prototype51tests不能冒充此seed的當前驗證。 |
| AC-03 | Given 目標CLI已登入指定ChatGPT帳號，When 真App Server採集，Then account與method/schema匹配並產生去識別snapshot。 | pending | [quickstart acceptance gate](docs/quickstart.md) 明示live-unverified。 |
| AC-04 | Given 真snapshot與使用者可見usage/status，When 比較各window與重置，Then 語意一致且缺cycle對齊token仍null。 | pending | [quickstart](docs/quickstart.md) 六項live gate未通過；沒有目標主機證據。 |

## 現況與缺口

有maintainable seed與deterministic離線測試；不是已完成真帳號整合。
不解析auth files，email只本地比對；若workspace無官方可驗欄位則fail closed。
來源updated timestamp缺失須unknown，不能用採集時間冒充。
部分失敗exit2仍有stdout JSON；非零退出不能丟掉partial結果。
先前51項prototype數字只屬歷史背景，不能沿用為本repo測試通過數。
合併交付與owner驗收分開，live gate未過不開排程切片。

## 啟動與驗證

依 [quickstart](docs/quickstart.md)，需要Python3.11+、POSIX及已登入官方Codex CLI。
本地驗證：`python3 -m unittest discover -s tests -v`、
`python3 -m py_compile codex_usage.py`。
真採集以 `python3 codex_usage.py --codex PATH --target-file PRIVATE_JSON`，
PATH／PRIVATE_JSON需按quickstart解析，僅放預期身份，不放token或cookie。
exit0=兩次usage讀取OK，2=partial，1=failed；本次未呼叫App Server。

本次只核對文件、程式入口與既有證據；未執行產品建置或外部整合。
歷史命令與結果保留原來源，不以文件盤點日期覆蓋實測日期。

## 可用版本

目前 `usable_tag: none`。
須記CLI版本、身份、實際schema、去識別snapshot、可見usage對照及cycle_tokens=null確認。
在六項live gate通過及當前回歸齊備前，保持offline-tested／live-unverified。

標記前須核對已合併目標SHA、必要CI／審查與核心流程證據。
沿用較早結果須比較其後程式及設定差異，相關變更必須補驗。
