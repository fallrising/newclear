# Mithril 研究與計劃驗證記錄

## P1a local/native core：2026-10-15

本輪限 develop-only 的第一個本機段落，source pin 不變。工具不呼叫 SSH／Docker，所有 fixture result 標成 local-fixture／remote_execution_supported=false；沒有四機 Redis/Mithril 啟動、故障、網路變更或清理。完整 P1 與 MR-004 仍未完成。

### Actual local evidence

- Strict JSON／inventory／artifact／plan、semantic reload、independent digest、dirfd/no-follow private state、lock、operation intent／uncertain reconciliation、foreign/unknown refusal 及保留資料／node ID 的 synthetic lifecycle 已實作。
- Worker Red、Red02、Red03 在實作／修正前實際失敗；最後 Green05 的 18 項 test methods 通過，含 CLI subprocess 與六個 create/remove 故障窗口。詳見 [builder report](../.team/reports/T-002.md)。
- Root 初次在 Python 3.13.5 重跑 18 項 tests 並執行真 CLI demo。主機沒有 make；兩個 local Makefile 呼叫因缺工具失敗，沒有把它們寫成 PASS。隨後用固定 Python 3.11 image、無網路／唯讀 source 與 disk-backed private outputs 跑 `make check` 和 `make demo`，均 exit 0。
- 最終獨立審查發現 demo 的 `..` 路徑可先寫入 source 再被 fixture 拒絕。Root 加入四項 demo 回歸；Red 階段實際重現 traversal failure 與缺 acceptance assertion，修正後 focused Green 四項通過。輸出先拒絕 traversal，再以 no-follow directory handles 建立私有目錄／檔案；demo 明確檢查 smoke、owned observation、zero resources／uncertainty。原始失敗保留於 protected evidence；更新後 Root Python 3.13.5 與固定 Python 3.11.17 均通過完整 22 項，Python 3.11 demo 通過。独立複審也重跑 22 項及 demo，結果見 [final review](../.team/reports/T-003.md)。
- Demo 實際呼叫 8 個 CLI subprocess，28 個 recorded synthetic operations，兩輪重建 process instances、marker 保留，最後 owned synthetic resource／uncertain intent 數皆為 0。這不是實機資料持久化、Redis ACL 或 socket/RESP acceptance。
- Registry 查核固定 Redis 7.4.11 amd64 manifest，尚未啟動該 runtime。研究 source 在固定 Rust 1.98.0 隔離 builder 完成 release、121 upstream unit tests、Clippy、fmt、binary version 與 SHA256。原 base 缺 lint/format components、implicit rustup sync 嘗試写入唯讀 image 的兩次失敗均保留；第三次完整通過。見 [native evidence](evidence/native-build-2026-10-15.json)／[runtime lock](../runtime.lock.json)。
- 原 v0.1.7 tag dereference 為 fed12518c4183aebd102a02a41b9073cd23e1b85，與研究 commit 不同；未拿它替換 source pin，也未发布 binary/image。

Native原始 logs/binary 与 private inventory/CLI receipts 留 common launcher protected evidence/artifacts；公开只保留去識別摘要、精確 hashes 和 task IDs。Private P0 證據有四台 SSH metadata 与 12 方向 Tailscale transport 探測；transport 成功不证明服务 TCP admission／有效 tailnet ACL，provider rescue 和共享資源保留仍须核对。

Independent T-001 design review 指出 scope、operation identity/recovery、semantic validation 与 private paths 四项問題，已在 [P1 contract](P1-CONTRACT.md) 修正後才分派 implementation。最終 review、PR／CI／merge facts 以对应 report／GitHub 紀錄為準，不由本文推定。

### Remaining gates

Thin SSH executor、per-host Compose/auth／purge 尚未交付；完整 P0/P1、P2/P3、C01–C13、real backend health、runtime ACL、migration/failover/cache、fair benchmark 全部尚未 PASS。MR 表仍 4 DONE、1 BLOCKED_ENV、4 TODO／未完成 5。下方 2026-09-27 是原始歷史，不作本輪重跑。

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
