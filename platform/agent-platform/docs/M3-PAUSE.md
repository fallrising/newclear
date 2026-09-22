# M3 第四個切片：安全暫停與恢復

固定 OpenHands／Cocoon none-lane 模式現在提供工作台及 API 的 pause／resume。暫停先關閉新的 terminal admission，再確認目前工具收尾與 guest 程序回到執行前基準；恢復接續同一 VM／conversation。**M3 尚未整體完成**；AT-07 egress／secret 與 AT-11 model proxy／budget／usage 仍待開發。

## 操作與狀態

- OpenHands run 已觀測到初始 prompt、處於 `running` 或 `awaiting_approval` 時可暫停。尚在配置、finalizing、終態與 fake backend 不提供此操作。
- `POST /api/v1/runs/{id}/actions` 沿用 session、CSRF、`Idempotency-Key` 與 `expected_state_version`。`action: pause|resume` 回 202 pending；相同 key／payload 回原收據，不同 payload 或 stale state version 回 409。
- `running/awaiting_approval → pausing → paused → resuming → running/awaiting_approval`。受理請求不表示工具已停止或恢復完成；請求抵達 connector 前已派送的操作仍可能繼續。
- 暫停保留原 VM、workspace、binding、reservation 與原期限，每 30 秒重新核對；尚未收尾時每秒排程核對。失聯或證據不一致保持 pausing／resuming、容量不釋放，不能把 ACK 當成成功。
- 暫停及恢復都提高 generation、撤銷舊 worker lease 與尚未套用的審批。啟用審批的 run 恢復後，未執行批次必須取得新的 generation-bound grant；恢復本身不核准工具。
- 可在 pausing／paused／resuming 取消。取消撤销控制意圖，沿用原 VM 四項停止證據後才釋放容量。原期限到達時，控制 worker 停止 VM 並核對回收，標記 `failed / run_deadline_expired`，不先恢復執行。
- 四個控制執行緒獨立於四個普通執行緒。恢復完成即交回普通 queue，控制執行緒不長期執行 agent。所有已配置的任務仍共用全平台四個 reservation 上限。

工作台顯示等待／暫停／恢復狀態、容量及期限語意。HTTP 回覆遺失時保留原命令 key、動作與 state version，先確認該請求，避免重試時變成另一個動作。

## 安全判定

固定 SDK 的 native `paused` 或 `/interrupt` ACK 不能證明工具程序已結束。本切片不使用它們作為 pause proof，也不使用 VM hibernate／snapshot 或 host shell fallback。

1. 初始 user message 以 `run=False` 送入後，SDK 已初始化 terminal，尚未執行工具。Connector 執行固定 root-owned guest probe，保存 boot ID 與 UID 2000（agentprobe）的 PID／start ticks／executable／cmdline hash 基準。原始命令與 private full_state 不會進入平台事件。
2. Pause intent 與 admission policy 操作先持久寫入私密 journal，再把 policy 設為 AlwaysConfirm。固定工具只有 terminal；上游單一 Finish／Think 的例外不會 dispatch terminal。
3. REST ConversationInfo 讀 autosaved state，控制操作後可能仍是舊值。因此控制及其後的 conversation 觀測改用每次新 WebSocket 訂閱、在 conversation lock 下產生的 `full_state`；只提取 ID、execution_status、confirmation_policy、leaf_event_id。它不是持久 history event，不加入 SSE 重播。
4. 必須觀測到 AlwaysConfirm、`waiting_for_confirmation` 或 `finished`、前後一致的 live boundary，以及相同 boot／程序基準。Probe 在兩次穩定掃描中比對；掃描時程序消失視為不確定。額外背景程序、PID 重用、exec replacement、guest／server 重啟、缺失基準、無法讀取 probe 均不能宣告 paused。
5. 完整 bounded history 中有 terminal soft timeout、缺 exit code 或未知工具時，保守維持 pausing。即使相關程序後來消失，也不把未證實收尾的舊工具觀測自動升級為安全；可取消或等待期限回收。
6. Worker 只接受完整四項布林 proof：`admission_closed`、`at_tool_boundary`、`same_boot`、`same_processes`。暫停完成與恢復完成各保存一次 event／audit；週期核對不重複完成紀錄。

Resume 再核對同一 VM、pause intent 與新鮮 quiescence proof。原 policy 為 NeverConfirm 時，還原 policy 並至多送一次 `/run`；已 finished 的 conversation 不重啟。原 policy 為 AlwaysConfirm 時保留 pending batch，交由新審批決策處理。即時觀測確認原 policy 與可接續狀態後才完成 resuming；不重新配置 VM、不重送初始 prompt。

所有 mutation 受 generation fence 與 connector 單 writer lock 保護。已完成的 durable resume receipt 可在回覆遺失後讀回；未知 `/run` 回覆不重送，保留 resuming 與容量。關閉 admission 的 policy write 可依同一 writer 下觀測到的 AlwaysConfirm 對帳，不以此推論未知工具已完成。固定 probe 的 SHA-256 也必須符合目前 connector 原始碼。

上游依據均固定在 commit `856d99d48e4b11c70c5f1cab21e7830570dbc324`：[state lock／policy／run loop](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py)、[live full_state](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/openhands-agent-server/openhands/agent_server/event_service.py)、[autosaved REST state](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/openhands-agent-server/openhands/agent_server/conversation_service.py)、[terminal observation](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/openhands-tools/openhands/tools/terminal/definition.py)。

## 驗收與範圍

新增 18 項 PostgreSQL／HTTP 整合測試與四項 UI 互動測試；涵蓋競爭、舊 generation／grant、背景程序、soft timeout、失聯、ACK 遺失、完成收據恢復、週期核對、控制 worker 交接與到期回收。真實 KVM 六案例：自動模式恢復、審批模式重新核准、背景程序等待、執行中命令收尾、暫停後取消、暫停後到期；另回歸同 VM recovery、cancel、approval。

證據：[彙整](evidence/m3-pause-2026-09-22.json)、[六個 KVM 案例](evidence/m3-pause-kvm-2026-09-22.json)、[recovery](evidence/m3-pause-recovery-2026-09-22.json)、[cancel](evidence/m3-pause-cancel-2026-09-22.json)、[approval](evidence/m3-pause-approval-2026-09-22.json)。

```bash
make platform-check
make web-check
python scripts/test-postgres.py python scripts/m3-pause-kvm.py \
  --config /private/path/connector.json --origin http://127.0.0.1:17888 \
  --output .artifacts/m3-pause-new
```

本驗收限固定私有、單 writer、非 root agentprobe、terminal 工具、none-lane guest 與模擬模型；不是任意 tool／daemon、付費 provider、guest exploit 或直接修改 Agent Server 的保證。兩次程序快照只是整體判定的一部分，不能獨立替代 admission barrier 與持鎖的工具邊界。VM 暫停時仍運行服務、保留資源，不是節省 VM 費用的 hibernate。

升級先 drain，再套用 `006_pause.sql` 並一起更新 API／worker／connector／web；保留 journal／fences／DB generation。舊 active journal 沒有 pre-tool process baseline，不能推定可安全 pause。下一步是 AT-07／AT-11；M4 artifact／export／backup／GC 與 production gate 保持原範圍。
