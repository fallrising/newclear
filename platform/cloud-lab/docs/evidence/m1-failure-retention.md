# FQ：故障矩陣與保留邊界證據

## 本輪結果

[FQ01–04](../failure-retention-qualification.md)補齊原十四列的[證據對照](../failure-matrix.md)、11個有鑑別力的隔離案例及[不自動刪除的保留設計](../retention.md)。產品runtime、schema、原Worker／runner及所有線上授權皆未改；沒有新增依賴、cloud操作、模型呼叫或付費。完整AC-07／08與mainline仍pending。

## 實際測試

- `node --test --test-isolation=none --test-name-pattern=FQ platform/cloud-lab/tests/control.test.mjs`：FQ-focused2的11案例通過；最終增強獨立digest oracle與firings保全後，FQ-mutations baseline再次11案例通過。
- `python3 platform/cloud-lab/tools/check.py`：FQ-full-loopback共Node107＋Python304＝411tests全過，無fail／skip；Node24.14.0、Python3.13.5。實際本機HTTP、Unix socket、子程序與SQLite包括在內，不宣稱此輪workerd／遠端D1或Python3.11執行。
- 全部經共用launcher，logs保存在FQ-focused、FQ-focused2、FQ-full、FQ-full-loopback與FQ-mutations對應evidence；沒有覆寫初始失敗。

取消／完成兩種次序保留terminal result、原artifact/report_digest／identity；取消不冒稱停止。受控barrier讓兩個請求都先讀同一revision，真SQLite CAS只能一個200、另一個409；精確補報及重複report保留結果。unknown在deadline後仍reconcile_only／active，不因取消擅自釋放槽。

首次dispatch在截止或剩餘執行預算不足時保持never-started；lease恰好過期的舊report409且原整列不變，新fence可使用原結果。late case分別驗finish恰好execution deadline及超過一秒：送達均late，但前者可fresh/passed，後者incomplete/unknown。原開始／完成／接收時間分列。

16385byte artifact、caller自行帶late或不合法unknown payload均拒絕且不改command整列；已完成後改artifact bytes得到RESULT_CONFLICT。schema錯誤而被記錄failed validation的既有行為仍由原案例涵蓋，不與拒絕混為一談。

七天案例先由真scheduled handler建立firing/command，再完成report：Node crypto獨立SHA-256、原始pretty JSON bytes下載不變、到期前一秒200、恰好到期410。command整列、firings、保留總數與same-key／payload conflict不變；合成grants覆蓋時間旅行，不續任何真實權限。nonce可隨認證改變，因此不把整個DB不變作錯誤oracle。

## 鑑別力與失敗保留

五個一次性source副本mutation都被新增案例檢出：取消覆寫terminal（3fail）、放寬revision CAS（1fail）、artifact expiry等號錯誤（1fail）、移除execution completion deadline（1fail）、錯誤digest（1fail）。每個失敗都是預期assertion，不是import／程序啟動失敗；baseline11通過、原Worker SHA-256前後相同。副本與日誌在launcher build/evidence，沒有修改產品source或live。這是對既有行為的qualification，沒有偽造產品功能RED。

首次FQ-focused使用Node預設test isolation，只報一個file-level pass，沒有逐案例證據；該結果不計為11案例通過，改用專案既有`--test-isolation=none`後取得具名11結果。首次FQ-full受sandbox socket EPERM阻擋，Python35errors；Node在首個HTTP整合失敗後native callback assertion中止。保留兩份原log，不主張已確定native assertion根因；准許隔離loopback/socket後FQ-full-loopback411通過，未改產品程式、跳過測試或延長產品期限。

## 審查與缺口

[T856獨立審查](../../../../.team/reports/T-856.md)第一輪readonly盤點列明14列的既有證據與不足；最終檢查實際diff／411tests／五種mutation日誌後ACCEPT。主導接受本輪local／設計範圍，正常PR／CI／remote readback仍以任務板為準。歷史remote恢復、隔離還原、Safari與ULR均以原證據鏈呈現，不冒稱本輪重跑。

目前缺口包括client artifact原bytes完整性檢查、持久拒絕稽核、事件seq與通知場景尚未實作／需對齊M1輪詢契約、unknown/in-flight跨D1/journal還原；provider用量／帳單及archive/tombstone實作仍未完成。原unknown原因也未因這些測試被查明。既有應用容量與期限不變，不需要owner重測瀏覽器。

文件檢查實際通過50project contracts、8llms、T856 task validator、400個既有及新增Markdown相對連結與staged diff check；最後另驗report合約與完整diff，保留結構化exit收據。
