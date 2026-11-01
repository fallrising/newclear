# T-0432 existing named HTTP stream settlement

Demand: desk T-0432, claim PR286 merged `9328cadebad7e709b181715df7942b6e91bef5d1` before product edits. Source `f33ee2e2420cb2d67d2cf16304aecf382396f634`. This is an implementation slice of unchanged T-1102 UC-R01–R05, preserving original17AC and prior SS/PC/CS/CU delivery.

## Scope and fixed acceptance

Existing SIWC/Grok Responses and OpenCode Chat HTTP paths, for streaming Chat/Messages/Responses clients and their currently supported tool exchanges. No provider expansion, restored codex/private backend, Antigravity, Cursor tools/images, CLI startup timeout or unrelated hardening. No real provider/login/credential/private DB, Docker, dependency/permission/release/deploy. Buffered client accounting remains prior behavior; forced upstream streaming for buffered clients is not a new client-stream scope.

- NH-1: Given any in-scope client stream, reserve a durable unique attempt immediately before each actual inference send. Existing fallback and one legal401 retry share one request_id, preserve every attempt and use separate monotonic clocks. Refresh/discovery are not inference and create no model usage. Preserve forwarding/auth/allowlist/refresh locking/borrowed-file read-only policy/retry limits; reservation failure is nonretryable503 with zero send/fallback. Pre-dispatch rejection creates no inference attempt.
- NH-2: Observe original Chat or Responses usage and terminal before conversion, never synthesized counters. Preserve Chat usage tails; Responses completed/incomplete/failed and source errors are independent of HTTP status and nullable usage. Explicit zero survives; invalid/absent counters are never invented. First-terminal wins, later noise cannot overwrite or double count. Bound retained observation; only fixed numeric observations/status/timing enter the ledger. Named subscription/OAuth costs remain null without a validated price basis; generic API-key prior estimates remain compatible.
- NH-3: Success/upstream failure/truncation/cancellation/timeout/unpolled or partial body drop/conversion rejection settle exactly once with observable timing and fixed diagnostics. Observe only bytes accepted by the existing converter/native guard, including CR/LF/CRLF and terminal lookahead; never rescue earlier failure with later same-chunk usage/success. Settle before final client output; preserve original stream bytes, tool IDs, error behavior, backpressure and resource limits. Each attempt measures its own dispatch, headers, first meaningful raw text/tool output and local terminal/stop; D-03 is not whole-fallback timing.
- NH-4: Insert/finalize failure does not cause inference replay. Pending rows survive and recover once as interrupted after restart without invented usage. Existing history/configuration remain reusable; API/HTML/CSV agree for the same data, preserving null and explicit zero. No historical repricing or complete-billing claim.
- NH-5: A rerunnable headless offline entry proves setup/auth, all three client streams and supported two-turn tools, fallback/401 reread/failure/cancel/timeout, usage and restart/reuse. All inference/refresh/discovery paths must be proven controlled fake endpoints before tests. Preserve genericHTTP/Claude/Cursor journeys and existing digest guards. Full focused RED→minimum correction→native regression, independent source/runtime and ledger review, requiredCI/normalmerge/readback, complete verified backup and own-worktree cleanup precede delivery claim.

## Current source matrix

| Provider | Upstream | Authentication and existing retry | Observer before this slice |
| --- | --- | --- | --- |
| SIWC | Responses, forced stream, official plan-sharing sanitization | imported OAuth, serialized proactive refresh and at most one401 refresh/retry | excluded by generic API-key guard |
| Grok | Responses, follows client stream | imported OAuth refresh or borrowed explicit auth file; borrowed reread every attempt, one401 retry only if token changed, never refresh/write file | excluded by provider/borrowed guard |
| OpenCode | Chat | existing token/free import or named connection; existing refresh attempt has no implementation, no added retry | excluded by provider guard |
| Generic HTTP / Claude / Cursor | Chat / existing CLI formats | already delivered | regression only |
| Antigravity | generateContent/discovery | separate #702 isolation work | excluded |

## Design and isolation

Move HTTP reservation to the actual send boundary; retain one mutable owned attempt slot per target forwarding chain, settle a401 before an existing legal retry and replace the slot with a fresh reservation. The caller passes one request context through fallback; errors with in-scope accounting never create duplicate legacy rows. Observe upstream format through the existing owned body lease. Add a bounded Responses observer and source revision; preserve existing conditional store finalization/startup recovery. Native guard must expose consumed source boundary and terminal failure so raw observation cannot look beyond rejection or settle before CR lookahead resolves.

Inference base overrides already exist. They do not isolate refresh: SIWC uses a fixed auth base and Grok a fixed token URL. Refresh proof therefore uses per-instance, test-compilation-only transport injection into the same refresh lock/re-read/persist/retry logic, with no production option/allowlist change. Injected clients use no proxy and no redirects to exact loopback fake endpoints. Binary walkthrough imports fresh synthetic credentials without refresh tokens and never calls login/import-local/refresh-all; borrowed Grok uses an explicit fixture-owned absolute file. Model discovery routes, if invoked, must resolve to the same non-forwarding fake HTTP server. Antigravity is never configured.

## Plan and evidence

Documentation frozen before implementation; actual nine-path baseline RED retained and corrected. Estimate3–4activehours including integration/review/delivery;20minute checks; commands/CI bounded600s; one initial repro plus at most2 reasoned corrections per issue. Stop affected work for isolation failure, scope/SDD/authority conflicts, no progress or material estimate overrun. Whole-round unmeasured tool/provider/model/token/cost/active-wait values remain unknown/null.

Mainline incomplete, usable_tag none, desk in_progress. Full#698 needs complete path evidence;#699–702 remain open, AC04tools/AC17Cursor text-only decision unresolved. Real client/version/provider and OAuth billing are not established by synthetic tests. Complete this bounded continuation then stop.

## Observed local evidence and remaining delivery gates

The initial real HTTP matrix forwarded all nine provider/client streams but persisted no durable attempt/raw counters: actual RED. The integrated correction reserves at send, observes original Chat/Responses, and retains each401/fallback result. Additional actual REDs cover converted CR-only early acceptance, converter failure feedback, and independent review R1 (BOM ignored by converter but observed by accounting); minimal corrections preserve existing wire behavior. Focused tests also cover named preheaders timeout/cancel, unchanged borrowed401, native body drop/read error/lookahead, reservation/finalization faults and once-only restart recovery.

Commands run from the repository root (all Rust commands use the existing shared target):

- `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml`:353 tests/22groups passed, including both converter BOM witnesses and preflight zero-dispatch.
- `cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check`, `cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings`, and `cargo +1.99.0 build --locked --manifest-path gateways/pokercase/Cargo.toml`:passed.
- `python3 -m unittest discover -s gateways/pokercase/scripts/tests -v`:67passed. `python3 -m unittest discover -s scripts/tests -v`:20passed.
- `python3 gateways/pokercase/scripts/named_http_walkthrough.py --check --binary <verified-binary> --expected-binary-sha256 <accepted-digest> --output-dir <evidence-parent>`:nine stages passed,41 durable inference rows (34succeeded/5failed/1cancelled/1timeout), three separate fake discovery calls, zero denied destinations. Every named cost stays null; refresh success/failure is independently exercised through the test-only transport and is not attributed to this binary journey.
- Existing `offline_walkthrough.py`, `claude_walkthrough.py` and `cursor_walkthrough.py` check journeys each passed all nine stages against the same verified binary; generic fixture estimates remain synthetic and partial, not a bill.
- Guarded named `--serve` passed the actual journey, authenticated admin200, SIGTERM exit0, owned child reaping and temporary data removal. The new preserved helper pins its own binary and all six script dependencies; prior entry/digest guards remain unchanged.

Initial socket/fetch sandbox restrictions were distinguished from product failures and retried only via platform-approved execution. Original failures remain in private evidence; no success retry establishes#701 root cause. Full-round tool/provider/token/cost/active-wait measurements remain unknown/null. Repository contracts passed and independent source/runtime review found no remaining blocker. Mandatory CI/merge/readback have passed for PR748. Ledger/backup/cleanup remain final handoff gates, not preclaimed here. Workflow CI now runs all Python helper tests and the new named journey; its pinned workflow validator remains mandatory before merge.

## Remaining route to the owner goal

The generic HTTP, Claude, Cursor text-only and existing named HTTP streaming offline paths are delivered in bounded slices; this does not close full#698. Antigravity and any remaining unobserved paths require complete coverage evidence, with#702 isolation still separate. Buffered-client accounting keeps its prior scope. #699 still covers complete token/pricing provenance and precision/historical semantics; OAuth/subscription observations are not known bills. #700 needs the named real-client/version matrix and real AC01/04/08 evidence after isolation; SIWC namespace tools and actual provider behavior remain unverified. The AC04 tools versus AC17 Cursor text-only decision remains open. #701 intermittent startup/auth failures retain unknown cause. Existing CLI pre-first-output wait has no new deadline; only the established cancellation and post-output stall behavior is covered. No live provider/client approval or owner-personal run is inferred from agent fixtures. Stop after this authorized slice.

## Product merge and handoff snapshot

產品 [PR748](https://github.com/fallrising/newclear/pull/748) source `667248f46d0a90a3d3d8849196f8f0df614d3e4e`、merge `af2321d68aca9c26e043c249f3bda16395ece016` at 2026-10-29T08:08:28Z；353 Rust tests/22 groups、fmt/Clippy/locked build、67 Python、20 validator tests、46 contracts/7 indexes、獨立來源/執行審查通過。必要 Pokercase CI、Project success contracts、Workflow static validation 全通過；正常 merge 後18檔內容、source/merge祖先與雙方Desk-Task trailer回讀一致。

既有SIWC/Grok Responses與OpenCode Chat的三種客戶端串流現在每次實際推論前登記attempt；fallback/既有合法401重試保留相同request_id與不同attempt，refresh/discovery不列推論。原始Chat/Responses usage、終態與各attempt獨立時間入帳，缺值unknown、明確零保留；OAuth/訂閱費用不推算為已知帳單。借用Grok檔保持read-only，未變更token的401不重試；正式allowlist與retry限制不變。

named HTTP九階段隔離旅程通過：41筆attempt（34 succeeded、5 failed、1 cancelled、1 timeout）、3次獨立fake discovery、0個非預期目的地，41筆cost全部null。涵蓋三provider×三client文字/既有工具兩輪、fallback/借用401、失敗/截斷/缺值/零/取消/stall、API/HTML/CSV及重啟保留歷史設定後新請求。真正refresh由test-only transport透過原有鎖/重讀/rotation/persistence測試，不冒充binary旅程曾呼叫refresh。named preheaders取消/timeout、body drop、conversion failure、儲存故障與pending一次恢復另有focused/unit/integration證據。既有genericHTTP/Claude/Cursor各九階段旅程回歸通過；generic fixture估價不是provider帳單或開發費用。

新保留入口預設check，固定六個來源及獨立binary digest；實際--serve也完成旅程、authenticated admin200、SIGTERM exit0、owned child與臨時資料清理。Binary SHA256 `b03228008e0cc4668bb0aea499bdbb74ad7ccf81892fdffb0521406f836ab4fb`。舊Cursor入口與digest原文保留。這是agent離線實測，沒有宣稱owner親自跑過。

保留九組baseline missing-attempt RED、converted CR-only提前觀察RED、converter failure回饋缺漏RED，以及獨立review R1的BOM消費邊界RED；各以最小修正取得GREEN，BOM另驗兩種實際轉換模式。初次socket/fetch/index sandbox拒絕由平台核准精確操作解決，沒有chmod或放寬正式限制。claim validator曾用錯cwd，fail-stop在提交前停止；讀取錯路徑不冒充產品失敗。本機未找到既有actionlint工具，未宣稱本機通過，必要remote workflow static validation已通過。所有提交/發布gate使用fail-stop；未用重試通過宣稱#701根因已知。

完整#698仍需剩餘路徑完整覆蓋，Antigravity保留#702隔離工作；buffered clients維持前輪範圍。#699完整token覆蓋/價格來源精度/歷史語義、#700具名真client/version/provider與AC01/04/08、SIWC namespace工具實際相容性，以及AC04工具對AC17 Cursor text-only範圍決策仍未完成。#701既有啟動/auth間歇問題根因未知；本輪不處理CLI首次輸出前deadline或其他hardening。mainline incomplete、usable_tag none、desk in_progress；不自動關閉#698–702，不把測試數量當整體完成。

只使用fake HTTP/CLI/runtime、合成憑證/借用檔與臨時DB；沒有真provider/登入/credential/私人DB/Docker、新依賴、擴權、release/deploy。原17AC、T1102、Cargo、已交付SS/PC/CS/CU及不相關tracked plans保留。全輪未完整量測工具/provider/token/費用/active-wait均unknown/null，局部command時間和fixture41次推論不代表開發模型/provider總用量。

本份為產品merge時點快照。NH-5全流程的後續帳本發布、完整備份`t0432-named-http-settlement-20261029`逐檔核對及本輪工作樹清理，以私人`t0432-named-http-settlement/handoff.json`最終事實核實，不預先宣稱完成；完整操作位置留在私人交接。完成此有界切片即停止，不啟動下一里程碑。

最終artifact核對另從乾淨已提交source做locked build，仍得到同一b032binary，四條旅程及serve再次通過。共享target曾呈現另一digest；兩條追加旅程因root傳入該digest而在fixture啟動前被guard拒絕，改用實測locked-build digest後通過，原失敗保留、保護不變；不把這當#701根因證據。
