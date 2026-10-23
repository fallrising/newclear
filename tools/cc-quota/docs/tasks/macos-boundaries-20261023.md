# M2：macOS憑證邊界與Python3.11 CI

來源基線：`f64c7ef01532f717e963e7c1adec4cbae87f16e7`（M1已合併）。Owner要求持續開發，里程碑完成即提交／合併PR。AC01–04不縮減；本輪範圍為AC02錯誤處理與AC03／04的平台準備，並非完整真人驗收。

## 已確認問題與修復

- 舊碼Keychain查詢非零退出後會讀`.credentials.json`；合成fixture已實際重現，會切換來源。現Mac僅使用原生`/usr/bin/security`，拒絕／逾時／缺資料均停止，不讀檔案fallback。
- 舊碼接受null token，直到HTTP層才失敗；現驗證JSON結構及非空可列印ASCII token，控制字元、空白、錯型別、缺欄位在HTTP前停止。Linux檔案路徑保留。
- errors記錄固定代碼與提示，不寫入憑證內容、Keychain stderr或例外內的秘密字串；不刷新、輸出或轉存token。

## 本地實際驗證

所有本地Python測試從source cwd經共用workspace launcher執行；日志保留在 `data/projects/cc-quota/tasks/<task>/preserve/evidence/`。

| task | 實際執行 | 結果 |
| --- | --- | --- |
| m2-existing-behavior | 合成fixture直接呼叫舊read_token | PASS重現：Keychain失敗讀檔、null token被接受；不輸出token |
| m2-credentials-red | `python3 -m unittest discover -s tests -p test_credentials.py -v` | RED：7 tests，2 failures／20 errors；部分errors為尚未實作CredentialError |
| m2-credentials-green | `python3 -m unittest discover -s tests -v` | 35 tests PASS |
| m2-local-gates | 同上；`bash -n install.sh`；`python3 scripts/check_project_success.py`；`git diff --check` | 35 tests、syntax、41 contracts/index與diff PASS；本地Python3.13.5 |
| m2-local-gates | `ast.parse(..., feature_version=(3,11))` | 所有Python來源／tests語法PASS，不當作Python3.11 runtime證據 |

## 原生平台CI

CI維持10分鐘job timeout，使用標準`ubuntu-latest`／`macos-15`及repo既有SHA釘選setup-python（Python3.11），cache／temp置runner.temp。Repo確認為public；[GitHub官方標準runner文件](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)說明public repo的標準runner免費；未申請larger runner、購買資源或付費API。

三項原生Mac測試：

1. 擷取實際notify產生的AppleScript，以`/usr/bin/osacompile`編譯Unicode／引號／換行／反斜線腳本，不執行通知。
2. 使用隔離HOME與假的launchctl執行真install.sh，再由`/usr/bin/plutil`解析產出的plist，不註冊工作。
3. 攔截查詢參數，只將service換成不可預測的不存在名稱，使用真`/usr/bin/security`驗證查詢失敗及不fallback。絕不查詢真的Claude service、修改search list或建立keychain。

本機Linux未執行原生Mac測試；GitHub macOS runner已實際執行通過，詳如下表。

## 審查、交付與剩餘缺口

獨立T995審查對修正後程式／測試範圍ACCEPT，報告保留PARTIAL及首次CI失敗；root已讀取實際CI日誌補足平台證據。發布狀態由[任務板](BOARD.md)記錄。AC03真人登入／Keychain成功取用／usage對照，以及AC04真launchd hourly、可見通知與睡眠恢復仍blocked；CI上的合成輸入不能替代。無部署／release／usable tag。

首次[CI run 39886075939](https://github.com/fallrising/newclear/actions/runs/39886075939)在工作流程載入時失敗、jobs為空，未執行測試。job-level env不能引用runner context；依[官方context範圍](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)移到兩個Python測試step，保留runner.temp隔離。

## CI與整合證據

測試head `22fcd708937f2ba59f0a151cb74aafbdfb3e7127`；已整合main `77d8262265dd88e8db1b01c7995a70e9b357dd04`，僅PLAN附加紀錄衝突，保留兩方內容。後續文件提交不改以下runtime/tests/workflow，SHA256見 [M2 manifest](../../../../.team/cc-quota/evidence/m2-manifest.json)。合併仍須最終head的CI通過。

| 環境／檢查 | 實際結果 | 證據 |
| --- | --- | --- |
| Ubuntu CPython3.11.17 | 35 offline tests、bash syntax PASS | [CI](https://github.com/fallrising/newclear/actions/runs/39886434932/job/120195578861) |
| macOS15 CPython3.11.9 | 35 offline tests、bash syntax、3 native tests PASS | [CI](https://github.com/fallrising/newclear/actions/runs/39886434932/job/120195578463) |
| Repo契約 | 41 contracts/index PASS | [CI](https://github.com/fallrising/newclear/actions/runs/39886434864) |
| 本地main整合後 | 35 tests、syntax、41 contracts/index、diff PASS | workspace `m2-integrated/preserve/evidence/` |

Root使用 `gh run view --json` 與 `gh run view --log` 實際回讀；完整日誌保留於workspace `m2-ci-evidence-retry/preserve/evidence/`。首次sandbox讀取失敗後正常授權路徑重試成功，沒有把失敗當作通過。Reviewer報告：[T995](../../../../.team/cc-quota/reports/T-995.md)。

Root evidence gate：接受本次憑證／平台邊界里程碑；初始workflow錯誤已修正並原生實測，AC03／04真人主線仍pending。PR [#510](https://github.com/fallrising/newclear/pull/510)完成最終CI及合併後才在下一個board-only PR關閉T0995列。
