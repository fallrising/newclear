# M3 第三個切片：工具審批

> 2026-09-23 更新：同 UID terminal 讀取 guest session key 的缺口已由 [控制憑證隔離切片](M3-GUEST-ISOLATION.md) 修復，並重跑本文控制流程。以下歷史證據與當時邊界保留；最新部署須使用獨立非 root 控制帳號與固定 launcher。


Recovery（PR #22）與安全取消（PR #24）已合併。此切片完成固定 OpenHands／none-lane 模式的 AT-06 審批流程：工具先提出動作，operator 查看完整參數後核准，connector 再核對同一批動作才放行。**M3 尚未整體完成**；egress／secret 驗收及模型預算仍待開發；後續安全 pause／resume 已見 [M3 pause](M3-PAUSE.md)。

## 開啟與使用

新增 OpenHands Agent 設定時，選擇「每批工具操作都需核准」；API 為 `POST /api/v1/agent-profiles` 的 `require_approval: true`。既有 profile 不變，新 profile 的 API 預設仍為 false，保留固定模擬模型的自動驗收模式。Fake backend 拒絕啟用審批。Profile revision 不可修改；run 保存當次設定。

工具動作尚未執行時，run 進入 `awaiting_approval`。工作台列出完整 terminal 參數、有效期限與核准／拒絕按鈕。等待時仍占 VM 與容量；五分鐘或 run deadline（取較早者）後，這份核准失效。過期可核對原 VM 後產生新世代的審批，舊核准不再有效；run deadline 不會因此延長。

核准只授權顯示的整批動作一次。拒絕會撤銷待執行動作並走安全取消流程，確認 VM 停止後才是 `cancelled`。已核准的決策不能再改為拒絕；若要停止後續工作，使用取消。API 受理與 connector 套用之間為非同步，取消不能撤回已送出的動作或已發生的副作用。

固定模型仍只修改 `m2-result.txt`，沒有付費 provider、任意自然語言 coding 或 external write credential。審批不是 shell 命令的安全分類器；此切片依賴既有 none-lane、私有 connector 與固定工具清單。

## 契約

- `GET /api/v1/runs/{id}/approvals`：登入後讀取此 run 的審批紀錄，包含 normalized action、digest、generation、policy revision、expires_at、decision、decided_by、status 與 applied_at。
- `POST /api/v1/approvals/{id}/decision`：沿用 operator session、CSRF 與 `Idempotency-Key`，body 為 `decision: approve|deny`、`action_digest`、`generation`、`expected_state_version`。
- 正確決策回 202 pending；它表示受理，不代表工具已完成。同 key／payload 重送回原收據；同 key 不同 payload、不同 key 的第二次決策、逾期、世代或內容不符均回 409。
- 決策 transaction 依 job → run → approval 順序加鎖；只允許 live worker lease、目前 awaiting_approval 狀態與 pending grant。兩個分頁競爭只有一個決策成功。
- Digest 綁定 run、generation、`always-confirm-v1` policy、完整有序批次的 action/event/tool-call ID、工具名稱與所有 action 參數。最多 16 個 terminal 動作、32 KiB，不能截斷參數後讓人審批。已知 connector／sandbox／session secret 出現在參數中時，拒絕產生審批內容。
- 核准送出前，connector 核對原 VM ownership、固定 conversation、AlwaysConfirm policy、穩定的待審批 history、整批 digest、到期時間與 live generation fence。完整動作不符就不送出核准。
- Connector 在上游核准前持久記錄 intent；完成收據可重播而不重送。若上游回覆不明，保留 reservation／interrupted，不盲目再核准。已完成 connector 收據、但 worker 尚未保存的情況，可在恢復時補上 applied 與 audit。
- Worker 接管提高 generation。尚未送出的舊核准失效，必須在新 generation 重新審批；原 VM 與 prompt 不重建。新動作參數也會使舊審批失效。
- `approval.requested/decided/applied/invalidated/expired` 與相關 audit 保存在 DB。`applied` 表示核准已送出並取得 ACK；工具完成仍以後續事件及 run 結果為準。`tool.proposed` 不表示命令已執行。

上游固定 commit `856d99d48e4b11c70c5f1cab21e7830570dbc324` 的 [confirmation handler](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/openhands-agent-server/openhands/agent_server/event_service.py) 會對當前整批 pending actions 呼叫 run；沒有 action digest 參數。平台因此在私有 connector 的單一 writer lock 下重新核對完整批次，不對外開放 Agent Server 的直接寫入、history branch 或 profile mutation。對話須保持這個受控寫入前提；不宣稱能對抗繞過 connector 的管理員或任意 guest exploit。

[AlwaysConfirm](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/openhands-sdk/openhands/sdk/agent/agent.py) 會在 terminal 動作執行前等待確認；單一 Finish／Think 是上游明確排除的內部動作。此模式沒有替換上游或在 host 執行任意工具。

## 暫停的界線

本審批切片驗收時，一般 pause／resume 能力仍為 false；後續實作與目前能力見 [M3 pause](M3-PAUSE.md)。固定版本的 [pause implementation](https://github.com/OpenHands/software-agent-sdk/blob/856d99d48e4b11c70c5f1cab21e7830570dbc324/openhands-sdk/openhands/sdk/conversation/impl/local_conversation.py) 先設定 paused，再由 run loop 在步驟間停止；paused 或 interrupt ACK 不能單獨證明 terminal／背景程序均已停止。本切片提供「工具送出前等待審批」，沒有把它當成一般安全暫停。後續須建立工具收尾與 resume 對帳契約再開啟。

## 驗證與升級

新增 16 項 PostgreSQL／HTTP 審批測試與三項 UI 互動測試。包括完整批次、六個決策競爭、重播、參數變更、逾期、未知回覆、已完成收據恢復、worker 接管、舊 generation、取消／拒絕、CSRF／auth 及已知 secret 不進入審批。真實 KVM 核准與拒絕案例都確認決策前 `m2-result.txt` 尚不存在；核准後才產生 diff，拒絕則不執行並確認 VM 停止。另重跑配置中與 120 秒命令的取消回歸。

證據：[彙整](evidence/m3-approval-2026-09-22.json)、[真實 KVM](evidence/m3-approval-kvm-2026-09-22.json)、[取消回歸](evidence/m3-approval-cancel-2026-09-22.json)、[同 VM 恢復回歸](evidence/m3-approval-recovery-2026-09-22.json)。

```bash
make platform-check
make web-check
python scripts/test-postgres.py python scripts/m3-recovery-kvm.py \
  --config /private/path/connector.json --origin http://127.0.0.1:17888 \
  --scenario approval --output .artifacts/m3-approval-new
```

升級需先 drain、套用 `005_approvals.sql`，再一起更新 API／worker／connector／web。保留既有 journal、fences 與 generation；不要在有 active run 的情況切換 worker／connector 契約。

目前下一步：AT-07 egress／secret 與 AT-11 model proxy／budget／usage。M4 artifact／export／備份／GC／production gate 保持原範圍。
