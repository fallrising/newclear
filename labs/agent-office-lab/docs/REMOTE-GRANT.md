# Pi 遠端任務的一次性授權

遠端 UI 執行限於 Pi／DeepSeek 的固定合成檔案任務。先由操作員透過 CLI 建立一次性授權，再以明示接受授權的操作台查看計畫、確認並啟動。一般啟動操作台時仍不允許付費派工。

## 操作流程

在 lab 目錄先查看固定任務計畫，再於已取得當次付費批准時建立授權：

```sh
python3 scripts/office_dispatch.py plan pi
python3 scripts/office_dispatch.py grant pi --ttl 900 --confirm-paid-remote-run
python3 scripts/office_console.py --accept-remote-grant pi
```

建立授權只保存一張有限期的執行許可，不會啟動模型。CLI 輸出的完整 id 留在本機；操作台只顯示指紋及到期時間。在頁面選 Pi → 合成檔案任務 → 查看執行計畫，確認模型、請求／輸出／時間限制後啟動。頁面確認不能自行建立新授權。

目前固定限制為最多四個 provider 請求、每請求最多 512 output tokens、180 秒；`money_cap` 為 null，沒有金額硬上限。停止會要求 runner 清理，但已送出的遠端請求仍可能計費。授權不可用於任意 prompt、私人專案、遠端重試或 Grok／Cursor。

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
