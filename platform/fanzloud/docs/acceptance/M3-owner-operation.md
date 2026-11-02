# M3／FN-07 本人操作準備 — T-0442

2026-11-02：**離線準備；本人確認未完成；所有新窗口均未批准／未啟動。**
沿用 M3-U 與原 SDD，不增加里程碑、不修改驗收。M1/M2 與
[U01–06／自動 U07](M3-reconciliation.md) 已接受，不重做。

## 已接通與原安裝

Web → Rust 持久提交意圖 → AP 唯一 Worker／lease／生命週期 → 隔離工具；
成果回到固定 base 的 diff/checks、不可變 candidate 與跨廠商 typed review。
明示對帳只讀精確 AP command receipt，再原子確認原 SQLite；新 unknown
仍鎖定，無正向精確證據不解鎖、不重送、不猜 run。重啟後需 AP 可達並重新登入。

原 SQLite 離線回讀仍為 4 confirmed／0 unknown，U07 writer／review 引用存在。
原 unknown 綁回原 cancelled/not_allocated run，不能當作 coding 成功。
本輪重新核對選定備份 226 檔雜湊，0 mismatch；固定 binary SHA256
`13f2b192ed219566721a313779ed364b9a83ea45f1e88b8d6371bec8bf226085`。
實測來源 `86350871766bbfbe9d29325b49aae659c2d74c92`；前次最終交付
`9a3f3a54d2ad6ff3c3779553857e409009e1f74d`；本輪承接基底
`19fdeb4fa588b213d1a00ef6e45e7f79676a24cf` 的兩元件與實測來源之差只有文件。
承接 [desk PR403](https://github.com/fallrising/desk/pull/403) 已合併回讀。

目前沒有常駐網址。四個既有本機 listener 未開、原 PostgreSQL stopped／restart=no／
loopback；遠端 runtime 的零 VM／claim／cgroup／reservation 沿用已接受的清理證據，
本輪沒有登入驗收主機或重新量測遠端。兩份精確私人設定保持 0600；秘密未輸出。
原撤銷的容器 seed credential 保留，不重建、不輪替。

## 現行條款與缺口

[SDD §6 FN-07](../../SDD.md#6-最終驗收全部必須通過) 的 When 原文：
「owner 依短操作步驟登入→選 agent→提交→看進度→下載 diff→交接審查→重新開啟」。
必留證據另含「owner 操作確認」。[批准恢復方案 U07](../specs/PROPOSAL-M3-recovery.md)
也區分 bounded live journey 與 separate owner confirmation。

| 部分 | 已有證據 | 本人仍需做什麼 |
| --- | --- | --- |
| 同來源真瀏覽器 integrated journey | U07 自動 Claude writer→Codex accept／3理由，重啟三組下載完全相同 | 自動化不能代替本人操作 |
| 登入／辨識兩家 agent／開既有任務／下載／重新開啟 | 已接受自動證據；下面的零 CLI 窗口可補本人可讀回確認 | 本人實際操作與一句結果確認 |
| 選 agent→提交→看新任務進度→明示交接審查 | U07 自動證據已接受，沒有本人執行證據 | 只讀既有成果不能證明本人完成這些動作；仍缺本人提交／交接 |
| 重啟／unknown／審查邊界 | U06/U07、native fault／輪數測試 | 不要求重跑故障；候選非完整 checkout，reviewer 未重跑 writer tests；返工／第二輪仍 native-only |

因此 **10 分鐘、零新 CLI／VM 的只讀確認不足以單獨把 FN-07 或完整 M3 改為通過**。
它可先完成 owner 明確優先要求的最小人工確認。若要一次覆蓋現行 FN-07，
須選下方完整操作窗口，不能靠改字句、手動資料修復或把自動旅程算成本人操作。
兩個方案是替代選項，不會連續自動執行。

## 本人最短步驟：既有成果窗口

私人連線、原設定／store 與期限由可信端另存 operator entry；不在 Git 寫主機、
帳號、秘密。使用既有私人 HTTPS／核准 tunnel 與仍有效的憑證；無法信任或已過期就停，
不要求略過瀏覽器警告、不新增登入／重新輪替。

1. 開私人入口，填既有 operator 登入。在「Agent」下拉辨識 Claude 與 Codex，
   可切換選項；這個窗口不按「提交任務」。
2. 在「最近任務」或「提交紀錄」開原 writer，確認 run
   `9c20ec74-f940-46fd-81e6-064b9dee93eb`。看到成功、檢查通過與工作區已清理；
   base 為 `55bd36a47d3ca619b0a10bcad427b9fb9b8c99c5`。
3. 按「下載 diff」，再按「取得審查候選」→「下載候選」。
   **checks 在候選 JSON 的 `result.verification` 中，沒有獨立 checks 下載按鈕。**
   可同時讀頁面 checks 與下載後的原始記錄；不另造 checks 產物。
4. 開既有 reviewer `54dc092e-a174-4af6-a48c-ac0ab54b3a33`，看首輪 accept／3理由，
   按「下載審查成果」。這裡是讀既有 review，不按「提交固定候選審查」。
5. 關閉頁面重新開啟／登入，找回兩個 run；再次下載，與首次文件比對。
   本窗口不重啟 AP/Rust，重啟一致性沿用已接受 U07。
6. 回報「本人完成登入、辨識兩家 agent、開啟既有 writer/reviewer、查看 checks、
   下載並重新開啟成果」，或指出失敗步驟。記錄實際結果，不預填成功。

| 文件 | Bytes | SHA256 |
| --- | ---: | --- |
| candidate（含 checks） | 1747 | `9faf56d6d8ccb05ce8f6b20e78c728db9de516fb890ae3ab62a0dea2d04468d7` |
| diff | 285 | `c5134c8015bad2104fceb70e5c4c79086d6ec9bd85a0b4fa0f833b4ed3ef6fdb` |
| review | 1923 | `745de4e6cbfa5fe3878b186bb8e3e675d3c000b93d7d0ee281d1fc2212d1aabd` |

## 一次集中選擇的有界窗口方案

**尚未授權。** 先取得 owner 明確在場及選擇，才啟動；不把本文件、沉默或時間經過當批准。
每個新窗口用新的操作紀錄／單次意圖，不讀寫 maintenance/U06/U07 已消耗 intent，
不呼叫任何舊 harness main。啟動失敗也記錄，不重設或默認延長。

- **優先最小確認：總共最多 10 分鐘，最後 2 分鐘只收束。** 僅原 PostgreSQL、
  AP API、固定 Rust binary 與私人 HTTPS/tunnel；無 AP worker、Connector/runtime、registry、
  VM 或 coding/review CLI。HTTPS 入口只容許 GET 與精確 session 登入 POST／登出 DELETE，
  其他 mutation（task/review/rework/cancel/reconcile）全拒；不只靠不點按鈕。
  AP/Rust 其餘入口只 bind loopback，owner 只接 HTTPS 入口。
  認證 session 與 Rust 已觀察狀態可正常落盤；「只讀」是指無新執行或原成果更改，
  不是宣稱兩個 DB 零寫入。完成上面 6 步後即停，不用滿額時間。
- **若選一次補完整本人 journey：總共最多 15 分鐘，最後 3 分鐘只清理。**
  同一原安裝／相同 production bytes；單台 4CPU／4GiB VM、zero-warm、AP 唯一生命週期，
  最多 2 次新 CLI（1 Claude writer＋1 Codex reviewer），每次最多 180 秒，
  開始／執行亦受絕對清理 cutoff 約束，不靠 CLI timeout 延長窗口。
  Owner 自己登入、選正式 Claude、以既有固定 repo/base 提交一次小修復、看進度、
  下載 diff/checks/candidate，再明示選 Codex 交接一次並下載 review、重新開啟。
  可信管理員可啟服務，不替 owner 點產品操作或代貼 coding CLI。
  首輪非 accept、unknown、超時或前置失敗就保留未通過並停止；無返工／第二 reviewer、
  無新 store、無 M1/M2 並行重驗。原兩個 run 的讀取仍可在同窗口完成；不另開第二窗口。

目前兩案都只是操作提案，新的單次有限 launcher／HTTPS gate **尚未建立或試跑**，
不得因文件已審就直接啟動。啟動前須先完成離線檢查：只讀案拒絕所有執行 mutation；
完整案由可信 gate 固定原 repo/base、正式 writer/reviewer profile 與單次 intent，
只容許一次 tasks.create，再容許該 writer 的同 candidate hash／artifact 的一次 review；
禁止額外 task/review/rework/action/reconcile，不能僅靠 UI 或操作者記憶限制。
180秒單次限額與絕對 cleanup cutoff 須由可信監督器按 AP 原生取消／清理 authority 執行，
不改 profile 來放寬已批准限制；未確認停止即失敗，不得啟下一個 CLI。
兩案的 intent 單次消耗、來源／profile／lineage 綁定、deny-by-default 路由及獨立清理計時器
都須有離線驗證／必要審查，未完成就不開服務。此處沒有聲稱新的啟動安全機制已通過。

兩案都在啟動前核對磁碟≥15GiB、來源／固定 binary/runtime 雜湊、目前 desk 授權、
原 store／原 DB、已有 TLS 與 owner 私人連線。完整方案另須精確核對交接定位的原主機
資源與零 VM 前置；不操作其他專用主機。TLS 不足覆蓋整個窗口、未知 listener／consumer、
原資源不為零、來源 drift 或私人連線不可用就不開始。原服務若非 stopped 不擅停他人服務。
HTTPS 必須在允許範圍與絕對 deadline 內關閉；管理端獨立計時器負責停止所啟動的 owned
process／DB，非依賴頁面或 owner 訊息。完整案清理仍經 AP cancel／原 runtime authority，
不能只 kill observer 宣稱 VM 停止。收尾核對 task/run/command/archive 的預期差異、
SQLite、listeners／owned processes；完整案再核對 VM/claims/cgroups/reservations=0。
清理未確認就明列 unknown，不另開窗口補證據。

## 離線交付驗證

文件改動只對應既有 M3-U；SDD／ADR／production bytes／依賴與認證不變。
驗證：source diff、原 SQLite 白名單欄位、226 檔 SHA256、固定 binary、精確容器安全欄位、
本機 listener、UI 原始碼標籤／下載 schema、相對連結、project-success 與 whitespace，
再 fresh-context 獨立文件審查、必要 CI、正常合併與遠端回讀。詳細 receipts 留私人交接／PR。
沒有重跑已綠 native/live suite；未啟服務、不測登入或 provider，故本次不新增 runtime 證據。
原 Rust logout 失敗與診斷通過但根因未知、pre-main 缺 sys 失敗均沿原紀錄保留。

T-0442/T-0447/T-0449 仍 in_progress；本人確認與完整 M3/FN07/platform 仍未完成，
舊 Cloud AC-04 不變。Provider requests/tokens/cost 與完整工具總量 unknown；
外層編排／巢狀 calls、agent 啟動與實際產品 CLI 不混算。不新增 API 計費、服務、
runtime dependency、公開部署、release 或可用 tag。
