# T-0426 Mainline acceptance convergence

Demand: [desk T-0426](https://github.com/fallrising/desk/tree/main/tasks/T-0426-thinrouter-mainline-acceptance). Fixed acceptance: [MC-1–MC-3](../../SUCCESS.md#t-0426--mainline-acceptance-convergence).

Started2026-10-26T17:59:19Z;baseline`567b9fc90b90885bdd6901603b3abdd65e313e60`. ClaimPR246 merged`f9080686b031da90a4b6bac6bc9eebfbdce96fdc` at2026-10-26T17:56:48Z before product edits. PriorT0425 fully delivered; source/claim/board/journal/desk currentCI/ancestry rechecked. Main clone checkout preserved.

Estimate35–55active minutes;20minutecheckpoints;worker10+3minutes/source7+2/ledger4+2;singlecommand/CI600seconds;initial plus2reasoneddiagnostic/correction attempts perproblem. Fulltools/provider/token/cost/activewaitunknownnull;namedcommandwall and task-native-launch counts are separate observations.

Design before evidence: map fixedAC03 requirements to current config/guard/store and HTTP admission tests, run existing focusedbaseline before deciding whether any change is needed. Read all17coreACs and source/test entrypoints for implemented provider capabilities. Classify the remainingAC01/04/08 live evidence separately from existing offline contracts and prior live observations. Keep independentT1102usage-correctness work visible as a dependency; do not change its plan or implement it here. Preserve historical failed probes and later superseding evidence. No broadening into timer/shutdown fixes absent a new reproducible fixed-AC blocker.

Required gates: focusedbaseline,full lockedRust1.99.0 tests/fmt/Clippy,validators/contracts/indexes,independent evidence/content and ledger review,necessaryCI/normalmerge/remoteaudit,board/journal/desk andverifiedbackup/cleanup. No realprovider/model/login/Docker,credentialaccess,dependency/permissionchange,release/deploy orwholeproductacceptance.


## 收斂結論與計數口徑

本輪固定的是剩餘驗收入口，沒有把產品改成較小的目標。核心表的 AC-01–AC-17 編號及 Given/When/Then 原文保留；狀態必須連到實際證據與版本。AC-03 的當前結果見下方驗證紀錄。其餘表內 `passed` 多為本機 fake upstream／CLI 證據，不能換算為整個產品的完成百分比。

接手時任務板有 75 列 `done`，其中包括文件里程碑；不是 75 個功能全部完成。T-1102 的文件列已關閉，但其 thinrouter runtime 用量／錯誤保存工作尚未完成。AC-03 對帳完成後，核心表仍有 AC-01、AC-04、AC-08 三組未完成的當前驗收，另有 T-1102 的既有依賴。這是工作群組，不能宣稱只剩三個或四個開發任務；修正數量要由有界重現及明確驗收決定。

本輪不新增 idle timer retention、未 poll response watcher、graceful shutdown、HTTP/2／proxy 或 runtime teardown 必修項。只有新重現能連到既有固定 AC，且清楚說明使用影響、所有權、失敗斷言和有界修正時，才提入必要工作；否則保留已記錄的能力邊界。

## MC-1：AC-03 證據對帳

來源入口：[server.rs](../../src/server.rs) 的 `build_app`、`require_api_key`、`ensure_api_key`；[config.rs](../../src/config.rs) 的 `loopback_listener`／`validate_listener`；[store.rs](../../src/store.rs) 的 key 驗證與 `has_api_keys`；[guard.rs](../../src/guard.rs) 的 forwarded 判定。

| 固定條件 | 可觀察證據 | 證據界限 |
| --- | --- | --- |
| 預設拒絕缺少、無效及停用 key | `cost_auth::empty_and_disabled_keys_reject_before_all_upstream_surfaces`：六個 inference 路徑回 401，fake upstream 計數不增加；有效 Bearer／x-api-key 是 200 正控制 | `/models`、`/v1/models` 的無 key 拒絕亦被測；其他組合的共同性依 shared middleware 來源，不冒稱每個組合都跑過 |
| bootstrap 必須明確開啟且 listener 是 loopback | `config::tests::bootstrap_is_off_by_default_and_exact_loopback_only`；`cost_auth::public_bootstrap_and_unprotected_admin_fail_before_listener_start` | IPv4 gateway 有實際 HTTP；IPv6／hostname／mapped-address 判定為 configuration unit evidence，沒有新增 IPv6 transport 旅程 |
| 只接受完全沒有 credential header 且 total keys 為零 | `cost_auth::explicit_loopback_bootstrap_only_accepts_absent_credentials_and_zero_total_keys`：錯誤或空 header 不降級，建立或停用最後一把 key 都不重開 bootstrap；`store::auth_tests::bootstrap_counts_disabled_keys_as_configured` | 合成隔離資料庫及本機 upstream，沒有真實帳戶或既有資料庫 |
| forwarded 請求不得使用 keyless bootstrap | `admin_security::forwarded_requests_cannot_use_keyless_bootstrap`：五種 forwarded 身分 header × 兩個 Chat 路徑拒絕，direct loopback 是成功控制 | 其餘 API 共用 gate 的判斷有來源依據；這不是所有實體 proxy／Tailscale 設定驗收 |
| 公開 listener 必須保留 admin 與 gateway 授權 | `cost_auth::public_listener_requires_admin_auth_and_gateway_auth`、unsafe-startup test；`config::tests::public_listener_requires_nonempty_admin_token` | `0.0.0.0` listener 以 loopback client 測；不冒稱外網／防火牆配置通過 |

`cost_auth` 的六條 inference 路徑是 `/v1/chat/completions`、`/chat/completions`、`/v1/messages`、`/messages`、`/v1/responses`、`/responses`。`build_app` 為這些路徑及 model-list 裝同一份 key middleware。這個對帳不改 AC-03 的承諾，也不把未覆蓋的 transport 組合補成已測。

原始聚焦命令並非全綠：`admin_security` 5/5，`cost_auth` 3/4，`public_listener_requires_admin_auth_and_gateway_auth` 在 `cost_auth.rs:124` 出現 `gateway exited before health`，尚未到授權斷言。未改 source 的 exact 單測診斷通過，bootstrap unit tests 2/2 通過。Fixture 丟棄 child stderr，且有 reserve-port/drop-before-spawn 窗口；當次原因未知，不能寫成已證實 port collision。原始失敗完整保留；後續完整套件結果另列，不覆寫這次 exit 101。Baseline 正確與證據狀態落後可用文件修正處理，不製造產品 RED 或改動斷言。

## MC-2：核心驗收與能力矩陣

以下是目前來源與測試能支持的範圍，不是對外 provider 現況或所有客戶端版本的相容保證。

| 核心 AC | 目前可用證據／定位 | 剩餘條件或界限 |
| --- | --- | --- |
| AC-01 | grok／opencode／agy 的歷史 smoke；當前 adapter 與 local fixtures | 需目前 source／model／protocol／憑證時效下的有限真實 smoke，歷史結果保留 |
| AC-02 | provider registry、refresh／forwarding 與 CLI 來源可定位 | source 能力不等於帳戶可用；real acceptance 由相關列承擔 |
| AC-03 | 本輪 admission／bootstrap 對帳及下列完整套件 | 限已列本機條件；不擴為所有網路配置 |
| AC-04 | Claude fake CLI／MCP 往返、取消／錯誤與三 API 回歸 | 真實 client／工具旅程未驗；Cursor 的工具要求與 AC-17 text-only 範圍差異仍開放，不能默默刪掉 AC-04 承諾 |
| AC-05 | admin_security、guard、secret-storage 本機回歸 | 本機安全契約；T-1102 的 raw error 保存問題另列，不能由這些測試推成不存在 |
| AC-06 | responses_e2e 與 converter fixtures，三 API text/tool/image、stream/nonstream | 合成上游證據；real SIWC 仍屬 AC-08 |
| AC-07 | prompt_cache unit／responses_e2e header 斷言 | 沒有真實 cache hit 或成本效果量測 |
| AC-08 | siwc／oauth_refresh local tests，`responses_e2e::siwc_provider_applies_preview_limits` | 真實登入／refresh／namespace tool 相容仍未驗；舊 `tests/codex_e2e.rs` 引用已不存在 |
| AC-09 | store retired-codex fixture／registry tests | 舊 provider 停用與 token 清除，不是恢復舊路由 |
| AC-10 | claude_code_e2e／unit fake CLI：三 API text/image、參數、環境、stdin | 尚未經真實 Claude Code 帳戶驗收 |
| AC-11 | MCP bridge 命名與回傳 ID 的 fake-helper 測試 | 此列原文保留較早的「結束 run／新開」描述；目前生命週期依後來 AC-12–AC-14 的同進程續輪／shelf 契約與測試，不重建舊行為 |
| AC-12 | claude_live_e2e 真正啟動 fake CLI/helper 的 tool continuation、timeout／eviction | 本機程序整合不是官方 CLI 帳戶整合 |
| AC-13 | next-user reuse、idle expiry、T-0425 deadline／continuation ownership | 無真實 prompt-cache 命中率保證 |
| AC-14 | saved shelf、restart／resume／fallback 的隔離 fixture | 真實 session 路徑與官方 CLI resume 相容待核心旅程驗收 |
| AC-15 | Responses 事件／序號／終態 conversion tests | protocol fixtures，不能代替真實客戶端版本驗收 |
| AC-16 | borrowed-login fixture 與本機 auth tests | 沒有本輪真憑證讀取／Grok repo 巡查／真實 refresh |
| AC-17 | Cursor text-only fake runtime；2026-10-24 corrected-runner 單次 Chat 非串流歷史成功 | 一次 HTTP200／5.897s／owned-container cleanup 成功不代表全部 API／stream／tools/images；歷史兩次 502 保留 |

| 實作路徑 | 已有本機支援／驗證 | 未接受為完成的內容 |
| --- | --- | --- |
| 三個 client API | Chat Completions、Messages、Responses；versioned／bare aliases 依各測試；支援的 stream／buffered 轉換 | 任意 client version／proxy／provider 的完整相容性 |
| Claude provider | text、images、client tools via MCP；同進程 user/tool continuation，idle shelf／resume；本機 fake process evidence | 真實 CLI/model/session、真實 client 工具旅程 |
| SIWC route | 實作的 Responses adapter、三 API 轉換、local sign-in／refresh fixtures、preview-limit fixture | 現行官方 API／帳戶可用性、namespace tool 回傳形狀；此表描述 repo 實作，不是上游已確認契約 |
| Cursor provider | 既有 opt-in／mandatory-container 的 text-only 契約；tools/images 回 501；歷史單次 Chat text 成功 | 工具／圖片功能與廣泛 live matrix；本輪不做 Cursor 排障／Docker |
| grok／opencode／agy | repo registry／adapters、本機合成測試及歷史 smoke | 當前帳戶／model／protocol 可用性仍由 AC-01 驗收 |
| 客戶端配置文件 | curl、Cursor、Claude Code、Continue.dev、Cline／Roo 的配置範例 | [CLIENTS.md](../CLIENTS.md) 沒有已驗的 client-version 清單；範例存在不等於 named-client acceptance |

### 固定剩餘工作入口

| 入口 | 開始前必需輸入 | 關閉所需證據 | 停止／保留條件 |
| --- | --- | --- | --- |
| R-01 → AC-01 當前 provider smoke | 指定 source、provider/model、client protocol、已有合法 connection、允許請求數／timeout／費用界限；新的明確 live 授權 | grok／opencode／agy 各被宣稱支援列有具名輸入、預期 marker／狀態、實際結果與時間；失敗列保留；憑證與原文不進證據 | 任何授權／credential／額度／cleanup 不明即停止該列，不自動登入／重試／fallback 到其他帳戶 |
| R-04 → AC-04 完整客戶端／工具旅程 | 先固定 CLIENTS 具名 client/version × provider/model × API × stream/buffered × text/tool/image 列；依既有 AC 記支援／501限制；明確解決 AC-04 與 Cursor text-only 的範圍差異 | 每一承諾列都有端到端結果；tool ID、輸入／結果往返、終態／錯誤／取消與 owned-resource cleanup 正確；不以 curl fixture 代替聲稱支援的真實 client | 未決範圍不能記 passed；不擅自增加 Cursor 工具／圖片或刪 AC-04 承諾；未授權 live 列保持未執行 |
| R-08 → AC-08 SIWC 真實整合 | 固定實作 source、client/version/model 與三 API 列、已有核准帳戶／profile、請求及 refresh 上限，明確 live／必要 login 授權 | 真實授權／refresh 相容、text/tool 回應與 namespace 名稱／ID 對應；原始401/429/timeout及本機cleanup如實保存；每個 fixture-only 條件仍明示來源 | 不為製造429而耗盡額度，不藉反覆登入／refresh／模型重送填齊證據；遇未知外部效果先對帳 |
| R-U1 → 既有 T-1102 thinrouter runtime | 讀取原規格 D-01–D-06／對應 UC AC；以當前 source 重現，選一個有界 thinrouter 切片並完成認領 | 逐項來源問題有 synthetic RED→GREEN、完整回歸與 ledger/unknown/privacy 語意證據；各切片正常交付；不以文件列 done 代替 runtime 完成 | 不執行 T-1102 其他產品工作、不改其 tracked plan；沒有 runtime 重現不宣稱修復效果或真憑證外洩 |

R-01／R-04／R-08 的真實執行目前受禁止 provider 呼叫／登入／Docker 的約束，本輪全部未執行。這些列是可 review 的驗收條件，不是新增執行授權。來源、測試與有限預估不足以得出最終任務總數或可靠完成百分比。

### 已有用量／錯誤保存依賴

[T-1102 規格](../../../../docs/specs/llm-usage-correctness.md) 原文及其文件里程碑保持不變。本輪只重核 thinrouter 來源是否仍含相關路徑；未做 runtime canary、修正或其他產品調查。

| 原 ID | 本輪來源仍可見的條件 | 不能推導的結論 |
| --- | --- | --- |
| D-01 | `proxy.rs` CLI／部分 native streaming 在交出 stream 前 `log_usage`，tokens/cost 為 None | 不代表所有 provider／所有路徑都漏計 |
| D-02 | streaming 先記 HTTP200；`store.rs::usage_by_day` 依 `status=200` 彙整成功 | HTTP headers 成功不是生成成功；尚未以本輪中斷 fixture 驗證 accounting 結果 |
| D-03 | latency 在 body／stream 結束前取樣，UI 名為 Avg latency | 現版三個 handler 在每個 target loop 內建立 Instant，不能宣稱目前 fallback 重複累積整體耗時 |
| D-04 | token/cost SUM 的 COALESCE 與 total unwrap 將缺值轉成0 | 來源能證明 missing／zero 混合，不能冒充已量測帳單差額 |
| D-05 | `estimate_cost` 對缺 completion 或單側價格使用0 | partial estimate 並不證明完整金額；沒有真實費用量測 |
| D-06 | `record_failure` 與三個 forwarding error 分支截短後保存 `e.body` | 截短不是去識別；未執行 canary，不能宣稱已發生真憑證洩漏 |

### 結案規則與唯一下一步

只有核心承諾有其範圍相符的證據、R-U1 既有依賴有明確完成／處置、必要回歸與獨立審查通過、正常合併與遠端回讀完成，才能重新評估產品主線。未決 scope 或未驗 live 列仍開放。`mainline: incomplete`、`usable_tag: none` 保留；本輪不建立 tag、release 或 deploy。

本輪交付完成後，唯一優先入口是 **R-U1／T-1102 thinrouter D-06：用本機 synthetic canary 重現錯誤內容持久化，再決定最小修正**。這可在現有禁止真實 provider 的條件下進行，且連到既有來源缺陷與隱私契約。下一輪先依 N1/N2 定位／認領，沿原規格固定驗收；本輪不順手實作，也不啟動其他產品。其餘 R-01／04／08 保留上述具體條件，避免每完成一個邊界就擴張結案線。
## MC-3：本機驗證與交付門檻

在 source baseline `567b9fc90b90885bdd6901603b3abdd65e313e60`，本輪未修改 runtime、tests、Cargo 或其他里程碑 tracked plan；既有行為已有有效回歸，故不新增鏡像測試或假 RED。當前完整驗證：

- 共用 target 下 `timeout 600 cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml`：245 passed／18 groups、0 failed／ignored，97.562s；包含全部9個 admission/admin 整合測試與2個 bootstrap unit。
- 同環境 `cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings` 及 `cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml -- --check` 通過。
- `python3 -m unittest discover -s scripts/tests -v`：20 tests 通過；`python3 scripts/check_indexes.py`：44 contracts／7 indexes 通過；`git diff --check` 通過。
- 前述聚焦初次失敗（exit101、8/9 passed）、未改 source exact retry（1/1）、bootstrap（2/2）與完整套件結果分開保存。啟動失敗原因仍未知，完整 PASS 不消除這項測試可靠性限制。

證據在本機 `.local/t0426-mainline-acceptance/`（原始 logs／JSON、唯讀 worker report 與原始失敗），交付時備份至 `~/test/backup/t0426-mainline-acceptance-20261026`。Command wall seconds 僅屬該命令，不代表整輪 active/wait；整輪工具／provider／token／費用／active-wait 精確總量 unknown/null。

獨立最終文件／來源審查、必要 CI、正常合併／遠端回讀及看板／journal／desk／備份仍各有獨立完成門檻；本段不預先宣稱已通過。Desk 交付後仍由 owner 決定 done。
