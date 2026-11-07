# UR：未知結案source與隔離證據

## 結果

[UR01–04](../unknown-resolution.md)完成source與隔離驗證：[T854獨立審查](../../../../.team/reports/T-854.md)ACCEPT，完整回歸Node96＋Python304＝400tests通過、無skip。原live命令仍unknown；這次沒有發布新Worker、停止runner或執行結案SQL、續權／改Cron／付費。完整mainline仍incomplete／無usable tag。

## 行為與證據

離線工具只接受新鮮、固定node-health、deadline已過、原journal已持久unknown且identity相符的單筆snapshot；32KiB、私人0600/Git外檔案及exclusive輸出。生成exact record/body/revision等原欄CAS與SQL自身60秒期限，需operator具體批准。決議保存actor／時間／理由／resolution id／journal摘要，result仍null，原journal／command身份／attempt／external_ref／計數保留。

Worker將closed_unknown視terminal；舊report409且不重新打開，cancel不改決議，原idempotency重送返回原命令。UI明示「已結案，結果仍未知」、不再取消／下載偽造成果；bot沿用unknown且code=RECONCILIATION_CLOSED、verified=false，不增加模型處置工具或capability。

- UR-green2：8項Python resolution測試，涵蓋CAS、重播0、真result／revision／body漂移、SQL過期、deadline／journal／recipe身份／私人檔案與Git拒絕；2項Worker/UI終局測試及16項bot回歸通過。
- UR-integration2：實際Python規劃器產出SQL，對Node SQLite D1執行，獨立SQLite owner journal不改。閉環一：unknown→結案→原report409→usage active0但retained/recent不退額→同ID不重跑→新Cron→新claim→validated。閉環二：真結果先到，operator CAS0且結果完整保留。是本機真實SQL／跨語言驗證，不是遠端D1並發或實體停止證明。
- UR-full：`python3 platform/cloud-lab/tools/check.py`實際400tests全過，涵蓋原HTTP/HMAC/socket／CLI／服務與本輪新增案例。由共享workspace launcher執行，日誌保留於UR-full；本機Node24.14.0/Python3.13.5，未聲稱Python3.11已本機跑。
- 原真人驗收沿用Safari回報122／84／1及D1同窗口核對；依owner要求取消Console asset hash，不為此新增人工測試或重開human窗口。

## 失敗歷史

UR-red的未實作planner造成4個預期錯誤，Worker晚到report錯回200、UI未知狀態標示均重現；原失敗保留。首次UR-green私人檔案測試碰到launcher temp的Git祖先而拒絕，修正fixture只隔離Git祖先判斷，另保留真正repo路徑拒絕測試；生產檔案防護未放寬。

首次跨語言UR-integration使用同步spawn遇兩次10秒timeout；UR-process-diagnostic確認最小stdin程序同樣ETIMEDOUT，未將其當作產品成功。改用既有測試慣用的有界async spawn／stdin.end後，UR-integration2兩案通過；未延長timeout或跳過案例，不宣稱已查明系統層根因。

## 實際原命令的離線準備

主導另外以既有管理介面唯讀取得原09:15UTC命令，再從原config指定journal讀取對應unknown行；真正執行新版CLI成功，產生未applied的私人計畫及具體proposal。所有帳號／domain／command id／完整row／journal／SQL收據留私人目錄，不進Git。計畫本身60秒後過期，不能拿它直接執行；批准後暫停runner並fresh重採原identity，再產生新CAS。

下一步具體影響：短暫暫停原runner／排空在途，部署相容Worker並核對設定，將原09:15命令以未知結果結案（保留紀錄，釋放1槽），恢復原service/config/journal與原期限，再觀察一筆新Cron。原命令不重跑；不延長任何授權、不改免費方案。實際結案與服務暫停需owner具體批准；結案後不可直接回退不支援closed_unknown的舊Worker。這份方案已可審閱，但尚未執行。
