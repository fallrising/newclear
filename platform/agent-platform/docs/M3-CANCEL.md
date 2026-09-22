# M3 第二個切片：安全取消

M3 recovery 已於 PR #22 合併（`d23df54`）。此切片完成 AT-08 的安全取消：OpenHands 任務可從工作台或 API 取消，排隊任務不會配置 VM，已配置任務則在確認原 VM 停止後才顯示 `cancelled`。**M3 尚未整體完成**；審批、暫停／恢復、egress／secret 與模型預算仍待開發。

## 取消契約

`POST /api/v1/runs/{id}/actions` 使用原有 operator session、CSRF、`Idempotency-Key` 與 `expected_state_version`。送出 `{"action":"cancel","expected_state_version":N}` 後回 `202`、`command_id`、`status`（pending／completed）與 run snapshot。

同 key／payload 重送得到原本的受理結果；不同 payload 回 409。這個結果是**命令受理收據**，不會隨 VM 狀態改寫。以 `GET /api/v1/runs/{id}`／工作台事件讀取目前狀態，`cancel_command_id`、`cancel_requested_at`、`cancel_completed_at` 提供追蹤。`commands.status=completed` 代表 API 收據已完成，不代表 VM 已停止。

| 取消時機／觀測 | 行為 |
| --- | --- |
| queued，尚無 binding | 同 transaction 撤銷 job 並標 cancelled，不需要 connector 或 VM；cleanup 保持 not_allocated |
| provisioning／running／interrupted | 保存取消意圖、提高 generation、撤銷舊 worker ownership，保持 cancelling，交由取消 worker 核對 |
| connector 尚無 allocation intent，DB 為 pending binding | 持久取消 tombstone，阻擋延遲 allocation；確認沒有 admission 後歸還 reservation |
| 已有 ownership 證據的 VM | 核對原 claim、template／資源、PID＋start ticks、VM ID／runtime directory／cgroup；要求 Agent Server interrupt，然後停止 VM |
| interrupt 失敗或逾時 | 不以 paused／ACK 當終止；仍要求停止已確認 ownership 的 VM |
| release ACK 遺失 | 保持 cancelling／unknown；下一次核對取得完整停止證據才完成，不盲目重送 release |
| node 不可達、停止證據不足、allocation ownership 不明 | 保持 cancelling／unknown 與 reservation，不顯示 cancelled，也不建立 replacement |
| finalizing | 回 409 finalizing，避免打斷已進入結果保存階段 |
| succeeded／failed／cancelled | 回 409 run_terminal，不改寫舊結果 |

取消 worker 沿用 30 秒 lease／5 秒 heartbeat 與持久 generation fencing。一般 worker 最多四個執行 slot，另有最多四個取消處理執行緒，避免四個 upstream 請求卡住時不能處理取消。這些取消執行緒不配置 VM、不增加 resource reservation。取消 worker 重啟後，recovery queue 保留 `cancelling` 意圖，每 30 秒再次核對不確定狀態。

Connector 私有 `POST /v1/runs/{id}/cancel` 沿用 loopback／token／Origin／大小限制，只接受 run ID 與 generation。取消 tombstone 與操作 intent 都寫入原私密 durable journal。較舊 generation 不得繼續寫入平台狀態、送 prompt 或執行新 mutation。API 受理與 connector 套用是非同步的；已進入 guest 的工作仍需停止，不承諾撤回已發生的外部副作用。

OpenHands interrupt 的 HTTP 等待上限為 10 秒；無論是否 ACK，均要求 release VM。完整停止證據仍包括原 VMM process 消失、VM record 消失、runtime/COW directory 消失、CPU scope 消失與 claim 消失。只有完整 proof 或持久的「沒有 allocation intent」證據可完成取消。配置 RPC 尚未回覆或 ownership 不明時仍需等待核對；這種情況不以逾時當成成功。

API 的取消受理與 worker 的 `run.cancel_completed` 都記入 audit，事件保存 command ID 與停止證據。`004_cancel.sql` 加入追蹤欄位；升級沿用 drain、migrate、worker／connector 一起更新的方式。保留原 journal／fences 與 DB generation。

## 工作台

OpenHands run 啟用取消，finalizing／終態／已在取消時禁用。受理後顯示「正在取消」與容量仍保留；node 失聯仍顯示核對中。丟失回覆後可用相同 command key 重試，不把重複點擊當成另一份取消命令。Fake backend 仍不宣告 cancel capability；暫停／繼續／審批繼續禁用。

## 驗收與重跑

- 15 項新增 PostgreSQL／HTTP 驗收：排隊取消、配置前 tombstone、配置後取消、running、重送與 payload conflict、六個並行取消、授權／CSRF、finalizing／終態拒絕、node partition、未知 allocation／prompt、interrupt 失敗、release 回覆遺失、停止證據不足，以及取消 worker 重啟／run deadline 過期。
- 獨立 CLI process 的四個普通 worker 同時卡在 HTTP 回覆；仍可接受取消並停止目標 VM fixture，另外三個 run 正常完成，舊 worker 回覆不覆寫 cancelled。
- 工作台增加兩項互動驗收：pending 不假裝已取消、回覆遺失以原 idempotency key 重送。
- [真實 KVM](evidence/m3-cancel-kvm-2026-09-22.json)：provisioning 取消與 OpenHands 已開始的 120 秒 terminal 命令取消；完整停止證據及 zero VM／claim。
- [同 VM 恢復回歸](evidence/m3-cancel-recovery-2026-09-22.json)：allocate ACK、prompt ACK、event commit 三個 SIGKILL 時點仍恢復原 instance，初始 prompt 不重送。
- 測試與來源 hashes 見 [彙整 evidence](evidence/m3-cancel-2026-09-22.json)。

```bash
make platform-check
make web-check
python scripts/test-postgres.py python scripts/m3-recovery-kvm.py \
  --config /private/path/connector.json \
  --origin http://127.0.0.1:17888 \
  --scenario cancel --output .artifacts/m3-cancel-new
```

KVM driver 只接受專用 empty／zero-warm node 與 `agent_platform_test` DB。長命令情境由 test driver 在已確認 ownership 的 guest 內，替換 loopback 固定 fixture model 的回覆，要求真實 OpenHands terminal 工具寫入 started marker 並 sleep 120 秒；不修改產品 prompt、profile 或加入任意執行後門。API、worker、connector、Agent Server 與 VM 停止走產品流程。測試結束停止本次服務、移除 task-owned PostgreSQL，私密 journal 留在 repo 外。

## 下一步

AT-06 的 approval（固定 action digest／generation／expiry／競爭與 replay）及安全 pause／resume；接著 AT-07 egress／secret 與 AT-11 model proxy／reservation／settlement／usage。取消不等於審批或安全暫停，固定模擬模型也不等於通用自然語言 coding agent。M4 的 artifact 封存、明確授權 export、備份／GC 與部署 gate 保持原範圍。
