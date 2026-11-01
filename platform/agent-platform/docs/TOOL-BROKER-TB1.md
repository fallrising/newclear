# TB-1 — 控制端 mock tool broker

2026-10-03。這是 [Tool Broker 設計](TOOL-BROKER.md) 的第一個實作切片，不改寫該文件作為 TB-0 提案的歷史狀態。未配置時沒有工具權限；既有 API、worker、模型通道與 guest 不會載入此模組。

## 已固定的邊界

`src/agent_platform/tool_broker/` 提供獨立 ASGI app factory `create_tool_app(db, policy)`。只接受明確傳入的 immutable `Policy`，只連 `http://127.0.0.1:<port>` 的 synthetic GitHub fixture，沒有 live mode、環境 token 搜尋或 production loopback override。測試憑證只由可信 harness 傳入記憶體，`repr` 隱藏 secret；不保存 raw secret 至 SQL，不新增秘密檔案或 dependency。**不可在此 mock 模式配置真實 credential。** 正式 credential store、最小 upstream permissions 與真實 provider 啟用屬 TB-3。

部署位置固定為獨立控制端服務程序：harness 擁有 DB pool，建立 app 並交給獨立 ASGI server。正常控制 app 沒有 mount 它，沒有 CLI 自動啟動它。app 使用專用 4-worker executor、拒絕超額請求而不排隊；不能佔用取消控制 worker。每 run 的 2 個 in-flight 上限另外由 PostgreSQL 序列化，跨 app instance 仍有效。這次測試驗證 socket I/O 不持 lifecycle lock，未宣稱已部署程序隔離。

沿用 `ModelProxy.live` 的 job → run 鎖順序與鎖後 DB clock，包含 lease owner／generation、run deadline/state、sandbox binding/reservation、cleanup、pause/cancel/control action 及 model cutoff。TB-1 因而只適用既有 OpenHands fixture runtime。未接 connector attestation、guest mailbox、SDK 或新 profile 啟用流程；那些是 TB-2 的先決條件，不能把 host-only harness 當作 agent 已能使用的工具。

## 固定契約

- Wire revision：`tb1`；adapter：`github-read-mock-v1`；GitHub response fixture revision：`2022-11-28`。
- `Policy` 固定 service UUID、credential revision／origin／repository path binding、numeric repository ID、canonical owner/name、完整 commit、精確 path/issue allowlist、operation allowlist 與 limits。只能收緊設計上限；不提供 wildcard、URL 或 headers。
- Request JSON 最多 32 KiB；三種操作為 `github.repository.get`、`github.issue.get`、`github.file.get`。所有 request 必須帶 `operation`、`repository_id`；issue 另外帶 `issue_number`；file 另外帶 `commit`、`path`。額外欄位、身分／approval／credential 欄位、寫入 operation 均拒絕。
- 每個操作重新讀取 repo metadata，核對 numeric ID 與 canonical name。File 由固定 commit 逐層 tree 找出 blob，只接受 regular mode `100644`／`100755`；拒絕 symlink、submodule、truncated tree、錯誤 SHA、重複 entries，不跟任何回覆 URL。
- 檔案最多 4 path segments；每 operation 最多 8 次 HTTP attempt、累計 1 MiB JSON 回覆、解碼檔案 256 KiB。總期限 10 秒、idle timeout 5 秒，皆可收緊。沒有 redirect、retry、pagination、compression、ambient proxy 或串流；secret 完整字串在解碼 JSON／blob 命中即拒絕。

成功 `result` 僅包含以下欄位；不透傳 upstream 其他欄位、headers 或 URLs：

| Operation | Result 欄位 |
| --- | --- |
| repository | `id`、`full_name`、`private` |
| issue | `number`、`title`、`body`、`state`；拒絕 issue endpoint 回傳的 pull request |
| file | `path`、`commit`、`sha`、`encoding: base64`、`size`、`content` |

### 可信 harness 與 capability

Host 先明確 `Broker.provision(run_id, generation, owner, binding_id, expires_at=...)`，再 `issue(...)` 取得 `tb1_` capability。這兩個動作只有 Python 控制介面，沒有 HTTP issuer 或 grant endpoint。provision 是測試控制入口，不能由 guest payload、操作結果或 run 自動觸發。第一個 grant 固定 run 的 policy digest／期限／caps；重新 provision、擴權或換 credential 均拒絕。TB-2 必須透過新 immutable profile revision／新 run 配置此入口，不能向 active production run 注入權限。

Capability 只以 SHA-256 保存，最長 2 分鐘，綁定 run／binding／generation／worker owner。模型 `mp1_` token、其他 run token、舊 generation 或失效 lease 均不可替代。`issue` 只輪替 capability，不重設 ledger/caps；`rebind` 只接受已通過 live gate 的較新 generation，保留原 policy、期限與消耗，將未完成舊操作標為 unknown。service 或 run 撤銷不可恢復，credential rotation 需新 service revision／新 run。

### HTTP 與結果交付

`POST /tb1/runs/{run_id}/operations/{operation_id}` 使用 `Authorization: Bearer tb1_...` 與 JSON。UUID 由可信 relay 管理；HTTP caller 是可信 host harness，這次沒有讓 guest 直連控制面的路徑。Body 不能自報身分。禁止 browser Origin、cookies、query credentials、重複 JSON keys、壓縮 request；request body 另有 5 秒接收期限。回覆一律 `Cache-Control: no-store`。

首次成功回覆包含 operation metadata、白名單 `result` 與一次交付 `receipt`。接收端確認保存後呼叫 `POST .../{operation_id}/ack`，body 為 `{"receipt":"..."}`。receipt 只存 hash，ACK 可安全重複。ACK 前拒絕新的 operation；重試原 ID 只回 metadata、標示 delivery unknown，不回放結果或 receipt。若已接收端仍持有原 receipt，可核對後補 ACK；若 receipt/結果遺失，工具通道停止，保留證據，不重新呼叫 upstream。ACK 只表達交付確認，不擴張 operation 權限。

## Ledger 與故障語意

Migration `013_tool_broker.sql` 新增 service、run grant、token、operation 四張表，未對既有 run 發放 grant。SQL 只存 opaque IDs、revision/digests、固定 operation/狀態/原因、時點、嘗試次數及成功回覆 byte count，不存 raw payload、repository 名稱、issue/file 內容、完整 URL 或 secrets。沒有新的 SSE producer。一般 audit 只記固定 action 與 opaque run/service ID。

Admission 將授權與 cap reservation 一次 commit，再離開 DB transaction 執行 adapter。相同 ID／相同 normalized payload 只回目前狀態；不同 payload conflict。每 hop 重新核對授權並在 socket I/O 前保存 attempt count；在 socket 建立前 crash 也可能已有 count，所以它是保守嘗試數，不是已證實送達的請求數。失敗／未知回覆沒有可信 byte total，以 null 保存，不寫假零。

未 admission 的 schema／authority 拒絕沒有 operation row、零 dispatch。已 admission 的 timeout／錯誤／crash 均不退款、不重送；保留 request cap 與 in-flight 占用。過期的 admitted row 在下一次有權限查詢／操作時轉為 unknown；沒有背景重試。unknown 會永久占用本 run 的一個 in-flight slot，本切片沒有人工退款 API。已成功但 revoked 的 completion 只保存 metadata、delivery withheld，不交付內容。

Admission 早於 pause/cancel commit 的請求仍可能送出；pre-hop recheck 不能回滾外部請求。已撤權的 completion 被擋下。broker 不改 run state、不釋放 VM reservation，不把停止收件等同 VM quiescence。Operation ledger 沿用 run 的保留生命週期，沒有新 GC 或自動刪除 unknown 的機制；M4 retention 尚未實作。

## 驗證入口與未完成項

```sh
make platform-check
# 只跑 TB-1（仍使用新的專用 PostgreSQL container）
python scripts/test-postgres.py python -m unittest discover -s tests_platform -p 'test_tool_*.py' -v
```

`test_tool_broker.py` 驗證 SQL/HTTP 授權、並行 reservation、generation/lease、撤權、commit/crash 與 no-replay/ACK；`test_tool_transport.py` 驗證 mock socket/response fixtures、檔案與 credential boundaries、超量/慢回覆，以及未啟用的 public DNS-to-dial/TLS guard。具體命令與結果以本 PR 的 CI／驗收紀錄為準。

| 設計驗收項 | TB-1 的證據範圍 |
| --- | --- |
| TB-AT-01–03 | Mock request/resource/identity/audience/binding 與 SQL lifecycle gate；不含 guest 身分傳輸 |
| TB-AT-04 | DNS/address selection 與 TLS 驗證 guard 的隔離測試；mock 不使用 public transport，未驗證 live GitHub |
| TB-AT-05–06 | PostgreSQL 並行／once-only/cap、commit fault 與進程終止、不確定結果/ACK；沒有 guest delivery crash 證據 |
| TB-AT-07 | 封閉唯讀 schema，沒有 write/approval/export endpoint；**未實作**一般批准 digest/expiry/一次消耗，未宣稱該整項通過 |
| TB-AT-08–09 | 控制端 pause/revocation 與 socket bounds/redaction；未驗證 VM pause quiescence |
| TB-AT-10–12 | **Not run**：guest/KVM/SDK/實機故障與 live readonly access，需後續分階段授權 |

`PublicGitHubConnection` 只提供未啟用的 guard 原型：固定 host/443、一次 DNS 檢查後直接 dial 該 IP、保持 hostname/CA verification。它不能由 `Policy` 選用，沒有 live adapter／credential 發放流程；不代表 TB-3 已完成。完整 production egress、DNS resolver deadline、最小權限證明、秘密 storage/rotation/retention 必須在 live enablement 前補齊。
