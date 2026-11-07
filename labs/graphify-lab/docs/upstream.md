# Graphify 上游核對與採用邊界

核對日期：2026-10-29。本文是來源研究，不是執行成功證明；本 lab 的驗收狀態以
[SUCCESS](../SUCCESS.md)、[SDD](../SDD.md) 與實際執行證據為準。

## 1. 固定版本、安裝與授權

本次讀取的上游為 `Graphify-Labs/graphify`，預設分支 `v8`；本機 clone 的
`git rev-parse HEAD` 已核對為 `0a8cd4e1e342235fe53e881fb5d591bf0460071f`。
以下程式來源連結固定到此 SHA，避免可變分支與文件日後改版造成混淆。

| 項目 | 核對結果 |
| --- | --- |
| Python 套件 | `graphifyy`，注意結尾是兩個 `y`。 |
| 套件版本 | `0.9.97`；changelog 記錄發布日期為 2026-10-27。 |
| Python | 上游要求 `>=3.10`；本 lab 的環境選擇見 SDD。 |
| 命令入口 | `graphify` 與 `graphify-mcp`，核心不依賴 Node.js。 |
| MCP extra | `graphifyy[mcp]`；其他 extras 按使用的輸入格式選擇。 |
| 授權 | 目前主授權 Apache-2.0；重新授權前部分貢獻保留 MIT 條款。 |

依據：[套件定義][pkg]、[發布記錄][changes]、[NOTICE][notice]。
上游獨立安裝的套件形式是 `graphifyy[mcp]==0.9.97`；本 lab 應使用
[README](../README.md) 的隔離環境與依賴鎖檔步驟，不能以未固定版本的安裝替代驗收。
固定 PyPI 版本和固定研究來源 SHA 是兩項來源紀錄，不宣稱 wheel 與 Git tree 位元相同。

`graphify install` 另外負責寫入 assistant skill／規則，並非建圖必要步驟。
本輪使用 CLI 與 stdio MCP，不執行全域 skill 安裝，也不改其他專案規則。[上游說明][readme]

## 2. Code-only 與模型邊界

`graphify extract <path> --code-only` 在本機抽取代碼結構，跳過文件、PDF、圖片的
模型語意抽取，不需要 LLM API key。安裝依賴、取得參考 Git source 仍可能需要網路；
「建圖不呼叫模型」不等於整個 bootstrap 離線。[CLI 實作][cli]

未指定 code-only 時，混合資料夾可能走配置的 semantic backend，或者由 coding assistant
的 skill 流程處理文件。這是另一條資料及費用路徑，本輪不將它混入代碼測試。[上游說明][readme]

常用 Python、JS／TS、Go、Rust、Java、C／C++、C#、PHP 等有結構抽取；Vue、Svelte、
Astro 等會依支援的嵌入語法處理。SQL、Terraform 與部分語言需 extras；支援語言不保證
每種框架、型別推導或動態構造都能解析。[套件定義][pkg]、[輸入格式文件][languages]

| 邊的信心標記 | 應如何理解 |
| --- | --- |
| `EXTRACTED` | 在輸入中直接抽取出的關係。 |
| `INFERRED` | 由解析或推導連起的關係；不必然來自 LLM。 |
| `AMBIGUOUS` | 可能有多個目標，不能當成唯一確定的呼叫。 |

這些標記有助判讀來源，不能代替開啟源碼與執行必要測試。[解析文件][resolution]

## 3. 上游能力與本 lab 包裝層

| 能力 | Graphify 原生 | 本 lab 的責任 |
| --- | --- | --- |
| 代碼抽取與關係解析 | tree-sitter／專用 extractor、symbol resolution。 | 呼叫真實固定版本，不另寫 parser。 |
| 定位與導覽 | `query`、`explain`、`path`、`god-nodes`。 | 提供固定問題、已知預期與來源回讀。 |
| 修改影響 | `affected` 反向遍歷已知依賴。 | 正負例及限制說明，不當成完整測試選擇器。 |
| 增量更新 | manifest、AST cache、`update`、可選 `watch`。 | 以可變 fixture 驗證更新與舊符號消失。 |
| 多 repo | `merge-graphs`、`global`。 | 明確輸入版本、命名與可解析跨 repo 場景。 |
| 原始碼下載 | `clone` 提供可變目錄重用。 | URL／完整 SHA 的固定來源與完整性檢查。 |
| 共用索引 | 可指定 output／graph 路徑。 | 依版本、subdir、設定隔離，並行鎖與原子發布。 |
| Agent 接入 | MCP stdio／HTTP 與 assistant integrations。 | 本輪只驗證真 stdio 握手及讀取。 |
| 效能與空間 | 有 benchmark 命令及上游宣稱。 | 記錄本次工作負載的數據及計算假設。 |

上表的包裝層欄位是 [SDD](../SDD.md) 的責任分配，不表示每項已驗收。
原生入口可核對 [CLI][cli]、[MCP server][serve] 與 [cache][cache]。

## 4. 查詢的實際語意

以下為上游命令形式；`target`、`index` 與符號名需換成本次產生的路徑和真實 node。

```sh
graphify extract target --code-only --out index
graphify query "OrderService" --graph index/graphify-out/graph.json --budget 1000
graphify explain "OrderService" --graph index/graphify-out/graph.json
graphify path "submit_order" "save_order" --graph index/graphify-out/graph.json
graphify affected "save_order" --graph index/graphify-out/graph.json --depth 3 --relation calls
```

`--out DIR` 寫入 `DIR/graphify-out/`。此版本 `extract --code-only` 寫出 graph 與 analysis／
manifest／cache 等輔助產物，不會自動生成 `graph.html` 或 `GRAPH_REPORT.md`；HTML 需另跑
`graphify export html --graph index/graphify-out/graph.json`。需要報告時可用
`graphify cluster-only index --no-label --no-viz`，避免模型命名。[CLI 實作][cli]

查詢本身依關鍵詞、符號及屬性評分選 seed，再做圖
遍歷，沒有把問題送給生成式模型作答。任意中文長句不一定命中英文 symbol；可用實際名稱或
node ID 收窄查詢。`--budget` 是輸出預算，不代表已量測的模型 token 花費。[CLI][cli]、[查詢實作][serve]

`path` 預設按方向搜尋；`--undirected` 回答的是忽略方向的連通性。預設遍歷也允許
`contains` 的反向導覽，且可穿過 imports 等關係，因此有路徑不等於有純 calls 鏈。[CLI][cli]
`query`、`explain`、`path` 對名稱歧義可回 `3`、無匹配可回 `4`，但 **`0` 不能證明找到路徑**：
此版本在兩 endpoint 存在而無路徑時，印出 `No directed path found`／`No path found` 後仍
退出 `0`。runner 必須檢查輸出、節點與實際邊，保留負例，不能只判斷程序退出碼。[CLI][cli]、[CLI 文件][cli-doc]

MCP 的圖工具包括 `query_graph`、`get_node`、`get_neighbors`、`get_community`、
`god_nodes`、`graph_stats`、`shortest_path`；另有三個 GitHub PR 工具。
此版本沒有名為 `affected` 的 MCP 工具，不能把 CLI 命令名直接當 MCP schema。[MCP server][serve]

## 5. Source snapshot、graph 與 cache 是三種資料

Source snapshot 保存完整固定版本的源碼；graph 保存符號、關係、位置及 metadata；
AST cache 保存可重用的抽取結果。Graph 可引導精確讀取，不能完整還原或取代源碼。[建圖實作][build]

「一份參考代碼」指多 consumer 引用同一個 URL／SHA 的 source 與相同設定的 index，
consumer 僅保存 pointer。節省來自避免重複 source／index，不是 Graphify 自動壓縮所有資料。
不同 revision 可有不同 snapshot；跨 revision 的 Git object 重用不等於工作樹完全不占空間。

`cache.py::file_hash` 使用內容與相對路徑計算 hash，AST cache namespace 還含 Graphify
版本、cache schema 及 grammar versions。它不是不分路徑的全域內容去重；修改路徑、解析器
版本或設定，都需要重新判斷能否重用。`GRAPHIFY_OUT` 可指定相對或絕對輸出位置。[cache][cache]

同一份固定 source 不應直接被增量更新測試修改；更新場景應用獨立的可變 fixture。
正式 reference 若被修改，應由包裝層拒絕把它當作已鎖定 SHA 的可信來源。

## 6. 為何不直接用原生 clone 作固定 reference

`cli.py::_clone_repo` 預設放在 `~/.graphify/repos/<owner>/<repo>`，第一次 shallow clone，
目錄已存在則執行 `git pull`。它按 repo 重用，沒有按完整 commit 隔離。[CLI 實作][cli]

此版本的 pull 失敗只輸出 warning，函式仍回傳目錄並顯示 Ready；指定另一個 branch 也不
等於建立獨立快照。這適合隨上游變動的方便入口，不能單憑成功訊息證明取得預定 revision。

因此本 lab 的 `references.lock.json` 與 cache 邊界負責完整 SHA、來源驗證、dirty cache
拒絕及同 revision 重用；原生 Graphify 負責對已驗證的 source 建圖。這些保護須由測試證明。

## 7. 多 repo 的真實範圍與兩種入口差異

本地開源版本已有多 repo 功能，無須因 README 提及 Cloud 就假定必須付費。
`merge-graphs` 讀多份圖、加 repo prefix，輸出指定 JSON；`global add` 則管理個人目錄
下的 global graph，重用同 tag 會替換該 repo 的舊節點。[CLI][cli]、[global_graph][global]

`cross_repo_calls.py` 從 caller 的 `metadata.unresolved_calls` 補 member call，要求
receiver type 能在其他 repo 找到唯一候選。這不是任意 HTTP 路由、消息佇列或動態載入的
跨服務語意推理。[跨 repo calls 實作][cross-calls]

此 pass 的語言表含 C++、C#、Go、Java、Kotlin、Objective-C、Swift、PHP、JS／TS／SFC，
**不含 Python**。這只描述跨 repo member-call pass，不是否認 Python 單 repo 支援。
跨 repo 正例可用 typed TypeScript consumer 與 SDK；同名型別歧義須設負例。[跨 repo calls 實作][cross-calls]

| 行為 | `merge-graphs` | `global add` |
| --- | --- | --- |
| repo 隔離 | 替輸入產生不同 prefix。 | 使用指定 repo tag。 |
| 跨 repo member call | 呼叫補邊 pass。 | 呼叫補邊 pass。 |
| 同 namespace／name 型別 | 呼叫 `link_shared_type_declarations`。 | 此版本未呼叫該 pass。 |
| 全圖重新分群 | 合併分支保留／偏移既有 community IDs，沒有 cluster 呼叫。 | 不能推定與另行全圖分群等價。 |
| 寫入一致性 | 指定合併輸出檔。 | graph、manifest 各自 atomic write。 |

依據：[CLI 合併分支][cli]、[全域圖實作][global]、[共享型別實作][cross-types]。
共享型別只加 `same_type_as` 邊，保留兩邊節點；兩份宣告可能已分歧，不能假定實作等價。

[多 repo 文件][multi-doc] 的流程提到 re-cluster，但此 SHA 的 `merge-graphs` 分支未執行
分群；需要時另行 `cluster-only`，並以 `--no-label` 避免模型命名。
`global_add/remove` 未見涵蓋整個 read-modify-write 的跨程序鎖；各檔案 atomic write 不能
防止兩個 writer 互相覆寫。因此共用方案需單 writer／鎖，consumer 讀取已發布的結果。[global][global]

## 8. 正確性與成熟度解讀

Graphify 是導覽與證據索引。動態 dispatch、反射、生成代碼、缺少輸入、stale index 及不同
語言的解析缺口都可能造成漏邊；缺少 path 不足以證明沒有執行時關係。[架構文件][architecture]

`affected` 只能追已存在的關係；找到 test caller 是測試線索，不是證明其他測試可省略。
精確修改前應回讀 source，涉及執行行為時執行對應測試。正負 fixtures 證明的是選定場景，
不能外推到所有語言和 repo。

本次版本仍是 0.x，changelog 持續修正解析、cache、圖合併與輸出問題；採用應靠固定版本和
代表場景回歸，不能靠 star 數或通過安裝就宣稱完整正確。[發布記錄][changes]

## 9. 效能與空間數據如何解讀

| 指標 | 應記錄／限制 |
| --- | --- |
| 冷建圖 | source 取得與依賴安裝另列；記錄首次解析 wall time。 |
| 暖重跑 | 分辨 wrapper 直接命中 index 與 Graphify AST cache 命中。 |
| 修改後更新 | 記錄輸入變更、新舊符號及實際解析／命中情況。 |
| 查詢延遲 | 分開 CLI 程序啟動、圖載入與常駐 MCP repeated query。 |
| `rg` baseline | 用明確且可比較的問題；字串命中與關係查詢並非同一輸出。 |
| 上下文成本 | 記錄回傳 bytes／字元；沒有 tokenizer 就不可冒稱精確 tokens。 |
| 磁碟占用 | 分列 source、`.git`、graph、cache、HTML，說明計量方式。 |
| 多 consumer 節省 | 標示份數、計算式與假設；計算值不是實際多機部署量測。 |

MCP server 保留 graph contexts／LRU，更新時可重載；暖查詢可能受益，但實際結果須量測。
簡單字串定位可能仍由 `rg` 更快；Graphify 的待驗證價值是減少多輪關係探索與無關內容讀取。
小 source 的索引可能比 source 大；單 consumer 不保證節省磁碟。[MCP 實作][serve]

本文不引用上游 token 百分比作為本 lab 的成果，也不預填速度或空間測量。

## 來源

固定 SHA 的程式碼是本次行為核對依據；線上文件僅作補充，可能隨上游更新。

[pkg]: https://github.com/Graphify-Labs/graphify/blob/0a8cd4e1e342235fe53e881fb5d591bf0460071f/pyproject.toml
[changes]: https://github.com/Graphify-Labs/graphify/blob/0a8cd4e1e342235fe53e881fb5d591bf0460071f/CHANGELOG.md
[notice]: https://github.com/Graphify-Labs/graphify/blob/0a8cd4e1e342235fe53e881fb5d591bf0460071f/NOTICE
[readme]: https://github.com/Graphify-Labs/graphify/blob/0a8cd4e1e342235fe53e881fb5d591bf0460071f/README.md
[cli]: https://github.com/Graphify-Labs/graphify/blob/0a8cd4e1e342235fe53e881fb5d591bf0460071f/graphify/cli.py
[serve]: https://github.com/Graphify-Labs/graphify/blob/0a8cd4e1e342235fe53e881fb5d591bf0460071f/graphify/serve.py
[cache]: https://github.com/Graphify-Labs/graphify/blob/0a8cd4e1e342235fe53e881fb5d591bf0460071f/graphify/cache.py
[build]: https://github.com/Graphify-Labs/graphify/blob/0a8cd4e1e342235fe53e881fb5d591bf0460071f/graphify/build.py
[global]: https://github.com/Graphify-Labs/graphify/blob/0a8cd4e1e342235fe53e881fb5d591bf0460071f/graphify/global_graph.py
[cross-calls]: https://github.com/Graphify-Labs/graphify/blob/0a8cd4e1e342235fe53e881fb5d591bf0460071f/graphify/cross_repo_calls.py
[cross-types]: https://github.com/Graphify-Labs/graphify/blob/0a8cd4e1e342235fe53e881fb5d591bf0460071f/graphify/cross_repo_types.py
[cli-doc]: https://docs.graphify.com/open-source/configuration/cli
[multi-doc]: https://docs.graphify.com/open-source/features/multi-repo
[languages]: https://docs.graphify.com/open-source/features/languages
[resolution]: https://docs.graphify.com/open-source/features/deduplication
[architecture]: https://docs.graphify.com/concepts/architecture
