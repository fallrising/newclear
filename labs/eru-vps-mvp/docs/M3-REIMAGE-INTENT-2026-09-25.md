# ERU-014 人工控制台重灌 intent／receipt 前置（2026-09-25）

本紀錄交付 ERU-014 的離線計畫輸入核對，**不是重灌執行器，也不是 VPS 驗收**。仍由 owner 在 provider 控制台操作；不呼叫 provider API、不需要供應商 token。intent、provider 資源識別及實機資料只存於 `private/`，此 repo 不提供可直接套用的實機範例。

## 離線核對契約

`labctl plan --operation rebuild-node --node worker-4 --mode provider-reimage --reimage-intent private/reimage-intents/worker-4.json` 只接受 `private/reimage-intents/` 下的普通 `.json` 檔案。輸入必須包含且只包含 schema v1 欄位：

- `schema_version`：整數 `1`。
- `provider_api_used`：必須是布林 `false`。
- `provider_resource_ref`、`os_image_ref`：owner 在控制台核對的精確資源與 OS image 識別，不接受空字串、萬用值或控制字元。
- `target`：`alias`、`node`、`machine_id` 三者都必須與目前唯讀 snapshot 的 worker 身分完全一致。
- `erase_scope`：明確列出唯一 `boot_volume_ref` 與 `additional_volume_refs` 清單；沒有額外磁碟時仍填空清單。禁止萬用值、重複項目或把 boot volume 再列為額外 volume。
- `reviewed_at`：具時區的 ISO-8601 時間戳，最多 30 日；未來時間、過期時間及重複 JSON 欄位均拒絕。

支援 checkout 的 `private/` symlink 指向 repo 外私有資料目錄，但 intent JSON 檔本身不得是 symlink。plan 會保存正規化的 reviewed values，並以 `private/...` 邏輯路徑與 SHA-256 建立 private binding。輸入缺漏、範圍過大、target 身分不符、API 使用標記為 true、檔案在私有目錄之外或為 symlink 時，plan 會帶 blocker。plan 和 intent 都是私有操作資料，不得複製至公開 evidence。

## Owner receipt（只記錄人工聲明）

重灌完成後，owner 可在 `private/reimage-receipts/` 提供 schema v1 receipt，綁定 plan ID/hash、原 provider resource／OS image／volume scope 和舊 machine ID；另記錄新 machine ID、boot ID、OS release、provider console action reference、completion/review 時間、owner confirmation，以及從 provider console 帶外確認的 Ed25519 SSH host-key SHA-256 fingerprint。plan 必須沒有任何其他 preflight blockers；console 操作須在 plan 建立後 24 小時內完成，owner receipt 最晚於 7 日內確認。receipt 檔為普通 JSON，支援 checkout 的 `private/` 外接 symlink，但 receipt 本身不可為 symlink，也不可重複寫入同一 plan。

`python3 scripts/labctl.py record-reimage-receipt --plan PLAN_ID --sha256 PLAN_SHA256 --receipt private/reimage-receipts/worker-4.json` 只做本機 schema／hash／身份／時間核對，並要求 receipt 的 OOB fingerprint 與既有專用 alias trust file `~/.ssh/hzd-vps/known_hosts/disposable-04`（目標 alias 對應檔）完全一致，並把 trust file 路徑、指紋及檔案 SHA-256 一併寫入 immutable 的 private `owner-receipt-recorded` 記錄。owner 必須先在 provider console 核對 fingerprint，並自行完成本機 trust file 更新；此命令不連 SSH、不讀新 host、不呼叫 provider API，也不會寫入 `known_hosts`／verified key inventory、不會重新納管 worker、不會解除排程 fence，也不會把 plan 或 ERU-014 標成完成。它只核對 owner 的帶外聲明格式與綁定，不能證明 provider 操作或新機器狀態為真；新 host key 信任、worker-only bootstrap、註冊和 smoke 仍需分開驗證。

## 唯讀 replacement-host gate（尚未對 VPS 執行）

`python3 scripts/labctl.py verify-reimage-host --plan PLAN_ID --sha256 PLAN_SHA256` 僅在 owner receipt 已記錄後可用。它重核 plan、receipt 原始檔 SHA 與記錄時的 alias trust file SHA，然後只用 plan 綁定的 `ckc-disposable-02`～`04` alias，以 `BatchMode=yes`、`StrictHostKeyChecking=yes`、`UpdateHostKeys=no`、單一 alias trust file 執行遠端唯讀檢查。它比對新 machine ID、boot ID 與 OS release；要求 SSH、Tailscale、Docker、containerd active，Tailscale IPv4 屬於 tailnet 範圍，ERU runtime 為空，沒有 core／etcd／agent 殘留，並記錄 Docker／containerd 版本。通過結果只寫入 immutable private observation，包含新 tailnet IPv4；不輸出原始遠端 facts、不安裝元件、不註冊 node、不改 trust，也不解除 fence。

本機測試以 fake SSH runner 驗證 alias、strict options、identity／service／runtime gate 與 trust drift；沒有連線到任何 VPS。此 gate 是之後 bootstrap 前的唯讀核對，不是 ERU-014 E2E PASS。

## 尚未解除的執行 blocker

即使 intent 完全有效，plan 仍不可執行。目前沒有受控 drain／重新納管／resume adapter，也沒有新 host key 的 out-of-band 信任及 SSH／Tailscale／runtime bootstrap 流程。若 worker 尚有 ERU workload，必須先遷移並驗證；Docker workload 另需 ownership／遷移審閱。這些 blocker 保留了「日常元件重裝」與「人工 OS 重灌」的界線。有效 intent 不代表 owner 已經同意立即重灌，也不授權任何自動執行。

本機測試只使用暫存目錄與假資源識別，除 intent 的正／負案例外，也覆蓋 receipt 的舊／新 machine ID、boot ID、plan hash、resource／volume scope、owner confirmation、OOB fingerprint、freshness、symlink 與 duplicate keys；確認記錄不可覆寫、OOB fingerprint 與既有 alias trust file 不符時拒絕且不造成 remote mutation。正式 host identity、provider inventory、credentials、raw evidence 均未讀取或新增。驗證結果：`test_labctl.py` 42 tests 通過，完整離線套件 295 tests 通過；receipt／host verification CLI `--help`、Python compile 與 `git diff --check` 通過。

ERU-014 仍為進行中；intent／receipt 都只是離線前置，待本機開發收尾後才安排實機驗收。OS 版本、重灌後身分、host key、SSH／Tailscale／runtime／worker-only ERU bootstrap、重新註冊、HTTP smoke 與其他 worker 保留都須分別核對。詳見 [TASKS](TASKS.md) 與 [HANDOFF](HANDOFF.md)。
