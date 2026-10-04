# ERU 本機收尾：驗收範圍與缺口

2026-10-04 續作：[durable directory preparation](M3-FRESH-DIRECTORY-PREPARATION-2026-10-04.md) 補裸OS到安全staging目錄的前置操作，獨立授權、持久intent、禁止採納／重播及只讀恢復；本輪限本機／fake transport驗證。整體PARTIAL、正式剩餘12不變。

2026-10-04 後續：[固定SSH staging adapter與host helper](M3-FRESH-NETWORK-SSH-STAGING-2026-10-04.md) 加入OOB pinned transport、現場identity／path檢查及durable no-clobber發布；只以fake SSH／temp-root驗證。directory preparation、activation與實機驗收仍未完成，正式剩餘12不變。

2026-10-04 後續：[network file-staging協調器](M3-FRESH-NETWORK-STAGING-2026-10-04.md) 綁定當次計畫／授權，先durable intent再單次adapter dispatch，回應遺失只讀reconcile；本輪fake adapter驗證，不啟用設定或接受stage。正式剩餘12不變。

2026-10-04 後續：[fresh network-access設定計畫](M3-FRESH-NETWORK-ACCESS-PLAN-2026-10-04.md) 產生四機固定firewall／pinned known_hosts／staged core key內容，保存immutable private plan並離線重導出；重核當次admission與身份。尚未套用設定或驗收network stage，正式剩餘12不變。

2026-10-04 後續：[network stage 唯讀前置檢查](M3-FRESH-NETWORK-ADMISSION-2026-10-04.md) 重驗精確pending、replacement facts與當次scope-bound authorization／fence／隔離proof。歷史preparation不刷新授權；檢查通過不授予mutation或stage acceptance。ERU-015與正式剩餘12項不變。

2026-10-04 後續：[replacement 裸 OS facts](M3-FRESH-REPLACEMENT-FACTS-2026-10-04.md) 新增四機 OOB key／receipt 綁定的唯讀採樣、immutable private observation 與離線重驗。只用 synthetic／fake transport 測試；不等於 network／完整 residue／stage acceptance，ERU-015 與正式剩餘 12 項不變。

2026-10-03 後續：[四機 fresh 人工 receipt 驗證](M3-FRESH-REIMAGE-RECEIPTS-2026-10-03.md) 實作獨立 core／worker 證據契約與唯讀 assessment；不代表重灌已執行或 stage accepted。ERU-015 仍進行中，正式剩餘 12 項。

2026-10-03 後續：[唯讀 fresh baseline observation](M3-FRESH-OBSERVATION-2026-10-03.md) 接續四機／etcd／ERU metadata 基線及 schema-v2 host evidence 重導出；本輪只用 fake／contract tests，未做 VPS 操作。這不是 fresh stage acceptance，正式剩餘仍為 12 項。

2026-10-03 後續：[execution envelope 準備與 pending inspection](M3-FRESH-EXECUTION-PREP-2026-10-03.md) 新增目前本機 bindings／evidence 重核、immutable preparation 及專用只讀分類；沒有 stage dispatch、自動 reservation、generation acceptance 或 barrier release，ERU-015 與正式剩餘數不變。

2026-10-03 後續本機切片：[pending-generation admission barrier](M3-PENDING-GENERATION-2026-10-03.md) 已接續實作持久 reservation 與合作式 controller 入口攔截。它不涵蓋外部 writer fence，沒有 production fresh executor／barrier completion；下文較早的缺口與測試數保留歷史語境。

本檔 guard 修補的歷史基線為 `82cd9d8`，沿用固定 18 項任務；完成 6、剩餘 12（近期 1、後續 11）。本機測試不替代 VPS 驗收。本輪僅修正版本驗證工具及整理證據，沒有部署、重裝、故障注入或讀寫真實 private 資料。

後續 v0.1.7 候選驗證見 [雙次建置紀錄](M3-CORE-V017-VALIDATION-2026-10-03.md)（已通過雙次隔離建置與有界 compatibility）；ERU-015 已補 [executor 設計](M3-FRESH-EXECUTOR-DESIGN-2026-10-03.md)，已接續 [本機 simulation](M3-FRESH-SIMULATION-2026-10-03.md)，仍缺 production executor。下列 429／438 tests 為 guard 修補當時的已驗證快照，不替代候選 patch 的新版測試結果。

## 各項本機證據

| 任務 | 已具備的本機能力 | 測試入口 | 尚缺的驗收 |
| --- | --- | --- | --- |
| ERU-009 | drain planner、先 fence／replacement readiness 後 exact-ID cleanup、fresh subset recovery；成功停在空且 fenced 的 worker，另建一般重裝 plan | `test_worker_drain*.py`：26 tests | 真實 CLI/API/job、drain 後重裝／恢復及其他 worker 保留；不宣稱單一自動 drain→reinstall→resume |
| ERU-010 | 失聯 metadata 精確清理、quota／identity 守護、fresh subset recovery、重驗 desired specs 的 replacement wrapper | `test_worker_loss*.py`：30 tests | 外部 fence、失聯與 replacement 實機演練；node remove/resume、自動 quota repair、持續維持副本數不屬目前契約 |
| ERU-013 | release provenance、版本轉移、獨立建置與不可覆寫 manifest 守護；v0.1.7 雙次 byte-identical build、有界 compatibility 與 validation manifest 已通過 | `test_core_release`、`test_core_publish`、`test_core_update`、`test_validate_core_patch` | upgrade／rollback／interruption VPS 驗收及 plugin／live runtime 相容性 |
| ERU-014 | install→access→registration→smoke→resume→generation 六階段及唯讀 recovery；拒絕錯誤 core artifact 和 stale predecessor | `test_reimage_host.py`：4 tests；`test_labctl.py`：87 tests（含其他 labctl 功能） | safe AddNode patch 受控部署、人工 OS reimage receipt 與整體 E2E；不能以元件重裝代替 OS 重灌 |
| ERU-015 | Profile A review planner、simulation journal／coordinator、pending barrier、execution preparation／inspection、唯讀 baseline collector、四機人工receipt assessment、replacement裸OS facts、當次network stage前置證據檢查、固定network-access設定計畫及network file-staging協調器（fake adapter驗證） | `test_fresh*.py` | production stage dispatch／external fencing／完整bootstrap／generation commit與seal仍缺程式；之後才是三個獨立fresh generations、V01–V04／V08、residue與RTO |

ERU-009／010／014 的上述有限本機流程已具備，仍保持整項「進行中」。ERU-013 不因 guard 修正而取得跨版本驗收；ERU-015 不能標成「本機完成、只待 E2E」。歷史文件的較小 suite 數是當時快照，不是本輪測試數。

## 版本驗證缺陷與修補契約

本輪以 synthetic temporary fixtures 重現三項缺陷：

1. publisher 先檢查目標不存在，再 `os.replace`，可能覆寫在其間建立的 manifest。發布必須使用原子、不可覆寫操作；競爭失敗保留對方 bytes，清除自己的暫存檔。
2. public manifest loader 只核對主要建置的跨版本相容性測試，接受獨立建置缺少或失敗的相容性證據。每個宣告來源版本都必須在兩次建置有明確成功紀錄；重複或格式不明的 step 不得掩蓋失敗。
3. publisher 接受相同 `result.json` 作為兩次獨立建置。相同檔案身分（包括 hardlink alias）必須拒絕；兩個不同檔案的內容相同仍合法，不能以 hash 相等推論沒有獨立重建。

檔案身分檢查只是必要條件，不能證明兩次 build 實際來自獨立環境。source／patch／toolchain、baseline regression、compatibility、artifact bytes 與獨立 runner 的可信證據仍是發布前提；該 guard 修補切片沒有產生新的 Go artifact 或 release manifest；後續候選切片的狀態以雙次建置紀錄為準。

## 新 upstream stable 的接續條件

2026-10-03 透過官方 GitHub API 核對，[v0.1.7](https://github.com/projecteru2/core/releases/tag/v0.1.7) 已於 2026-09-29 發布。[v0.1.5…v0.1.7](https://github.com/projecteru2/core/compare/v0.1.5...v0.1.7) 為 11 個 commits，包含 missing workload 的 gRPC NotFound、etcd missing-key 語意、workload status prefix reads 與敏感環境值 logging 修正。因此舊文件中「等待新 stable」是歷史前提，不能當成本輪阻礙。

目前 deployment locks 仍固定 v0.1.5；新增 v0.1.7 候選 validation manifest 維持 verified-not-deployed。本輪查得 v0.1.7 指向 commit `c80116374a49682d133f74dcb65cb90cb9549bc4`。後續候選切片以此精確來源核對 tag、審查 safe-node-add patch，為 missing-workload／metadata／resource wire 語意新增有界版本相容性證據（不宣稱 plugin quota repair），在隔離 source/toolchain 執行 baseline 與 patched tests，完成兩次獨立 byte-identical build；兩次 build 與新 manifest 已取得實際證據，見上述候選紀錄；既有 manifests 與 deployment locks 均未覆寫。

## ERU-015 下一個實作邊界

完整 fresh 執行器會新增破壞性的四主機能力，已提出獨立設計，仍須審閱並實作 fake/contract tests；不因本輪一般開發或測試機授權而自動執行。

- Scope：僅 Profile A、exact 四台 provider／volume identity、一個 `G→G+1`，fresh 與 snapshot restore 分離；人工 provider console 不改成 provider API。
- Guards：綁定 source、inventory、artifact、controller readiness、外部 materials、writer quiescence、owner-reviewed data disposition、host receipts、全新 etcd token；每 stage 重核 predecessor receipt 和 host incarnation。任一不明、漂移、重複 journal 都停止。
- Recovery contract：先 durable intent 再 side effect，記錄 immutable receipt；回覆遺失只讀 reconcile、不重播清理或重灌。新控制面必須為空，重建 app 後完成 exact metadata/runtime/plugin residue audit；V01–V04 未齊不得 commit generation 或記 accepted run。
- Decision boundary：已有 [完整 fresh executor 設計](M3-FRESH-EXECUTOR-DESIGN-2026-10-03.md) 列出資料處置／隔離、immutable receipt、pending barrier 與恢復契約；設計審閱不能替代 executor 實作。若只接受 planner，必須明確縮小本機收尾範圍，不能默默更改原驗收標準。

## 驗證紀錄

基線 `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`：429 tests，OK。獨立 audit 專項為 drain 26、loss 30、reimage identity 4、labctl 87、release／publish／update／validate／fresh 47；這些專項與 full suite 有重疊，不相加冒充總數。

修正後驗證（命令從本 component 目錄執行）：

- `PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tests python3 -m unittest -v test_core_release test_core_publish test_core_update test_validate_core_patch`：40 tests，OK；修正前相應新案例已確認失敗，保留 red／green evidence。
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`：438 tests，OK，0 failures／errors／skips；較基線新增 9 tests。
- 以 `core_release.validation_record` 逐一載入 `patches/*.validation.json`：兩份既有 v0.1.5 manifest 均通過。
- 原 workflow 的 Python AST、JSON、Markdown links／trailing whitespace、tracked private-file exclusion 與 `git diff --check`，加上 `python3 -m compileall -q scripts tests`：全部通過，具體執行紀錄見本輪 team report。
- 獨立 fixed-diff review：實際檢查五檔程式／測試 diff、重跑 40 tests 與兩份 manifest，沒有阻擋修正的 finding，結果收錄本輪 team report。

上述 438-test 歷史切片僅驗收三個本機 guard 缺陷。後續 v0.1.7 artifact／有界 compatibility 已驗證，完整 suite 為 446 tests；正式跨版本實機流程、ERU-015 executor 及 live gates 仍未完成。
