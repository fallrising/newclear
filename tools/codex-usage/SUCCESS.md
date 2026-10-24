---
project: tools/codex-usage
purpose: 統一唯讀查詢多工具額度與使用狀態並保留 Codex 採集相容性
kind: tool
mainline: incomplete
usable_tag: none
reviewed: 2026-10-23
source_commit: b7f2a4311d1135977ba273efba8e77702b908036
---

# Agent Usage / codex-usage 成功契約

> 最新授權：owner 已要求提交程式並合併 PR。本文件下方「未授權／未提交／CI未跑」屬前階段紀錄；
> 本次交付狀態以文末 T-0975 為準。未授權 release/tag/deploy，原 live 缺口不變。

## 主線與範圍

以下原 Codex collector 範圍及 AC-01–04 保留；多來源入口依下方 M2 擴充，兩者不互相取代。

Owner 已啟動 [START_DEVELOPMENT_PROMPT](START_DEVELOPMENT_PROMPT.md)，恢復主線；舊 documentation-only 限制屬歷史任務。
[README](README.md) 限單次、短生命週期、唯讀採集：初始化後僅查 account/read、account/rateLimits/read、account/usage/read，最後重驗身份。
不建立 thread 或 model turn；不解析 auth files。email 僅本地比對；指定 workspace ID 而無官方可驗欄位時 fail closed。
部分失敗保留 JSON，缺值為 null；cycle_tokens 不以百分比或日／累計 tokens 推算，來源時間不以採集時間代替。
排程、SQLite、通知、多帳號、login/logout、私有端點與 API Platform usage 替代都不在範圍。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given collector source，When 核對 RPC 與輸出契約，Then 只有固定唯讀方法且 cycle_tokens 不以百分比推算。 | passed | 原始碼審查；fake CLI 驗完整方法順序與參數、身份失敗清除資料；[本次證據](docs/evidence/2026-10-23-verification.json)。只代表離線契約。 |
| AC-02 | Given 缺值、重複 bucket、身份不符或 CLI 缺失，When 離線測試，Then null／partial／fail-closed 符合契約。 | passed | 原 seed 17 tests；新增回歸先 RED，再 GREEN；root 重跑 33 tests、編譯通過。[回歸](tests/test_regressions.py)、[證據](docs/evidence/2026-10-23-verification.json)。 |
| AC-03 | Given 目標 CLI 已登入指定 ChatGPT 帳號，When 真 App Server 採集，Then account 與 method/schema 匹配並產生去識別 snapshot。 | passed | Owner 已指定 repo 外 target；CLI 0.163.0 真採集 exit 0，前後帳號比對通過、account/rate_limits/usage 皆 ok。[去識別 snapshot](docs/evidence/2026-10-23-live-snapshot.json)、[receipt](docs/evidence/2026-10-23-live-receipt.json)。workspace 按設定使用 current CLI workspace，未聲稱獨立驗證 workspace ID。 |
| AC-04 | Given 真 snapshot 與使用者可見 usage/status，When 比較各 window 與重置，Then 語意一致且缺 cycle 對齊 token 仍 null。 | pending | 已有真 snapshot，但缺同帳號可見讀值／時間／timezone；[quickstart](docs/quickstart.md#comparing-the-visible-usagestatus-view) 提供對照流程。mock 不能代替。 |

狀態維持 **offline-tested / live-collected / visible-status-unverified**。原定 AC 均保留；文件、離線實作、真驗收、CI、合併與部署分開計算。
任務板：[docs/tasks/BOARD.md](docs/tasks/BOARD.md)。未合併前不將任務列標 done。

## 現況與缺口

本次修正未知／錯誤 schema 誤報成功、target/options／process/protocol 失敗 traceback，以及最後身份驗證失敗仍保留資料的問題。
只解析 primary/secondary quota windows；依本機 schema 驗 usedPercent int32，保留正確的部分資料，無支持欄位為 null／partial。
合法空 summary 與 nullable metrics 不當成零；timeout 限有限正數、最多 120 秒；target 限 64 KiB 一般檔案。
原始碼由壓縮寫法整理為可審查函式，仍只用 Python 標準函式庫。

## 啟動與驗證

依 [quickstart](docs/quickstart.md) 指定 target／CLI 後執行單次採集。
本次執行（透過共用 workspace launcher；去識別日誌索引見證據文件）：

- `python3 -m unittest discover -s tests -v`：原 seed 17 PASS。早期 prototype 的 51 tests 僅屬歷史，不計入本次。
- 第一輪 RED：28 tests、24 failing subtests 與 2 errors；schema RED：32 tests、3 failures，均保留實際失敗日誌，修正後才重跑。獨立審查另發現 leader 先退出會留下 descendant，root 補 33 tests／1 failure RED，再修到 33 PASS；同 reviewer 重驗 ACCEPT。
- `python3 -W error::ResourceWarning -m unittest discover -s tests -v`：root 33 PASS，exit 0。
- `python3 -m py_compile codex_usage.py`：exit 0；`ast.parse(..., feature_version=(3,11))` 通過語法檢查。
- `codex --version`：0.163.0；`codex login status`：exit 0，僅保留 ChatGPT login 分類，不輸出／保存身份與憑證。
- `codex app-server generate-json-schema --out <workspace-build>/stable` 及加 `--experimental` 的產生均 exit 0；只核對本機 protocol 支援。
- `python3 scripts/check_project_success.py`：41 contracts PASS；`git diff --check -- .`：元件 scope PASS。

實測 interpreter 為 Python 3.13.5；沒有 Python 3.11 runtime 實測，語法檢查不代替它。
[來源 hashes 與 root 命令結果](docs/evidence/2026-10-23-verification.json) 對應本次未提交來源；frontmatter SHA 是起始主線版本。
獨立審查結果及收尾證據見 [本次報告](docs/evidence/2026-10-23-report.md)。
歷史離線交付保留於 [346 report](../../archive/tools/codex-usage/tasks/346-offline-evidence/report.md)，其 CI 不代表本次 CI。

## 剩餘缺口與下一步

1. 已完成：owner 提供私人 target，expected_email 由 owner 指定，use_current_cli_workspace=true；檔案內容與路徑不寫入公開證據。
2. 已完成：以該 target 單次真採集，exit 0；原始 stdout 僅保留 repo 外受限證據，公開 snapshot 移除 bucket 名稱並以序號取代 bucket ID。初次沙箱執行 process_stdout_closed／exit 1，核准沙箱外重試成功；兩次結果均保留。
3. 用同帳號可見 usage/status、UTC 讀值時間與 timezone 比較 bucket/window/reset；cycle_tokens 沒有完整對齊來源仍 null，完成 AC-04。
4. 本次未授權 commit/push/PR/merge/tag；hosted CI 未跑，未合併、未部署。完整主線及必要審查/CI/合併前保持 usable_tag: none。

本次使用本機已登入 CLI，無 VPS 或服務啟停。真採集時間為 2026-10-22T18:30:44Z；週窗口剩餘 87%，重置 2026-10-29T17:10:45Z，cycle_tokens=null。這些是 snapshot 讀值，尚未與畫面比對。

[Live follow-up report](docs/evidence/2026-10-23-live-report.md) 記錄本次實際命令與驗證；33 項離線測試的來源 hashes 未改變，無需因純證據／文件更新重跑 runtime suite。本次元件 contract／文件檢查通過；全庫 project-success 因另一個正在修改的 labs/zircon-godot AC 表格格式失敗，未改動該專案；[檢查結果](docs/evidence/2026-10-23-live-checks.json) 保留此失敗。

## 可用版本

`usable_tag: none`。需 AC-01–04、必要 CI／審查及合併證據齊備，另獲 tag 授權後才能建立可用版本；本次無發布或部署。

## M2 — Agent Usage 統一查詢（owner 2026-10-23 直接授權）

Owner 要求接入多工具並合併重複項目。本次將統一入口集中在本元件 `agent_usage.py`，重用既有 Codex collector 與 cc-quota SQLite 快照，不複製採集器、不新增第三個工具專案。舊 CLI、SQLite、launchd／通知與所有未驗 AC 保留。共用提案 `docs/specs/quota-signal.md` 依此更新；其舊狀態不限制本次 owner 指示。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AU-01 | Given 已設定來源，When 統一 snapshot，Then JSON／文字表格分清訂閱額度、API 支出、本機統計，單一失敗不丟其他結果。 | passed | root 63 tests（含 30 項新測試）；6 項 CLI smoke；統一 Codex／OpenCode 真讀取 exit 0。[M2 證據](docs/evidence/2026-10-23-agent-usage-verification.json)。 |
| AU-02 | Given Codex 與 Claude，When 接入既有 collector／readonly DB 或官方 statusline，Then 不重做 credential handling、不寫既有 DB，不觸發模型。 | passed | 重用 collector；Claude DB readonly hash、statusline whitelist/0600 與無模型流程測試通過。Codex 真身份通過；Claude 真來源仍未提供，未宣稱 live 通過。 |
| AU-03 | Given OpenCode Go、Grok、Cursor、Grok Bot、Antigravity，When 查詢各來源，Then 只支援可驗證的官方／本機讀取，未支援即 unknown；人工讀值明示 manual。 | passed | 七 provider registry 與來源限制完整；OpenCode 真本機 stats 通過（不是 Go 額度），Cursor mock transport 通過；Grok／Grok Bot／Antigravity 僅 manual，不宣稱自動額度接入。 |
| AU-04 | Given 過期／畸形來源與共享額度，When 展示，Then stale／partial／unknown 明確；不把各工具額度相加，不從 token 或費用推算訂閱額度。 | passed | stale/reset、缺值、畸形數字／時間、局部失敗、隱私與無共享池加總測試通過；獨立審查兩項問題先重現再修，最終 ACCEPT。 |
| AU-05 | Given 舊工具與已保存證據，When 整合，Then 舊入口／tests 不退化、文件與CI指向同一主線，原 live gaps 保留。 | passed | 舊 Codex 33 tests 包含於 63；Claude 後端 35 tests 通過。文件／CI 集中統一入口；兩元件契約通過。hosted CI／原 live gaps／Git 合併均另列未完成。 |

不新增模型呼叫、scheduler、通知平台、SQLite schema、登入／憑證抽取、私有網頁抓取；API key 僅明確指定環境變數引用，固定官方 readonly API。此次開發／合併產品入口不代表 Git commit/push/merge 授權。

M2 本地實作與整合驗證已通過，整體主線仍 incomplete：原 AC-04 未驗，Claude／Cursor 真來源缺設定，
其他服務無自動 quota adapter，hosted CI／合併未執行。查詢能力整合不等於全部服務自動額度已完成。
[使用指南](docs/agent-usage.md)、[M2 report](docs/evidence/2026-10-23-agent-usage-report.md)、
[統一真快照](docs/evidence/2026-10-23-agent-usage-live.json) 與 [receipt](docs/evidence/2026-10-23-agent-usage-verification.json)。

## M3 — cc-quota 封存與唯讀歷史（owner 直接指示）

Owner 要求封存另一項目並繼續開發。cc-quota 原地封存，保留來源、舊指令及證據，不再作獨立開發主線。
Agent Usage 新增既有 Claude DB 的歷史 JSON/table、時間範圍、筆數界線與缺漏標示；不搬資料、不採集憑證、不重新安裝排程。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AH-01 | Given owner 封存指示，When 更新項目契約與索引，Then cc-quota 明示 archived／not-applicable，原未驗 AC 不偽裝通過，活動入口唯一。 | passed | cc-quota 已原地封存 archived/not-applicable、Tier D；舊prompt失效，活動導覽轉向本工具。6個 runtime/tests檔案hash不變，原pending AC保留；全庫41契約與索引PASS。 |
| AH-02 | Given 既有 Claude DB，When history 查詢時間範圍／筆數，Then 唯讀、有界、UTC 歷史觀測與 gap/truncated 明確，不讀 raw／credentials。 | passed | 21項history新測試＋63項既有測試，共84PASS；5項CLI smoke使用封存後端實際db() schema，DB hash/mtime不變。WAL/sidecars明確拒絕。 |
| AH-03 | Given 畸形／未來／缺資料與舊入口，When history 或原命令，Then 錯誤去識別、缺值不補零、舊63 tests不退化。 | passed | 獨立T-973先REWORK：readonly SQLite會動SHM；補RED並修正後T-974 ACCEPT／84PASS／原WAL案例來源不變。原snapshot/capture/collector回歸未退化。 |

原 Codex AC-04、Claude/Cursor live 及其他 provider 自動接入限制仍保留。沒有 commit/push/merge/deploy 授權。

M3 本地封存／歷史切片已通過；[報告](docs/evidence/2026-10-23-history-report.md)、[驗證與hashes](docs/evidence/2026-10-23-history-verification.json)。
整體 Agent Usage 主線仍 incomplete，舊可見狀態／各 provider live／hosted CI與合併缺口不變。

## T-0975 — 目前成果、最終目標與交付

最終目標：一個本機、標準函式庫實作、無模型呼叫的統一入口，可靠查看七種工具的用量與額度。
有可驗證來源就自動讀取；沒有來源就明示 unknown／manual。訂閱百分比、支出、本機tokens、歷史觀測與共享池不混算。
不以「列出七個名字」當作「七個都能自動查額度」。

已達成：Codex唯讀採集與真帳號驗證、統一JSON/table與來源隔離、Claude DB/statusline接入、OpenCode本機stats真讀取、
Cursor Admin spend adapter、人工觀測、Claude readonly history、過期／缺漏／截斷／隱私處理、cc-quota封存。
既有12條驗收中11條在其明示範圍passed，原AC-04仍pending；這不是七工具全面自動接入的完成百分比。

後續固定列 **7項來源工作**；本次提交／CI／合併另由T-0975交付，不混入來源數字：

| ID | 尚待完成 | 依賴／結束條件 |
| --- | --- | --- |
| FU-01 | Codex可見status對照（AC-04） | 同帳號同時段可見窗口／reset讀值，驗證語意一致。 |
| FU-02 | Claude真資料驗收 | 使用者既有DB或statusline資料，核對snapshot；有DB時驗history，不為取資料呼叫模型。 |
| FU-03 | Cursor真Admin spend驗收 | 授權團隊的key環境變數與expected email，真身份／費用核對。 |
| FU-04 | OpenCode Go訂閱quota自動接入 | 取得可驗證官方機器可讀來源後接入／實測；本機stats不充當quota。 |
| FU-05 | Grok quota自動接入 | 核實可用官方來源與格式，再接入／實測；目前manual。 |
| FU-06 | Grok Bot quota自動接入 | 核實方案與可用來源，再接入／實測；共享池不推斷。 |
| FU-07 | Antigravity quota自動接入 | 核實可用官方來源，再接入／實測；目前manual。 |

無可行官方介面的項目維持明確限制，不能靠猜測或私人端點湊成功；調查可結論為不支援，需明示原因。
WAL歷史、跨服務持久歷史與新排程／通知屬選配後續，不計入上述7項，不因封存自動承諾重做舊功能。

本次交付準備：從最新origin/main建立隔離候選，只納入本工具、cc-quota封存及相關文件；
其他專案未提交工作保留原處。最終HEAD CI／合併結果將寫入 [交付證據](docs/evidence/2026-10-23-delivery.md)。

## T-1101 — Langfuse 整合文件先行

本輪只交付開發／修正規格與兩條獨立文件 PR 中的本條；固定核對來源為 `6b444b00457591996db135e4ec6ab65b1d01ad4c`。
規格路徑：`docs/specs/llm-observability-langfuse.md`；進度沿用 [任務板](docs/tasks/BOARD.md)。
保留既有 mainline、usable_tag 與所有未驗 runtime AC；文件通過不代表功能實作或缺陷修復。

| 文件 AC | Given／When／Then | 狀態 | 驗證計畫／證據 |
| --- | --- | --- | --- |
| LD-D01 | Given 本次固定來源與 owner 範圍，When 完成文件審查，Then 定義訂閱額度、執行觀測與控制責任的整合範圍。 | pending | 索引／連結／範圍檢查與獨立文件審查待完成。 |
| LD-D02 | Given 本次固定來源與 owner 範圍，When 完成文件審查，Then 定義來源、關聯 ID、計量、去重、隱私與失敗契約。 | pending | 索引／連結／範圍檢查與獨立文件審查待完成。 |
| LD-D03 | Given 本次固定來源與 owner 範圍，When 完成文件審查，Then 定義分階段實作依賴、驗收矩陣與文件交付證據。 | pending | 索引／連結／範圍檢查與獨立文件審查待完成。 |
