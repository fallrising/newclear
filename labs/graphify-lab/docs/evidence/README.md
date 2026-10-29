# Graphify lab 執行證據

## 已驗證版本與結果

- Runtime commit：`011fa8cac6137735b576e14b5695ea26544e91db`（遠端工作分支已回讀）。
- 執行時間：`2026-10-29T13:59:37.151591+00:00`；Python `3.12.14`、Graphify `0.9.97`、MCP `2.3.0`。
- [完整原始報告](full-run.json)：**7 passed，0 failed**；[邊界測試](unit-tests.txt)：**29 passed**。
- 報告包含 14 份 runtime／lock／fixture 的 SHA256，已與凍結的程式碼逐一核對。
- 已安裝 package 的六個核心檔（CLI、cache、serve、extract、cross-repo 等）與固定 upstream SHA `0a8cd4e1e342235fe53e881fb5d591bf0460071f` 完全一致；不將整個套件所有檔案都宣稱已逐檔比較。
- [獨立審查](review.md) 記錄發現、修正及接受範圍。

## 重跑命令

在 `labs/graphify-lab`：

```sh
make setup PYTHON=python3.12
make check
make prepare CACHE="$PWD/work/fresh-cache"
make full CACHE="$PWD/work/fresh-cache" RUN_DIR=work/fresh-run
```

這次正式報告使用乾淨的 `work/final-cache` 與 `work/final-run`，確保第一個 index 是 cold、第二個 consumer 是 warm。
日常使用改用 README 的全域共用預設；新環境須先 prepare。每次 RUN_DIR 必須不同。

## 真實 source 與圖

| 目標 | 節點 | 邊 | 首次建圖／開啟 |
| --- | ---: | ---: | ---: |
| Graphify 自身 `graphify/` | 3,925 | 8,915 | 9.361 秒 |
| newclear `tools/codex-usage` | 222 | 550 | 1.978 秒 |

Graphify 的 `cache.py::file_hash()` 與既有元件的 `normalize_rates()` 均以 graph 行號回讀定義驗證。
來源完整 SHA／內容 fingerprint、精確 blob URL 及圖雜湊在 JSON 中。

第二個 consumer：source 驗證 **0.029613 秒**，index 驗證／重用 **0.173753 秒**。
兩份 pointer 指向相同 source 與 graph inode；實際有一個該 revision 的 source entry。Warm 仍計入內容與設定完整性驗證，不是只查檔案是否存在。

## 空間：觀測與推算

這裡使用十進位 MB（1 MB = 1,000,000 bytes），是 logical regular-file bytes，不是 allocated filesystem blocks。

| 實測項目 | Bytes | MB |
| --- | ---: | ---: |
| 完整 reference checkout，不含 Git metadata | 30,138,739 | 30.139 |
| Git metadata（depth-1 fetch） | 13,319,778 | 13.320 |
| Source cache metadata | 119 | 0.000119 |
| 針對 `graphify/` 的 index directory，含 graph／parser cache／sidecars | 11,597,290 | 11.597 |
| 每個 consumer pointer | 633 | 0.000633 |
| 共用 Python 環境，另列、未混入下面兩種 baseline | 208,708,600 | 208.709 |

以下是由上述 bytes 計算的模型，**沒有真的建立十份 checkout**：

| Consumers | 各自 source＋index（MB） | 共用 source＋index＋pointers（MB） | 同等架構節省比例 | 相對各自僅 source 的節省額（MB） |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 55.056 | 55.057 | -0.001% | -11.598 |
| 2 | 110.112 | 55.057 | 49.999% | 31.860 |
| 5 | 275.280 | 55.059 | 79.999% | 162.233 |
| 10 | 550.559 | 55.062 | 89.999% | 379.523 |

單一 consumer 的 graph 是額外成本；共用的收益來自避免重複 source/index。
Python 環境是共同成本，不能在 baseline 重複算十份來誇大節省。這個模型只包含當前 reference revision／設定的一個 index；保留其他 revision 或舊設定索引會另外佔空間。

## 查詢時間的不同含義

下列是 11-node／16-edge Python fixture，每種五次觀測的中位數；完整樣本在 JSON。

| 路徑 | 中位數 | 計入的成本 |
| --- | ---: | --- |
| Graphify CLI query | 317.928 ms | Python 啟動、圖讀取及關係鄰域回傳 |
| `rg` exact search | 9.099 ms | 程序啟動與精確匹配文字行 |
| 常駐 MCP 重複 query | 2.898 ms | 同 query 暖命中與 stdio round trip，不含 server 啟動 |

小 fixture 冷建圖 **1.002195 秒**，原生 unchanged 重跑 **1.212332 秒**；後者此輪沒有比前者快，啟動與檢查開銷仍在。
CLI、rg 與 MCP 的輸出內容、是否常駐、cache 狀態不同，這不是同一工作量的速度排名。
沒有測 LLM 端到端任務時間、回答品質或 tokenizer 成本，也不引用上游 Cloud 的 token 節省宣稱。

## 回歸、失敗與限制

1. 審查找到 ancestor ignore 變更可能誤用 index：已納入 ignore/config、Git HEAD／tracked membership、info/global excludes，前後重驗。新真 Graphify regression 及最終 full 全過。
2. 子程序改以 `python -I` 啟動，清除 ambient Graphify override；未觀察到 reference 執行，但防止其他環境 shadow 已鎖 package。
3. 最初一般沙箱的 MCP initialize timeout；相同原生版本在允許 stdio 子程序的執行環境通過兩次 session。沒有 patch 上游、降級 SDK、使用 handler mock，或啟動網路服務。
4. `path` 無有向路徑仍可能 exit 0；runner 同時檢查訊息與實際 calls oracle。`query --budget` 是 soft budget。
5. 跨 repo 正例為 TypeScript typed member call；重複 receiver type 會拒絕確定連邊。不代表 Python 跨 repo 或任意 HTTP 介面解析已驗證。
6. Native HTML export 的 embedded graph 通過；viewer 使用 unpkg vis-network，瀏覽器互動／CDN 離線可用性未驗證。
7. 所有 source 是公開或合成；報告已清理本機路徑。fixtures 的 SHA256 是權威來源版本，不以外層 Git HEAD 代替 fixture 內容。

## GitHub CI

Runtime commit 的四項檢查已回讀成功：

- [Graphify lab CI](https://github.com/fallrising/newclear/actions/runs/40886993908)：從乾淨 runner 安裝 hash lock，跑邊界測試、fetch pin、真 CLI／MCP 場景。
- [Workflow static validation](https://github.com/fallrising/newclear/actions/runs/40886993963)。
- [Project success contracts](https://github.com/fallrising/newclear/actions/runs/40886994002)。
- [llms.txt CI](https://github.com/fallrising/newclear/actions/runs/40886993795)。

後續 commit 僅補本證據／索引／狀態文件；最新 PR head 的 CI 以 [PR #759](https://github.com/fallrising/newclear/pull/759) Checks 為準。
