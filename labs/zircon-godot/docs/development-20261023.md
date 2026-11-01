# 2026-10-23 主線啟動：建置與 host shutdown

結果：**PARTIAL，尚無可玩／已驗收版本**。Owner 已啟用主線，不能再把本項目當作 dormant 文件研究；同樣不能把 build 或 test double 當成遊戲。進度權威為 [BOARD](tasks/BOARD.md)，原始 AC 保留於 [SUCCESS](../SUCCESS.md)。

## 版本與實作

- newclear 工作基準 `b7f2a4311d1135977ba273efba8e77702b908036`，分支 `docs/retire-goku-development-prompts-20261023`；保留既有 Goku／其他 prompt 未提交內容，未 commit/push/PR/merge/tag/deploy。
- 外置上游固定 `e383d4a020c46acce37a845eae5cc84a867ecffc`；本次查詢 upstream HEAD 為 `e715157b81b6ff9a0da993b97e32272bc2ba40cb`，未自動升級。已比較最新 HEAD：ServerCore/Program.cs 與兩個目標 csproj 無差異，但共用 ServerPackets／client network 及資源讀取器有變更，因此維持同 SHA 的基線，不能混用新舊 binaries。41 個 manifest blob SHA 與固定 tree 全部一致。
- Debian 13 x86_64；隔離 .NET SDK **10.0.402**、runtime **10.0.13**，Godot **4.6.3.stable.mono.official.7d41c59c4**。官方 Godot zip 與官方 SHA512-SUMS 比對通過。
- [build.py](../scripts/build.py)：固定來源／變更範圍檢查；明確 server/client/test 輸出、NuGet cache、Godot intermediate、日誌與 binary hashes。沒有匯入上游完整程式或素材。
- [check_editor.py](../scripts/check_editor.py)：task 內 staging project／editor 設定，headless import 的 exit code 和錯誤文字一起檢查；不啟動遊戲。
- [shutdown patch](../patches/0001-graceful-console-stop.patch)：取消 Ctrl-C 預設立即終止，移除不處理任何命令卻阻塞等待 stdin 的主迴圈，等待既有 environment stop/save 路徑。

版本、hash、build 結果另見 [機器可讀摘要](evidence/20261023-build.json)。`sources.json` 是 2026-10-04 歷史研究 manifest，不改寫歷史 runtime skipped 為本次 pass。

## 實際驗證

所有 build/test 由共用 workspace launcher 執行。下表命令使用符號路徑：`DOTNET` 為上述隔離 SDK、`SOURCE` 為外置固定 checkout、`CLIENT_BIN` 為該 task 輸出，完整展開命令與本機路徑留在 repo 外。

| 驗證／實際命令 | 結果 | 證據 task ID／限制 |
| --- | --- | --- |
| `git ls-remote … HEAD`、固定 checkout、`dotnet --info` | pass | 固定 SHA 未漂移；SDK 10.0.402 |
| `dotnet build ServerCore/ServerCore.csproj -c Release`，顯式 artifacts/output | pass：0 warnings / 0 errors | `native-build-approved-20261023`（原始上游）、`reproducible-build-20261023`（shutdown patch 後） |
| `dotnet build GodotClient/ZirconClient.csproj -c Debug`，顯式 artifacts/output | pass：6 warnings / 0 errors | 同上；4 個 CS8632 nullable 註記、2 個 CS0219 未使用變數，未壓制 |
| `dotnet build Tests/GroundLootChecks/GroundLootChecks.csproj -c Release` | pass：0 warnings / 0 errors | 同上 |
| `dotnet …/GroundLootChecks.dll` | pass | `loot-checks-20261023`；200 scenes、20 shuffles、10,000 cache cycles、8,000-item selection；這是舊 Client 模型，非 Godot E2E |
| `python3 -m unittest discover -s labs/zircon-godot/tests -v`，原始 Program.cs | **RED：2 tests / 2 failures** | `shutdown-red-20261023`；SIGINT exit -2，只有 READY 無 save；internal stop 在 stdin 開啟時 5 秒 timeout |
| 同一 unittest，套用 patch | **GREEN：2 tests / 0 failures** | `shutdown-green-20261023`；真實 .NET 子行程及 SIGINT，兩種停止均先 WORLD_SAVED 後 CONFIG_SAVED 且 exit 0 |
| `python3 …/scripts/build.py --source … --dotnet …` | pass：三專案皆 exit 0 | `reproducible-build-20261023`；41 blob checks、known-patch gate、binary hashes；server/client 未啟動 |
| Godot `--headless --version`；zip SHA512 | pass | `godot-sdk-verify-20261023` |
| `python3 …/scripts/check_editor.py …` → Godot `--headless --editor --path … --import --quit` | pass：exit 0、0 ERROR | `editor-checked-20261023`；不等於 desktop、遊戲畫面或登入驗收 |

Host 測試只證明入口程式的停止排序。它以 test double 代替世界與 MirDB；尚未證明真實角色位置、背包或 DB 可恢復，未測 startup 中途 Ctrl-C、SIGTERM、force-kill 或 crash recovery。這個修補不是 AC-04 要求的 gameplay 規則修改。

## 保留的失敗與環境差異

1. 初次 sandbox Git DNS 失敗；依環境規則申請 escalation 後取得來源。沒有改代理／網路政策。
2. `native-build-20261023` 三專案都在 .NET `NuGet-Migrations` mutex 的唯讀 runtime 目錄失敗；approved build 後通過。不可把原失敗刪掉或寫成產品 compile error。
3. 初次 Godot SDK 忽略通用 `--artifacts-path` 的 intermediate layout，在外置 source 下產生約 7 MiB `.godot/mono/temp/obj`。保留該已知 build artifact，沒有清理／遷移既有資料。正式 runner 依實際 SDK props 加入僅限 ZirconClient 的 intermediate override，後續輸出已確認在 task build/godot-obj。
4. 初次 native build 遺留 compiler process group，workspace 要求手動檢查；後續 runner 使用 `--disable-build-servers`，新 task 無此警告。收尾 `/proc` 檢查未發現該隔離 SDK／Godot 的存活行程；不刪 lock／manifest。
5. `editor-import-20261023` 雖 exit 0，log 有 sandbox socket 和 editor settings 儲存錯誤，**不算 pass**。新工具使用 task 內 settings，經 escalation 的 `editor-checked-20261023` 無錯誤。
6. 本機沒有 DISPLAY／WAYLAND_DISPLAY，未提供合法資產集。未啟動空白 server 冒充基線，未造帳號或上傳 DB，未使用 VPS／停止其他服務。VPS 不會補足資產權利或桌面證據。

7. 首次 final-local-checks 的 SUCCESS validator 拒絕 `partial`／`blocked`／`passed（靜態）` 作為狀態列舉；現使用既有契約允許的 `passed`／`pending`，詳細 partial／blocked 原因仍保留，未放寬 validator 或 AC。

## 尚缺輸入、驗收與 review

| AC | 本次可確認 | 下一個最小步驟 |
| --- | --- | --- |
| AC-01 | 固定 tree 的 41 個 blob 再核對 | 歷史閱讀範圍保留，不稱全量 audit |
| AC-02 | SDK、server/client build、headless editor import | 提供合法素材集路徑／來源依據，以及能執行 Godot .NET desktop 的圖形會話；按 quickstart consumer 表填實際 resolved paths/hashes，再啟動一 server／一 client／一 map／一 character |
| AC-03 | GroundLootChecks 獨立局部 pass | 在真實 Godot client 完成登入／合法非法移動／障礙校正／戰鬥／掉落／拾取；未執行的負向網路案例仍保留 |
| AC-04 | host stop regression RED→GREEN | 使用隔離真實 Users.db 比較正常停啟前後狀態，再做一項玩法規則修改與 revert；host patch 回退不能替代它 |

初次交付時獨立 review 尚未執行（以下為歷史阻塞，已由後續 CLI review 解決）。已讀 `codex-team-delivery`／`cli-team`：其規則要求 worker 的 host-enforced timeout 與有效權限；此 session native spawn 工具未提供 timeout 參數。不能把 prompt 時限當作已強制執行。外部 CLI 路由涉及額外模型呼叫，而啟動 prompt 不追加付費呼叫授權，故未啟動該路由，也未以同 agent 自查冒充獨立 review。後續 owner 授權階段 PR 交付後，以具 timeout 的 CLI route 完成下述 review；仍沒有全遊戲可用標記聲明。

本次 evidence gate 只接受「來源核對、原生 build、headless import、isolated host regression」的證據；完整主線保持 **PARTIAL**。

## 收尾檢查

`final-local-checks-20261023` 的 host unittest 2/2 pass、`git apply --reverse --check` pass、Python compile pass、component links pass；該次 SUCCESS status enum 失敗保留如上。修正格式後 `final-doc-checks-20261023`：`python3 scripts/check_project_success.py` **41 contracts/navigation/index pass**，`git diff --check` pass，所有 component Markdown local links pass。未修改 validator。

初次交付時公共工具與 patch 已由 root 逐檔檢視，當時獨立 review／CI／合併未完成。收尾發現其他項目也在本 working tree 產生變更；未 stage、覆寫或回退它們。本次範圍只有 Zircon component 與 `.team/PLAN.md` 的 Zircon append。

## 階段 PR 交付（owner 後續授權）

完成範圍是固定來源建置、headless editor import 與 host shutdown 修補；不是完整 P0/P1 或 AC-02 通過，更不是可玩遊戲。Owner 明確授權提交與合併此階段。使用獨立 `feat/zircon-build-shutdown-20261023` 工作樹，只移入 Zircon component。

- [T-978 review](../../../.team/reports/T-978.md)：Codex CLI 0.163.0、gpt-6.1-sol medium、read-only、approval never、外層 timeout240s／kill-after5s，一次 ChatGPT login 呼叫。獨立 static review **ACCEPT**，沒有阻擋問題；reviewer 沒有自稱重跑測試。
- 低風險意見已處理：quickstart 明示 build gate 不檢查 ignored files，不宣稱 hermetic／完整輸入 provenance。
- Root 在新工作樹重跑：`milestone-build-20261023` 三專案 build exit0；`milestone-tests-20261023` host2/2 pass；`milestone-gates-20261023` validator15/15、41 contracts、component links、diff check pass；`milestone-editor-20261023` 使用本次新 binaries 的 headless import exit0、0ERROR。
- 前次的 native spawn timeout 限制不再阻擋此階段，CLI route 使用既有 ChatGPT 登入，未購買資源／改付費 API 設定。第一次 CLI escalation 因可能外傳私人 repo 被 auto-review 拒絕；GitHub API 確認 repo public 且 owner 已授權公開本次內容後，重新審核允許同一唯讀路由；未繞過拒絕。
- 完整 runtime 與 gameplay AC 繼續 pending；PR CI／合併回讀結果以 BOARD 為準。

提交前 staged diff check 揭露 patch 檔本身的空白 context 行（非上游程式碼尾端空白）；改為 unified=1、同步 exact-patch 比對，套用後 Program.cs 不變。保留 historical_patch_sha256 並記新 patch hash。首次 commit 因缺 Git author 設定未建立提交；使用既有 GitHub 帳號 noreply identity 的單次設定，不改全域設定。
