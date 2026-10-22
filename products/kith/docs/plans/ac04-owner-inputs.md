# AC-04 執行輸入填寫表

範本版本：1（2026-10-22）。對應 [SUCCESS AC-04](../../SUCCESS.md)、[SDD](../../SDD.md)、[成本契約](../cost-safety.md)。

用途：補齊真 hosted provider、原生 CLI 與獨立審查的執行資料，讓 agent 在同一次核對後繼續開發。這是交接表，不是程式可直接載入的 runner.toml 或驗收設定檔；agent 會依實際實作產生對應設定。

## 1. 已批准的範圍，不需重填

Owner 已批准依 AC-04 契約開發、提交程式及達門檻後合併自己的 PR，包含獨立 worktree、issue／認領／任務板、正常 push、匿名化證據、board-only 收尾及 RELEASE。舊交接的「尚未批准」「不含 merge」「只到可審 PR」不再是當前授權狀態。

四組驗收固定為：A 真 hosted 完整回覆與持久化／generation 對應；B 真 native CLI 的 accepted／running／trace／thread 摘要及 replay 不重複 spawn；C 新請求與既有 SSE 撤權、非 operator personal 喚醒拒絕；D hosted 與 runner 的 opt-in、attempt／concurrency admission 及拒絕後零新增 dispatch／spawn。包含 C 的既有 SSE 修正與 D 的 runner pre-spawn admission，不自行縮成 hosted-only。

模型、認證位置、可花費金額與獨立審查路由仍需具體值。開發授權不代表任意花費或登入／安裝／路由例外。正式部署、remote migration／secrets、排程、usable tag、force push、關 issue、刪 branch、修改 AGENTS／CLAUDE 及清理既有工作仍不在本次範圍。

## 2. 如何填寫與交回

1. 複製整份文件到下列 repo 外位置，再編輯私有副本；不要直接在 GitLab／GitHub 填寫或提交已填版本。
2. 把各表「你的填值」中的 `待填` 換成答案。所有檔案／目錄填絕對路徑；不要貼 API key、token、cookie、私鑰、密碼或完整認證檔內容。
3. 不知道的技術資料可填 `請代查：已知線索／檔案路徑`。agent 會先唯讀核對；模型選擇與金額授權不能用代查推定。無資料就保留 `待填`，不要猜測。
4. hooks／plugins／MCP 若不用，明填 `全部停用`；其他不適用欄位填 `不適用：原因`。空白、示例及建議值都不算授權。
5. 完成後只回覆：`已填妥，請讀取 <本地絕對路徑>`。不需把內容貼進對話，也不需再批准開發／提交／合併。

指定位置：`$HOME/.config/kith/ac04/owner-inputs.md`，目錄權限 **0700**，檔案權限 **0600**。在執行 agent 的同一台主機、同一操作身份下保存；若在其他電腦編輯，先自行傳到這個位置。

可從 repository 根目錄執行以下命令建立私有副本。若目的檔已存在，最後一步會拒絕覆蓋；請編輯既有檔案。

```sh
install -d -m 700 "$HOME/.config/kith/ac04"
(
  umask 077
  set -C
  cat products/kith/docs/plans/ac04-owner-inputs.md > "$HOME/.config/kith/ac04/owner-inputs.md"
)
```

私有副本與後續引用的設定檔都留在 repo 外。既有 CLI 認證保留原位，不為本次任務複製認證、登入、安裝或變更全域設定。若還沒有可用的隔離身份，填明缺項，由 agent 回報前置工作。

## 3. 填寫識別

| 欄位 | 你的填值 | 說明 |
| --- | --- | --- |
| 填寫日期／時間 | 待填 | 含時區，例如 UTC RFC3339 |
| Owner／operator 身份別名 | 待填 | 可用本地別名，不需真名、email 或帳號秘密 |
| 私有交接檔絕對路徑 | 待填 | 本文件私有副本的實際位置 |
| 授權有效期間 | 待填 | 本次 AC-04 開發／驗收與收尾可使用下列預算的期限，含時區 |

## 4. Hosted provider：只選一組

| 欄位 | 你的填值 | 說明 |
| --- | --- | --- |
| Provider 名稱 | 待填 | 真官方 API 供應商 |
| 精確 model ID | 待填 | 不只寫「最新」「預設」或模型家族 |
| 官方 HTTPS base URL | 待填 | 不含帳密或 token；不使用轉接訂閱的 gateway |
| API 格式／token 參數 | 待填 | 填已知格式；不知道可請 agent 依所選官方端點與現有 adapter 查證 |
| 串流設定 | 待填 | 開啟／關閉；agent 會核對所選模型與 adapter 支援 |
| 既有 API 認證引用 | 待填 | 只填 repo 外設定／秘密檔的絕對路徑、格式與欄位名稱；不填秘密值 |
| 計價及可用配額依據 | 待填 | 官方價格頁或本地非秘密紀錄位置、觀測時間、帳戶／provider-side 額度限制；未知就明填未知 |

只提供路徑不代表允許呼叫；呼叫與費用依第 6 節。agent 會檢查檔案存在、權限及非秘密欄位，不在公開文件或共享日誌輸出秘密。

## 5. 原生 CLI：只選一組

| 欄位 | 你的填值 | 說明 |
| --- | --- | --- |
| CLI／native adapter | 待填 | 現有 native adapters：codex、claude_code、gemini_cli；command fake 不能用來完成 B |
| 精確版本 | 待填 | 可填「請代查：下列 executable 的 --version」；不需自行升級 |
| 精確 model ID | 待填 | 含提供模型的 provider；需要能核對實際執行身份 |
| Executable 絕對路徑 | 待填 | 既有安裝；agent 會核對版本、digest、實體路徑與 inode |
| CLI home／認證位置 | 待填 | 填既有合法且隔離的 home／認證引用路徑，不貼憑證內容 |
| 專用 workdir／state 目錄 | 待填 | 分別填絕對路徑，標明已存在或允許新建；不可與其他產品共用／嵌套 |
| 認證種類及使用權 | 待填 | api_key 或 subscription；確認由上述 operator 合法使用；個人訂閱不供第二人喚醒 |
| 唯讀 profile／設定位置 | 待填 | profile 名稱與設定檔路徑；非互動、唯讀、固定合成 fixture，禁止子 agent |
| Hooks／plugins／MCP | 待填 | 各自填「全部停用」或精確允許清單及設定位置，不接受未核對的繼承預設 |
| 工具與網路範圍 | 待填 | 只讀專用 fixture 的工具清單及必要模型端點；不得存取無關主機、正式資料或額外服務 |
| Fanzloud 隔離核對線索 | 待填 | 如有該產品，填可唯讀核對其 executable／home／workdir 的設定位置；不存在則說明 |
| 訂閱／API 配額依據 | 待填 | 可用額度、重設時間、共享限制與觀測時間；unknown 不代表免費或無限 |

產品 runner 與團隊 reviewer 是不同角色。本節不授權以產品 runner 代替共用團隊入口，也不沿用舊的直接 OpenCode 審查例外。若選定版本需要 model pin／parser 修正，限於原 AC-04 提案範圍；不得默默換 CLI 或模型。

## 6. 模型執行預算與授權

以下是整個第二階段的總上限，包含重試與最多一次修正／重驗。請在「你的填值」明填實際批准值；原提案僅作填寫參考。第二階段總時間上限 180 分鐘，前置核對計入；不足就保留真實未完成狀態。

| 欄位 | 你的填值 | 原提案／填寫規則 |
| --- | --- | --- |
| Hosted inference 總 attempt | 待填 | 原提案最多 4 次；包含 HTTP retry／修正重驗 |
| Native CLI 總任務啟動數 | 待填 | 原提案最多 2 次；啟動數不等於模型請求數 |
| Hosted／CLI concurrency | 待填 | 原提案各為 1；另填全流程同時模型執行上限，原提案為 1 |
| Hosted／CLI 每次 timeout | 待填 | 原提案 300 秒／120 秒 |
| 每次 output token 上限 | 待填 | 原提案 512；agent 必須核對 CLI 是否真的可限制，不能假稱已強制 |
| 每次合成上下文上限 | 待填 | 原提案 2 KiB；不含真實私人聊天 |
| Provider／CLI model-list 次數 | 待填 | 原提案 0；若需要非零，明列對象、次數及 timeout |
| 幣別 | 待填 | 例如 USD；不可留空 |
| Hosted 最高新增費用 | 待填 | 明確數字，與下列總額同一幣別 |
| CLI 最高新增費用 | 待填 | 明確數字；若只准既有訂閱且不准額外收費，明填 0 並寫清配額限制 |
| 本次全部模型活動最高新增費用 | 待填 | 明確數字，包含 hosted、CLI、reviewer、重審與 board-only 收尾；不能只填「少量」 |
| 可用配額及不得動用的額度 | 待填 | 引用第 4／5／7 節觀測；包含既有訂閱的可用限制 |
| 真模型執行授權 | 待填 | 填「批准依本表所填模型、路徑、次數與費用上限執行 AC-04」或「尚未批准模型執行」 |

本表金額是 owner 授權上限，不是程式已能保證的帳單硬上限。agent 必須先確認計價／token／配額及觀測方法足以遵守預算；無法估算或限額不清就停止付費步驟。CLI 一次任務可能包含多個模型請求。0 元只允許已核對且不新增收費的路徑，不能由訂閱名稱推定免費。禁止自動加購、超額或改用其他模型。

Timeout／未知結果保留 reservation 與 unknown，不盲目重試，不重設 ledger／D1，不藉跨日刷新額度。已開始的遠端工作可能繼續計費。

## 7. 獨立唯讀 reviewer

請提供既有合規路由；若不熟悉 route ID，可填 registry／已審核實測證據的位置，由 agent 查證。沒有就明填「尚無」，不能用模型清單、help、exit 0 或上次產品的例外代替。

| 欄位 | 你的填值 | 說明 |
| --- | --- | --- |
| 共用 route ID | 待填 | cli-team 共同入口的具體路由 |
| Provider／精確 model ID | 待填 | 實際獨立 reviewer，不能以主控自審代替 |
| Capability registry 絕對路徑 | 待填 | 私有 registry；不要把原檔提交到 repo |
| Matching reviewed live evidence 路徑 | 待填 | 已審核的實測證據，不是 fixture；可由 registry 指向 |
| CLI 版本／唯讀 profile／配置位置 | 待填 | 可請 agent 從 registry／evidence 唯讀核對，不自行換版本或修路由 |
| 可用配額與觀測時間 | 待填 | 包含共享訂閱限制；未知明列 |
| 程式 PR 初審／修正重審次數 | 待填 | 分別填數字；最多一次修正循環；初審加重審原提案最多 2 次 |
| Board-only 收尾初審／重審次數 | 待填 | 分別填數字；須另計入總預算，不偷偷追加 |
| 每次審查 timeout／審查總時間 | 待填 | 原提案每次最多 600 秒；總時間受第二階段 180 分鐘限制 |
| Reviewer 最高新增費用 | 待填 | 明確金額、使用第 6 節幣別，已包含在第 6 節全部總額內 |
| Reviewer 執行授權 | 待填 | 填「批准上述路由在所填預算內執行唯讀審查，含收尾」或「尚未批准審查」 |

Agent 會核對模型、binary／版本／digest、OS／身份、parent runner、profile／有效配置、共用來源版本及證據有效期。查不到匹配 route 時回報缺項，不在產品任務中登入、安裝、修理路由或臨時放寬權限。

## 8. Agent 讀取後的處理規格

先只讀核對本表、檔案權限、非秘密配置、最新 main／PR／claims 與既有 route。空白、待填、unknown 或請代查都不會自動成為授權；可唯讀確認的資訊由 agent 補證，不重新要求 owner 填已查到的值。

必要輸入與路由齊備後，按已批准 A–D 範圍建立獨立 worktree、限定任務與驗收入口，先 RED 再 GREEN；以同一版本完成真整合及本地 gates，最後核對 CI、獨立 final-head review、最新 main 與 merge receipt。公開證據只保留匿名化摘要；私人設定路徑、身份、認證與本填寫表不進 PR／CI／shared logs。

如仍缺必要資料，一次列出具體缺項並標 BLOCKED 後結束，不背景等待、不啟動相依 runtime 工作、不用 fake 驗收代替。文件交付或本表填完本身都不代表 AC-04 PASS。
