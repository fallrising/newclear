STATUS: PARTIAL

# Kith 階段 0 交付報告

Session: Kith-20261021-1804
Issue: https://github.com/fallrising/newclear/issues/446
PR: https://github.com/fallrising/newclear/pull/449
Base: cda7571e8d45c9c9f036d8b65e41ad26362f7492

## Summary

交付閱讀快記階段 0：定案兩表資料契約、非自動套用 SQL 草稿、RC-01～07 的 fixture／故障切點／斷言清單，以及 9 項 SQLite 隔離檢查。RC 功能全部仍 pending，聊天室既有 AC 不變。

notes 新增 revision 以 CAS 拒絕舊 ACK，並明定每篇一份可編輯補充。快記同 key 不覆寫原文；相同 key／不同 payload 必須明示衝突。匯出確認綁定遠端 Git 持久化，不只看本地檔案存在。RC-04 在階段 1 對 notes/export 預定路由先驗證認證拒絕，階段 2 接線後再回歸，避免把 404 當作安全驗收。

## Verification

所有新測試／檢查從本次獨立 worktree 經 `python3 /home/ckc/test/codex/agent-workspace/workspace.py run kith <task> -- <command>` 執行。Python 3.13.5、SQLite 3.46.1；測試使用 Python 3.11 可用的標準函式庫介面，但本機未提供 Python 3.11，沒有宣稱在 3.11 跑過。

| task / command | 結果 |
| --- | --- |
| Kith-20261021-1804-red / `python3 -m unittest discover -s products/kith/test/reading_capture -v` | exit 1，9 errors；全部因尚無 reading-capture-schema.sql，預期 RED |
| Kith-20261021-1804-green / 同上 | exit 0，9 passed；全部既有 migrations 可先套用，兩表草稿未改聊天室 schema／fixture |
| Kith-20261021-1804-checks / 同上 | exit 0，9 passed，主控重驗 |
| Kith-20261021-1804-checks / `python3 scripts/check_project_success.py` | 首次 exit 1：當時 report.md 尚未建立；補齊後 docchecks exit 0，41 project contracts 通過 |
| Kith-20261021-1804-checks / `python3 .github/scripts/validate_llms_txt.py` | exit 0，5 files、0 errors |
| Kith-20261021-1804-checks / `git diff --check` | exit 0 |
| `teamctl.py validate-task .team/tasks/T-446.md`、`teamctl.py validate-report .team/reports/T-446.md` | 各 exit 0；使用安裝的 codex-team-superpowers validator |

checks 的各子命令輸出保存於共用 workspace 的 `kith/Kith-20261021-1804-checks/preserve/evidence/check-0.log`～`check-5.log`，子命令各自 exit code 如上；外層彙整器的 exit 0 不代表所有檢查通過。

docchecks 另驗證 61 個本地文件連結、T-447 task contract、capability validator 與 diff check，全部 exit 0；輸出在同一共用 workspace 的 Kith-20261021-1804-docchecks/preserve/evidence。

本機 Node 24.14.0／npm 11.9.0 與 CI 固定的 Node 24.18.0 不同；本次不改 runtime、dependencies 或自動 migrations，未在本機跑聊天室 npm lint/test/web build，也未安裝依賴。既有 Kith CI 會執行這些檢查，最終 head 結果必須另外核對。

本次未跑 RC E2E、真 D1、Runner/Git 匯出、正式建置發布或手機真人使用，因階段 1/2 尚未實作或不在授權範圍。未部署、未建立 usable tag、未關閉 issue。

## Documentation

更新 MVP 計畫、README、SUCCESS；新增 SQL 草稿與 RC 清單。資料契約補充 revision、note cardinality、body byte 上限、ACK 與序列匯出，未縮減 RC 範圍。原本待決的實際內容 repo、文章 ID 策略與 Runner 憑證配置保留至階段 2 接線前。

## Risks and Follow-ups

本機 SQL 檢查不能證明 D1 HTTP 語義、認證、瀏覽器保存或 Git 持久化。草稿要在階段 1 的隔離 D1 通過後才升格為正式 migration。單一 Runner 是此設計的約束；多 Runner 必須另設序列化／競態防護。

原生 Codex worker 已完成唯讀需求審閱，主控接受並整合。交付 commit `266aab10e78aca400a3827b7c33af4c53b9d6a0a` 的本機最終檢查通過，CI [Kith test/web](https://github.com/fallrising/newclear/actions/runs/39651400599) 與 [success contracts](https://github.com/fallrising/newclear/actions/runs/39651400453) 全部 SUCCESS。

但不同模型家族獨立審查**未完成**：Grok 顯示未登入，未啟動模型；OpenCode plan / `opencode-go/longcat-2.5-preview-free`（LongCat 家族，作者 OpenAI GPT）在全工具 deny、無 MCP、--pure 的政策下退出 1，回傳 HTTP 402、`Upstream request failed: Endpoint is unavailable.`，沒有審查結論。詳見 [T-447 報告](../../../../.team/reports/T-447.md)。免費模型雖在官方與本地目錄存在，這不證明端點可用。本次未登入、未改付費設定、未換付費 API 或用同家族審查冒充。

證據保存在共用 workspace 的 `kith/Kith-20261021-1804-review/preserve/evidence/`：review-input.txt、policy.json、head.txt、events.jsonl、stderr.log、exit-code.txt。兩次前置檢查因解析設定仍列出 herdr 狀態外掛而停止；檢視來源後，使用 --pure 並將本次 child 的 HERDR_ENV 設為 0 使外掛無作用，保留全部 deny 政策後才啟動模型。沒有降低安全約束。

Evidence gate：**BLOCKED，不合併**。PR 保留 draft，本報告保持 PARTIAL；需要 owner 恢復可用且不產生付費 API 消耗的不同家族審查途徑。此次失敗紀錄提交後，必須對新的最終 head 重新審查並核對 CI/main；不能沿用先前 head 的 CI 當成新 head 證據。最終遠端狀態在 PR 留言回讀，issue 加 needs-owner 並留下 RELEASE，不關閉 issue、不刪除未合併 worktree。

下一里程碑為階段 1：快記＋收件匣（RC-01～04）。本 session 不接續執行。
