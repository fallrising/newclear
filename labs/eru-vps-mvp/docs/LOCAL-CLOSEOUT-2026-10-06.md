# ERU 本機缺口核對（2026-10-06）

本核對固定在公開 source `8b9981854536d3735e838a876959976b5ef53d78`。本輪 T-270 僅審閱 source、既有文件和 synthetic tests；未讀真實 `private/`，未連 VPS、SSH、provider 或 kernel。正式清單仍為完成 6／剩餘 12；本機測試不抵銷任何 live DoD。里程碑與驗收界線見 [completion mainline](M3-FRESH-COMPLETION-MAINLINE-2026-10-06.md)，操作前置及回填欄位見 [E2E 操作包](E2E-OPERATIONS-2026-10-06.md)。較早的 [2026-10-03 矩陣](LOCAL-CLOSEOUT-2026-10-03.md) 保留歷史測試數，不能取代當前 source 核對。

## 全部進行中任務：source、證據與下一道閘

| 任務 | 當前可證的本機能力／入口 | 尚未通過的閘與精確範圍 |
| --- | --- | --- |
| ERU-007 V11 | `scripts/soak.py`、`soak_runner.py`、`soak_report.py` 與 `tests/test_v11_rate.py`：02／03 各 1 req/s、86400 slots、原始 JSONL/hash、每台成功至少 85536、離線重算。`test_soak_evidence.py` 證實收集界線。 | 短 pilot 與獨立 24h VPS run 未執行；核對三台時鐘／原始樣本、無 OOM／etcd alarm／磁碟 >80%、服務／HTTP 無故障後才可 live 驗收。30 秒舊觀測不能代替。無重現本機 blocker。 |
| ERU-008 peer 重裝 | `scripts/labctl.py` 的 `canary-start --exclude-node`、`rebuild-node` 與 `scripts/recovery.py`；`test_labctl.py`、`test_recovery.py` 涵蓋 worker-2／3 目標身分、非目標守護、隔離和 source-bound recovery。 | 清理舊 canary 後逐台以新 plan/hash 實機重裝、HTTP／quota／其他 worker 不變的核對；不接受先前因非空而 blocked 的 plan。非空 target 先走 ERU-009。無重現本機 blocker。 |
| ERU-009 非空 drain | `worker_drain.py`、`worker_drain_executor.py`、`app_cleanup.py` 和 labctl 六個 drain 命令：live preflight、一次 fence、全 replacement ready 後 exact-ID cleanup、partial cleanup fresh subset 與唯讀 recover；`test_worker_drain*.py`。 | 本機有限流程存在；真正 CLI/API/job、drain→一般重裝→恢復的 VPS E2E 未驗收。任何失回覆須先只讀 reconcile；不把有限程式說成已跑完整單一自動鏈。 |
| ERU-010 失聯恢復 | `worker_loss.py`、`worker_loss_executor.py`、`worker_loss_replacement.py`：外部 fence 證據 binding、兩次 stable preflight、exact stale-ID dissociation、quota zero、fresh subset 與 ERU-012 replacement；`test_worker_loss*.py`。 | 本機有限流程存在；V11 後有界實機失聯演練、真正 CLI/API/job 與末端 quota／identity／HTTP 證據未驗收。外部 fence 由 operator 取得；本程式不驗證 provider fence，也不自動修 quota 或重播失敗 journal。 |
| ERU-011 controller 接手 | `controller_preflight.py`、`test_controller_preflight.py`：本機 package/source/artifact/SSH alias/外部私有輸入存在性檢查，結果 `ready_for_review` 只供審閱。 | 必須在乾淨 controller/OS 從可信外部私有材料重現 bootstrap、重收 live preflight、核對控制器接手和四機狀態；現有 B 的 cache 或舊報告不能算。無重現本機 blocker。 |
| ERU-012 stateless app | `app_desired.py`、`app_executor.py`、`app_cli_adapter.py`、`app_cleanup.py` 及四個 `test_app_*.py`：digest-pinned v1 spec、exact revisions/replicas、兩階段 preflight、失回覆 no-replay、HTTP readiness、exact-ID cleanup。 | 本機有限功能已齊；真實 Eru CLI/API/job 與 VPS create/no-op/update/cleanup、quota admission、失回覆對帳仍未驗收。v1 無外部 traffic routing、secret 或 volume。無重現本機 blocker。 |
| ERU-013 patch/version | `core_release.py`、`core_update.py`、`core_publish.py` 和 release tests：來源/patch/provenance、不可覆寫 manifest、版本轉移 guard。`patches/core-v0.1.7-safe-node-add.validation.json` 及 [雙次建置紀錄](M3-CORE-V017-VALIDATION-2026-10-03.md) 已有 byte-identical 既存證據。 | 不重建既有兩個 v0.1.7 build；目前仍 verified-not-deployed。需審閱當次 deployment lock/manifest，以新 plan 完成受控 upgrade→rollback→interruption 和 live plugin/runtime 相容性。不能以舊 v0.1.5 reapply 算跨版本驗收。 |
| ERU-014 單 worker OS 重灌 | `reimage_*`、`reimage_worker_*`、`labctl.py`；`test_reimage_host.py`、`test_labctl.py`：人工 intent/receipt、worker-only install、core access、fenced register/smoke/resume、generation commit 及唯讀 recovery。 | 本機六階段有限流程存在；先受控部署已驗證 safe AddNode patch，再做人工 provider console OS/volume 重灌、OOB host identity、完整 VPS 鏈與 generation readback。元件重裝不算 OS 重灌。 |
| ERU-015 全群 fresh | `fresh_run_ops.py`、`fresh_bootstrap_ops.py` 和 `labctl.py fresh-run` 在基線上可到 `cluster-bootstrapped`；[T-267](../.team/reports/T-267.md) 留有完整 1133 tests 與 synthetic 22 步證據。 | **當前本機缺口**是 `apps-replayed`、`resources-accepted`、`residue-audited`、本機 generation commit/evidence index/accepted-run seal/barrier completion；T-268／269 和 root 當輪另行實作，T-270 不預判結果。正式 V08 仍須三個不同 generation 的完整四機 fresh；每次核對 V01–V04、全 metadata/runtime/CNI/plugin residue、RTO、source/artifact/authority lineage。 |

## 五項本機 DoD 快照

| 任務 | 本機狀態（基線） | 不能由此推論的 live 狀態 |
| --- | --- | --- |
| ERU-009 | 有 bounded drain/cleanup/recovery source 與 fake tests；本輪 focused suite 含相關測試通過。 | 真實 nonempty worker drain、一般重裝與恢復尚無 VPS evidence。 |
| ERU-010 | 有 exact-ID loss/partial/replacement source 與 fake tests；本輪 focused suite 含相關測試通過。 | 失聯/fence、180 秒候選、真實 quota/CLI/API 未驗。 |
| ERU-013 | provenance/version guards 和既存 v0.1.7 雙建置已具備；本輪未重做 build。 | 跨版本部署、rollback、interruption 與 plugin/runtime E2E 未驗。 |
| ERU-014 | 人工 receipt 至本機 generation commit 的有限流程有 fake tests。 | safe patch 部署、provider console 重灌和四機讀回未驗。 |
| ERU-015 | 截至 8b998185 只到 bootstrap accepted；後續本機切片另由 T-268／269／root 驗收。 | 三次 fresh、V01–V04/V08、residue/RTO 全未驗；不能寫「本機完成，只待 E2E」。 |

本輪 focused 命令在 component 目錄：`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tests python3 -m unittest -q test_v11_rate test_soak_evidence test_controller_preflight test_app_desired test_app_executor test_app_cli_adapter test_app_cleanup test_worker_drain test_worker_drain_executor test_worker_loss test_worker_loss_executor test_worker_loss_recovery test_core_release test_core_update test_reimage_host test_labctl test_recovery`，實測 285 tests／40.566 秒／OK。它涵蓋當前任務的有限契約，沒有執行 live 操作，也不替代 root 對新 ERU-015 source 的最後驗證。

## 2026-10-07 整合 source 與驗收進度

前兩表是 T-270 的基線核對，保留當時的結果。T-268／269 與 root 已接入 replay、raw V02/V03/V04/residue、generation index/commit/accepted/completion、durable retirement、普通第二次 consumer 及 retained lineage。Root 的唯一完整 CLI journey 保留原 bootstrap assertions，並使用完整 pinned-source metadata、optional status 及目前 containerd 的 ID=Name 契約；generic Name parser 的 opaque ID 反例另行測試，不能混為目前 runtime profile。完整離線與遠端交付 gate 仍在執行，結果以 [T-271](../.team/reports/T-271.md) 為準。

ERU-012 的新 source audit 重現並修正了 ID/name 混淆：ID 保持原樣，exact app/entry 由 Name 與 reviewed spec/labels 綁定；explicit foreign/malformed Name 不能退回舊 display-ID。Pinned core 的 Name parser 無法保持含底線的 entrypoint，現在先拒絕此 spec，避免錯誤 deploy index。新 regression 與既有 app suite 61 項／0.844 秒通過；這更新基線表「無重現 blocker」的結論，不追認舊285項為新 source 證據。

| 本機 DoD | 當輪實作／驗證映射 | 剩餘界線 |
| --- | --- | --- |
| ERU-009 | 既有 bounded drain/cleanup/recovery；最終完整離線 suite 覆蓋其 native tests。 | 真 CLI/API/job 與 nonempty drain→一般重裝→恢復 live 未驗。 |
| ERU-010 | 既有 bounded loss/partial/replacement；shared opaque ID 修正及完整離線 suite。 | 外部 fencing、失聯/quota/HTTP live 未驗，180秒候選沒有新實測。 |
| ERU-013 | 既有 provenance/version guard、已完成的兩次隔離 v0.1.7 build；不重建。 | verified-not-deployed，upgrade/rollback/interruption 與 plugin/runtime live 未驗。 |
| ERU-014 | 既有六階段本機 workflow/generation/recovery，native tests 納入完整 suite。 | safe patch 部署、provider OS/volume 重灌及 live 鏈未驗。 |
| ERU-015 | 新 public CLI 完整主線、exact current authority/no replay、source-derived raw graph/status/ledger、generation prefix recovery/retirement/history。 | 最終 full native 尚待；三次不同 generation 的 fresh、V01–V04/V08、residue/RTO live 全未驗。 |

五項本機 gate 只接受可核對的完整 native 結果，不以 source、fake focused 或審查文字替代。正式完成6／剩餘12保留；E2E 操作包保持 UNEXECUTED。

## 2026-10-08 最終本機 evidence gate

完整離線 1258 項／20828.887 秒／OK；222 個 native Python 檔前後 SHA256 一致，唯一 public CLI 主線通過；full09 log SHA256 `08ff99ffac01dd96cf22caea99d98696f82b7190e990996c528bc6ad19e04b07`，native09 manifest SHA256 `ab0da4d1a14aadf7acebff735a4fa093f44b4f847aba99acce86668ce33750bb`。原始 full03 的1221／5914.129秒、1failure／10errors及full04的1232／5824.429秒、1failure／1error及full05的1241／5791.443秒、1failure，以及所有早期 RED／中斷均保留在 [T-271](../.team/reports/T-271.md)。T-275 與 root 修正 actual Name/raw ID binding、drain原始 entrypoint；T-277/T-278核對目前containerd ID=Name；T-279修正僅測試的process消失競態；replay acceptance保留已驗dependency refs而不更動physical cache；generation current recheck 使用 proved before-view；ordinary empty-history0755 controller 保留既有 admission，未知 history 仍拒絕。T-280獨立審查匹配候選228檔、含native06全部220個Python檔，沒有新可重現 blocker。

五項 ERU-009／010／013／014／015 本機完成、待 E2E；逐項驗收映射以 [TASKS](TASKS.md) 最新表為準。GitHub exact-head CI、合併／遠端核對／desk 是尚待發布 gate，完成後在 PR／帳本追加實際結果。較早基線表不追認為新 source evidence；formal6／12與 E2EUNEXECUTED 不變。

T-293 independent review matched230 candidate/all222 native files, original report SHA256 `1e625ae9ab2355bef1310b6ef207d187b47a3d1a23473c72dd167279c23249d2`. Exact one-line readonly spy installs the same callback without unused call-history retention; independent actual-callback write rejection and argument/result/exception forwarding checks passed. T-292 matched actual-reader plain1,490,586opens/43,585,536B peak versus MagicMock771,177call records perlist/917,458,944B/MemoryError supports this necessary test-only repair; diagnostic sentinel/resource failure are not whole proof or original OOM attribution. Earlier T-28774 tests/52.111s exit0 remain source-specific evidence for221 unchanged native files, not a new rerun. Same-lock current authority and original CLI assertions remain unchanged; T-282/T-283 historical bootstrap loader evidence stays separately scoped.

Actual old full06 FAILED1249/18342.113s with1failure and exitunknown/null after daemon restart remains preserved (logSHA520a38f747c6330f521b58eaccdb7d45ec66508be725e7a86f19a044341d4f7a). T-286 traced post-operation same-finalizer lock revalidation and added only nine lines routing through existing owner.check; current authority/deep proof/nested guard remain. Final full09 is an independently observed successful new run, not recovery of the failed run. CI timeout 360minutes derives from measured successful local runtime 20828.887s and separately estimated margin 12.9minutes; actual GitHub runtime remains unknown before CI. Checks/action pins/permissions/triggers remain unchanged, with final footer and deadline-only T-294 follow-up review required. Actual prior full08 lost native/collector/monitor with no footer or recoverable exit; originalRUNNING metadata is historical and separate recovered evidence records INCOMPLETE_PROCESS_LOST. Cause remainsunknown. T294 independently accepted a no-signal natural-parent-exit collector probe, detached supervisor and exact source freeze for a newfull09 attempt, not a resumed/relabelled run. Actual prior full07 ended SIGKILL exit-9/wall18904.22365703399s/logSHA6e5bf133066e7fe07a95ed850eaf025fb568e8ee27cb5752ab4149efaef38ef4 with no footer/cases/suite time; original kill cause remainsunknown. T-289 tiny0/0 proof seams and T-291 CPU-capped unfinished actual reader remain PARTIAL. T-292 matched bounded mock MemoryError/plain actual derive boundary and T-293 exactcallback review support only the one-line test-spy repair. Full09 is a separately measured new whole run with15-second processRSS samples and before/after session counters; sampled peak is a lower bound and session events alone do not prove native PID attribution. Live remainsUNEXECUTED.
