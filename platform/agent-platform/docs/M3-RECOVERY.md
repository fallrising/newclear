# M3 第一個切片：worker 恢復與租約 fencing

本文件保留 recovery 切片交付時的行為；最新取消功能與剩餘工作見 [M3 cancel](M3-CANCEL.md)。

M2 已於 PR #21 合併（`75d9c08`）。此切片提供 AT-04／AT-05 的 worker 重啟、未知回覆、node partition 與舊 generation 驗收；**M3 尚未整體完成**。審批、取消／暫停／恢復、受控 egress、model proxy、預算／用量與完整 audit 仍待開發。OpenHands 仍使用固定模擬模型，不需要 provider key。

## 恢復行為

Worker 每 5 秒續 30 秒 DB lease，commit 後才把同一到期時間交給私有 connector。Connector 把 generation／到期時間 fsync 至獨立的 `state_dir/fences/`，可在耗時的 VM 操作仍持有 run lock 時續租。過期 lease 與較舊 generation 的新操作均拒絕；接管不代表已停止先前進入 guest 的命令。

過期 real-runtime job 進入 recovery queue，取得 ownership 時在同一 DB transaction 提高 run／job／binding generation。原 run、attempt、sandbox binding 與 reservation 不變，恢復不受剩餘新任務 slot 限制。Connector 先核對原 claim、固定 template／資源、VMM PID＋start ticks、VM ID、runtime directory、cgroup，準備後另核對 pinned Agent Server 與 conversation ID。

| 持久化證據 | 接續方式 |
| --- | --- |
| 尚無 allocate intent，DB 仍是 pending binding／provisioning | 可首次配置；不建立第二份 reservation |
| allocate 已完成，prepare 尚未開始 | 接回同一 VM，首次 prepare |
| prepare 已完成，prompt 尚未開始 | 接回同一 conversation，首次 prompt |
| prompt 已完成 | 只從 DB backend cursor 讀取後續事件，絕不重送初始 prompt |
| result 已完成 | 重用已保存結果，完成 DB transaction 與 cleanup |
| release 回覆遺失，或 VM TTL 到期 | 核對全部停止證據與 claim 消失後才歸還容量 |
| allocate／prepare／prompt／result 已開始但結果不明 | 保持 interrupted／unknown，不重送該操作；既有 VM 仍占容量 |
| node 不可達、VM 身分不同、conversation 不一致 | 保持 interrupted／unknown，不配置 replacement |
| 已有 binding／conversation，但 connector journal 缺失 | 拒絕重新配置，等待處理 |

未知操作每 30 秒再次**核對**，不代表每 30 秒重送 mutation。沒有保存 handle 或 VMM ownership 的未知 allocation，仍需管理員對帳；即使 claim-list 空了，也不能自行推論停止證據。Known VM 若已完全消失且沒有保存結果，run 以 `runtime_stopped_before_result` 失敗；不虛構成功結果。終態 run 只處理清理，不重開執行。

`003_recovery.sql` 加入 `interrupted_from`、`reconciled_at` 與 recovery index。事件保存來源 ID／cursor、已保存結果與 cleanup 事件去重；`runtime.reconcile` audit 記錄 run 與接管 generation。Run API 保留原中斷階段與成功核對時間，工作台既有活動流顯示 `runtime.reconciled`、state 與 cleanup 事件。

## 邊界與升級

- 這是同一 VM／conversation 的 worker reattachment，並非從 VM snapshot 或重新啟動 Agent Server 恢復工具執行。`durable_resume` 與 UI 的 pause／resume／cancel／approval capability 仍為 false。
- Connector 信任私有 worker 提供已 commit 的 DB lease；瀏覽器不能取得 connector token。部署仍限單主機且 DB／worker／connector 時鐘一致，不宣稱跨主機 clock-skew 容錯。
- 先 drain、完成 active 工作，再更新 worker／connector 並執行 `agent-platform migrate`。兩者須一起更新：M3 connector 要求 lease grant，舊 worker 沒有此協定。保存原 journal／fences，不重設 state directory 或 DB generation。
- 新增私有 `PUT /v1/runs/{id}/lease` 與 `GET /v1/runs/{id}?generation=N`；沿用 loopback／token／Origin／body limit，inspect 回傳不含 guest token、session key 或 host path。
- 舊 M2 unknown 操作依證據繼續 quarantine，沒有資料補寫就不猜測原狀態。Fake backend 的已執行故障仍維持原有 quarantine；此切片專注真實 runtime connector 路徑。
- 憑證、固定 repository bundle、none lane、固定模型及上游版本沿用 [M2](M2.md)。沒有新增 provider／GitHub 寫入或部署能力。

## 驗收

一般 CI 使用真實 PostgreSQL、真實 HTTP connector、獨立 worker process 與 deterministic upstream。VM／Agent Server 模擬僅在 fixture 邊界；產品的 SQL、lease、journal、inspect、事件匯入與 cleanup 路徑均實際執行。

新增 19 項測試，包含九個 SIGKILL 時點：allocate 前／ACK 後、prepare ACK 後、prompt 前／ACK 後、來源事件 transaction commit 前／後、result ACK 後、release ACK 後。另驗證 allocation／prompt 回覆遺失、connector 重啟、並行六 worker 搶 recovery、node partition、PID 重用、缺 journal、停止證據不足、DB lock 等待期間 lease 到期，以及 run lock 不阻擋接管 fence。

```bash
make platform-check
```

真實 KVM acceptance 另外執行三個 SIGKILL 案例（allocate ACK 後、prompt ACK 後、事件 commit 前），核對同一 VM／handle、generation 1→2、初始 user message 只有一筆、來源事件去重、diff、四項停止證據及零殘留：

```bash
python scripts/test-postgres.py python scripts/m3-recovery-kvm.py \
  --config /private/path/connector.json \
  --origin http://127.0.0.1:17888 \
  --output .artifacts/m3-recovery-new
```

需要已啟動的專用 empty／zero-warm node 與 connector；只允許 `agent_platform_test` DB。Test driver 在殺掉 worker 後，把該 dead worker 的 DB lease 調整為過期以縮短等待；實際接管走產品 recovery queue。這不是正式產品 API。Finalizer 只處理自己記錄且已確認 ownership 的 VM，不以虛構 lease 繞過 fencing。

證據：[恢復 KVM report](evidence/m3-recovery-kvm-2026-09-22.json)、[M2 四 VM 回歸](evidence/m3-m2-regression-2026-09-22.json)、[驗收彙整](evidence/m3-recovery-2026-09-22.json)。測試結束均確認 zero VM／claim，停止測試 connector／sandboxd，刪除 task-owned PostgreSQL；私密 journal 保留在 repo 外。

## 下一個切片

先完成安全取消與 pause／resume／approval（AT-06／08）：queued、provisioning、長命令與 node 不可達時的觀測語意，approval 綁固定 action digest／generation／expiry。再加入受控 egress／secret 驗收（AT-07）與 model proxy／request reservation／settlement／usage（AT-11）。完成這些才可把 M3 標成 Passed；M4 仍負責 artifacts、明確授權 export、備份／GC 與 MVP 部署 gate。
