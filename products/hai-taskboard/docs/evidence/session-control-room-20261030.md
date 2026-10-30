# T-1030：Session 控制室文件驗證紀錄

日期：2026-10-30。範圍：SC-DOC-01..03；只驗證文件，不是產品／Provider 驗收。
基準：`1181db123f108ab096bbc1ae9a4e804097d939ca`。
認領 commit：`310138390501a6362e1f7cb9160ae141173a1c52`；認領 BOARD blob：`5bb3b30105704975f5bd7da72533396a966731bf`。
交付入口：[Draft PR #832](https://github.com/fallrising/newclear/pull/832)。最終 head／CI／remote readback receipt 記在該 PR；不把待發生的驗證寫成已通過。

## 範圍與來源

本輪讀取 root／HAI AGENTS、SUCCESS、README、BOARD、SDD、executor/security、ADR-006、
remaining-work 計劃與共用交付規則。版本固定在基準；歷史 evidence 的 PASS 不當成本次重跑。
上游五個專案的實作參考沿前次研究的 pinned snapshots，列在 [mini-SDD](../sdd/session-control-room.md)；未下載依賴或部署它們。

只改 README、SUCCESS、BOARD 與新 mini-SDD／[主線診斷](../plans/provider-critical-path-20261030.md)／本報告。
不改 production、OpenAPI、migrations、dependencies、CI、AGENTS、已接受 SDD／ADR、歷史 oracle 或產品狀態。

## 工具與基準完整性

終端 `git ls-remote https://github.com/fallrising/newclear.git HEAD` 失敗：`Could not resolve host: github.com`。
容器下載因 URL 尚未經 web 開啟被拒；後續 public raw／archive 的 web 嘗試分別為 DisabledError／not accessible，未取得檔案。
這不是 repo 不可存取的判斷：GitHub app 的 fetch_file／fetch 正常，create_branch／update_file／Draft PR 已成功。
改用 app 讀取、以 Git blob SHA 校準本地 UTF-8 bytes，再由 Git data API 原子提交；不使用終端認證失敗來推定 app 無讀寫權。

| 原始檔 | 與基準比對的 blob SHA |
| --- | --- |
| README.md | `86f2d110c66ef442dc00b3ef7b9a8058caeeda85` |
| SUCCESS.md | `1cb5c86a190c589826cf520e07f953fe6ad57941` |
| docs/tasks/BOARD.md | `ab73347d03faefb2763ce1dcb8b436309068b5d3` |

## 文件驗證方法與結果邊界

Task-local `check_docs.py`（工作容器，不新增產品測試）檢查：
原始三個 Git blob 與已發布認領 blob；六檔 allowlist；SUCCESS 原文／frontmatter／四條 AC 不變；
舊 BOARD 完整保留與三條 in_progress 認領；README 僅新增設計入口；新增 local links 對已讀取的 pinned tree／新增文件；
八條 Proposed 設計條款、十個未來 oracle；UTF-8、換行、fenced block、衝突標記、secret-like token 與 whitespace。
實際命令為 `python3 /mnt/data/hai-session-design/check_docs.py`，並呼叫
`git diff --no-index --check /mnt/data/hai-session-design/baseline /mnt/data/hai-session-design/work`。
初次 task-local checker 把 `git diff --no-index --check` 的「有差異但無診斷」exit 1 誤當失敗。
以獨立 clean／尾隨空白 fixture 核對後，改為拒絕任何 whitespace 診斷或工具錯誤；全檔逐行 whitespace 檢查仍保留。
這是檢查程式的 exit-code 修正，不是產品失敗或放寬既有驗收。
這不是 `go test`、瀏覽器驗收或獨立 review；不建立假的通過產品測試。

| 項目 | 狀態 |
| --- | --- |
| 三個原始檔／認領 blob 精確重建 | PASS；原始 Git SHA1 驗證 |
| 最終 scoped 靜態文件檢查 | PASS：六檔、三個 baseline blobs、23 個新增 local links、八條設計條款、十個 Proposed oracles；四條產品 AC 未變 |
| native project-success／HAI CI | 本地 NotRun：沒有完整可執行 checkout；查看 PR 的最終 head CI，認領 commit CI 不替代最終 head |
| 獨立文件／契約審查 | PENDING；本輪只有主導自我檢查，不冒充另一位 reviewer 的 ACCEPT |
| provider／Go／web／browser／恢復實測 | NotRun；本輪不啟動 runtime |
| 新功能 HAI-SC-T01..10 | Proposed/NotRun；尚未建立可執行 skeleton |
| merge／usable tag／release／deploy | 未執行、不在本輪授權內 |

## 自我檢查處置（不是獨立 review）

保留兩個重要澄清：現行計劃的圖把 MCP 排在 LIVE 前，正文卻允許核准的 direct adapter；
因此診斷不能把 MCP 宣稱成不可替代技術條件，也不能把 U1 便利功能全列作既定前置。
M1a／M1b 是已交付的核心 API，不因質疑主線就描述成全在做裝飾支線。

設計校正：Context 使用獨立 context_revision，不誤用 execution generation；
Steer 不得覆寫 accepted Goal／AC／workspace／policy；這些變動仍走原規格失效流程。
L1 提早技術驗證明示須改哪些權威條款，未批准時仍走現行 M1c／Fake-only 路線。

## 發布與後續接受

認領先於設計編輯；同一工作分支與 Draft PR，不直接推 main。
內容提交須以認領 commit 為 parent，使用既有 tree + 六檔變更；更新 ref 必須 force=false 且 expected_sha 相符。
發布前重讀 main；若有相關變更先對帳，不覆蓋。發布後回讀 commit parents、檔案 blob 與 PR head，逐一對照本地 manifest。
上述發布步驟的實際 SHA／readback／最終 CI 寫在 PR receipt，不在產生它自身 SHA 的文件中製造自我參照。
任務列保留 in_progress／end 空白；尚未獨立接受或合併，不宣稱全部交付完成。
