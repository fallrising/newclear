# 開發接續紀錄 — 2026-09-24

目前停止點：**AT-11-C2b2 的 HTTPS provider transport 與 profile verification 已實作；45 個 dependency-free unit tests、200 個 PostgreSQL／HTTP platform tests、Ruff 及 GitHub CI 的 check／web／control-plane 全通過。real-KVM acceptance 尚未通過。Draft PR [#82](https://github.com/fallrising/newclear/pull/82) 因 unresolved same-journal recovery／KVM gate 未合併。** 沒有呼叫付費／外部 provider，也未使用主機既有 provider key；真實費用仍 unknown。設計與限制見 [AT-11-C2b2](M3-HTTPS-PROVIDER.md)，本次結果見 [evidence](evidence/m3-https-provider-2026-09-24.json)。下一視窗指示見 [NEXT-PROMPT.md](NEXT-PROMPT.md)。

## 本次 AT-11-C2b2 HTTPS provider 與 verification

- 最終工作樹已對齊 GitHub main `dba9ee94a49bcfe2efb298caa1d5324cfde03988`，改動只在 `platform/agent-platform`。新 `openai-compatible-https-v1` 固定完整 HTTPS endpoint、model、request cap、file-backed credential reference、CA fingerprint 與 TLS policy digest；強制 TLS 1.2+、憑證鏈及 hostname 驗證，不使用 ambient proxy、不跟 redirect、不自動 retry。Provider usage 標成 unbilled；`amount_decimal:null`、`hard_money_limit_supported:false`。未呼叫外部 API，未讀取既有 provider key。
- Immutable profile revision 保存 strict verification policy：預設 `none` 是 unknown；`commands` 直接執行 bounded argv，限制 check 數量／timeout／輸出並核對 workspace diff；舊 KVM harness 明確使用 `fixture-m2`。Connector 重新核對 revision、contract hash、check 結果與 diff hash；只有完整通過才可成功。
- 新增 migration 012，讓新 profile model reference 走 `openai-compatible:chat-completions`，保留舊 `fixture:m2` revision。`mock-https-complete` real-KVM harness 已加入本機 TLS mock、測試 CA、無 mock run-ID header 與 guest profile check。
- 最新 `make platform-check` 通過：45 個 dependency-free unit tests、200 個 PostgreSQL／HTTP platform tests、Ruff lint／format。第一次 PR CI 的 fast check 因缺少平台 runtime dependencies 無法 import 兩個新測試；已把它們移到已安裝鎖定依賴的 `tests_platform` suite。Web CI 的 1 個舊狀態文案 assertion 已更新；修正後 GitHub Actions run `36008490179` 的 check／web／control-plane 全部通過，包含 browser acceptance。本機 `make web-check` 因沒有 Node/npm 未能執行。`mock-https-complete` 未通過：managed launcher 未套用文件要求的 supplementary `kvm` group，`/dev/kvm` open 得到 `EACCES`，sandboxd 記錄 Cocoon clone 子程序被終止。只讀確認 `sg kvm` 有 device 存取權；沒有在該錯誤後重試 KVM。
- 原 197 筆 journal release result 仍全部通過 exact stop-proof validator。此次另外留下 1 筆 `allocate=started` 且無 handle／observed／release proof 的 intent；無 active claims／VM、clone runtime directory 或 CPU scope。產品 `drained()` 因 ownership 不確定而拒絕通過。此新 row、舊 journal 與 fences 均保留；connector、sandboxd 已停，owned PostgreSQL container 數為零。不能刪 row、換 state directory、改 generation 或直接 driver 繞過它；下一次同 journal KVM 前必須有正式、可稽核的 recovery 決定。
- Implementation commit `aae40ce`、交接 commit `70ce010` 與 CI 修正 `e099c6e` 已推至 `agent/agent-platform/at-11-c2b2`；Draft PR [#82](https://github.com/fallrising/newclear/pull/82) 的目前 CI 全通過。Repo recovery review 確認 `M3-RECOVERY.md` 對沒有 handle／VMM ownership 的未知 allocation 要求管理員對帳；產品 inspect 只讀並回 `allocation_ownership_uncertain`，release 又要求已保存的 observed VM。沒有可用於此筆 row 的受支援 reconciliation command/API。PR 不得在正式 same-journal recovery 決策與 real-KVM gate 前 merge。
- 私有輸出留在 `/tmp/apm3-at11c2b2-20260924`，不要公開 TLS key、mock key、model／SDK request 或 journal。

## 本次 AT-11-C2b1 本機 OpenAI 相容 mock

- 從 GitHub 最新 main `77e5e14e0eb0bd62544ea3ece02aa448e08df456` 建立獨立 worktree `newclear-agent-provider-mock`，只修改 `platform/agent-platform`。使用者同意外部 API 依賴先以 mock 驗收，最後 E2E 再提供接口；因此未讀取主機既有 provider key，也未呼叫付費模型。
- 新 `openai-compatible-mock-v1` 私有政策固定主機 loopback endpoint、credential fingerprint、可設定 model ID 與 request cap；不接受公開 URL、真實金額 preview 或 fixture credits。SDK 請求正規化為 Chat Completions 文字／function tools JSON；mock 回應只讓驗證後的文字、允許工具與三個 usage counters 進 guest。測試專用 run UUID header 只送 loopback mock，維持 JSON body 的相容形狀並完成目前固定 workspace assertion；未來真實 provider adapter 不可沿用。
- 既有 job→run ownership、短效 token、先預留後 dispatch、unknown 不退款／不重送、tool gate、持久 cutoff 與完整 VM 停止證據不變。Mock 用量不是可信 provider 計量；`amount_decimal:null`、`hard_money_limit_supported:false`、Web usage capability 關閉。沒有 DB migration 或 launcher／OCI rebuild；啟用仍需先 drain，再同步配置所有 worker 的 `MODEL_PROXY_CONFIG`。
- M0 45、平台 190、Web 22 項測試及 lint／format／build 通過；修正 mock verifier 契約後另跑 7 項針對性 PostgreSQL 測試。真實 KVM 的 `mock-complete`、`mock-cutoff`、`mock-unknown` 三個新案例及原 fixture `isolation` 回歸均通過，包含 29 項 terminal 隔離；每例都確認 VM／claim 清零、公開憑證掃描與停止證據。第一次 mock 成功案例因固定 verifier 預期 run UUID 而安全失敗且已清理，修正後重跑成功，公開 evidence 有記錄。
- 私有原始 payload／mock key／logs 在 `/tmp/apm3-provider-mock-20260924`，沿用 `/tmp/apm3-egress-20260923/journal` 與 fences、原 Cocoon cache。收尾 connector／sandboxd 已停，VM／claims 為零，197 筆 journal 對應 VM 全部停止，測試 PostgreSQL container 為零。沒有刪除 journal／fences 或降低 generation。
- 下個切片依使用者提供接口的時間安排獨立 HTTPS provider transport 與具體 dialect E2E；在此之前可先以 mock 完成安全 endpoint 設定、credential secret reference 及任務驗證契約。Claude／Gemini 原生 API 需獨立 adapter。真實帳戶費率／token 上界／帳單對帳與硬金額上限仍缺；不可把公開價目或 mock counters 當帳單。

前次停止點：**AT-11-C2a 已加入固定公開價目／token 上界的金額預留演練**，仍只向本機 fixture dispatch。公開美元價目用於驗證 admission／ledger 故障語意，沒有付費 provider 帳單或硬金額上限；`amount_decimal` 繼續為 null。完整設計與限制見 [AT-11-C2a](M3-PUBLISHED-PRICE-PREVIEW.md)，驗收見 [evidence](evidence/m3-published-price-preview-2026-09-24.json)。

## 本次 AT-11-C2a 公開費率演練

- 從 GitHub main `55ce00a2c469a1f262c25b9eaeec6bb7ef3d5952` 建立隔離 worktree `newclear-agent-at11c2`，只修改 `platform/agent-platform`。截至開始核對，其他開啟 PR 為 dim-gate #61；main 最近 agent-platform PR #55 文件、#51 C1 均已合併。
- 官方 `gpt-4o-mini-2024-07-18` 規格與公開 Standard、稅前 USD 價目固定為版本化 preview：input 128,000 token 上界、output 最多 4096、非快取 US$0.15／百萬 input 與 US$0.60／百萬 output；單 request 最大全額 US$0.0216576。Operator 必須明確確認公開 pay-as-you-go 條件及 24 小時內到期；模型 snapshot 不保證帳戶價格不變。
- 新 `011_published_price_preview.sql` 的 quote 欄位與 C1 合成 credits 分開。SQL 仍禁止真實 `amount_decimal`／currency／price_revision；API 顯示 `published_price_preview`、`quote_*`，`cost_status: unknown` 與 `hard_money_limit_supported: false` 不變。未 opt-in 的舊 policy digest 不變。
- Job→run 鎖內先 commit UUID／全額美元估算上界，才 dispatch；合法用量依公開非快取價結算演練值，reserved／unknown 保留全額。429、超界、SIGKILL 不重送或當零；政策修改、價目過期關閉新 admission。Terminal gate 與 durable cutoff／停止證據沿用原安全路徑。
- M0 45、平台 186 項 PostgreSQL／HTTP 測試及 Web 22 項、lint／format／build 均通過；19 項真實 KVM 含成功結算、零 dispatch 額度截止與超界回報保留全額，並回歸原 guest-model 16 案及 29 項 terminal 隔離。私密 payload／配置／logs 在 `/tmp/apm3-at11c2-20260924`；沿用原 journal/fences/cache。收尾核對 VM／claims 為零，192 筆 journal 對應 VM 全部停止，connector／sandboxd 已停，任務測試 PostgreSQL 已移除；公開 hash 與摘要見 [evidence](evidence/m3-published-price-preview-2026-09-24.json)。
- 下一個 C2 切片才可增加獨立真實 provider adapter 與明確 opt-in key、帳戶實際價格適用性、正式 usage／invoice 對帳及 usage UI。公開價目、fixture counters 或 provider project spend limit 都不能自動變成帳單硬金額保證。沒有使用主機既有 provider key。

前次停止點：**PR #46 的 AT-11-B 已合併；AT-11-C1（PR #51）固定 fixture credits 預留／結算與預算截止已驗收。真實 provider 金額仍 unknown，完整 AT-11-C／AT-11／AT-07／M3 未完成。** 前次分支 `agent/agent-platform/at-11-c` 從 GitHub main `d80028c64c2d359d6a44bbe699a09d1d1d2bfe8a` 建立，提交前重基於 `5bf015c4cdec64c9a7db0019b8e39a383627297c`，只修改 `platform/agent-platform`。以下各舊切片保留歷史交付範圍。

## 本次 AT-11-C1 固定 fixture credits

- 新 `010_fixture_budget.sql` 只為受控本機 fixture 增加合成 credit 上限、單價版本、每 request 輸入／輸出上界、預留及結算欄位。未 opt-in 的舊配置 digest 不變；run 一旦釘住 pricing／limit，不因 token 輪替或 worker 接管重設。真實 `amount_decimal`／currency／price_revision 仍為 null，`hard_money_limit_supported:false`。
- Admission 在 run 鎖內先保存 UUID／完整上界預留再 dispatch；final 以合法計量結算，reserved／unknown 以全額保守占用。429、超界、SIGKILL 不自動退款或重送；政策漂移不能重算。上限不足阻擋上游呼叫，沿用 AT-11-B 的持久 cutoff、token 撤銷與完整 VM 停止 gate。
- M0 45／平台 182 測試、lint／format 通過。真實 deny-all KVM 的 credit 結算、零 dispatch 預算截止及超界回報保留全額均通過，完整 16 案 guest-model 回歸（含 29 項 terminal 隔離）與公開 hash／停止證據見 [evidence](evidence/m3-fixture-budget-2026-09-23.json)。
- 私有配置／payload／logs 在 `/tmp/apm3-at11c-20260923`；沿用 `/tmp/apm3-egress-20260923/journal` 與 fences，不刪、不降低 generation。收尾產品 drain gate 確認 132 筆 journal 對應 VM 均停止、VM／claims 為零；node／connector 已停、測試 Postgres 已移除。重跑前仍須重新核對。
- 下一步 AT-11-C2 需先取得可信真實 provider 價格及 token 上界與明確 opt-in，才可提供硬金額上限。其後 usage UI／opt-in provider smoke。合成 fixture credits 不是付費帳單。

## 本次 AT-11-B guest model transport

- UID 2001 guest mailbox 承接固定 OpenHands 1.49.2 chat/tool dialect；host 經授權 sandbox port relay 拉取 request，worker 使用 AT-11-A 的控制端 ModelProxy／SQL ledger。沒有 guest→控制面網路例外，驗收全程 explicit deny-all。
- 短效 run token 與 SDK local key／relay session key 分開；token 最長五分鐘，active worker 每 120 秒輪替，更新以 generation／revision 單調核對。舊 token 不重設 request cap，guest 不持有上游 fixture credential。
- UUID／guest private fsync／SQL reservation／connector delivery intent 保留不重派語意。Reserved 或 settled 後中斷不重送 completion；已確認 delivery 後可接回同 VM／prompt。
- 新模型模式一律 AlwaysConfirm，手動／自動 terminal admission 都檢查 live ownership／固定 policy／剩餘額度。Cutoff 持久撤權並要求停止原 VM；停止證據不完整時保留 reservation，recovery 補證，不刪 journal／fences、不降低 generation。
- 新增 migration 009 與 15 項驗收；M0 45／平台 176 測試和 lint／format 通過。真實 KVM 涵蓋新模型 13 案例（含雙 VM 跨 run、29 項 terminal 攻擊與三個 SIGKILL 時點），並回歸既有 13 個控制案例；來源 hashes／完整結果見 [evidence](evidence/m3-guest-model-2026-09-23.json)。
- 部署需完整 drain／備份／migrate，再更新 API／worker／connector；不需重建 launcher 或 OCI template。全部 real workers 明確設定 `MODEL_PROXY_CONFIG=/private/model.json` 並啟動本機 fixture upstream 才開新通道。未設定者的新 run 仍是 legacy guest fixture；已配置 run 的模式不符時拒絕接續，不自動換模型。
- Pause 與 in-flight 模型請求競爭時，撤權 completion 不交付；無法取得安全工具邊界就保持 pausing／容量，透過取消或期限收尾。模型結果不明不自動重送，沒有把 SDK error 當作安全 paused。
- 本次 worktree `/home/ckc/test/codex/newclear-agent-m3-guest-model`；私密原始 payload／logs／fixture keys／配置在 `/tmp/apm3-guest-model-20260923`。沿用 `/tmp/apm3-egress-20260923/journal`、原 fences／launcher／Cocoon cache；原配置完整保留。公開文件與 evidence 不含原始憑證或模型 payload。
- 收尾已確認 VM／claims 為零、97 筆 journal 對應 VM 全部停止；connector／sandboxd 測試服務已停，測試 Postgres 已移除。全部 journal／fences 保留，node 配置仍是 explicit deny-all；重跑前必須重新核對現況。
- 下一步 AT-11-C 是可信 pricing／token 上界與金額 reservation／settlement，再做 usage UI、明確 opt-in provider smoke 及完整 AT-07／11 整合。沒有付費 provider、自然語言 coding、streaming 或完整 M3 完成宣告。

## 本次 AT-11-A 控制端 model proxy

- 新增 `008_model_proxy.sql`、獨立 loopback model endpoint、私有管理 CLI。Token 只以 hash 入 DB，最多五分鐘／run deadline；每筆 admission 核對 running、generation、owner、live job lease、固定模型、binding 與未釋放 reservation。
- Run 首次發放 pin 住政策 digest 與 1–100 次 request cap，並行先 reserve 再呼叫。Rotation／worker generation／restart 不重設額度；重複 request ID 不重派，payload 改變回 conflict。
- 429／timeout／損壞／敏感回覆是 unknown；SIGKILL 後 reserved 保守留存。合法 fixture token counters 可 final，金額永遠 null／unknown，沒有可信價格／token／金額硬上限。
- Cancel 不等待上游 I/O；已 admission 的請求可能完成，仍保存用量，舊授權結果不回傳。Proxy 不釋放 VM reservation，不碰 KVM journal／fences／generation。
- **僅本機受控文字 fixture，沒有付費 provider、tool-call／streaming 或 guest transport。** 原有 guest fixture 繼續照舊；UI `usage` capability 保持 false。新 API `GET /api/v1/runs/{id}/usage` 明確標示 `guest_connected:false`／`configured`／未知費用。
- 新增 32 項 SQL／HTTP／process crash 測試；M0 45 項／平台 161 項與 lint／format 通過，完整測試結果見 [證據](evidence/m3-model-proxy-2026-09-23.json)。本次不宣告新的 KVM／provider 驗收。
- 新 worktree `/home/ckc/test/codex/newclear-agent-m3-model-proxy`；私有測試 logs 在 `/tmp/apm3-model-proxy-20260923`。既有 `/tmp/apm3-egress-20260923` deny-all 配置、launcher 與全部 journal／fences 保留。沒有啟動 KVM node／connector，測試 Postgres 與 proxy process 由測試清理。
- 升級先 drain、備份、套用 migration 008。沒有切換 worker／guest 模型路徑、不需要重建 launcher；新服務只用獨立 fixture key，不需要 provider key。下一個切片必須驗收 guest 通道再切換模型。

## 本次固定節點 egress

- 固定 sandboxd 0.1.12 的 none-lane **仍可經 vsock proxy 出站**。本切片開啟受控 proxy，提供 exact host／port／method allowlist、解析後 IP guard、redirect 下一跳驗收；不把 net=none 或 proxy 未啟動當安全保證。
- `egress_node` 固定 binary hash、sealed memfd 配置及啟動 argv；connector 核對 live PID／start ticks／boot ID、binary、seal、內容與 API listener ownership。拒絕內網 override、wildcard、SOCKS、secrets、tenant／NIC／preview 等未驗收路徑。
- `007_egress.sql` 保存 catalog／run 政策 digest，不可變 profile 也固定 digest。Queued 舊 run 或舊 profile 不會借用新政策；舊 journal 缺政策證據時拒絕繼續，取消／停止對帳仍可使用。
- **政策不支援 live replacement**：執行中配置不可改寫，pool API 拒絕政策 mutation；先 drain、核對所有 VM／claims／原程序／runtime directory／cgroup 已停止，再重啟 node。Mismatch 不表示既有流量立即撤銷，reservation 沒有停止證據就保留。
- Terminal launcher 新增固定 loopback proxy 環境，guest helper 核對沒有可用 NIC。依 [guest isolation](M3-GUEST-ISOLATION.md) 重建 0600 launcher 並更新 digest；UID 2001／2000、NoNewPrivs、控制 workspace 隔離不變。
- M0 45 項、平台 129 項與兩項固定上游 DNS 契約測試通過；真實 KVM egress、deny-all 政策變更與既有控制流程回歸，見 [證據](evidence/m3-egress-2026-09-23.json)。Redirect 證據要求源站真回 302，沒有拿公開測試站自己的 403 當平台拒絕。
- 升級 API／worker／connector，drain 後 migrate／sealed node 啟動／register-runtime／新 profile revision。Connector 與 sandboxd 須同服務 UID／GID，本機兩者一致經 `sg kvm` 啟動以讀取 `/proc`；不放寬程序權限。
- 本次私密測試配置、launcher、journal／fences、Go 測試工具鏈在 `/tmp/apm3-egress-20260923`，`connector.json` 最後為 explicit deny-all，allow fixture 保存為 `connector-allow.json`。同一 journal 的 direct driver 與 HTTP connector 不可同時執行。保留舊測試目錄及全部 journal。

## 本次 guest 控制憑證隔離

- Agent Server／固定模型使用非 root UID 2001，terminal 維持 UID 2000。私有控制 HOME／state／tmp／SDK workspace 與實際 repository 分離，封閉同 UID `/proc` 憑證讀取及 ambient plugin／import 注入。
- 固定 static launcher 僅在 guest 安裝 root:2001 mode 4750，只允許控制帳號啟動 UID 2000 shell；固定環境、清除 groups／FD／saved identity、NoNewPrivs 與 core dump 限制。沒有 host setuid 或 shell fallback。
- Prepare／prompt／approval／recovery／quiescence／result 核對 helper hash、權限與程序 UID。舊 journal 缺 revision 時拒絕繼續，但保留取消與完整停止回收。
- 新增八項 host 契約／編譯測試；平台共 116 項、M0 45 項通過。23 項真實 terminal 攻擊檢查、兩個 output canary 案例與 13 個控制回歸通過，見 [證據](evidence/m3-isolation-2026-09-23.json)。
- **升級先 drain**；以 `python -m agent_platform.build_terminal` 建立 0600 launcher，將輸出的 file／SHA-256 加入私密 connector 配置。保留 journal／fences；沒有新 migration，不原地修補舊 guest。

## 輸出安全切片（PR #30）

- 統一涵蓋 connector／node／sandbox／session 四種憑證；在 JSON 解碼後檢查巢狀 key／value，再遮蔽與截斷事件。含憑證的 ID／kind／state 與審批參數直接拒絕。
- 嚴格驗證 result 欄位、固定 base SHA、UTF-8 patch bytes／SHA-256／256 KiB 與 fixture assertion。含憑證或損壞的 patch 不存入 result、不宣告成功；保留容量直到停止證據確認。
- 新增 10 項安全回歸，平台共 108 項、M0 45 項通過；兩個真實 VM 驗收事件遮蔽、secret diff 拒絕、跨 workspace 隔離、目前 deny-all 網路及完整清理。
- 當時發現同 UID terminal 可讀取 session key；本次以控制／工具 UID 分離修復並重驗。輸出遮蔽仍只比對完整已知憑證，不是任意編碼防洩漏保證。
- 當時 proxy 未開啟的觀測不等於產品 egress policy 驗收；allowlist／DNS／redirect 已由本次固定節點切片補驗。Live policy mutation、model proxy／budget 仍未提供。

## M3 pause／resume 已完成

- `006_pause.sql`、pausing／paused／resuming、CAS／命令收據、generation 撤權、舊審批失效與完成 audit。
- AlwaysConfirm 關閉 terminal admission；初始 message `run=False` 初始化工具後收集 root-owned guest 程序基準。持鎖的 live WebSocket full_state、工具邊界、boot／PID identity 全部確認後才 paused。
- **REST ConversationInfo 在固定版本讀 autosaved state，可能落後控制 mutation。** 控制之後改用新訂閱 full_state，只選取控制欄位，不把 private snapshot 保存為 history／SSE。
- 恢復保持原 VM／prompt，還原原政策；需審批者產生新 generation grant，不因 resume 自動核准。未知 run ACK 不重送；完成收據可對帳。
- Paused 保留資源與原期限，定期核對，支援取消與到期直接回收。恢復成功交回普通 queue，控制執行緒持續可用。
- 新增 18 項後端與四項 UI 測試；六個真實 KVM 暫停案例及 recovery／cancel／approval 回歸，見 [證據](evidence/m3-pause-2026-09-22.json)。

## M3 approval 已完成

- `005_approvals.sql`、OpenHands profile `require_approval` opt-in、AlwaysConfirm、完整批次 digest／generation／五分鐘 expiry／live lease／CAS 決策。
- Connector 核對原 VM 與同一批 pending terminal actions 後才放行；持久 intent 與收據，未知回覆不重送、容量保留。
- 已完成 connector 收據可補登 applied／audit；worker 接管或參數改變須重新審批，不重建 VM／prompt。
- 工作台完整參數、核准／拒絕、原決策重試；拒絕走安全取消。當時一般 pause／resume 維持 capability gate；目前已由下一切片啟用。
- 16 項新增後端審批測試、三項 UI 測試、真實 KVM 核准／拒絕與取消回歸；證據見 [M3 approval](M3-APPROVAL.md)。

## M3 cancel 已完成

- `004_cancel.sql`、原子取消命令／冪等收據／state version、generation 撤權、取消請求與完成時間、完成 audit。
- 專用取消處理執行緒；四個普通 worker 卡住時仍可取消。Queued 直接取消，已配置任務必須確認原 VM 停止；未知狀態保持 cancelling 並保留容量。
- Connector 取消 tombstone、bounded interrupt＋VM release；完整停止證據才完成取消，未知 allocation ownership 不猜測成功。
- OpenHands 工作台取消／pending／重試流程；暫停／繼續／審批維持 capability gate。
- 新增 15 項後端取消驗收、兩項 UI 互動測試、真實 VM 配置中及 120 秒 terminal 命令取消、三個同 VM recovery 回歸案例；見 [M3 cancel](M3-CANCEL.md)。

## M3 recovery 已完成

- `003_recovery.sql`、原 binding／reservation 的 recovery queue、接管 generation、`interrupted_from`／`reconciled_at` 與接管 audit。
- Connector 獨立持久 lease fence；核對原 claim／VMM identity／固定 Agent Server／conversation 後接續事件，不重複 VM／prompt。
- 未知 upstream mutation／partition 保留容量；已確認原 VM 完全消失後才回收。無 ownership 證據的未知 allocation 仍須管理員對帳。
- 新增 19 項 recovery 測試：九個 SIGKILL 時點、未知 ACK、重啟、stale generation、partition、PID 重用、競爭及到期鎖等待。
- 三個真實 VM 恢復案例與原四 VM／第五排隊回歸通過；證據與限制見 [M3 recovery](M3-RECOVERY.md)。

## M2 已完成

- Cocoon／OpenHands 私有 connector、固定 template 與管理員登錄的 readonly Git bundle、非 root guest checkout、真實 terminal 工具執行、持久事件及 bounded diff。
- Connector 私密 durable operation journal、generation／payload gate、不確定操作不重送；worker 四任務並行與 heartbeat。Fake／real 混用仍遵守全平台四 slot 上限。
- 四個真實 VM 並行、第五 queued、workspace 隔離；VMM／VM record／runtime directory／cgroup 均確認消失後釋放容量。
- 真實 Chromium／PostgreSQL／HTTP 的 100-event reconnect／reload／不重複執行驗收；unsupported UI／API gate 與安全文字 diff。
- `002_runtime.sql`、runtime catalog、`register-runtime`／`connector` CLI、path-scoped CI browser acceptance。證據見 [M2 evidence](evidence/m2-2026-09-22.json)。

## 下一步

1. 先定義正式、可稽核的 same-journal recovery，處理 C2b2 留下的 `allocate=started`／無 handle quarantine；不可手改／刪 journal、換 state directory、降低 generation 或走 direct driver。完成 recovery 後才可依 [M3-HTTPS-PROVIDER](M3-HTTPS-PROVIDER.md) 以 `sg kvm` 啟動 sandboxd／connector，重新核對 deny-all／zero-warm／empty node，重跑 HTTPS mock KVM 與必要 isolation 回歸。之後再等使用者提供真實接口做明確 opt-in E2E。真實帳戶價格／token 上界／計費例外、可信金額結算、usage UI 及完整 AT-07／11 尚未完成；固定節點 egress 不支援 project-specific policy／即時撤銷／TLS 內容政策。
2. **仍使用固定模擬模型**：只執行 `m2-result.txt` 驗收，不解讀自然語言任務、不呼叫付費 provider。Guest 在明確啟用 AT-11-B 後才連控制端 fixture／mock proxy；legacy 模式仍保留。Token counters 是上游 mock／fixture 回報，不是可信 token／金額上界。
3. `connector.py`／`connector_journal.py` 擁有上游操作與私密 state，`runtime_worker.py` 擁有平台生命週期。沒有足夠停止證據時 reservation 必須保留，不得把 restart 當作重新配置授權。
4. 任務輸入只允許 catalog 中的 canonical repo／base SHA；目前以 8 MiB 以下固定 bundle 提供 repository，沒有任意遠端 clone／私有 GitHub credential 流程。
5. OpenHands cancel、pause／resume 已開啟；approval 由 profile opt-in。M0 primitive 通過不代表 M3 平台安全語意已完成；不要提供 host shell fallback。
6. 256 KiB 以下 diff 與 fixture verification 保存於 DB；M4 的 artifact store／download、explicit export、backup／GC／production 仍未完成。
7. 重跑 KVM 使用專用 zero-warm node；本機私密目錄 `/tmp/apm3-at11c2b2-20260924`（本次 HTTPS mock attempt，保留）、`/tmp/apm3-provider-mock-20260924`（C2b1）、`/tmp/apm3-at11c2-20260924`、`/tmp/apm3-at11c-20260923`、`/tmp/apm3-egress-20260923`（journal／fences／node configs）、`/tmp/apm2-20260922`（Cocoon cache／runtime）及所有舊交接目錄保留。C2b2 收尾 connector／sandboxd 已停、VM／claims 為零、測試 PostgreSQL container 為零；journal 有 198 筆，其中原 197 筆 stop proof 有效，新一筆仍 quarantine。不要輸出 token／journal 原文。M0 registry 已移除；使用既有 Cocoon cache，不能假設 `localhost:15000` 可拉取。
8. 從較舊版本升級先 drain／備份，再套用最新 `012_openai_compatible_model_ref.sql`（包含前序 migrations）並同步更新 API／worker／connector；新 profile revision 才能使用 `openai-compatible:chat-completions`，舊 `fixture:m2` 保留。另配置 worker 私有 HTTPS policy；不需重建 launcher／OCI，也不增加 guest egress。未驗收 `make web-check`（本機缺 Node/npm）及 real KVM；不要把 Python／PostgreSQL tests 誤稱為完整 E2E。不要刪 journal／fences、切換 state directory 或降低 DB generation。

## 必須保留的契約差異

- `template_digest` 是 promoted snapshot export digest，不是 OCI manifest digest；目前 probe 使用 configured pool／cold OCI claim。
- OpenHands `/interrupt` 只證實 paused；sandbox release ACK 與 claim-list 消失也不能單獨證實 VM 已停止。
- 每次 WebSocket 訂閱的首幀 full_state 快照不屬於持久化 history。
- SDK 0.1.12 wheel 的 sandbox.py 與研究時 source revision 不完全相同；exec timeout 不代表 guest 程序已終止。
- Session／sandbox token 從本機環境或 secret store 提供，不提交到 repository；沒有模型 provider key 需求。

設計見 [SDD](../SDD.md)，驗證命令與證據見 [M0](M0.md)，主機安裝與遠端執行見 [KVM-HOST](KVM-HOST.md)。
