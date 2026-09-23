# AT-11-B：guest model transport 與 SDK 工具呼叫

本切片將固定 OpenHands 1.49.2／`856d99d48e4b11c70c5f1cab21e7830570dbc324` 的模型請求接到 AT-11-A 的控制端 admission／ledger。**已接通的是明確啟用的本機 fixture 模型；沒有付費 provider、自然語言 coding、streaming、可信 token／金額硬上限或 usage UI。完整 AT-07／AT-11／M3 保持未完成。**

## 路徑與權限

```text
Guest SDK → guest loopback mailbox (UID 2001)
                    ↑ authorized sandbox port relay
              connector ← worker / ModelProxy → host loopback fixture
                                      ↓
                              PostgreSQL admission / ledger
```

Guest 不主動連控制面。Worker 經私有 connector 拉取 mailbox，再在控制端呼叫同一個 `ModelProxy` 實作；模型網路 I/O 不持有 DB 或 connector run lock。AT-11-A 的獨立文字 HTTP endpoint 仍可使用，但本整合不經該 endpoint，不額外提供遠端 token 發放 API。

- `guest_model.py` 與 Agent Server 同為 UID 2001；terminal 為 UID 2000。Mailbox 只綁 guest `127.0.0.1:18080`，沒有 outbound client、目的地欄位或 provider key。
- SDK 的 local key 與 mailbox relay 使用的 session key 是各 VM 的獨立控制憑證；它們不授權模型上游。短效 `mp1_` token 另由 worker 發放，guest mailbox 持有並隨請求回傳，控制端逐次檢查 run／generation／owner／live lease／binding／deadline。不能把 local/session key 說成五分鐘 proxy token。
- 上游 fixture credential 留在控制端。Connector 只持有 run token；guest 不持有 DB、node、connector 或上游 master key。
- Token 更新使用相同受認證 relay 與 `(generation, revision)` 單調版本。重複相同更新可確認，較舊版本或相同版本換值均拒絕。Worker 在 active pump 中每 120 秒更新，token 最長五分鐘且不超過 run deadline；沒有 pending upstream I/O 時才換 token。恢復接管會重新發放，新 token 不重設額度。
- Awaiting approval／pausing／paused／resuming／取消／失去 lease 時不受理新模型請求；恢復為 running 並取得 live binding 後才重新發放或使用憑證。
- Connector 私密 journal 保留發放過的 token，以涵蓋輪替後的原樣憑證輸出遮蔽；事件、審批與 diff 同時涵蓋 local key。這仍不是任意編碼的防洩漏保證。

模型通道不修改 sandboxd egress。驗收使用 proxy 已啟用的 explicit deny-all、none lane 與固定 sealed node；**沒有 private-IP override、全節點私網例外、NIC 或 host shell fallback**。

## 固定 SDK dialect

SDK 明確使用 `openai/gpt-4o-mini` 作為 fixture wire dialect，4096 output-token request 參數、temperature 0、`stream=false`、`num_retries=0`。這不是使用 OpenAI provider，也沒有 OpenAI credential。

控制端只接受 system／user／assistant／tool 訊息，文字或 text parts；terminal／finish／think 三種 function 定義。涵蓋實測的 assistant tool_calls 省略 content、tool message 的 name／tool_call_id、`max_completion_tokens`，正規化後送給固定上游。拒絕額外 provider options、任意 endpoint、multimodal、streaming、parallel_tool_calls=true、未匹配 tool ID 或未允許的工具。請求正規化後最多 128 KiB、回應 256 KiB。

工具回應必須是單一 assistant choice、已登錄的 function、合法 object arguments、唯一有界 call IDs；usage 沿用 AT-11-A 的整數、總和與 output 上界驗證。此驗證不等於有可信 tokenizer／價格或真實帳單。上游僅產生固定 `m2-result.txt` 修改與 Finish；不在 host 執行工具。

## 不重送與收尾

1. Mailbox 以 UUID 識別一個 SDK request，先 fsync 私密狀態再讓 host 取件；一次只有一筆 pending，最長等待 120 秒。相同 payload 的 SDK 重送拒絕，不改用新 UUID；整個 guest 最多記錄 100 個 payload hash。
2. 取件是唯讀，重接仍取得同一 request ID。更新憑證不改變該 ID。SQL 在上游 dispatch 前 commit reservation；同 ID 的 reserved／unknown／final 都不重派、不 refund。
3. 回覆先結算並重新驗證 DB 授權，再由 connector 寫 durable delivery intent、送至 guest。Delivery ACK 遺失不重送；完成收據可確認，但沒有通用 completion replay。Guest mailbox 程序重啟遇到既有狀態會 fail closed，不嘗試重新生成回覆。
4. Reservation 後 SIGKILL 可留一筆 reserved、零次上游；結算後 SIGKILL 保留 final counters，但不保證 guest 取得答案。恢復取到同 ID 時會拒絕重派並安全停止。已確認 delivery 後可接回同 VM／conversation，保留原 prompt，接續下一個工具邊界。
5. 新模型模式一律 AlwaysConfirm。自動模式由 worker 先核對 live DB ownership、固定 policy 與剩餘 request cap，再核准相同 digest 的 terminal 批次；人工模式保留既有 operator grant，送出前也檢查模型 gate。若 request 已耗盡上限，連該回覆提出的 terminal 也不放行。例如 cap=1 時第一筆回覆可以結算，terminal 不執行，run 安全失敗。SDK 的單一 Finish／Think 仍是其內部動作例外。
6. 模型錯誤、過期／撤權、未知 dispatch 或額度截止，持久保存 `cutoff_reason`、撤銷 token、關閉模型與新工具 admission，再走既有 interrupt／VM cancel 與完整停止核對。只有原 VMM、VM record、runtime directory、cgroup 與 claim 全部消失才釋放 reservation；否則 interrupted／cleanup unknown，recovery 繼續對帳，沒有 replacement。

取消或 pause 已提交後，舊 owner 不能覆寫其控制意圖。已 admission 的上游 I/O 可能繼續並結算，但撤權後 completion 不交給 guest。若 pause 與模型 I/O 競爭，不能證明 SDK 已到安全工具邊界時保持 pausing 與容量；可取消或由期限收尾，不把模型 error／timeout 當成 paused proof。已進入 guest 的工具副作用不承諾 rollback。

## 啟用與升級

先完整 drain／備份，套用新 migration `009_guest_model.sql`（含全部前序），一起更新 API／worker／connector。新增欄位是 `guest_connected` 與 durable cutoff；原 migrations 不改寫。保留 journal／fences／generation。Guest helper hashes 已改變，不能原地更新 active guest；terminal launcher 與 OCI template 不需重建。

沿用 [AT-11-A 的 0600 fixture config](M3-MODEL-PROXY.md)，先啟動上游 fixture：

```bash
python -m agent_platform.model_cli --config /private/model.json serve-fixture
# 在每個 real worker 的私密服務環境中設定：
export MODEL_PROXY_CONFIG=/private/model.json
agent-platform worker
```

Worker 已有 DATABASE_URL 與 connector 連線設定；本次將固定上游的 credential 加到控制端 worker。各 worker 必須使用同一 pinned policy。只配置私有檔案路徑，不將 key 放 argv／聊天／Git。

這是明確 opt-in：未設定 `MODEL_PROXY_CONFIG` 的新 run 仍是舊 guest-local fixture。Allocate input 與 prepare receipt 固定 transport 模式；active run 的 worker 配置與已準備模式不一致時拒絕接續，不切回另一模型、不重建 VM。升級與切換需 drain，不能混用兩種配置處理同一 active run。

`GET /api/v1/runs/{id}/usage` 在 guest credential delivery 確認後才顯示 `guest_connected:true`，並顯示 cutoff reason。成本仍 unknown／null、`hard_money_limit_supported:false`；Web usage capability 仍 false。

## 驗收與後續

```bash
make platform-check
python scripts/test-postgres.py python scripts/m3-guest-model-kvm.py \
  --config /private/connector.json --origin http://127.0.0.1:17888 \
  --output /private/new-acceptance-directory
```

KVM driver 只接受 empty／zero-warm node、專用 `agent_platform_test` DB。模型請求原文與憑證只在私密測試目錄，不進公開 evidence。到期使用 DB clock 邊界注入，輪替縮短 worker 本機 elapsed interval，SIGKILL 後只加速已證實 dead worker 的 lease 到期；沒有降低 generation。

公開結果與來源 hashes 見 [驗收證據](evidence/m3-guest-model-2026-09-23.json)。涵蓋成功循環、cutoff、人工審批、同 VM pause/resume、cancel、29 項實際 terminal 隔離檢查、短效憑證更新／到期／撤權、三個 worker SIGKILL 時點、雙 VM 跨 run 憑證拒絕與完整停止證據；另回歸原固定模型的 recovery／cancel／approval／pause 控制案例。

下一切片為 AT-11-C：可信 pricing／token 上界、金額 reservation／settlement，然後 usage UI 與明確 opt-in 真實 provider smoke。現有 fixture counters 不得充當可信費用；AT-07 還需與後續 artifact 安全整合。M4 artifact／explicit export／backup／GC／production 尚未開始。
