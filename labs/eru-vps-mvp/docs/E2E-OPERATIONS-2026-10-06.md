# ERU 實機 E2E 操作包（未執行）

狀態：**UNEXECUTED**。這是供 owner/operator 在另次明確、綁定當前 plan/hash/host/volume/generation 的操作授權後審閱的順序與證據表；本輪 T-270 沒有讀取 `private/` 或執行 SSH、VPS、nft、kernel、provider、release、部署和重灌。命令中的大寫 ID/SHA/檔名都是當次計畫輸出，不能用本文字串直接執行。先重新核對 source HEAD、[任務矩陣](LOCAL-CLOSEOUT-2026-10-06.md)、[operator 程序](OPERATOR.md)、[soak 程序](SOAK.md) 與當輪已驗證的 [fresh 主線](M3-FRESH-COMPLETION-MAINLINE-2026-10-06.md)。基線 `8b998185` 尚未有 replay→generation→barrier 完整入口；必須先由本輪 root final source/CI/review 證明該本機鏈，不可用本操作包補足缺少的程式。

## 操作卡與統一停損

每一張卡記錄：task/iteration、UTC 開始/結束、owner/operator 與授權記錄 digest、source commit/clean tree、部署 source/artifact locks、當前 inventory/cluster generation hash、精確主機與 volume scope、外部 writer fence、preflight 和 OOB host-key 證據、plan ID/SHA、每個遠端 action intent/result、private raw evidence 相對路徑/byte SHA256/size、公開結論與審核者。真實 host、IP、token、spec、SSH 原文只留受保護 private evidence；公開報告只列 status、count、digest、duration。每次讀回必須驗原始 bytes，單看檔名或自報 boolean 不算。

任何 current identity/source/artifact/authority/host key/generation/plan/hash 漂移、未知 metadata/runtime/quota、未封閉的 writer、SSH/操作回覆遺失、evidence 缺漏、健康或守護失敗，立即停止新的 mutation，保持原 journal、fence 和資料。先用對應 `status`／唯讀 `recover` 或 `reconcile` 判定已發生什麼；不能重播原 plan、刪 journal/lock、全域 prune、`resource --fix`、自動解除 barrier 或猜測 timeout 為未執行。恢復需新的 current observation、source-bound plan 和另次審閱。若 24h V11 期間有任何 VPS mutation，先標該 run 中斷並回收證據，之後另起獨立 run。

## 順序與成功判準

| 順序／任務 | 起動前證據與當次授權 | 可觀測成功條件；停止及恢復入口 | 待回填的 live 證據 |
| --- | --- | --- | --- |
| 0. 凍結控制器 | 乾淨 source/locks、目前四機只讀 preflight、受保護 external materials、唯一 mutation writer、controller lock；操作卡針對各步 exact scope 簽核。 | `controller_preflight.py` 的 review-ready 仍需 current host/etcd/runtime/identity 讀回；任一 stale/unknown 不開始。 | commit、lock digests、preflight IDs、operator 授權、fence/identity evidence。 |
| 1. ERU-007 V11 | 舊觀測已回收並以原 run exact cleanup；新 02/03 owned nginx canaries，source/health 固定；先短 pilot，再獨立 24h，不在期間做其他 mutation。 | 02/03 各 86400 連續 slots、各至少 85536 次成功；01/02/03 無 OOM、etcd alarm、磁碟 >80%、HTTP/服務故障，raw hash/byte boundary/時間完整且最後 cluster 健康；`complete_needs_review` 須人工判讀。失敗先 `soak.py status/collect/report`，需要停時 `stop` 保留原證據。 | pilot/full run 與 collection ID、三份原始 JSONL digest、離線 report、最後 live health、審核結論。 |
| 2. ERU-012 app | V11 已結束；reviewed v1 stateless digest spec、每 worker capacity、current all-workload identity、真實 Eru CLI/API/job 版本及受控 adapter runner。 | 相同 spec no-op 不增副本；新版 exact replicas/labels/image/node/HTTP ready 後只按 exact IDs 清舊版；create/remove lost reply 只讀對帳且 quota/其他 workloads 保持一致。未知狀態留 journal，停用 runner mutation。 | 原 spec digest、fresh plans、CLI argv/result 原件、每 worker HTTP、identity/quota before/after、失回覆演練。 |
| 3. ERU-008 peer | 先確認 target 空、舊 canary 已精確清理；為 worker-2 建 03/04 guard，再為 worker-3 建 02/04 guard，各自有新 plan/hash、健康、core patch、ownership evidence。 | 兩台分開完成 component reinstall，target revision/服務/HTTP/quota 正確，其他兩 worker 和 core 不變；成功計次只取 complete run。失敗使用 `labctl.py reconcile` 及 source-bound `recovery.py`，不要重播 failed plan。 | 兩組 guard health、plan/run/recovery digest、target/peer before-after、exact cleanup。 |
| 4. ERU-009 drain | 選 ERU-012-owned nonempty target，先 snapshot exact revisions/IDs、健康 destinations、fence 與重裝所需新的 current plan；守護其它 worker。 | replacements 全部 exact 且 HTTP-ready 才清 target source exact IDs；metadata、runtime、tasks、usage 全零再走一般重裝；恢復與 peer preserved。回覆不明用 `recover-worker-drain`，partial 則 fresh subset cleanup plan。 | parent/child plan/journal、逐 ID identity/readiness、空節點與 quota、reinstall/restore evidence。 |
| 5. ERU-010 loss | V11 之後；獨立有界演練授權與外部 provider/network fence 證據；記錄 failure/detection 時刻、原 workload IDs、兩次穩定 healthy snapshot 和容量。 | 180 秒候選如實量測；exact stale IDs 消失、target quota zero、所有 replacement exact replicas/HTTP ready、healthy peers 未改。失回覆走 loss/replacement read-only recover；partial 只建新 subset plan。 | fence raw proof/digest、detect interval、core/healthy-worker CLI 結果、quota/identity、child app plans、HTTP。 |
| 6. ERU-013 version | v0.1.7 validation manifest 與既有兩份 build digests 認證；當次 source/artifact/deployment lock、回退來源 run、plugin compatibility/服務健康與 upgrade/rollback/中斷專項授權。 | 以新 hash-bound plan 做 upgrade、驗 binary/CLI/plugin/runtime/metadata/HTTP；獨立 rollback/中斷後按 recovery journal 讀回 source version 與健康；原 v0.1.5 同版 reapply 不計。未知版本/manifest/備份即停。 | 各 plan/run/binary SHA、服務/HTTP/metadata/quota、rollback 原 source run、interruption/readback。 |
| 7. ERU-014 OS reimage | 一個已空 worker、四機健康、safe AddNode patch 已受控部署及 running binary SHA verified、reviewed exact provider/boot/additional-volume data disposition 與 console 授權。 | 人工 console OS reimage 後 OOB host fingerprint/new machine+boot ID；worker-only install→core access→fenced registration/smoke→resume→generation commit，每步 exact receipt、其它 worker 保留，最後 generation 只 +1。任何不確定先 `reconcile` 或 chain recover，不重做 console/remote mutation。 | action intent/owner receipt、replacement observation、各 stage journal/HTTP/quota/peer guard、inventory/trust/cluster readback。 |
| 8. ERU-011 new controller | 可信搬運外部 private/keys/SSH trust 到乾淨 OS，固定同一 source/artifact、owner 批准 controller takeover/fence；不要複製 B 暫存物當依賴。 | 新 controller 本機 preflight、current 四機只讀 preflight、狀態/plan/recovery 能以新 current evidence 再現；舊 controller 不得同時寫。發現缺件/host-key 漂移先停止接手。 | OS/package/source/artifact digests、external-material readback、SSH trust、four-host observations、takeover fence。 |
| 9. ERU-015 fresh ×3 | 每次獨立 Profile A 精確四 provider/volume scope、新 token、source/artifact/desired specs、writer quiescence 和外部 fence、人工 console data disposition；第 2/3 次綁上一代 immutable accepted evidence。 | 每次完成十二 stages、全新 etcd、exact workers/apps、V01–V04、完整 metadata/runtime/CNI/plugin residue 與 RTO 原始 interval；evidence index→inventory/trust→cluster `G→G+1`→accepted-run→barrier completion 次序和 readback 均可驗。3 次必須是 3 個不同 generation。lost reply 只觀察，`fresh-run recover` 不重播；未知前綴保留 pending/barrier。 | 三份獨立 run/index/receipt chains、host identities、full residue raw bytes/digests、V01–V04 probes、RTO interval、commit before/after、accepted/barrier readback。 |

## Fresh generation 時間證據契約（未執行）

依 [completion 主線契約](M3-FRESH-COMPLETION-MAINLINE-2026-10-06.md)，`prepare_generation` 的 timing input 必須有一份 `source=manual-console-owner-review`、`owner_confirmed=true`、`reviewed_at` 的原始 observation。它引用四份依 topology 排序的 queue 原件，每份綁定已驗 acceptance closure 中原始人工 console action／receipt、alias/node、console action ref、requested/started 時刻；另引用 total／installation 兩份同 observer/clock 的原始 interval，包含 wall endpoints 與 monotonic ticks。六份原件、其 action／receipt 鏈與原 prepare step renewal／admission／fence 都進入不可變 index。原 approval 必須涵蓋 index 建立時間，後補新 approval 不能取代已過期的原審閱窗口；finalize 另需新的 current renewal。

這是人工 owner review 的信任邊界，不能宣稱獨立 provider／machine attestation。四份明確零 queue 原件才可表達 observed no-queue；缺漏、unknown 或只有 matching JSON 均不成立。1800 秒為固定 candidate comparison，必須如實記錄；synthetic 時間不構成 live RTO。本文沒有執行或回填任何實機 interval。

## 已存在的命令入口（只供操作審閱，本輪未執行）

在 `labs/eru-vps-mvp` 以當次乾淨 source 執行。每條會接觸 live host 或 private 的命令都要先滿足上表授權；離線 `report` 也只能讀已回收的證據。具體 flags 與錯誤處置以 linked operator 文件及當次 `--help`/source 為準。以下是既有 CLI 的命令形狀，不填真實 ID/hash：

```bash
# ERU-007：pilot 和 24h 必須是不同 observer run；見 SOAK.md。
python3 scripts/labctl.py plan --operation canary-start
python3 scripts/labctl.py execute --plan CANARY_PLAN --sha256 CANARY_HASH
python3 scripts/soak.py start --canary-run CANARY_PLAN --acceptance v11 --duration-seconds 30
python3 scripts/soak.py collect --run PILOT_RUN
python3 scripts/soak.py report --run PILOT_RUN
python3 scripts/soak.py stop --run PILOT_RUN
python3 scripts/soak.py start --canary-run CANARY_PLAN --acceptance v11 --duration-seconds 86400
python3 scripts/soak.py status --run FULL_RUN
python3 scripts/soak.py collect --run FULL_RUN
python3 scripts/soak.py report --run FULL_RUN

# ERU-008：對 worker-2 與 worker-3 分別建立新 canary/health/rebuild plan。
python3 scripts/labctl.py plan --operation canary-start --exclude-node worker-2
python3 scripts/labctl.py plan --operation rebuild-node --node worker-2 --health private/diagnostics/HEALTH-control-health.json --canary-run CANARY_PLAN
python3 scripts/labctl.py execute --plan REINSTALL_PLAN --sha256 REINSTALL_HASH
python3 scripts/labctl.py reconcile --run REINSTALL_PLAN

# ERU-009：offline review → current live prepare → one-shot execute。
python3 scripts/labctl.py plan-worker-drain --target worker-4 --input private/operations/worker-drain-input.json
python3 scripts/labctl.py prepare-worker-drain --plan DRAIN_REVIEW_ID --sha256 DRAIN_REVIEW_SHA256 --apps private/operations/worker-drain-apps.json
python3 scripts/labctl.py execute-worker-drain --plan DRAIN_PLAN_ID --sha256 DRAIN_PLAN_SHA256 --apps private/operations/worker-drain-apps.json
python3 scripts/labctl.py recover-worker-drain --run DRAIN_RUN

# ERU-010：外部 fence 已證明後；partial 時從新的 exact-ID plan 接續。
python3 scripts/labctl.py plan-worker-loss --target worker-4 --input private/operations/worker-loss-input.json
python3 scripts/labctl.py prepare-worker-loss --plan LOSS_REVIEW_ID --sha256 LOSS_REVIEW_SHA256 --input private/operations/worker-loss-input.json
python3 scripts/labctl.py execute-worker-loss-cleanup --plan LOSS_PLAN_ID --sha256 LOSS_PLAN_SHA256
python3 scripts/labctl.py recover-worker-loss --run LOSS_RUN
python3 scripts/labctl.py plan-worker-loss-replacement --run CLEARED_LOSS_RUN --input private/operations/worker-loss-input.json
python3 scripts/labctl.py execute-worker-loss-replacement --plan REPLACEMENT_PLAN_ID --sha256 REPLACEMENT_PLAN_SHA256 --input private/operations/worker-loss-input.json

# ERU-014：provider console action 本身由 owner 人工完成並留下 receipt。
python3 scripts/labctl.py plan --operation rebuild-node --node worker-4 --mode provider-reimage --reimage-intent private/reimage-intents/worker-4.json
python3 scripts/labctl.py prepare-reimage --plan REIMAGE_PLAN_ID --sha256 REIMAGE_PLAN_SHA256
python3 scripts/labctl.py record-reimage-receipt --plan REIMAGE_PLAN_ID --sha256 REIMAGE_PLAN_SHA256 --receipt private/reimage-receipts/worker-4.json
python3 scripts/labctl.py plan-reimage-worker --plan REIMAGE_PLAN_ID --sha256 REIMAGE_PLAN_SHA256
python3 scripts/labctl.py plan-reimage-worker-recovery --plan BOOTSTRAP_PLAN_ID --sha256 BOOTSTRAP_PLAN_SHA256
python3 scripts/labctl.py recover-reimage-worker-chain --plan CHAIN_PLAN --sha256 CHAIN_SHA256

# ERU-011：controller 本機與四機只讀重驗；見 controller preflight 文件。
python3 scripts/controller_preflight.py
python3 scripts/preflight.py --output-dir private/preflight
python3 scripts/labctl.py status

# ERU-015：僅在本機 replay/seal/barrier 最終驗證後使用當次公開 CLI。
python3 scripts/labctl.py plan-fresh-rebuild --input private/fresh-rebuild-intents/ITERATION.json --plan-id REVIEW_ID
python3 scripts/labctl.py fresh-run start --plan REVIEW_ID --sha256 REVIEW_SHA256 --input EXECUTION_INPUT --run-id RUN_ID
python3 scripts/labctl.py fresh-run status --run RUN_ID --sha256 EXECUTION_SHA256
python3 scripts/labctl.py fresh-run next --run RUN_ID --sha256 EXECUTION_SHA256 --input private/step.json --input-sha256 STEP_RAW_SHA256
python3 scripts/labctl.py fresh-run recover --run RUN_ID --sha256 EXECUTION_SHA256
```

`ERU-012` 的現有 app planner/executor/adapter 是 Python API，`labctl.py` 目前沒有獨立 app subcommand；實機操作前應把已審閱的 bounded runner 呼叫、input/spec hash、失回覆對帳程序和 raw result 加進操作卡，不能用隨意的 Python one-liner 代替。`ERU-013` 的具體跨版本 plan/rollback 也須綁定當次 artifact 和原 source run；使用 [core validation](M3-CORE-V017-VALIDATION-2026-10-03.md) 與 [recovery 程序](RECOVERY.md) 的現行入口。`ERU-015` replay/acceptance/commit 的 `next` 及 recover input 必須以 root 最終驗證的 CLI 契約填入；基線的 `fresh-run` 命令存在不等於所有 stage 已實作。

## 回填與關閉

每張卡逐項記 `not-run`／`pass`／`fail`／`uncertain`，附當次私有 raw evidence 路徑、SHA256/size、公開審核摘要與 UTC 時刻；任何缺失仍 `not-run`，不能在 [TASKS](TASKS.md) 勾完成。最後對照實際 source HEAD/CI/PR、三次 fresh accepted chain、四機 readback、ledger task 狀態與本矩陣，才決定個別任務的正式 DoD。未經該次 live 操作授權，本包只是一份準備文件。

## 2026-10-08 本機前置驗收

完整離線 1258 項／20828.887 秒／OK；222 個 native Python 檔前後 SHA256 一致，唯一 public CLI 主線通過，full09 log SHA256 `08ff99ffac01dd96cf22caea99d98696f82b7190e990996c528bc6ad19e04b07`，native09 manifest SHA256 `ab0da4d1a14aadf7acebff735a4fa093f44b4f847aba99acce86668ce33750bb`。五項 local DoD「本機完成、待 E2E」，最終來源／必要 CI與交付事實見 [T-271](../.team/reports/T-271.md) 及 PR／帳本；本操作包仍 UNEXECUTED。原基線缺少入口的歷史敘述保留，不能當作當輪完成來源。沒有執行或回填任何真實 provider／machine timing、RTO 或 deployment。
