# T-0434 — Antigravity offline isolation and existing HTTP acceptance

Demand: desk T-0434 / [#702](https://github.com/fallrising/newclear/issues/702). Claim PR288 merged `acdecdbbcb8df5c305bc995cbe89cebe75cf7e3d` before implementation. Source `45f6cc55c8c47194b6dcecf986862e6676f6efc2`. This bounded verification slice follows unchanged T-1102 UC-R01/03/05 and preserves original17AC, Cargo and prior SS/PC/CS/CU/NH deliveries.

## Fixed acceptance

- AI-1: Given the current inference/stream/refresh/discovery implementation, document exact URL construction, authentication, security restrictions and injection points before any network fixture. Preserve T-0428's unintended synthetic official-endpoint401: no real credential/privateDB was read and no successful inference was observed, but it was not zero outbound. Never repeat the real-provider request.
- AI-2: Given a per-instance test-compilation-only transport and non-forwarding loopback fake server/proxy, prove before executing acceptance that every used inference, Google refresh and project discovery route resolves to the owned fake endpoint. Unknown destination/operation, redirect and CONNECT must not escape; no DNS/upstream forwarding, environment credential reads or fallback to production transport. Preserve production OAuth allowlist, fixed URLs, default client policy and permissions. Only synthetic fixtures and temporary isolated stores. Failure of this proof stops dependent HTTP tests.
- AI-3: Given that isolation proof, exercise actual HTTP through the existing gateway router/forwarding and conversion for buffered Chat/Messages/Responses, original Antigravity usage shapes (complete, absent/partial, explicit zero and invalid counts), exact destination/order/counts, project discovery persistence and existing refresh/one401 retry. Observe SQLite and existing admin JSON/CSV surfaces without inventing counters, billing or durable attempt coverage. Verify existing failure/fallback and no extra inference from discovery/refresh; preserve wire behavior. A production behavior correction requires a real retained RED first; baseline PASS is valid coverage and needs no manufactured RED.
- AI-4: Given existing stream=true handling, exercise actual HTTP byte forwarding, failure/cancel/stall and owned resource cleanup at proportionate scope. Record actual behavior and unsupported client conversion/terminal accounting honestly. This slice does not add Antigravity streamGenerateContent, tools/images, stream observer or durable attempt capability. Known gaps are reported, not converted into artificial passing completion claims. Reopen the isolated store and serve it again to prove current configuration/history reuse without automatic inference replay.
- AI-5: Given the final candidate, provide a headless repeatable command using a separately preserved, digest-checked native test executable and sanitized machine-readable report. Distinguish actual HTTP from parser/source evidence and real client/version/provider validation. Run focused/full locked Rust1.99.0, fmt/Clippy/build, Python and repository validators, plus unchanged generic/Claude/Cursor/namedHTTP journeys on an independently pinned normal binary. Complete independent source/runtime and ledger review, fail-stop commit/push/PR/requiredCI/normalmerge/readbacks, ledger handoff, complete per-file verified backup and own-worktree cleanup. Mainline incomplete, usable_tag none and desk in_progress remain; no automatic issue closures or next milestone.

## Source matrix and design

| Path | Current URL construction | Authentication / restrictions | Isolation contact |
| --- | --- | --- | --- |
| Buffered inference | providers::build_upstream_url ignores agy base and returns cloudcode-pa.googleapis.com/v1internal:generateContent | Bearer imported OAuth; official HTTPS host allowlist checked, existing operator overrides do not change this URL | cfg(test) explicit transport intercepts actual constructed URL before request builder; closed mapping to owned loopback |
| stream=true inference | Same generateContent URL, Accept text/event-stream; request adapter has no stream field | Same auth/checks; all clients currently use opaque passthrough, agy excluded from stream observer | Same guarded transport; characterize actual bytes and cleanup, not supported client-protocol streaming |
| Project discovery | agy::fetch_project_id uses fixed cloudcode-pa.googleapis.com/v1internal:loadCodeAssist with its own client | Bearer; metadata.project bypasses lookup; successful discovery is stored in OAuth meta | Private shared implementation with cfg(test) endpoint/client injection, no production knob |
| Google refresh | oauth_refresh uses fixed oauth2.googleapis.com/token and its own client | Production client_id/secret env; serialized connection reread and persistence, proactive best-effort and one401 retry | cfg(test) explicit synthetic client parameters + transport; never read production env in test branch |
| Admin connection test | connection base + /models using ProxyState.http | Existing admin gate and stored token; not Antigravity project discovery | If exercised, transport/proxy must deny unlisted URL/CONNECT; no live discovery probe |

Use a closed route table and a dedicated test client with redirects disabled, no system proxy inheritance and a mandatory non-forwarding loopback proxy (or equivalently sealed direct loopback destinations). The fake server generates responses locally and has no resolver/forwarder. No global environment mutation or test-only production CLI flag. Test transport owns the whole agy forwarding chain, including refresh/discovery; missing route is an error, never production fallback. Production wrappers retain their original arguments and behavior. The terminal entry executes native tests containing the real router/HTTP code; it is not a new production Antigravity demo mode.

No demonstrated runtime defect at document freeze. Safety injection and existing behavior characterization are test-first exceptions: the old unsafe fixture must not be rerun to manufacture RED. Focused transport-negative tests precede HTTP acceptance; any later directly related product defect must retain actual RED before minimal repair.

## Plan and limits

Estimate3–4activehours including integration/review/delivery,20minute checkpoints,600second command/CI bound, initial failure plus at most2 reasoned corrections per issue. Stop affected work if isolation cannot be proven, a material product/scope/authority conflict appears, progress stops or effort materially exceeds estimate. Whole-round unmeasured metrics remain unknown/null; local command times and synthetic request counts are separate.

No real credential/privateDB/provider/login, Docker, dependency/permission expansion, release/deploy; no #699 reform, #701 general repair or CLI startup deadline. AC04 tools versus AC17 Cursor text-only remains undecided. #698 still needs all remaining settlement paths; #700 actual client/version/provider and AC01/04/08 remain. Complete only this authorized isolation slice.

## New historical evidence

Owner personally reran the previous namedHTTP entry after its handoff/backup snapshot: nine stages/cleanup passed,41inference/3discovery/0unexpected destinations, pinned binary b03228008e0cc4668bb0aea499bdbb74ad7ccf81892fdffb0521406f836ab4fb. This new evidence is appended; old owner-not-run statements remain true for their snapshot. The old backup did not contain this later report. This is owner offline rerun evidence only, not whole-product/live-provider acceptance.

## Execution evidence

Local product checks passed on the candidate based on `45f6cc55c8c47194b6dcecf986862e6676f6efc2`. Independent source review preceded transport execution, and the six-test transport proof preceded actual HTTP acceptance. No production defect was manufactured or corrected: this slice adds test-only confinement and characterization of existing behavior. Independent product review, required CI, normal merge and remote readback passed for PR757; ledger, backup and cleanup remain final handoff gates.

| Evidence | Observed result | Limit |
| --- | --- | --- |
| Six transport tests | Closed three-URL map, constructor/validator refusal, unrelated CLI/API rejection; real fake HTTP10 requests (7allowed,3denied), four redirects not followed, zero owned-sentinel connections, cleanup | Reviewed inference/discovery/refresh call tree; not machine-wide egress or excluded admin routes |
| Actual gateway HTTP seven stages |37inference,3discovery,7refresh,0unexpected destinations;37client inference requests and169local admin requests | Synthetic requests, not real client/version/provider validation or development usage |
| Buffered15cases | Three client protocols, wrapped/unwrapped `usageMetadata`, missing/partial/zero/invalid/overflow counters and absent price; SQLite/adminJSON/CSV match | Existing persistence only; no new raw provenance or billing semantics |
| Discovery/refresh | Cached project persisted; discovery failure/missing project stops inference; proactive success/failure/malformed and one401 retry cases preserve exact order and token persistence behavior | No admin refresh-all/login/host import; refresh/discovery do not add model rows |
| Errors/fallback |503fallback saves existing two rows;400does not fallback; fixed error code retained | MalformedHTTP200→400 currently leaves zero usage rows, explicitly recorded as unresolved accounting gap |
| Existing streaming | Three APIs preserve exact opaque bytes; client drop, post-output stall and upstream failure verified | Still generateContent, no Gemini stream conversion/tools/images/observer/durable terminal attempt |
| Cleanup/reopen | Five stream owners dropped, zero active; server tasks joined, listeners rebound, temp data removed; routes/keys/history preserved on reopen and new request succeeds without replay |36legacy rows are not37durable inference attempts; HTTP200stream rows do not prove completion |

The legacy configured rates produce synthetic cost0.000043 for11input/7output and0for explicit zero; missing counters/prices remain null. This is fixture estimation, not verified subscription billing. Raw source fixture shapes and conversion assertions are in `src/agy_http_tests.rs`; the report shows actual request metadata and stored values without credentials or request content.

Commands run from the repository root unless noted:

| Command | Result |
| --- | --- |
| `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml --bin thinrouter --no-run` | PASS; compiled before any HTTP execution |
| Preserved native executable `antigravity_test_transport::tests:: --nocapture --test-threads=1` |6passed |
| Same executable `proxy::agy_http_tests::ai_http_acceptance --exact --nocapture --test-threads=1` |1passed; seven actual HTTP stages |
| `scripts/antigravity_http_check.py --test-binary <preserved-test-executable> --expected-test-sha256 <verified-sha256> --output-dir <evidence>` (component directory) | PASS; sanitized child environment, proof before HTTP, report/cleanup/destination/count checks |
| `cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml` |360tests /22groups passed,0failed/ignored |
| `cargo +1.99.0 fmt --check --manifest-path gateways/pokercase/Cargo.toml` | PASS |
| `cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings` | PASS |
| `cargo +1.99.0 build --locked --manifest-path gateways/pokercase/Cargo.toml` | PASS; normal production binary preserved separately |
| `python3 -m unittest discover -s gateways/pokercase/scripts/tests -v` |74passed |
| `python3 -m unittest discover -s scripts/tests -v` |20passed |
| `python3 scripts/check_indexes.py` |46contracts /7indexes passed |
| Existing `offline_walkthrough.py`, `claude_walkthrough.py`, `cursor_walkthrough.py`, `named_http_walkthrough.py`, each `--check --binary <preserved-normal-binary> --output-dir <separate-evidence>`; supported entries also use expected digest | All four nine-stage journeys and cleanup passed; old source/digest guards unchanged |

Native test SHA256 `61645fcfdcaa361ca9bf959c7584b0218c7e2b083713b134fcf9dfad4d3f7458`; normal binary SHA256 `af057a4c1337dfe8da486d731db2ad5fcaefe3bb739b33838736d1ac8115a88a`. These identify this preserved build, not a universal reproducible-build claim. Source fingerprints and complete command outputs are retained in the private delivery evidence. The [terminal build/preserve/rerun guide](../ANTIGRAVITY-OFFLINE.md) does not trust a mutable shared target.

Initial sandbox compiler/Git restrictions were treated as environment evidence; platform-approved exact operations proceeded without chmod or policy relaxation. Earlier source review caught a test-only CLI dispatch gap and corrected it before HTTP proof; a fixture status expectation was aligned before execution. No unsafe historical request was rerun for RED. Existing #701 startup/auth intermittent failures remain unexplained; passing regressions do not establish their cause.

## Remaining path to the owner journey

1. Keep the five offline entries: genericHTTP, Claude tools/session reuse, Cursor text-only, namedHTTP supported tools, and this Antigravity HTTP foundation. This slice provides actual isolation/conversion/persistence evidence; parser tests and source matrix alone do not supply it.
2. Antigravity still needs a separately authorized streaming/provenance/terminal settlement slice if required for the final product, including its opaque protocol boundary and malformed-success missing row. Other uncovered buffered/attempt paths remain part of full#698. Isolation does not complete those capabilities.
3. #699 still covers complete token coverage, pricing source/precision and historical accounting semantics. Fixture rates and missing-value preservation do not establish bills or quotas.
4. #700 still needs named real client/version/provider and AC01/04/08 journeys, including SIWC namespace-tool compatibility. AC04 tools versus AC17 Cursor text-only remains an owner product decision; this work adds neither Cursor tools/images nor new provider capability.
5. #701 retains the unresolved startup/auth intermittent failures and any separately scoped reliability work. No CLI first-output deadline or general hardening is added.
6. #702 is assessed from the complete source-plus-HTTP confinement evidence. Issue closure requires the current owner authorization; no automatic closure of#698–702. Mainline incomplete, usable_tag none, desk in_progress remain. Finish this bounded delivery and stop.

## Product merge and handoff snapshot

產品 [PR757](https://github.com/fallrising/newclear/pull/757) source `7d7382bc79854dfbd8786a22c1b7a67c9fbfc2d9`、normal merge `3d2b125afe250b35f1ff4ff1bc0a7bd47eac5255` at 2026-10-29T12:46:39Z；三項必要CI、獨立來源/執行/文件審查通過，17檔遠端內容、source/merge祖先及雙方Desk-Task trailer回讀一致。

本輪只建立既有Antigravity HTTP離線隔離與驗收基礎。測試編譯專用closed transport攔截固定inference/discovery/Google refresh URL，使用不轉送loopback proxy；六項proof通過後才執行實際gateway HTTP。Production OAuth allowlist、URL、權限、登入及依賴不變。Proof的10次fake請求（7允許/3拒絕）、四種redirect不跟隨、0sentinel連線及清理通過。

七階段實際HTTP觀測37inference/3discovery/7refresh/0非預期目的地，另計37client inference與169local admin請求；36legacy usage rows。15個buffered案例涵蓋三client轉換及wrapped/unwrapped/缺值/部分/零/無效/overflow/缺價，SQLite/adminJSON/CSV一致。Discovery快取、主動refresh與一次401重試、失敗/fallback、三client opaque bytes、取消/stall及重啟重用通過。5個stream owner釋放、0active，兩server join、listener rebind、temporary data移除。

360Rust tests/22groups、74Python、20validator tests、46contracts/7indexes、fmt/Clippy/locked build全通過；genericHTTP/Claude/Cursor/namedHTTP各九階段與cleanup回歸通過。乾淨已提交source的Cargo artifact回讀及40source hashes一致，保留test binary SHA256 `61645fcfdcaa361ca9bf959c7584b0218c7e2b083713b134fcf9dfad4d3f7458`、normal binary `af057a4c1337dfe8da486d731db2ad5fcaefe3bb739b33838736d1ac8115a88a`。新入口固定保留script/test binary後先proof再HTTP，不依賴可變共享target。

T-0428合成請求意外到官方端點得到401的歷史保留：未讀真credential/私人DB、未觀察成功推論，但不是零外連，也未重試真provider。新增owner證據為前輪namedHTTP入口親自重跑九階段/cleanup成功、41inference/3discovery/0非預期與原b032digest；report SHA256 `3a3ef04c6bb391fa2d7acafb8488a2bdaac5f42d949494c132d8574c9c66673d`。它晚於舊handoff/backup；舊未親跑快照不覆寫，舊備份不假稱含此報告，亦不宣稱owner已跑新Antigravity入口。

Antigravity仍是generateContent的opaque串流，無原生stream轉換/tools/images/observer/durable terminal attempt；malformedHTTP200→400實測沒有usage row，保留為#698剩餘記帳缺口。本輪legacy11/7合成rate估價0.000043不是訂閱帳單。完整#698其他未覆蓋路徑、#699token/價格/歷史語義、#700真client/version/provider與AC01/04/08及SIWC namespace工具、AC04工具對AC17 Cursor text-only決策仍未完成。#701啟動/auth間歇根因未知，不以green重跑推論已修。#702依完整隔離證據判斷，#698–702不自動關閉。mainline incomplete、usable_tag none、desk in_progress保持。

只用合成credential/fixture與隔離臨時DB，沒有真provider/登入/credential/私人DB/Docker、新依賴、擴權、release/deploy。排除admin refresh/refresh-all/probe/host import；這是列舉應用路徑的隔離，不是全機零egress。原17AC/T1102/Cargo/既有交付及不相關tracked plan保留。全輪工具/agent/provider/model/retry/token/費用/execution-active-wait均unknown/null；局部command時間與fixture次數不替代整輪量測。

此段是產品merge時點快照；AI-5後續帳本發布、完整備份`t0434-antigravity-isolation-20261029`逐檔核對與本輪工作樹清理，依私人`t0434-antigravity-isolation/handoff.json`最終回讀事實核實，不預先宣稱完成。完整操作位置留私人交接。完成本輪即停止，不啟動下一里程碑。
