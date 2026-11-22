# 遠端任務的一次性授權

T-0029 已完成一次真實 Pi／DeepSeek 操作台指定重試與 Blob 下載驗收；原402失敗保留，新批准只消耗一次，沒有自動重跑。見[成功證據](evidence/pi-console-completed-2026-11-22.json)。

遠端 UI 執行限於 Pi／DeepSeek 與 Cursor／Composer 2.5 的固定合成檔案任務。先由操作員透過 CLI 建立一次性授權，再以明示接受授權的操作台查看計畫、確認並啟動。一般啟動操作台時仍不允許付費派工。

## 操作流程

在 lab 目錄先查看固定任務計畫，再於已取得當次付費批准時建立授權：

```sh
python3 scripts/office_dispatch.py plan pi
python3 scripts/office_dispatch.py grant pi --ttl 900 --confirm-paid-remote-run
python3 scripts/office_console.py --accept-remote-grant pi
```

建立授權只保存一張有限期的執行許可，不會啟動模型。CLI 輸出的完整 id 留在本機；操作台只顯示指紋及到期時間。在頁面選 Pi → 合成檔案任務 → 查看執行計畫，確認模型、請求／輸出／時間限制後啟動。頁面確認不能自行建立新授權。

Pi 固定限制為最多四個 provider 請求、每請求最多 512 output tokens、180 秒；`money_cap` 為 null，沒有金額硬上限。停止會要求 runner 清理，但已送出的遠端請求仍可能計費。首次任務授權與指定重試授權不可互用；兩者都不可用於任意 prompt、私人專案或其他 provider。

查看及撤銷尚未使用的授權：

```sh
python3 scripts/office_dispatch.py grants
python3 scripts/office_dispatch.py grant-revoke GRANT_ID
```

每次建立授權都要有相應的操作員批准；不要把建立命令放入自動重啟腳本。過期、撤銷、來源變更、已使用或格式無效的授權不能執行。程式更新後須重新檢查計畫並建立新的授權。

## 消耗與故障語意

授權保存在私有 `state/remote-grants/`，包含固定 provider、模型、版本、限制、來源雜湊、使用者及工作區綁定。它是磁碟上的一次性紀錄，重啟操作台不會重置次數。瀏覽器沒有建立、延長或改寫授權的端點。

Dispatcher 先取得共用執行鎖、完成環境預檢，再原子消耗授權。忙碌或預檢失敗不消耗；消耗之後就算尚未建立 run、啟動失敗或程序崩潰，也不退還或自動重跑。清理未確認時，原有執行鎖仍阻擋後續任務。兩個操作台競爭同一授權也只能啟動一次。

計畫最多保存五分鐘，並受授權到期時間限制；更新頁面只讀狀態。授權指紋、執行狀態、實際消耗狀態與白名單結果可分別查看。消耗狀態讀取失敗時顯示無法確認，不視為尚未使用；遠端串流中斷而沒有完整用量時，輸出 tokens 顯示未知。失敗或停止不代表原任務完成，沒有產物時不顯示成功。

操作台 token 仍能操作已明確允許的本機工作：若 token 外洩，持有人可能在到期前使用那一次既有授權。因此只監聽 loopback、保留同來源驗證、短有效期、單一 pending 授權及精確請求欄位；完整安全驗收仍待完成。

## 本輪驗收範圍

依 [T-0024 技術指導](T24-TECHNICAL-GUIDANCE.md)，本輪以離線測試、暫存 lab 的本機測試程序、Chrome 和原有 Pi 本機故障流程驗證授權與介面整合。測試程序明確標為失敗／未推論，不呼叫遠端模型，不建立實際 checkout 的付費授權。

真實 Pi／DeepSeek 從操作台派工到產物的付費驗收需要另一個明確批准的一次性任務。完成之前，AC-01／09 與完整 MVP 保持 pending；本輪開發 agent 的 API 呼叫不能當作產品遠端驗收證據。

驗收結果：218 項離線測試、五組 Chrome 授權流程、真實 Pi 本機 429／取消與 65 筆結果回歸通過；[公開證據](evidence/remote-grant-2026-11-07.json) 保留先前失敗及模型使用區別。

## 指定失敗紀錄的遠端重試

T-0028 加入固定 Pi task 的一次性重試 grant。取得這一次重試的付費批准後，使用本 checkout 最新、已失敗且清理完成的原始 run 名稱：

```sh
python3 scripts/office_dispatch.py retry pi-work-REPLACE_WITH_RUN_ID
python3 scripts/office_dispatch.py grant pi --retry-of pi-work-REPLACE_WITH_RUN_ID --ttl 900 --confirm-paid-remote-run
python3 scripts/office_console.py --accept-remote-grant pi
```

在該紀錄按「重試計畫」，核對來源、次數與授權指紋，再明確確認執行。這張 grant 只允許此 parent 的下一次 attempt；不能啟動首次任務、另一筆失敗紀錄或本機故障檢查。也可使用 CLI `retry RUN_ID --execute --remote-grant GRANT_ID`，與 `--allow-remote` 互斥。每次最多四請求、每請求 512 output tokens、180 秒和整條鏈最多兩次重試不變；沒有自動重試與金額硬上限。

新建 grant 採 version 2，增加私有 `retry` 欄位：首次任務為 null，重試則綁定 parent、root、下一次 attempt、fixture／受測程式摘要、receipt／ledger 的標準格式摘要，以及原失敗報告的原始 bytes SHA-256。原報告即使仍然 failed，只要 bytes 變更也使 grant 失效。version 1 僅代表首次任務，仍須通過全部既有來源與期限檢查；不升級或補寫歷史授權。

計畫、execute 和 dispatcher 消耗時都重查原重試資格。Dispatcher 在共用鎖內綁定 parent，通過環境預檢後才原子消耗，透過既有 exec journal 交給 runner；失敗不會退還已消耗 grant。舊 parent、第三次重試、fixture／歷史／來源變更、成功或清理不全都拒絕。撤銷命令仍能處理已不符合資格的 pending grant。這是單 checkout 合作協定，不防持有本機寫入權者惡意重寫整份紀錄。

HTTP 公開授權摘要只增加 `scope=fresh|retry` 與 `retry={parent_ref,root_ref,attempt}`；不公開原始 grant id、run 名稱、私有摘要或路徑。瀏覽器仍使用 `retry_ref`，沒有建立、延長、修改或消耗 grant 的新端點，消耗只能經既有 dispatcher。

本輪測試使用隔離臨時 lab：真實 HTTP、Chrome、dispatcher、原子消耗、跨 exec 執行鎖與 retry receipt；環境偵測及 provider 是明示測試替身，產生 failed／零請求的結果。沒有建立實際 lab 的付費 grant、讀取憑證或呼叫 DeepSeek；產品付費重試及完整 AC-07／09／11 仍待另次明確驗收。

## T-0029：操作台真實驗收嘗試

2026-11-22 以新單次批准，經實際 CLI grant → Chrome 明確確認 → dispatcher → Pi／DeepSeek 發出一次固定合成任務。第一個外部請求收到 HTTP 402；依[官方錯誤碼](https://api-docs.deepseek.com/quick_start/error_codes/)為餘額不足。任務保持 failed，沒有產物或可核對的 output token 用量；沒有自動重跑。原生清理、外層受追蹤程序退出、授權消耗及操作台重啟／刷新不重跑已核對。

成功產物／Blob 下載仍未通過；測試替身及既有歷史成功不替代此次端到端驗收。下一步先由 owner 處理 provider 餘額，再對既有失敗 parent 新批一次指定重試；未建立下一張 grant。限額與失敗歷史不變，詳[白名單證據](evidence/pi-console-live-2026-11-22.json)。

T29 接續結果：新單次批准以綁定原失敗 parent 的 retry grant 執行；3次HTTP200、2142input／185output tokens、30.51秒，原生read／write及agent_settled、相同fixture、正確marker／total、原始及標準格式下載hash通過。Chrome實際下載、重複計畫拒絕、刷新／操作台重啟無重跑，32個外層受追蹤程序全退出。原402證據未改；這次成功不授權額外任務，跨provider與完整安全仍pending。

## T-0030：Cursor 固定首次任務

Cursor 使用同一套授權儲存、執行鎖與消耗機制，固定官方 CLI `2026.10.22-27dcf5f`／`composer-2.5`。取得當次單次付費批准後：

```sh
python3 scripts/office_dispatch.py plan cursor
python3 scripts/office_dispatch.py grant cursor --ttl 900 --confirm-paid-remote-run
python3 scripts/office_console.py --accept-remote-grant cursor
```

也可明示接受兩者：`--accept-remote-grant pi --accept-remote-grant cursor`，但整個 checkout 同時仍只有一張有效 pending grant，不會各存一張候用。Pi 與 Cursor 的 grant 不可互用；Cursor 僅允許首次合成任務，拒絕 `--retry-of`、任意 prompt 與其他模式。授權來源包含 Cursor runner、hook／wrapper／政策、共用控制程式與 CLI lock；程式更新使舊 grant 失效。version 1 僅支援歷史 Pi 首次任務，Cursor 使用 version 2、retry=null。

限制為 120 秒、一個 prompt、最多四次工具、4096 bytes 產物。請求／token／金額硬上限為 null，頁面顯示無硬上限；不沿用歷史單次240秒批准。停止本機程序不保證服務端立即停止計費。CLI 亦可在當次批准下使用 `run cursor --execute --remote-grant GRANT_ID`，與 `--allow-remote` 互斥。runner 的授權參照會再次核對已消耗紀錄、provider 與來源；對外結果只含指紋。

[控制層證據](evidence/cursor-console-grant-2026-11-22.json)使用真實 HTTP、Chrome、dispatcher、atomic consume 與跨 exec 執行鎖，provider 及環境偵測是隔離臨時 lab 的明示替身。驗證預設拒絕、確認取消不啟動、正確 provider、單次執行、停止、失敗不顯示成功、撤銷、刷新與重啟；無產品模型請求或實際 lab grant。Cursor 真實新入口到產物、原生取消／恢復仍待另一次具體驗收，完整 AC 不變。

## T-0031：Cursor runner 的一次性交接

已消耗 grant 的 id 不是另一份可重用執行許可。Cursor runner 接受 `--authorization-ref` 時，必須持有本 checkout 經 dispatcher exec 繼承的 guarded 執行鎖，並核對消耗收據的 dispatcher 入口、同一 PID、時間及完整來源／provider 綁定。通過後以排他建立的私有 `.runner.json` 收據領取一次；同一程序再次領取或新程序重用都拒絕，且拒絕發生於原生預檢及讀取憑證之前。已領取後即使預檢失敗，也不退還、不自動重跑。

這修正了舊 id 可以被新 runner 帶入、沿用相同授權指紋的紀錄問題；不是瀏覽器自動重試的證據。直接 `--allow-remote` 仍代表操作員另次明確授權，不以舊 grant 作為其依據。這仍是單 checkout 的合作協定，不防擁有本機寫入權者修改程式或收據。既有已消耗紀錄不遷移、不回復為 pending。

[本輪證據](evidence/cursor-grant-handoff-2026-11-23.json)使用實際 Python runner／dispatcher／exec／檔案鎖，原生預檢與 provider 為明示替身；零產品模型請求。單次開發 GLM 審查回覆 401 Invalid credential，沒有取得審查內容、沒有重試或 fallback；修正由主導獨立重現與審查。Cursor 真實新入口與完整 MVP 仍 pending。
