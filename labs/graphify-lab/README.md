# Graphify lab

用真正的 **Graphify 0.9.97** 試跑程式碼導覽、影響分析、增量更新、跨 repo 參考與 MCP。
保留一份固定 revision 的 reference source，加一份可驗證的 graph，讓多個任務直接共用。

先讀 [SUCCESS](SUCCESS.md) 查看逐項驗收；設計見 [SDD](SDD.md)，上游能力與實作限制見 [研究紀錄](docs/upstream.md)。
已完成 **7 組真實場景、29 項邊界測試與獨立審查**，runtime 的四項遠端 CI 通過。
[實測與限制](docs/evidence/README.md)／[已合併 PR #759](https://github.com/fallrising/newclear/pull/759)。
第一輪九項 AC 已完成，[結案 PR #760](https://github.com/fallrising/newclear/pull/760) 已合併；可依下列入口本機使用，未部署、未建立 usable tag。
後續 [T-0437 開發任務試點](docs/milestones/development-pilot.md) 是獨立里程碑，不改寫第一輪結果。
[本機 agent 工作流程](docs/agent-workflow.md) 提供固定來源的真實重構調查入口。

## 為什麼分成 source 與 graph

Graphify 負責 AST 解析與圖檢索；本實驗只補固定版本、共用 cache、來源核對及驗收。
graph 是衍生索引，不能還原完整原始碼。先用 graph 找符號／關係，再回讀指定來源與行號。

- **newclear 保存**：程式、依賴 lock、公開 reference 的 URL／完整 SHA、場景與精簡證據。
- **共用 cache 保存**：一份 reference checkout，以及按來源／設定／工具版本建立的索引。
- **每個 consumer 保存**：指向同一份來源與索引的 pointer；不複製大型 checkout 或 graph。

本次來源為 Graphify 自身的 `graphify/` 子目錄及 newclear 的 `tools/codex-usage`，另有可逐條核對正確答案的 Python／TypeScript [fixtures](fixtures/README.md)。
外部來源不 vendor 入 Git；既有 `refs/` 索引規則保持適用。

## 啟動

需要 POSIX（Linux／macOS）、Python **3.12**、Git、`rg`（ripgrep）；不用 Docker、模型權重或 API key。

```sh
cd labs/graphify-lab
make setup PYTHON=python3.12
make prepare
make check
make full RUN_DIR=work/first-run
```

`setup` 以 `requirements.lock` 的版本與 SHA256 安裝正式 PyPI 套件 **`graphifyy`（兩個 y）**。
`prepare` 是明確的下載階段，只 fetch `references.lock.json` 中鎖定的公開 commit。
`full` 使用已準備的 source，執行 code-only 解析與本機 stdio MCP，不使用 LLM，也不執行被索引專案。

輸出目錄必須是新的。第二次可用 `RUN_DIR=work/second-run`；既有 run 不會被覆寫。
第一次建立索引，後續直接驗證重用；報告明示本次是否 cache hit，不把重用冒稱冷建置。

預設共用位置是 `$XDG_CACHE_HOME/newclear/graphify-lab`，未設 XDG 時為 `~/.cache/newclear/graphify-lab`。
**不同 repo checkout／agent 要使用同一個絕對 cache 路徑**：

```sh
export GRAPHIFY_LAB_CACHE="$HOME/.cache/newclear/graphify-lab"
make prepare
make full RUN_DIR=work/shared-run
```

也可逐次指定 `make prepare CACHE=/absolute/shared/cache` 與 `make full CACHE=/absolute/shared/cache RUN_DIR=work/run-2`。
受限執行環境可使用 `CACHE="$PWD/work/shared-cache"`；此時只在這個 checkout 範圍共用。
快取根目錄必須在被索引來源之外；run 與 cache 也必須分開。

## 日常參考代碼

以下命令都使用同一個預設共用 cache；可在 `-m graphify_lab` 後加 `--cache /absolute/path`。

```sh
# 取得來源、版本及 graph 的本機路徑；不存在時不會偷偷下載
.venv/bin/python -m graphify_lab locate graphify

# 同名符號用檔名限定；file_hash 在上游有兩個候選
.venv/bin/python -m graphify_lab query graphify 'cache.py::file_hash()' --context call --budget 1000
.venv/bin/python -m graphify_lab explain graphify cache_file_hash

# 精確讀回來源，不把整個 reference 塞進 context
.venv/bin/python -m graphify_lab source graphify 'file_hash()' --file cache.py --lines 20

# 常駐 stdio MCP；不開 HTTP port
.venv/bin/python -m graphify_lab serve graphify
```

MCP client 應將 `command` 設為此專案 `.venv/bin/python` 的絕對路徑，`cwd` 設為本專案，
`args` 設為 `['-m', 'graphify_lab', '--cache', '/absolute/shared/cache', 'serve', 'graphify']`。
啟動時先驗證 source/index；之後由真正的 Graphify MCP server 提供工具。
本次驗證 stdio protocol；沒有替使用者安裝全域 skill、改其他專案 agent 指令或配置遠端 Gateway。

增加參考倉時，在 `references.lock.json.references` 新增唯一 `name`、公開 HTTPS `url`、
40 位小寫 `commit`、相對 `subdir` 與授權來源，再執行 `prepare`。`locate/query/explain/source/serve` 可使用新名稱。
`full` 的固定驗收仍針對這次記錄的兩個真實專案；新增 reference 不會自動獲得驗收。

## 實跑的開發場景

| Case | 操作與 oracle |
| --- | --- |
| REF-01 | 固定 Graphify source 建圖，核對 `cache.py` 的 `file_hash()` 定義行；兩個 consumer 共用相同 source／graph inode，量測大小與重用成本。 |
| REPO-01 | 對真實 `tools/codex-usage` 建圖，查 `normalize_rates()`，回讀來源行；內容必須符合記錄的 baseline fingerprint。 |
| DEV-01 | 真 AST 建圖，query／explain／有向 path；核對 `checkout → submit_order → apply_discount` 與原始行號；無命中／反向路徑負例；原生 HTML export。 |
| DEV-02 | `affected --relation calls` 找到 caller、上層入口及測試呼叫位置，同時排除無關函式。 |
| DEV-03 | 冷建圖、不變重跑、五次 CLI／rg／MCP 量測；兩個真 MCP 程序完成握手、工具列舉、query、node、path 及重開。 |
| DEV-04 | 暫存副本中 rename，再 `update`；新符號出現、舊符號消失，未修改的呼叫鏈仍在。 |
| DEV-05 | TypeScript consumer／SDK 分別建圖再合併，補上唯一可解析的 typed member call；加入同名 receiver 後拒絕錯誤確定連邊。 |

`make check` 另驗證共用快取的 dirty／revision／origin／損壞／路徑／並行／設定失效邊界與 CLI 拒覆寫。
這些驗證用真 Git、真 Graphify；受控原始碼可以合成，沒有用預寫 graph 或 mock MCP 冒充成功。

## 產物與圖檢視

`work/<run>/report.json` 是清理本機絕對路徑後的完整報告；`consumer-a.json`／`consumer-b.json` 是本機 pointer，會含本機路徑，不提交。
`scenarios/` 留下可變 fixture、真 graph 與原始 MCP stderr；全都在 Git ignore 內。
原生 viewer 在：

```text
work/<run>/scenarios/graphs/python-shop/graphify-out/graph.html
```

可以在瀏覽器開啟。已驗 HTML 生成與嵌入節點／邊資料；它從 unpkg 載入 vis-network，
本次沒有把瀏覽器互動或 CDN 離線可用性算成已通過。`extract --code-only` 本身不自動產生此 HTML；runner 另外呼叫 `export html`。

## 怎麼解讀數據

- 冷建圖、source 驗證、index 重用、CLI 啟動、常駐 MCP 查詢分開量測。
- `rg` 是精確字串基準，Graphify 回傳關係鄰域；兩者答案與工作量不同。CLI 不一定更快。
- MCP 暖查詢是同一 query 重複命中，包含 stdio round trip，不含 server 啟動；不能外推任意新 query。
- `--budget` 是 soft budget。記錄的是 UTF-8 bytes，不是 tokenizer 實測，沒有宣稱節省多少 LLM tokens。
- 空間報告列 source、Git metadata、index、pointer 及獨立的 Python 環境大小。
- 1／2／5／10 consumer 的節省額是從實測 bytes **推算**，同時列「各自 source＋index」與「各自只有 source」兩種 baseline。
- 一個 consumer 增加 graph 會增加空間；避免多個任務各自複製，才是共用設計的收益。

## 已知限制與維護

source 使用 HEAD／origin／dirty 檢查維持不可變語意，沒有設成作業系統唯讀。
快取針對同一個可信使用者的 POSIX 檔案系統，鎖協調合作程序，不能抵抗另一個可寫該目錄的惡意程序。
修改固定 source、graph 損壞或 metadata 不符會明確拒絕；不自動 pull／覆蓋／刪除使用者資料。

索引 identity 綁定工具鏈、來源內容與解析設定；來源位置也是 key，因 Graphify 的來源定位／sidecar 依賴它。
上層忽略規則、Git tracked membership／HEAD、info/global excludes 也納入失效判斷。
對 JS／TS，若解析需要 scan source 外的設定或 `node_modules`，此薄包裝層會拒絕，要求改索引包含設定與來源的 project root；不自行重寫 Graphify resolver。
搬到另一條路徑或另一台主機後應重建 index；這次沒有實作遠端同步或多主機共享服務。
directory symlink 不支援，越界的 file symlink 拒絕。

靜態 calls 並不等於所有 runtime 路徑，`affected` 也不是完整 regression-test selector。
跨 repo 補邊僅對可解析 receiver type 的 member call；本次正例是 TypeScript，不是自動解析任意 HTTP 服務。
`path` 在節點存在但無路徑時仍可能 exit 0，runner 會檢查回答及實際邊，不能只看退出碼。

若一般沙箱的 MCP initialize 逾時，請檢查它是否允許 stdio 子程序／事件迴圈。此次相同原生 Graphify／MCP 在允許的執行環境成功，未修改上游或降級 SDK。
元件 CI 在根目錄 [graphify-lab-ci.yml](../../.github/workflows/graphify-lab-ci.yml)；另須通過 repo index／workflow gate。
