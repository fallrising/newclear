# Observation rollout preparation evidence — 2026-10-28

[RP01–04](../observation-rollout.md)是部署準備，尚未執行任何cloud mutation、續權、unit安裝或service啟停。私人target、版本ID、原unit與候選只保存在operator持久目錄，不進public repo。

## 主導唯讀盤點

2026-10-28T17:46:02Z開始的六次成功management查詢確認：目前100% version與前次看板發布receipt相同；workers.dev／preview關閉，Cron空。四個grant revision1、未撤銷但期限已過；選定Access token enabled但期限也已過。D1 active0，enabled schedule0，三個SELECT各回rows_written0。Settings已保存供下一次fresh比較；此次未重新驗證Access policy、custom domain或完整version resources，不宣稱完整部署前檢查已通過。

`systemctl --user show`唯讀回報runner inactive/dead、MainPID0，原程序依既定stop-at正常退出0。此時沒有新RO socket來源；磁碟unit只作設定記錄，不能冒充resident觀測。

## 私人候選

固定PR724 runtime source `f77fa595b62df47240e93cd9da181340d6d2514f` 的12份明列source：3 Worker modules、3 assets、runner、recipe及4個IA工具依賴。每份以Git blob讀取並逐檔SHA256比對。三份assets另與已部署看板來源`6915230b16b9e46477eba7fa1b39816065b820a0`逐byte相等；沒有重新從公開URL下載並驗證。

已保存目前100%前版的具體rollback deployment request、原unit bytes、舊runner hash及帶未綁定stop-at的unit模板。保留原config／journal路徑，模板尚未安裝。私人讀取確認bot／runner備份key與各自config相符，只另存generation／expiry／digest及相等結果；沒有複製secret到公開證據、生成新key或更改期限。

候選目錄與全部子目錄0700、一般檔案0600，12份hash及Git byte比較通過。候選不是自動operator，沒有mutation執行權限；具體T0、expiry、secret payload和CAS request仍須批准後按新鮮狀態綁定。不能把未綁定模板稱為可直接部署的bundle。

## 保留的失敗

- 第一次API spec search未使用工具要求的async arrow function，語法拒絕；沒有Cloudflare請求。改正工具輸入後查得schema。
- 初次user-bus查詢被sandbox拒絕，沒有判定服務死亡；正常唯讀權限查詢取得上述inactive結果。
- 第一輪management中的D1 SELECT誤用API呈現欄位delivery，收到400 no such column；沒有寫入。查閱既有collector SQL後改用active=1，重新完整唯讀盤點；前後共12次management requests，不隱藏失敗輪次。
- 初次私人候選驗證失敗：遞迴mkdir的4層中間目錄繼承0775，最外層0700仍限制存取。只修正本次新建且經owner／類型確認的4個目錄到0700，再完整比對12份source與所有權限。保存原失敗及獨立candidate-verified receipt，沒有重建／覆寫候選或清理舊資料。

## 檢查與交付

Runtime來源與上一輪214tests及T830複審的來源相同；本輪不改runtime，故不重跑同一suite，也不將歷史214tests寫成本次新測試。此輪驗證聚焦source固定、私人候選權限、操作順序、回讀／補償與文件索引。RP-plan-checks核對目前DB／origin／audience與原目標相符、secret binding名稱保留、version與前receipt相符及備份key期限已過。RP-doc-checks通過索引、45專案契約、50文件／380連結／12固定來源audit、task validator與diff check。[T831獨立審查](../../../../.team/reports/T-831.md)ACCEPT，僅檢視公開文件與lead摘要，沒有讀取私人候選或自行查雲端。

完整AC06–08保持pending。準備任務可完成，但新機器窗口、實際deployment、成功SA／RO／IA live觀測及到期／退出回讀仍需後續執行證據。
