# CF 資源盤點報告接入（IR）

範圍：沿用原GET-only盤點器，手動產生一份JSON，再由有`inventory:publish`權限的operator上傳Cloud Lab；`inventory:read`讀取同workspace最新快照。沒有provider client、憑證複製、新Cron、通用recipe或外部控制權轉移。第一版只保存最新報告；原工具／私人證據負責歷史。

## Wire contract：cloudlab.inventory.v1

根欄位嚴格為`schema_version`、`source`、`started_at`、`observed_at`、`sections`。source嚴格為`id: "cf-inventory"`及`revision: "sha256:<64 lowercase hex>"`，revision為實際producer script內容hash，不含私人repo路徑或帳號ID。時間是UTC秒`YYYY-MM-DDTHH:mm:ssZ`，started_at≤observed_at，收集時間最多一小時；這不是跨API原子快照。

sections依序恰為zones、workers、worker_domains、pages、tunnels、access_apps。每個section欄位恰為`kind`、`state`、`error`、`resources`。state為readable或unreadable；readable的error為null；unreadable的resources必須是空陣列，error只接受具體HTTP狀態代碼（例如HTTP_401、HTTP_403、HTTP_503；regex `HTTP_[45][0-9]{2}`）、NETWORK_ERROR、INVALID_RESPONSE、PAGINATION_INCOMPLETE、LIMIT_EXCEEDED、CREDENTIAL_UNAVAILABLE。未知不代表零項資源。

每個resource欄位恰為`name`、`use`、`present`、`status`、`drift`。name是1–253個Unicode code points、use是0–160個；不接受控制字元或不完整surrogate。present為boolean。status僅zones可用1–32字元的provider狀態，缺少資源或其他kind為null，不能推導健康。drift是無重複的unexpected、missing、inactive、invalid_status代碼陣列，表示desired／actual差異；缺少項present=false且含missing，存在項不能含missing。各section資源名稱唯一。

全報告最多200資源，compact UTF-8 JSON最多24576bytes。producer無法完整輸出某區段時，將該區段明示unreadable／LIMIT_EXCEEDED，不靜默截斷成完整結果。只輸出名稱、用途與狀態摘要；無DNS明細、credentials、account IDs、URL、raw provider response或帳單估算。DNS原文字CLI行為保留。

## 保存與顯示

`GET /api/inventory`：要求inventory:read，按已驗證grant的workspace_id隔離；未上傳回report:null。`POST /api/inventory`：要求inventory:publish；body為report。仍使用既有Access／HMAC驗證與人類Origin檢查，沒有匿名／dev bypass。權限以workspace內固定cf-inventory來源為界，與節點resource_ref無關；既有commands:read不自動取得新權限。

新D1表只保存每workspace最新一份report、digest、observed_at與received_at。新報告以單一CAS upsert比較observed_at，舊時間或同時間不同內容回409；相同時間相同語義重送不改received_at。比server現在晚超過30秒拒絕。讀取回source時間與server時間；超過24小時標為過期，失去連線不顯示為當前已確認。資料存在、drift、服務健康分開。

看板由operator選JSON檔案後明確上傳，不自動監看檔案或排程；文字一律textContent。清除／失效工作階段時移除已讀內容，並防止晚回應重新顯示舊scope資料。新資料庫表、權限啟用及live發布需另行具體批准；本輪先完成候選與必要本機驗證。

## 驗收

| AC | Given / When / Then |
| --- | --- |
| IR-01 | Given既有collector與部分不可讀區段，When輸出JSON，Then完整性／來源／時間／差異有界且文字CLI相容 |
| IR-02 | Given有效及無權限caller，When保存／讀取／重送報告，Thenworkspace隔離、CAS與拒絕不改既有快照 |
| IR-03 | Given正常／部分／過期／失聯報告，When看板讀取及上傳，Then來源／時間／unknown／drift可見且不執行HTML |
| IR-04 | Given兩端候選，When跑producer到consumer真JSON與本機HTTP／瀏覽器，Then一次有界閉環成立；live結果另列未驗 |

## 使用與待上線變更

原盤點工具使用`--json`輸出檔案；exit1表示drift或unknown，仍可能產生有效報告，應檢查JSON而不是把非零退出當空檔。登入既有看板後選取檔案、明確「上傳報告」；「讀取盤點」顯示同workspace最新保存內容。UI需要既有commands:read再加inventory:read，上傳另需inventory:publish；machine API可只授盤點能力。來源hash是可追溯資訊，不是簽章或provider attestation；有publish權限者對報告內容負責。

候選部署差異：原Worker更新index與新增worker/inventory、public/inventory模組，靜態資產更新；原D1新增0003.sql的inventory_snapshots表，不修改原兩份migration或既有命令資料。原Access、secrets、runner、Cron及期限保持。回退可恢復原Worker／資產，保留新表中的報告；不要刪表。啟用inventory權限及任何續期必須另列principal／workspace／期限後批准；本次沒有續權。

目前驗證：37producer＋471consumer測試、本機workerd／D1與Chromium七組閉環成功；實際provider GET在2026-11-02T11:39:31Z回HTTP_403，各區段為unknown。該403來自獨立CLI憑證，不能推論MCP失效。後續沿用既有MCP，見下方收集流程及真實接入證據，再提出具體live啟用差異；不新增付費方案或自動排程。

## MCP收集與離線轉換（MC）

原producer另提供固定GET capture expression，由現有Cloudflare MCP執行。它只取得選定帳號的zones、Workers、Worker domains、Pages、tunnels、Access apps摘要及原分頁metadata，不複製token。capture存放私人檔案，由原工具`--json --capture <private-capture>`離線轉換；使用原desired清單、原分頁檢查與同一wire contract。轉換不讀憑證、不fallback網路、不自動發布。

報告時間保留MCP實際收集開始／結束，重跑轉換不會把舊觀測變成新資料。capture有20頁／2000rows每區段、1MiB每投影頁、8MiB總量與300秒request-start budget；不是強制中止in-flight request。捕捉403或不完整分頁的區段明示unknown。輸入capture是operator提供的資料，不是provider簽章或完整帳號可見性的證明。

`present`只代表在這次已驗證的可讀清單中觀測到該名稱；missing表示期望項未列出，可能需要核對帳號、token可見範圍或過時desired，不能據此斷言資源已刪除。看板文案依此改為「此次盤點未列出」，原desired與資源都不自動修改。

可重複執行的本機驗證：使用common launcher執行`node platform/cloud-lab/tools/qualify_inventory.mjs <installed-miniflare-directory> <private-report.json>`。使用現有工具鏈、合成HMAC身分與隔離D1，阻止外部fetch；驗證保存／讀回、重送、衝突、workspace及撤權。report不得提交公開repo，保留原capture與report hash作為私人證據。這不是live Access登入或線上發布。

MC來源接入已完成；後續ML按[批准方案](inventory-activation.md)上線，首報為明示management import，human授權與限制見[上線證據](evidence/inventory-live.md)。
