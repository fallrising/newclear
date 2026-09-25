# ERU-014 人工控制台重灌 intent 前置（2026-09-25）

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

## 尚未解除的執行 blocker

即使 intent 完全有效，plan 仍不可執行。目前沒有受控 drain／重新納管／resume adapter，也沒有新 host key 的 out-of-band 信任及 SSH／Tailscale／runtime bootstrap 流程。若 worker 尚有 ERU workload，必須先遷移並驗證；Docker workload 另需 ownership／遷移審閱。這些 blocker 保留了「日常元件重裝」與「人工 OS 重灌」的界線。有效 intent 不代表 owner 已經同意立即重灌，也不授權任何自動執行。

本機測試只使用暫存目錄與假資源識別，覆蓋正確綁定、錯誤 machine ID、provider API 標記、磁碟萬用值／重複值、過期時間、目錄外檔案、symlink、重複 JSON key，以及非 provider-reimage 旗標使用。正式 host identity、provider inventory、credentials、raw evidence 均未讀取或新增。驗證結果：`test_labctl.py` 33 tests 通過，完整離線套件 282 tests 通過；`labctl plan --help` 與 `git diff --check` 通過。

ERU-014 仍為進行中；待本機開發收尾後才安排實機驗收。OS 版本、重灌後身分、host key、SSH／Tailscale／runtime／worker-only ERU bootstrap、重新註冊、HTTP smoke 與其他 worker 保留都須分別核對。詳見 [TASKS](TASKS.md) 與 [HANDOFF](HANDOFF.md)。
