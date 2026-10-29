# Independent Grok connection — GC01–04

Owner選定獨立工具端。本輪將已驗收MT stdio source固定到私人runtime，登記到本機現有Grok Build；先只開health.status，不更動Kith、Cloudflare、bot grant或Access，不呼叫模型、不新增付費API。

| AC | 驗收 |
| --- | --- |
| GC-01 | 核對已安裝client版本及本機文件，備份原設定，固定已合併source及hash，私人state保留且不含公開憑證 |
| GC-02 | 只新增具名user-scope stdio設定、固定argv且無allow-submit；Grok原生doctor真正初始化並發現status工具，原其他設定語義不變 |
| GC-03 | 使用登記的相同argv驗證status真實回應及禁止check；另以既有認證查詢自身授權，明示過期／拒絕，不將local not_found當遠端可用 |
| GC-04 | 保存私人回執、公開去識別操作文件、獨立審查與正常Git交付；未執行模型的自然語言選工具或live提交保持待驗 |

## 接線與操作

Grok Build的本機user guide與`grok mcp --help`為安裝版本的依據。新增server名稱`cloud-lab`，command固定Python，args指向固定版本的MCP source、既有私人bot config與唯一私人state。設定不包含secret值、URL或任意模型參數；startup/tool timeout明確限制。預設只暴露`cloudlab_health_status`，不提供check，亦不新增自動批准規則。

可執行`grok mcp doctor cloud-lab --json`檢查實際連線；既有TUI在`/mcps`按r重新讀取或新開session。Grok工具catalog使用`cloud-lab__cloudlab_health_status`。模型需先search_tool再use_tool，input只有原request_id；MCP RPC id不是持久request_id。使用者仍可依既有permission設定批准工具操作。

未有本地請求時status返回not_found，這只證明client／本機adapter工作，不代表Access、HMAC或grant有效。真正遠端授權另用固定bot config的authorization-status查詢；拒絕仍是拒絕，不續權或以runner身份替代。先核對身份／期限，再另行準備具體有界bot續權與check驗收。原已批准runner期限、HL排程部署阻擋保持不變。

## 保存與回退

私人runtime保存source commit及每檔SHA256、原Grok設定備份、追加前後digest與診斷回執。state及requests.sqlite是持久資料，不能放進cache或清理。相同host設定不得任意換state來恢復。回退可`grok mcp disable cloud-lab`停用此server；既有設定與state保留。要完全移除時只移除具名entry，不覆蓋整份設定；不以舊備份覆蓋後續其他使用者修改。

本輪不執行實際Grok模型，不宣稱自然語言端到端完成；沒有自動續權、付費方案或API金鑰改動。實際結果見[接線證據](evidence/m1-grok-connection.md)。

後續[BL有界驗證](bot-live.md)已實際完成bot-only短期續權與一筆健康檢查，隨後恢復status-only；原GC過期診斷仍保留為歷史前態，新的精確期限與觀測見[BL證據](evidence/m1-bot-live.md)。

後續[BA首期準備](bot-activation.md)固定含BP／BR的候選並完成原Lab唯讀核對，原Grok仍status-only；未安裝候選、初始化政策或續權。
