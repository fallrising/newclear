# ERU-016 控制 metadata restore：本機 review-plan 前置

日期：2026-09-27。狀態：本機不可執行 planner 已實作；V10、實際 snapshot capture／restore、RPO／RTO 與應用資料恢復均未驗收。

## 交付範圍

`python3 scripts/labctl.py plan-control-restore --input private/restore-control-intents/ITERATION.json --plan-id RESTORE_REVIEW_ID` 只讀取 caller 已備妥的 private evidence，產生 `private/operations/restore-control/review-plans/RESTORE_REVIEW_ID.json`。計畫固定 `operation: control-metadata-restore-review-plan`、`mode: restore-control`、`executable: false`、`execution_implemented: false`、`remote_mutation_performed: false`；同一 ID 只能建立一次。

本 slice 沒有 `execute-control-restore`，不建構 `Operator`，不連 SSH/provider/VPS，不呼叫 `etcdctl`／`etcdutl`，不停止 writer／service，不建立 data-dir，不更新 inventory 或 `cluster.json`。generic `execute` 不讀這個 record area，也不接受此 operation。

## Private schema 與 trust boundary

頂層輸入固定：

- `expected_cluster`、`inventory`、`cluster_record`、24 小時內 controller report 與乾淨 source/lock bindings；
- 來源 generation snapshot，固定 Profile A、舊 member/cluster/token/data-dir digests、三台 worker 的 runtime／node-workload／plugin accounting baseline；
- `private/control-metadata-snapshots/` 下由 `etcdctl snapshot save` 取得的完整 `.db` regular file、size 與串流 SHA256；上限 4 GiB，讀取前後 inode/size/mtime 必須穩定；
- `private/control-restore-status/` 下的獨立 `etcdutl-snapshot-status` JSON，綁定同一檔案 SHA、etcd snapshot hash、revision、key count、size、check time 與 `etcdutl` binary digest；planner 不自行重跑工具；
- `private/backup-catalog/` 下的外部 catalog receipt，綁定同一 object SHA、不可逆 object ID digest、加密、retention 與 restore-read-test evidence；snapshot/status/source、catalog receipt、toolchain binary 與 available core-key records 還必須已由獨立審查加入 `control-restore-trust.json`。該檔預設四個 allowlist 皆空，不信任任何真實 snapshot；planner 核對 working bytes 和 Git HEAD 完全相同，更新後必須 commit 並重新產生 controller preflight，避免 caller 同時重寫 private snapshot 與所有 self-asserted digests；
- artifact lock 中唯一的 etcd v3.6 patch release，以及 `etcd`／`etcdctl`／`etcdutl` extracted binary digests；
- writer quiescence/in-flight-zero、capture chronology、舊控制面 identity/isolation、新 logical cluster 在 Profile A core host 的一個 member、新 token 與由 member data-dir 集合推導的新 data-dir digest；
- snapshot revision、估計 write rate、最大 restore window 與公式導出的 minimum bump；實際正整數 bump 不得低於 minimum，`mark_compacted: true`，且 watch consumer 集合必須涵蓋 core、agent 和每個有 evidence 的 plugin 並全部要求 restart；
- 三台 retained worker 的 exact Eru node/workload、runtime container/task 和 plugin account records；aggregate digests 必須從這些 records canonical derive，Eru membership 與 target etcd membership 分開核對；core key 必須明示 available，並綁 recovery mode、evidence 與 revoke set；
- evidence store，以及 RPO 900 秒／RTO 1800 秒的定義與 timestamp bindings；`application_volume_restore` 必須為 false。

trusted top-level `private` symlink 可用，但整個 plan transaction 只開啟並固定同一個 root directory FD，回傳前再核對目前 root identity；其後每層由 anchored directory FD + `O_NOFOLLOW` 開啟，record 以同一 root 下的 temp write + fsync + atomic hard-link-once 建立，因此 root swap、descendant／ancestor-swap symlink、partial visible record、路徑 escape、非 regular file、oversized JSON、duplicate field、NaN/Infinity、binding/hash drift 都 fail closed。copied live `member/snap/db`、`--skip-hash-check` 語意、prefix export、fresh/new-empty intent、舊 token/data dirs、`--force-new-cluster` 語意、Profile B/三成員冒充、應用 volume claim 也不接受。

## Decision 與 stages

結構或 binding 不可信時不產生 plan。結構可信但外部條件尚未成立時，仍可保存不可執行的 `decision: blocked` plan；blocker codes 包含 controller/toolchain、writer quiescence、external copy、old-control isolation、evidence store 或 RPO candidate。

所有 stages 都保持 `implemented: false`、`executable: false`、`evidence_status: checks_not_performed`：writers quiesced、full snapshot captured、external copy verified、old control isolated、target generation consumed、new data dirs prepared、snapshot restored、restore config written before start、new cluster healthy、clients restarted、metadata/runtime/plugin reconciled、HTTP verified、generation accepted、writers resumed。planner 綁定先後關係，不聲稱任一步已由本工具執行。

stdout 使用固定 allowlist，只顯示 plan identity／mode／decision、不可執行旗標、`G → G+1`、snapshot revision/key count/安全 digests、member/worker/workload counts、isolation gate、revision policy、blocker codes、plan hash 與相對 private path。host/member/cluster identity、IP/endpoint、token/data-dir、workload ID、raw status、spec、secret 與 absolute path 不輸出。

## 測試與尚缺驗收

開發先執行單一正向測試，於尚無模組時以 `ModuleNotFoundError: control_restore` 預期失敗。聚焦 suite 覆蓋 full snapshot 正向、partial/copied/fresh/volume 排除、bytes/status/catalog/tool/generation drift、revision policy、新 cluster membership/token/data-dir、blocked prerequisites、RPO/chronology、private path/symlink/duplicate JSON、immutable concurrency、deterministic hash、CLI redaction 與 no-executor static guard。

目前本機 planner 通過只代表 schema、binding、immutable storage 與公開輸出成立。ERU-016/V10 仍需另行設計及審閱 capture/restore executor，並在隔離環境以授權操作完成：writer quiescence、外部 snapshot 與解密讀回、舊控制面 fence、同一 snapshot 還原、新 logical cluster 啟動、client restart、core key、metadata/runtime/plugin/HTTP 對帳、generation commit、writer resume，以及實測 RPO/RTO。etcd snapshot 只保護控制 metadata；應用 DB、volume 與業務資料必須使用各自的一致性備份。
