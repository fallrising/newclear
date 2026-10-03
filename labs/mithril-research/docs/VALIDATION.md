# Mithril 研究與計劃驗證記錄

## 四機使用計劃：MR-PLAN-20260927-01

日期：2026-09-27。本輪是文檔／GitHub 交付；沒有 SSH 登入四台機器，沒有安裝、啟動、壓測、故障注入、修改網路或清除資料。

### 來源與整合範圍

已全文讀取 M0 的 AGENTS、README、lock、RESEARCH、SDD、SOURCES、STATUS、VALIDATION、quickstart，以及對應 root policies；對輸出截斷的 RESEARCH 續讀。Root README／PORTFOLIO 與 policies 的已讀版本以當前 tree/blob 身分核對。另只讀 Eru HANDOFF 的前段作共用主機風險辨識，不宣稱完整 Eru 審計或現場盤點。

新增 FOUR-NODE-PLAN 與 EXECUTION_PROMPT，更新本項目 README／AGENTS／STATUS／quickstart／本檔。既有 RESEARCH、SDD、SOURCES、upstream.lock、單機 conf 保留；root README／PORTFOLIO 沿用 M0 PR #135 已審查的新增索引及 research-only override，沒有改動其他投資決策。

以目前 main 為基底保留其後續 Eru 等變更，並保留 M0 commit `16aded5982ba5fcca2242ca5134a2ae600a7fe56` 的歷史來源。不能以舊 M0 tree 覆蓋整個 main。實際 PR、head、merge 與 checks 狀態以 GitHub 交付紀錄為準，不在本文預先宣告合併。

### LOCAL-RUN：只驗證文件

本工作環境以 Python 3.13.5 執行靜態檢查：本輪七份 Markdown 的 UTF-8、末尾換行、無 trailing whitespace、fence 配對；相對引用對照本輪檔案及 GitHub 已確認路徑；來源 reference definitions／固定 Mithril commit；MR 任務 ID 唯一、依賴無環、狀態計數；初始 master/replica 跨主機配置與 data/bus port 對應。

人工內容覆核：四台有使用計劃但無身分／部署證據；跨機不能沿用 loopback/nopass；Redis 叢集與代理入口故障分開；fault 後 role drift 要重新核對；cache／replica／sharding 是獨立變因；H4 混部效能有限制；runtime 工具均標記待實作；down 保留資料、purge 單獨確認。這是本輪自審，不冒充獨立 reviewer 或多模型審查。

Shell 嘗試讀取公開 Git remote 因 DNS 無法解析 github.com 而失敗；GitHub connector 可讀寫並保留原始 tree/blobs。沒有因 shell clone 失敗而改寫研究來源或跳過 GitHub 讀取。

以上不是 Markdown renderer、外部連結全站爬取、設定 parser、Mithril build、原生 tests、Redis health、實機網路／ACL、故障、壓測或 soak 的 PASS。本輪未新增 harness／workflow；沒有適用 CI run 時應寫 NO APPLICABLE RUN，不寫 CI passed。

### 下一輪 evidence

MR-004 / P0 先完成真實目標映射、環境／保留清單與批准；P1 才鎖 runtime artifacts 並實作工具。功能、故障、效能仍全部 NO RESULT。未來每輪記錄 run ID、Git/upstream/artifact、匿名拓撲、命令、exit status、case/operation counts、結果分類、回復與限制；raw evidence／secrets 留私有位置。

## M0 歷史記錄（原始研究輪次，不當成本輪重跑）

日期：2026-09-27。範圍：原創研究文件、來源 lock、loopback 設定與 root 索引；不是 upstream runtime 驗收。

原 M0 記錄：Linux x86_64、Python 3.13.5；UTF-8／末尾換行／trailing whitespace、fence、相對連結、JSON pin、loopback 設定及 MR 任務計數已做靜態檢查。Root PORTFOLIO 修改前核對 blob `af673061f29dd29111c7540d342f3356b14bcbb9`，只加 A-tier 與 research override；root README 只加索引。M0 沒有修改其他 component、.team 或 workflow。

| M0 項目 | 當時紀錄 |
| --- | --- |
| shell git clone | FAILED：DNS 無法解析 github.com |
| Rust build/test/clippy/fmt | SKIPPED：當時無 cargo／rustc |
| Redis Cluster／Docker fixture | SKIPPED：當時無 Docker／redis-server／redis-cli |
| 上游 integration suite | NO RESULT；98-test 說法僅 UPSTREAM-CLAIM |
| RESP3／migration／cache／ACL／failover | NO RESULT；只有來源與待測契約 |
| benchmark／capacity／soak | NO RESULT |
| 真實 VPS／production | NOT ATTEMPTED |

M0 的環境限制不能外推成四台測試機都無法安裝，也不能把安裝預編譯 binary 說成必須先在四台裝 Rust。歷史 M0 與本輪文件成果均不支持 production readiness 判斷。
