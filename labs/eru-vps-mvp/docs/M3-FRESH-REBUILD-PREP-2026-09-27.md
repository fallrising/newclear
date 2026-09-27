# ERU-015 全群 fresh rebuild：本機 review plan

更新：2026-09-27。這一輪只交付單次 Profile A 全群重建的私有、不可執行 review plan；沒有停止 writer、連線 VPS、呼叫 provider、重灌、清除 etcd/runtime、部署 app 或更新 generation。建立 plan 不等於授權執行，也不算 V08 通過。

## 入口與公開輸出

在 controller B 的專案根執行：

```bash
python3 scripts/labctl.py plan-fresh-rebuild \
  --input private/fresh-rebuild-intents/ITERATION.json \
  --plan-id FRESH_REVIEW_ID
```

輸入、controller report、四份 host intent 及輸出 plan 都必須位於各自固定的 `private/` 目錄；允許本專案既有的可信 `private/` 根 symlink，但其下任一 symlink、目錄穿越、巢狀非預期路徑、重複 JSON key 或超過 16 MiB 的輸入都會拒絕。相同 plan ID 不覆寫。

stdout 只列 plan ID／hash、decision、blockers、本次 generation、series iteration 及 host／volume／app 計數；不列 alias、IP、provider／volume reference、machine ID、OS image、app spec、command、workload ID 或絕對 private 路徑。完整範圍只保存在 `private/operations/fresh-rebuild/review-plans/`。

## 輸入契約

頂層必須只有下列欄位：

- `schema_version: 1`、`mode: fresh`、`topology_profile: profile-a-four-host-basic`。
- `series` 固定 `required_successes: 3`，每份 plan 只代表 iteration 1～3 的其中一次；iteration 2／3 必須同時引用目前 generation 的前一份 immutable review-plan envelope，以及 `private/operations/fresh-rebuild/accepted-runs/` 內另行 hash-bound 的 acceptance record。planner 會核對同一 series 的緊鄰 iteration／generation／plan hash、V01～V04、residue、RTO 欄位與 evidence-index digest；caller 只填一組 ID/hash 不能自行宣告先前 run 通過。
  - 後續 iteration 的 `previous_accepted_run` 必須只有 `id`、`plan_sha256`、`generation`、`acceptance: {path, sha256}`；plan 由固定的 `review-plans/ID.json` 讀回，不接受 caller 自訂 plan path。
  - acceptance record 必須只有 schema／operation／status、plan identity、cluster／generation／series／iteration、`checks`、`rto` 與 `evidence_index_sha256`；status 為 accepted，V01～V04 與 residual check 全為 passed，RTO 同時記 total、provider queue、installation 及 1800 秒 candidate。
  - 前一份 plan 本身必須為 `decision: reviewable` 且 blockers 為空；兩次 plan 的 Git commit、artifact／upstream／core validation、provider／volume／OS scope 及 normalized desired-app digest 形成相同 campaign hash。prior token 必須等於前次 target token，下一次再使用不同 target token。
- `expected_cluster` 必須等於現有 `private/operations/cluster.json`；plan 只提出 `G → G+1`，不修改該檔。
- `controller_report` 及 `inventory` 都用 private relative path + raw SHA-256 綁定。controller report 必須在 24 小時內、來源 commit 格式正確，且 artifact／upstream／core validation digest 仍與本機檔案一致；planner 另在讀取 inputs 前後重讀本機 Git HEAD／project cleanliness，必須仍和 report 相同且乾淨。
- `host_intents` 依序精確列四台 alias／node、private reimage intent path 及 hash。每份 intent 重用 ERU-014 的人工 console 規則：`provider_api_used=false`、30 日內 owner review、精確 provider resource／OS image／machine ID／boot 及附加 volume。四台 provider／volume reference 必須全域唯一，且使用同一 OS image；拒絕 `*`、`all` 或任何隱含全選。
- `fresh_etcd` 固定 `mode: new-empty`、`restore_source: null`，且 target token digest 必須與 prior token digest 不同。snapshot、既有 data-dir、舊 membership 或舊 workload metadata 不屬此模式。
- `external_materials` 明確聲明 controller 外的 bootstrap secrets、provider console access 及 evidence store 是否可用，並只保存 attestation digest。
- `desired_apps` 必須是非空、logical name 唯一的 ERU-012 v1 無狀態 spec；image 必須 digest-pinned。plan 保存 normalized spec／spec hash／deterministic appname，後續仍須在新叢集上建立全新的 ERU-012 execution plan。
- `writer_quiescence_review` 與 `data_disposition_review` 保存 30 日內 owner review 及 evidence digest。`confirmed=false` 可留下 blocked plan，但不是執行前的即時證明。

## 固定安全語意

plan 永遠為 `executable: false`、`execution_implemented: false`、`remote_mutation_performed: false`。它依序描述 controller ready、scope review、writer quiescence、generation start、四台重灌、network/access、empty control plane、cluster bootstrap、app replay、V04 resource checks、residue audit 及 generation acceptance；每一 stage 都是 `implemented=false`／`checks_not_performed`。

fresh 與 V10 restore-control 完全分離。新 generation 只能從空 etcd 建立，舊 node／workload／plugin capacity 必須作為殘留失敗條件，而不是還原來源。四台重建後必須重新取得 host receipt／identity／host key，驗證 V01～V04、全 keyspace／runtime residue、總 RTO 與 provider queue／installation 分段時間。

V08 仍需三個分開 sealed、generation 單調遞增的實機 run；任一失敗都不能改名為成功或重播原 destructive plan。30 分鐘仍是 candidate RTO。ERU-014 的單 worker install／generation commit 不可拿來執行本 plan，因它保留控制面且只更新一台 worker。

## 本輪驗證邊界

本輪測試只在 temporary private fixtures 建立 review plan，涵蓋四台範圍、generation、fresh/restore 互斥、token、provider／volume、OS、app specs、external blockers、controller drift、series chain、private path／symlink／duplicate、hash 及 CLI redaction。沒有讀取真實 private 內容，沒有任何 VPS E2E。正式 ERU-015 仍為進行中，任務數不減。
