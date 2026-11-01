# Mithril 研究與計劃驗證記錄

## P1f local durable intent：2026-10-17（develop-only）

新增獨立本機 journal，精確契約見 [P1-JOURNAL-CONTRACT](P1-JOURNAL-CONTRACT.md)。
沒有 dispatcher、resolution、phase advance 或實機操作；原有 scripts/tests/contracts
與兩份 locks 保持原樣。完整 P1／MR-004 仍未完成，正式計數4 DONE／1 BLOCKED_ENV／4 TODO。

### Actual offline evidence

- Native `gpt-6-astra` [T-017 design](../.team/reports/T-017.md) 的 D1–D7 經 root 凍結為 p1f-v1，native `gpt-6.1-sol` 才開始 T-018 tests-first 實作。沿用本 session2026-10-17 已核對的 exact model IDs／accepted route，未替換；provider-resolved identity／usage／quota／cost 未知。
- Root `t0333-root-reading01` 核對44份前輪完整閱讀輸入 byte-identical；`t0333-root-baseline01` 執行 `python3 -m unittest discover -s labs/mithril-research/tests -v`，Python3.13.5 原有 **133 tests**，exit0。
- T-017 `t0333-astra-design-audit01` 核對58項輸入；`t0333-astra-design-report02` validator／scope／privacy／whitespace 全部通過。report01 的 scope recorder 錯把 root 已配置的 PLAN/task 當成 worker 修改，exit1 保留；report02 對照起始 snapshot 修正檢查，沒有變更 D1–D7。

- [T-018 builder](../.team/reports/T-018.md) 的 `t0333-sol-red01` 保存 focused unittest 缺少新 module 的實際 exit1、完整 stdout/stderr/result。實作前已加入原始17 actions、process race／crash／late effect 與 persistence failure tests；這個 Red 本身不算行為通過。

- Root R1 發現新 lock inode 尚未 fsync 就建立 metadata binding；Astra 同意補強，契約明確更新為 p1f-v1.1。`t0333-sol-red02` 的23 methods 中兩項實際 assertion failures 重現缺少 lock-fsync／其失敗未阻止初始化，exit1 保留；修正後 `green03` **24 methods**、`full01` **157 tests** 通過。Green01 的6個 errors 是測試 sanitizer 誤讀 plan.run_id（正確在 ownership 下），已修正並保留原 logs，沒有隱藏為 PASS。
- Root `t0333-root-full01`：`python3 -m unittest discover -s labs/mithril-research/tests -v`，Python **3.13.5**、**157 tests**，exit0。Root 完整閱讀315行新 module、528行測試與所有文件 diff，檢查實際 Red／Green／R1 修正。
- Root `t0333-root-probe01`：獨立 **139 checks／8次實際 CLI calls**，exit0；覆蓋全部17 actions、同根永久阻擋重複記錄、malformed／partial／private modes、raw lexical aliases、strict indexes、新 subprocess timeout 後原子行程仍存活並產生晚到 mock effect。效果晚到前後 intent 都保持 uncertain，沒有重送。CLI 輸出通過 path／ID／digest privacy checks。
- Root `t0333-root-py311-01`：固定 `python@sha256:c3cd26fd6259ce667be208ab9c118463210a745ffc97e0e85af5121c10bc71c5`，Python **3.11.17**、network none、source read-only、nonroot／cap-drop／no-new-privileges；`make -C labs/mithril-research check` **157 tests** 與既有 `make -C labs/mithril-research demo DEMO_OUTPUT=PRIVATE_OUTPUT` 均 exit0。Demo **8 CLI calls／28 synthetic operations**，兩輪 process instance 重建、marker 保留，最後 synthetic resources／uncertainty 都0。這是本機測試容器，不是 Redis／Mithril service。

- Astra [T-019 independent review](../.team/reports/T-019.md) 的 `t0333-astra-review-full02` 通過 **157 tests**；`probe01`／`crash01`／`nested02` 合計 **5494 checks**，包含 **14次實際 CLI**、**6個實際 SIGKILL boundaries**、5354項 nested-input／retained-inode／R1檢查，均 exit0。普通 copied root 因 inode binding 拒絕；合法路徑搬移後同一 inode 的 uncertainty 仍保留。獨立 audit01 核對28個原有 scripts/tests/P1 contracts與guides/locks 不變。
- Reviewer full01 因 host 無 make，在測試啟動前失敗，原 traceback／空 recorder streams 與 failure-note 保留；full02 改跑 Makefile 的實際 unittest 命令。nested01 是 probe 等價性預檢未捕獲 canonical NaN 的 LabError，在 probe 的 NaN 等價性預檢中止，沒有完整結果；nested02 修正 probe 後通過。T-018 報告的 copied-root 描述依審查修得更精確，`t0333-sol-handoff02` 驗證單句差異、privacy／report 與 frozen hashes，程式未改。

- T-019 最終建議 **ACCEPT**，無剩餘 blocker。`t0333-astra-review-handoff02` 通過六個 task/report validators、20-file scope／privacy／UTF-8／whitespace、P1e PLAN archive、28個原檔與固定MR計數。handoff01 的簡單 privacy regex 誤把 slash-separated prose 當作 `/root/` 路徑；原失敗保留，修正 scanner 邊界後通過，產品與文件不需改動。

- Root `t0333-root-static01` 通過20檔 scope／privacy／UTF-8／whitespace／AST／新文件連結、六個 task/report validators、23個既有檔 byte comparison、P1e PLAN archive 與4/1/4計數。Root evidence gate 接受本有界 source；後續 GitHub 交付仍須正常完成。

### Evidence limits

Same-retained-root cooperative lock／intent fence 不能阻止另一個 root、同 UID rollback
或外部操作者。Process/mock 與故障注入測試只驗證本機順序和中斷，不是斷電耐久性
或真實遠端結果。No-intent 不能當作 absent／empty／healthy 或安全重試；任何回覆
遺失、timeout、重啟或晚到效果都不清除 uncertainty。部分 artifacts 保留並拒絕使用。

Authenticated live collection／freshness、階段前後與逐效果身分核對、精確獨立批准、
完整 startup／phase-aware executor／authenticated resolution、runtime image provenance、
有效 host/network/ACL、replication health／lag、實機保留資料 lifecycle、proxy smoke
與精確 purge 仍未驗收。Down 保留資料，purge 另須批准。未重跑歷史 native build、
Compose parser 或四機盤點。PR/main CI、merge／遠端回讀以後續 GitHub／帳本紀錄為準。

## P1e offline phase predicates：2026-10-17（develop-only）

新增獨立純離線五 barrier validator 與 validate-only private CLI；只讀原始
complete redis-collection，核對獨立 bundle／ownership／node-ID map 與指定
snapshot predicate。原有全部 scripts/tests/contracts 和兩份 locks 未修改。
沒有 collector invocation、phase advance、executor、startup 或新 journal。
實機 runtime 為 UNEXECUTED；完整 P1 未完成，MR-004 BLOCKED_ENV，
固定計數4 DONE／1 BLOCKED_ENV／4 TODO。

### Actual offline evidence

- Native `gpt-6-astra` [T-014 design](../.team/reports/T-014.md) 完成獨立設計，root 凍結 [p1e-v1](P1-PHASE-CONTRACT.md) 後，native `gpt-6.1-sol` 開始 tests／Red。沿用同 session2026-10-17 已核對的 exact model IDs 與 accepted P1c/P1d route，當前 catalog 仍提供兩模型；沒有替換，provider-resolved identity／usage／quota／cost 未知。
- Root `t0332-root-reading-audit01`：39份前輪完整閱讀輸入與 P1d source byte-identical；當前 root README、AGENTS、collector contract、T-011 及相關完整實作重讀。`t0332-root-baseline02`：Python3.13.5 原有112 tests 通過。baseline01 因 host 缺 make，在測試啟動前 exit1；recorder 未捕獲 startup exception 的完整 streams，traceback 留 tool transcript，另保存明確 failure note，未算 PASS。
- [T-015 builder](../.team/reports/T-015.md) 保存 Red01 缺 module 的實際 exit1，以及 Red02 三個實際 CLI failures：dot component、重複中間 slash、雙前導 slash 在初版被接受。Root R1 要求先重現再修正；新 reader 在開檔前要求原字串 normalized 與 single-root anchor。Green03 最終21 methods、Full01 **133 tests** 通過；原17／20 methods green 保留為修正前歷史。20個既有 scripts/tests/contracts/locks byte-identical。
- Root `t0332-root-full01`：`python3 -m unittest discover -s labs/mithril-research/tests -v`，Python **3.13.5**，**133 tests**，exit0。Root 已完整閱讀新 module/tests、R1修正與實際 Red/Green logs。
- Root `t0332-root-probe02`：另寫的 **60 checks／9次實際 CLI calls**，exit0。包括5x5 barrier discrimination、各階段 machine/container/process／partial拒絕、P1c持續拒絕中間狀態、非零 keyspace counters、API不呼叫 collection/socket/subprocess、CLI大於舊1MiB envelope、duplicate JSON、private modes、三種 path aliases、額外 execute flag 與 help。probe01 因 root probe 錯讀 manifest.run_id 而 KeyError，原失敗保留；修正的只是 probe，source 未改。
- Root `t0332-root-py311-01`：固定既有 `python@sha256:c3cd26fd6259ce667be208ab9c118463210a745ffc97e0e85af5121c10bc71c5`，Python **3.11.17**、network none、source read-only、nonroot/cap-drop/no-new-privileges；`make -C labs/mithril-research check` **133 tests**，`make -C labs/mithril-research demo DEMO_OUTPUT=PRIVATE_OUTPUT` 均 exit0。Demo實際 **8 CLI calls／28 synthetic operations**，兩輪 process instance重建、marker保留，最後synthetic resources／uncertainty都0。

- Astra [T-016 independent review](../.team/reports/T-016.md) 建議 ACCEPT，無 blocker：獨立 **133 tests**、**375 checks／30次實際 CLI** 通過；核對20個 baseline files、P1d PLAN archive、實際 Red/Green、root兩個 Python版本／demo／CLI證據與全部文件。三種 path aliases 由獨立 probes 再驗拒絕，public privacy檢查無私有路徑。

- Root `t0332-root-static01`：20個交付檔scope／privacy／新文件links／UTF-8／whitespace／AST、三task／三report validators、20個既有scripts/tests/contracts/locks byte comparison、P1d PLAN archive與固定MR計數均通過。

所有新 build/test/check 都經 common launcher、唯一 task IDs，明確保存
stdout/stderr/exit 與 artifacts/evidence；baseline01 recorder startup failure
的例外已如上標示。本機 Python 測試容器不是 Redis/Mithril service。
歷史 native121 tests／Clippy／fmt、Compose parser 與四機盤點沒有在本段重跑。

### Evidence limits

Predicate match只描述輸入 assertion，collection fingerprint只綁定原始內容。
Imported ssh origin不代表authenticated receipt；完整回應不代表freshness、
原子六節點狀態、空磁碟、loading／quiescence或健康。最終predicate保留合法
非空資料與既有P1c epoch規則，不能推定先前階段已執行。中間predicate不讓
P1c admission放寬，也不提供下一步或自動轉換。

Authenticated live collection／freshness、實機phase-aware validation、獨立精確
批准與逐效果身分重核、durable mutation intent／uncertainty、runtime/image/config/
storage/process-to-endpoint provenance、有效host/network/ACL、replication health/
lag、retained-data lifecycle、proxy smoke與獨立批准的精確purge仍未通過。
Timeout／lost reply不是遠端取消；既有uncertainty不被讀為授權或清除。
Down保留資料，purge另有條件。PR/main CI、merge與遠端回讀由後續GitHub／
帳本紀錄確認，不由本source snapshot預先宣告。

## P1d read-only collector：2026-10-17（develop-only）

本段新增獨立六節點唯讀 collector、固定 SSH helper 與 private CLI，
只以 offline／mock SSH／mock runtime 驗證。原有 P1c parser／pristine 或
already-converged admission、獨立 node-ID binding、中間狀態拒絕，以及
P1b down／purge／uncertainty 行為均未修改。Phase-aware validator 的獨立
predicates 已評估，但實作延後，沒有 phase advance、executor 或新 journal。
完整 P1 未完成；MR-004 保持 BLOCKED_ENV，4 DONE／1 BLOCKED_ENV／4 TODO。

### Actual offline evidence

- Native `gpt-6-astra` [T-011](../.team/reports/T-011.md) 完成設計審查，root 凍結 [p1d-v1](P1-COLLECTOR-CONTRACT.md) 後，native `gpt-6.1-sol` 才開始行為修改。兩個 exact model IDs 已按工具 catalog／官方頁核對，沒有替換；provider-resolved identity、usage/quota/cost 未知。
- Root `t0327-root-baseline01`：原有 **87 tests** 通過。`t0327-root-baseline-identity`：P1c 的 22 個交付檔在原 source、merge 與本輪 baseline byte-identical，確認 ancestry/trailer；兩份 locks 與固定 research pin 不變。
- [T-012 builder](../.team/reports/T-012.md) 保存 `t0327-sol-red01` 缺 module 的實際 exit 1，以及 `t0327-sol-red02` 重現 mapping 父目錄非私有仍被接受的實際 failure。修正後 `green03` **25** 新 methods、`full02` **112 tests** 通過；baseline 13 個 scripts/tests/locks byte-identical。中間 Green01 的 test injection seam 錯誤及 Audit01 的零檔選取錯誤保留，不能作 final acceptance。
- Root `t0327-root-full01`：`python3 -m unittest discover -s labs/mithril-research/tests -v`，Python **3.13.5**，**112 tests**，exit 0。Root 已逐段閱讀新 implementation/tests 與所有文件 diff。
- Root `t0327-root-probe01`：另寫的 **14 checks** 通過，包括六節點完整、最後一節點 malformed process 變 partial、保留私有 partial、status/map/order/admission/origin/process 偽造拒絕且不建立 output，以及 P1c 拒收 collection envelope。兩個實際 CLI subprocess 只以 Python wrapper 注入 mock Transport：complete exit 0、partial exit 2，stdout/stderr 通過 private identity／credential sentinel 檢查。
- Root `t0327-root-py311-01`：sandbox 拒絕 Docker socket，exit 1，未執行測試容器；失敗保留。核准後 `t0327-root-py311-02` 使用固定 `python@sha256:c3cd26fd6259ce667be208ab9c118463210a745ffc97e0e85af5121c10bc71c5`，Python **3.11.17**、network none、source read-only、nonroot/cap-drop/no-new-privileges。`make -C labs/mithril-research check` **112 tests** 與 `make -C labs/mithril-research demo DEMO_OUTPUT=PRIVATE_OUTPUT` 都 exit 0；demo 實際 **8 CLI calls／28 synthetic operations**，兩輪 process instance 重建、marker 保留，最後 synthetic resources／uncertainty 都為 0。

- Astra [T-013 final review](../.team/reports/T-013.md) 建議 ACCEPT：獨立 **112 tests** 與另寫的 **74 checks**（內含 5 次實際 CLI help/refusal calls）通過；核對原有 13 個 scripts/tests/locks、P1c PLAN archive、worker Red/Green 與 root Python 3.11／mocked CLI 實際 logs，沒有 behavior blocker。Root 發現 report 含私有絕對路徑，已在發表前去識別，handoff02 report／whitespace／privacy 檢查通過；原 handoff01 保留，已驗的 source hashes 不變。

- Root `t0327-root-static02` 通過 **21-file** scope/privacy/link/UTF-8/whitespace/Python AST 檢查、三 task／三 report validators、16 個既有 implementation/tests/locks/contracts 的 byte comparison、P1c PLAN archive 與固定 MR 計數。前一個 static01 因 task validator 要求保留 unchecked assignment checklist 而停止；已恢復 task 格式，完成狀態記於 reports／PLAN，原失敗保留。

所有新 build/test/check 均經 common workspace launcher，使用唯一 task ID，
分別保存完整 stdout/stderr、exit、artifacts/evidence。Python 測試容器只是
本機隔離測試；沒有啟動 Redis/Mithril service。歷史 upstream 121 tests、
Clippy/fmt、Compose parser 與私有四機盤點沒有在本段重跑。

### Evidence limits

Complete 僅表示固定回應 framing、原始 parser 與獨立輸入 binding 通過，
不是健康、空磁碟、freshness、原子六節點 snapshot、phase admission 或授權。
每節點一次嘗試；unknown/null 不代表 absent/empty/healthy。Timeout 或本機
SSH process-group cleanup 不代表遠端取消，現有 uncertainty journal 不會被清除。
Mock origin 保留；輸入 collection 仍是 assertion，不是簽章或實機 receipt。

實機 authenticated collection/freshness、half-close 相容性、process-to-endpoint
及 image/config/storage provenance、loading/quiescence、有效 host/network/ACL、
replication health/lag、retained-data lifecycle、proxy smoke，以及獨立批准的
精確 purge 都尚未通過。Startup/upload/create/up、phase-aware validation／
execution 與 durable uncertainty fencing 仍缺。PR/main CI、merge 與遠端回讀
由後續 GitHub／帳本紀錄確認，不由本 source snapshot 預先宣告。

## P1c bootstrap tools：2026-10-17（develop-only）

新增 Python stdlib 六節點觀察 parser／topology validator、獨立 node ID map
binding、四階段 bootstrap proposal 與 private plan/validate CLI。`offline-snapshot`
的 origin 保留 synthetic／operator-supplied 宣告；本輪實際測例全為 synthetic，
結果 lane 為 offline-bootstrap。沒有 collector、SSH／Redis 連線或 phase executor，
未啟動 Redis/Mithril、寫入 VPS、改網路、purge、release 或 publication。
完整 P1 未完成，MR-004 保持 BLOCKED_ENV，4 DONE／1 BLOCKED_ENV／4 TODO。

### Actual offline evidence

- Native `gpt-6-astra` [T-008 design review](../.team/reports/T-008.md) 先審 exact schema、獨立 node identity、epoch／slot／replica 規則、private output 和 conditional barriers；root 凍結 [contract](P1-BOOTSTRAP-CONTRACT.md) 後，native `gpt-6.1-sol` 才修改 behavior。Exact model IDs 未替換；usage/quota/cost 未知。
- Root `t0320-reading-audit`：29 份 required-reading inputs 與本對話已全文讀取的 P1b source byte-identical；本輪相關契約、STATUS、VALIDATION、四機計劃與 execution prompt 再次全文讀取。Root `t0320-root-baseline`：原有 70 tests 通過。
- [T-009 builder](../.team/reports/T-009.md) `t0320-sol-red01`：先有測試，缺 bootstrap module 的實際 exit 1 保留；初輪 Green01 為 15 methods。追加邊界測試的 Red02 實際重現五個 malformed output-path TypeErrors，修正後 Green02 的 17 methods 通過。Full01 共 87 tests 通過。Red logs 沒有被覆寫為成功結果。
- Root `t0320-root-full01`：`python3 -m unittest discover -s labs/mithril-research/tests -v`，Python 3.13.5，**87 tests**，exit 0。既有 70 methods、labctl/bundle/SSH helper/controller 與兩份 locks 均保留。
- Root `t0320-root-cli01`：獨立撰寫的 Python probe 實際呼叫 bootstrap CLI **7 次**，pristine 17 actions／converged 0 actions 各產生與獨立 digest reload 成功；重算 hash 後移除 barrier、slot gap、六節點一致換 ID 均以 exit 2 拒絕。後兩項未建立 output；所有輸出經 synthetic identity/path sentinel 檢查，stderr 空。Raw proposals/receipts 留私有 evidence。
- Root `t0320-root-py311-01` 首次 Docker socket 存取被 sandbox 拒絕，exit 1，未執行 Python 容器；失敗記錄保留。相同有界 local-test 透過核准執行的 `t0320-root-py311-02`，固定 `python@sha256:c3cd26fd6259ce667be208ab9c118463210a745ffc97e0e85af5121c10bc71c5`，Python **3.11.17**、network none、source read-only、nonroot/cap-drop/no-new-privileges，`make -C labs/mithril-research check` **87 tests** 及 `make ... demo` 均 exit 0。Demo 實際為 8 CLI calls／28 synthetic operations，兩輪重建 process instance、marker 保留、最後 resources/uncertainty 皆為 0。

- Astra [T-010 final review](../.team/reports/T-010.md) ACCEPT：獨立完整 **87 tests**、另寫的 **48 probes**（含 9 次 CLI）通過；核對 source identities、Red/Green、root Python3.11／CLI logs 及所有文件，無 blocking findings。Root `t0320-root-static01` 的 21-file scope/privacy/link/whitespace/Python syntax、三 task／兩 report validators、P1b PLAN byte-exact archive 與 MR counts 均通過；最終 acceptance gate 另核對新增 review report 與收尾文件。

以上每個新 check 均經 common workspace launcher、使用唯一 task ID，明確保存
stdout/stderr、exit 和 artifacts。固定 Python 容器只執行測試／synthetic demo，
不是 Redis/Mithril service。Root 沒有重跑歷史 native 121 tests、Clippy/fmt，
也沒有重跑 Compose parser；下方 P1b/P1a 的結果保持歷史分類。

### Evidence limits

Imported snapshots、container/labels／machine identity 與獨立 node map 仍是宣告，
不證明真實 collection、freshness、storage ownership、loading 或 quiescence。
Already-converged 只描述給定拓撲，沒有 replication-link／lag 或 live-health
驗收。四階段 barriers 為未實作的 live gates，不能由 plan hash 解除。
Collector、startup/upload/create/up、phase-aware execution／uncertainty journal、
Mithril runtime image provenance、有效 ACL/network、retained-data lifecycle、
proxy smoke 及獨立批准的 purge 仍待完成。PR/main CI、merge 和遠端回讀以
後續 GitHub／帳本紀錄為準，不由本 source snapshot 預先宣告。

## P1b tools：2026-10-15–17（develop-only）

這段交付 private four-host Compose/auth bundle、固定 SSH observe/stop/remove
helper、帶持久 intent 的 down/reconcile 與 purge preview。沒有實際 SSH 呼叫、
VPS 寫入、Redis/Mithril 啟動、網路變更、purge、release 或 image publication。
`local-fixture`、`offline-bundle`、`mock-ssh` 分開記錄；實機 runtime 為 UNEXECUTED。
固定 research commit 與兩份 locks 未變，完整 P1／MR-004 未完成。

### Actual offline evidence

- Native `gpt-6.1-sol` builders 與 `gpt-6-astra` 獨立設計／最終審查；模型 IDs 在規劃時按當前工具 catalog 與官方頁核對，無模型替換。Root 獨占 PLAN、整合、驗收與交付。完整 usage、quota 與費用未知，不推算數字。
- [T-004](../.team/reports/T-004.md) 的 D1–D5 先固定 bundle/schema、inline Mithril secrets、literal helper、authoritative absence、durable uncertainty 與獨立批准邊界，之後才分派兩個隔離 writer。
- [Bundle worker](../.team/reports/T-005.md)：實際 Red01/Red02 及 Green03，15 methods 通過。兩次真 CLI 產生 resolved synthetic 與 unresolved draft 私有配置；秘密及其 hashes 不出現在 summary／manifest。Credential injection、private output、link/traversal、semantic binding 與 nonrunnable H4 draft 皆有負向測試。
- [Transport worker](../.team/reports/T-006.md)：初輪 Red01–Red06 保留；Green03 的 30 methods 通過，包括 real subprocess mock、bounded pipes、deadline/lost reply、identity/ownership drift、private state、fixed argv、SSH mapping hook/token refusal 與保留資料。Report validator 的格式失敗保留並修正；沒有將失敗覆寫為 PASS。
- Root `t0310-root-baseline`：本輪起始 22 tests 通過。整合初版 `t0310-root-full01` 在 Python 3.13.5 通過 67 tests；`t0310-root-py311-01` 在既有固定 Python 3.11.17 image 以無網路、唯讀 source、非 root 及私有 disk-backed outputs 跑 `make check`（67 tests）與 `make demo`，均 exit 0。這些是修正獨立審查 finding 前的歷史 green，不能作最終驗收。
- Root `t0310-compose-parse01`：對保存的 synthetic CLI 產物執行 `docker compose -f FILE config --quiet`，resolved H1–H4 及 draft H1–H3 共 7 份 exit 0；draft H4 的 services 為空。只解析配置，未啟動任何服務，也沒有驗證 Redis/Mithril ACL 效力。
- [Independent T-007](../.team/reports/T-007.md) 初輪 67 tests 通過，但 `t0310-review-late-effect01` 的真實本機 subprocess 重現 R1：timeout 後目前狀態未變仍可有延遲效果，不能把 intent 判成 abandoned。R2 指出歷史 journal 接受 UNRESOLVED approval reference。兩項回交 Sol 先加 Red 再修正；原 probe 和初版 review 保留於 protected evidence。

- R1/R2 rework 的實際 Red02 有 10 個 assertion failures；Green01 修正後 33 transport methods 通過。對 stop/running、remove/stopped 保留 uncertain，即使新 admission 也不發出第二次效果；拒絕 abandoned journal 與 UNRESOLVED 歷史 reference。詳見更新後 T-006。
- Root 最終 `t0310-root-full02`：Python 3.13.5，完整 **70 tests**，exit 0。`t0310-root-py311-03`：固定 Python **3.11.17**，`make -C labs/mithril-research check`（70 tests）及 `make -C labs/mithril-research demo DEMO_OUTPUT=PRIVATE_OUTPUT` 均 exit 0。Demo 為 8 個 CLI subprocess／28 個 synthetic operations，兩輪 process instances 重建、marker 保留，最後 synthetic resources／uncertainty 皆為 0。中間 `t0310-root-py311-02` 的呼叫被中斷，沒有完成結果；未計為 PASS。
- Root `t0310-root-preview-cli01`：實際 `ssh_executor.py purge-preview` CLI 對 synthetic private manifest／ownership 執行，exit 0；六個 data candidates、零 eligible paths、apply=false，stdout 無原始位置。私有 API preview digest 一致；獨立 approval assertion 仍回傳 authenticated_authority=false／無 eligibility 或 apply。沒有遠端呼叫。
- Astra 最終 [T-007](../.team/reports/T-007.md) ACCEPT：獨立完整 70 tests、另寫的 delayed stop/remove subprocess probes，以及 12 個 malformed-journal action cases 全通過，R1/R2 已解決。Root `t0310-root-acceptance01` 通過 30-file scope/privacy／文件靜態檢查、四 task／四 report validators 與 `git diff --check`；locks、既有 fixture 和 P1a PLAN archive 未變。Reviewer audit-script 的中間失敗及修正亦保留於 report。

全部新 build/test/check 均經 common workspace launcher，以唯一 task IDs 保存
logs／artifacts／handoffs；公開只含去識別摘要。這輪未重跑 P1a 的 release build、
121 upstream tests、Clippy／fmt；下段歷史結果不當作本輪執行。

### Evidence limits

Compose parser 與固定來源 config/ACL command-table 檢查只支持結構／來源相容性，
不支持 listener、runtime ACL、image entrypoint 或容器 UID/GID 可讀性。Purge
approval API 只核對獨立 digest 與 assertion shape，永遠回傳空 eligibility／無
apply；不是 live filesystem/reference/process-use 或 semantic eligibility validator。
尚缺 Mithril runtime-image provenance、完整 startup／cluster orchestration、有效
host/network admission、實機兩輪 lifecycle 與另行批准的精確清理。MR 表保持
4 DONE、1 BLOCKED_ENV、4 TODO。PR/CI/merge 與遠端回讀結果以 GitHub 及後續
帳本報告為準，不由本 source snapshot 提前宣告。

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

P1a 當時缺 thin SSH executor、per-host Compose/auth／purge；P1b 的進度見上段。完整 P0/P1、P2/P3、C01–C13、real backend health、runtime ACL、migration/failover/cache、fair benchmark 全部尚未 PASS。MR 表仍 4 DONE、1 BLOCKED_ENV、4 TODO／未完成 5。下方 2026-09-27 是原始歷史，不作本輪重跑。

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
