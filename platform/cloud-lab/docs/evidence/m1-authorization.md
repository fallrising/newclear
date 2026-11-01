# Authorization lifecycle evidence — 2026-10-28

[AL01–04](../authorization-lifecycle.md)實作完成：Python標準庫離線`authorization.py status/plan`、嚴格snapshot、期限盤點、有界grant續期／撤銷提案，以及合成fixture與操作文件。未執行真實續權、撤權、憑證輪替、雲端API或服務變更。

## 驗證結果

- 共用launcher執行`python3 platform/cloud-lab/tools/check.py`：最終37 Node＋107 Python＝144tests通過，包含23項authorization測試。
- 真正SQLite套用計畫驗證：正確更新一次後重播0列；revision／policy／revoked漂移0列；新增active／unknown工作或enabled schedule時0列。續期保留scope與所有既有command bytes；撤銷保留policy。
- 期限測試覆蓋最早有效層、到期邊界、尚未生效、未知、過舊／未來snapshot、撤銷且缺期限、300秒新鮮度及30日提案上限。Human session明示not_evaluated，不從機器層推斷登入成功。
- 輸入拒絕未知欄位／secret、重複key／role、bool冒充revision、錯誤時間、credential錯綁、超限、symlink、hardlink、非0600及Git checkout。輸出拒絕不安全parent及已存在檔案，使用exclusive0600。
- 真實CLI在repo外私人目錄執行`status --snapshot <synthetic>`及`plan --snapshot <synthetic> --role runner --action renew --expires-at <synthetic> --output <private>`成功；stdout不含識別值，計畫applied=false。目錄只有合成metadata，不含真實部署資料；沒有執行SQL。
- [T826獨立複審](../../../../.team/reports/T-826.md)ACCEPT；先前REWORK與修正前失敗保留。Reviewer只讀列出的source與合成logs，未讀私人目錄或呼叫網路。

原始logs位於shared workspace的AL-red、AL-unit-green、AL-regression、AL-regression-green、AL-review-red、AL-final-regression、AL-cli-smoke、AL-cli-green各task之protected evidence。產品舊121tests仍在完整suite內；本輪沒有UI／Worker／runner程式變更。

## 保留的失敗

初始stub缺少行為，16項tests以31個error呈RED。第一輪實作後human fixture仍帶runner capabilities，驗證器正確拒絕；改為human允許能力後通過。最初完整suite被sandbox禁止localhost socket，既有15項Python HTTP測試及Node HTTP案例失敗；批准本機loopback後完整回歸通過，沒有擴權到外部服務。

第一個CLI smoke把輸入放在具有Git祖先的launcher目錄，正確被checkout guard拒絕。另在持久私人目錄放合成資料，使用相同guard重測通過，沒有修改或略過真實CLI的邊界。

T826初審指出revoked credential／Access metadata的expires_at=null會因狀態優先順序被錯標deadline_complete=true。新增一個測試的兩個subcase先失敗；改為直接檢查每個必要期限是否存在及snapshot新鮮度，再跑144GREEN。未把revoked變成valid。

## 範圍與後續

資料採集仍由operator提供當前metadata；這版沒有live snapshot collector、真人session驗證、看板提醒、apply命令、secret產生或自動輪替。`effective_expires_at`在deadline_complete=false時只是已知上界。計畫的30日上限不是30日授權，也不放寬原部署bundle的24小時限制。

下一步可實作具來源與時間證據的唯讀採集，再根據owner選定期限產生具體續期計畫。真正執行與機器憑證切換需獨立驗證；不自動重送未知結果，不刷新原command deadline。日用排程、retention／quota、Grok與agent adapter仍是後續範圍。主線AC06–08維持pending，無usable tag。
