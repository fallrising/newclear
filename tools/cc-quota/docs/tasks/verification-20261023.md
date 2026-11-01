# CC Quota 本次驗證 — 2026-10-23

範圍：AC-01／02修復及離線驗收，AC-03／04的可執行離線準備。Owner啟用START_DEVELOPMENT_PROMPT；未新增quota-signal、scheduler、依賴或憑證刷新。
來源：`b7f2a4311d1135977ba273efba8e77702b908036` 加本次工作樹差異；分支 `docs/retire-goku-development-prompts-20261023`。初次開發交付時未commit／push／PR／merge／tag／部署；後續owner授權的發布紀錄另列於下。原有其他產品差異保留。

## 已執行證據

所有新Python測試均從原source目錄經共用agent-workspace launcher執行。日志留在該workspace的 `data/projects/cc-quota/tasks/<task>/preserve/evidence/`，無憑證／真usage；表內是實際子命令／結果，非待辦命令。Runtime為Linux／Python3.13.5。

| task | 實際命令／檢查 | 結果 |
| --- | --- | --- |
| baseline-20261023 | `python3 -m unittest discover -s tests -v` | 7 tests PASS |
| worker993-red | 同上，新回歸先跑舊碼 | RED：18 tests，16 failures／8 errors（subtests可多於測試數） |
| worker993-review-red | 同上，Unicode／401／同秒重採 | RED：21 tests，3 failures |
| worker993-bounds-red | 同上，token範圍／超大trend bar | RED：22 tests，1 failure／1 error |
| worker993-final | 同上，worker完成版本 | 22 tests PASS；先前GREEN的resource warnings已修正 |
| installer-red-20261023 | `python3 <workspace artifact>/test_install.py -v` | RED：4 tests，1 failure／2 XML parse errors；另一個bootstrap失敗回歸PASS |
| root-green-20261023 | `python3 -m unittest discover -s tests -v` | 26 tests PASS，含4個隔離installer測試 |
| threshold-red-20261023 | 同上，未四捨五入門檻／浮點下溢 | RED：28 tests，1 failure／1 error |
| threshold-green-20261023 | 同上 | 28 tests PASS |
| eta-range-red-20261023 | `python3 -m unittest discover -s tests -p test_cc_quota.py -k tiny -v` | RED：1 test，1 subtest failure，ETA超出SQLite整數範圍；修正為unknown |
| cli-flow-20261023 | 實際subprocess：`python3 cc_quota.py report`；`collect --no-tokens -v`；`report --hours 24`；錯schema後`collect --no-tokens`；`report` | 預期exit依序1／0／0／1／0；SQLite欄位、錯誤與raw核對PASS；report前後DB SHA256及mtime不變；錯誤未新增正常snapshot |
| cli-flow-20261023 | `ast.parse(..., feature_version=(3,11))`：runtime與tests | Python3.11語法PASS；不是3.11 runtime測試 |

保留的非產品失敗：worker993-review-green遇跨秒時測試未ORDER BY的raw SELECT假設；測試改為最新raw row後通過。Root一次apply_patch因上下文不匹配未套用，讀回後成功套用；非測試通過紀錄。

## 改動與邊界

- report真正唯讀，不建立缺失DB；剩餘／pace／狀態明示為快照觀測，倒數隨時間更新，90分鐘以上間隔與舊快照提示GAP／STALE。
- 不再將缺utilization轉0；驗證所有提供的視窗再寫snapshot。raw保留成功fetch的JSON，errors僅保存安全的階段／型別／HTTP碼。通知失敗不丟棄已提交資料。
- 同秒成功重採替換整套snapshot；ID去重跨檔，畸形JSONL不終止quota採集。無message ID逐行計數的限制未隱藏。
- 門檻用原始精度；太小的用量若ETA不能表示為SQLite整數則unknown。極大合法百分比仍沿用remaining clamp，trend bar上限20格。
- installer在Linux拒絕且不寫入；plistlib負責XML逸出；記錄實際Python路徑與五個非秘密設定。測試的uname／launchctl為隔離替身，不是Mac安裝或排程證據。

## 目標環境與未執行項

讀SSH config及Include後發現8個候選條目，以BatchMode、strict host-key與timeout的只讀`uname -s`逐一核對，8個全部Linux（條目數不宣稱獨立主機數）。初次沙箱SSH配置權限錯誤；依規則提升同類只讀探查後成功。私有別名、路徑及原始診斷留repo外，沒有讀／轉存token、停止服務或改遠端設定。managed-environment工具／policy snapshot均不可用，未宣稱其ready。

- AC-03 **blocked / not run**：缺已登入Claude的授權Mac、Keychain互動與可見額度對照。未呼叫真usage端點。
- AC-04 **blocked / not run**：缺同一Mac；真launchd hourly trigger、可見通知及睡眠後恢復未驗。離線測試不能代替。
- 遠端CI、PR／merge／usable tag **not run**：沒有本輪Git發布授權；完整主線仍incomplete。
- Python3.11實際runtime **not run**：本機只有3.13.5；Mac需使用3.11+再跑相同suite。

下一個最小步驟：提供已授權且Claude已登入的Mac存取方式，依[quickstart目標機步驟](../quickstart.md#目標-mac-驗收尚未執行)補AC-03／04。不得把缺目標機改寫成產品已驗收。

## 最終審查與gate

T-994獨立審查：**ACCEPT限定離線變更**，未發現material defect；獨立重跑28/28 tests、installer syntax及scoped diff通過。[審查報告](../../../../.team/cc-quota/reports/T-994.md)為PARTIAL，未隱藏repo gate失敗與目標機未驗。

Root `root-final-20261023`：28/28 tests、`bash -n install.sh`通過；[來源SHA256 manifest](../../../../.team/cc-quota/evidence/final-manifest.json)記錄實測檔案，審查後重新比對完全一致。
Root `repo-gates-20261023`：T993/T994 task、T993 report validator及`git diff --check`通過；`python3 scripts/check_project_success.py` **failed**，原因是另一個並行任務正在編輯 `tools/codex-usage/SUCCESS.md`，缺4個heading及尚不存在的evidence連結。T994亦重現同一失敗，未改動其他項目來掩蓋。
Root `scoped-contract-final-20261023`：`python3 scripts/check_project_success.py --projects tools/cc-quota` **passed**；此限定檢查不替代仍失敗的repo-wide gate。

Evidence-gate決定：接受AC-01／02的實作與離線證據，整體交付為 **PARTIAL**。AC-03／04仍pending；完整repo gate／遠端CI／合併未通過，不宣稱mainline完成或usable版本。歷史RED、非產品測試失敗與所有skip均保留。

## Owner授權的PR交付（2026-10-23）

Owner後續明確要求提交程式並合併PR。以最新origin/main `b7f2a4311d1135977ba273efba8e77702b908036`建立獨立分支 `fix/cc-quota-offline-reliability`，只攜入CC Quota來源／文件與其審查契約，避免混入其他並行開發。runtime及tests的SHA256與已獨立審查manifest完全相同。初輪repo-wide失敗保留為歷史，下列新結果以隔離交付候選為準；AC03／04仍未驗，不部署或打usable tag。

`delivery-precommit-20261023`經共用launcher實際重跑：28 tests、`bash -n install.sh`、全repo `python3 scripts/check_project_success.py`（41 contracts）、task/report validators、component links及`git diff --check`全部PASS。隔離交付候選已解除初輪的repo文件gate阻塞。PR CI／合併結果由[任務板](BOARD.md)記錄，必須以GitHub實際checks及merged狀態為準；本次可合併範圍僅AC01／02與AC04離線準備。
