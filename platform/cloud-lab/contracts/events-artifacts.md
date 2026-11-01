# Events、artifacts 與結果驗證

> 下文保留 M0 設計基線。已授權 M1 開發的實作範圍、協定差異與限制見 [M1 實作契約](../docs/m1-implementation.md)；M0 提案不代表所有 operation 已實作。
狀態：**Proposed／spec-only**。本合約沒有事件串流、上傳或下載端點；[commands-runs](commands-runs.md) 定義權威與對帳。

## 事件 envelope 與順序

`Event` 含 `schema_version: cloudlab.event.v1`、`schema_minor`、`event_id`、`workspace_id`、`command_id`、`external_ref`、`dispatch_attempt_id`、`fence`、`source_seq`、`type`、`observed_at`、`payload`、`payload_digest`；接收端另寫 `received_at`、principal、request_id、驗證結果及 D1 revision。type 限 `external.bound`、`run.observed`、`run.result`、`cancel.observed`、`reconcile.observed`。每筆回呼依 [identity](identity.md) 驗身分。

`source_seq` 是同一 external_ref 下由 adapter durable 配發的正整數，只提供該來源順序，不能宣稱跨 command 全域排序。去重鍵為 `(adapter_id, event_id)`；比較接收端計算的完整 Event 原始 bytes digest，不能只比 payload_digest。相同內容回原 durable ACK，不重做投影；不同 digest 是 `EVENT_CONFLICT`，隔離並稽核。transaction 內同時寫 inbox、可接受的投影 revision 與後續 outbox；只有 durable commit 後 ACK。至少保留去重紀錄至該 command 的冪等保留期屆滿。

亂序可保存，但有 gap 的較高 seq 不直接推導成功；M1 每 external_ref 最多暫存 32 筆／256 KiB，超限回 `EVENT_WINDOW_EXCEEDED` 並要求 owner snapshot 對帳。補齊或已驗證 snapshot（含 covered-through seq）後才前進投影。舊 seq 不回退狀態，矛盾終態標 conflict／reconciling，不以「最後到達」取勝。舊 fence 事件保留隔離證據，由當前 fence 的對帳回報補證，不能直接提升為目前結果。

polling 使用 opaque cursor、每頁最多 100 筆，重讀允許重複；cursor 過期回 `CURSOR_EXPIRED` 並要求 snapshot。通知、DO、Queue 與 Workflow 皆為可重建投影或傳輸提示，不持有原生 execution truth。

## Result 與 validation

`Result` 含 `schema_version: cloudlab.result.v1`、`schema_minor`、`command_id`、`external_ref`、`dispatch_attempt_id`、`fence`、`owner_outcome`（succeeded／failed／stopped／timed_out）、`started_at`、`finished_at`、`owner_evidence_ref`、`output_digest`、`truncated`、`artifact_refs`、`validation`。不知道終態時只送 run.observed unknown，不填虛構 finished_at／result。

接收端另產生 `late` metadata（received_at > command execution_deadline），不是 Result payload 欄位。呼叫端送入 late 依未知欄位規則拒絕；晚到與 owner finished_at 是否超期分開顯示，不以網路延遲改寫 owner_outcome。

`validation` 含 `validator_id`、`validator_version`、`recipe_digest`、`status`（passed／failed／incomplete）、最多 16 個具名 `checks`（name／status／reason_code）、`evidence_refs`、`validated_at`。驗證器使用固定 recipe 規則，不執行模型建議。Cloud Lab 驗證來源、schema、scope、digest、預算、時序與必需 checks；身份／scope／schema 合法的終態證據即使 recipe validation failed／incomplete，仍保存為 result_recorded。只有 owner 的 succeeded 加 validation passed 且證據完整，才顯示有效成功。owner succeeded 但驗證失敗應顯示 validation_failed，資料不足為 incomplete，不能刷成綠色。

執行健康檢查成功與節點健康分開：例如 schema 通過、實際讀到 unhealthy，是成功取得「不健康」觀測；owner failure 則沒有有效健康結論。缺資料不得用零值代替 unsupported。輸出被截斷且缺必需欄位，validation 必為 incomplete。原生停止證據由 owner 提供，模型文字、退出碼單一值或空 artifact 不能單獨證明後代程序已停止。

## 有界 artifact

`ArtifactMetadata` 含 `artifact_id`、workspace／command／external_ref、`kind`、`media_type`、`sha256`、`size_bytes`、`created_at`、`expires_at`、`classification`、`producer`、`validation_status`。M1 每 result 最多 4 個物件，合計 ≤16384 bytes，單物件 ≤16384 bytes；不接受壓縮包、HTML、可執行檔、任意遠端 URL 或外部 fetch 指令。kind 限 health-json／diagnostic-text；media type 限 application/json／text/plain，UTF-8。

metadata 先驗 scope／大小，內容寫入私有儲存後核對實際 bytes／digest／type，只有驗證完成才可引用為證據；未完成物件標 pending，不得算成功。以有界 streaming 拒絕超限資料，不先全量載入。上傳 ticket（若後續採用）須一次性、短效、限定 workspace／object／bytes，不能是 bucket-wide token。

artifact ACL 與 command 閱讀分開，ReadArtifact 必須有 `artifact:read` 且通過該物件 ACL，下載時重新驗權；`commands:read` 只可看證據 metadata。回傳 opaque artifact ref，不在事件內公開 bucket key、秘密或長效 signed URL。M1 擬定 retention 7 天，屆期內容刪除後保留 digest／到期 metadata 與稽核；顯示 evidence_expired，不能宣稱仍可回讀原證據。刪除／保留的實作與租戶政策仍須後續 gate。

## 合成事件／結果摘錄

健康檢查 command `cmd_demo_1` 使用 `attempt_demo_1`、fence 1、external_ref `{owner: "node-check-owner", adapter_id: "adapter_demo", external_id: "check_demo_1"}`。`evt_demo_1`／seq 1 為 external.bound；`evt_demo_2`／seq 2 為 run.observed running；`evt_demo_3`／seq 3 為 run.result。

最後一筆 owner_outcome=succeeded，started_at=`2026-10-26T00:00:03Z`、finished_at=`2026-10-26T00:00:05Z`；health-json 內容是 `{ "status": "healthy", "sample_age_seconds": 2, "checks": { "collector": "ok" } }`。output digest 由這份實際 bytes 計算；文件不捏造其 hash。validation 的三項必需 checks 為 schema、freshness、scope，全為 passed，validator 為 `node-health-validator@1.0.0`。所有 body 均受 32 KiB 上限、output 受 16384 bytes 上限，範例不是已保存的 artifact。

## M1 snapshot profile的具體對映

[PS輪詢順序與恢復](../docs/snapshot-ordering.md)沿已授權ADR-03／08明列通知／Event提案與現行profile的差異：commit後ACK遺失靠持久command重讀，完整snapshot以command revision防倒退／衝突並可跳版。這不是Event source_seq或covered-through snapshot相容實作，原事件要求沒有被記成passed；採用事件協定時仍須獨立實作與驗證。
