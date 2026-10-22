# RE-1 implementation contract

Source of rules: docs/rules.md and SDD. This document records the RE-1 baseline. The current RE-2 extension is [re2-contract.md](re2-contract.md); its market/API and second-round guidance supersede the historical statements below that trading is unavailable.

## Runtime and API

`python3 labs/retro-economy/server.py --host 127.0.0.1 --port 8080 --db labs/retro-economy/var/retro-economy.sqlite3` from repo root. Only Python 3.11 stdlib, single-thread HTTPServer; native HTML/CSS/JS. Server supports port 0 and prints listening URL for test harness. DB persists each accepted action and outcome atomically.

Explicit static routes: `/`, `/app.js`, `/style.css`. API:
- POST `/api/join`: JSON `{name, profession, join_id}`; profession is `smith` or `herbalist`, join_id is a client-generated UUID persisted before first send. Returns 201 `{ok:true, token, state, message}`. Repeating same join_id and same payload returns same character/token without grant duplication; conflicting payload rejects. Name 1–24 trimmed characters, no control characters. No formal authentication claimed.
- GET `/api/state`: `Authorization: Bearer <token>`; returns 200 `{ok:true,state,message}`. Tokens never appear in state/logs or URLs.
- POST `/api/action`: same authorization; JSON `{action_id, action}`. Actions: `{type:"move",dx: -1|0|1,dy:-1|0|1}` with Manhattan distance 1; `{type:"gather"}`; `{type:"craft",item:"kit"|"medicine"}`. Server rejects undeclared fields, client result/coin fields, bad types, bool-as-int and nonfinite JSON. Returns `{ok:true,state,message}` on success; rejection `{ok:false,error:{code,message},state?}` with 400; unauthorized 401; missing route 404; conflicting reused action/join IDs 409; oversized JSON 413; bad content type 415. Response state on valid-token rule rejection is unchanged state. Message/error text user-facing Traditional Chinese.
- state object: `{id,name,profession,x,y,hp,coins,items:{ore,herb,kit,medicine},tower_stage,tower_reward_claimed}`. ID may be integer. Token only on join.
- Every action_id retained per-character in SQLite with payload fingerprint and original result, including rule rejection. Same id and identical payload returns previous result without effect even after intervening actions/restart; conflicting payload rejects. This clarifies SDD's ambiguous '最近' to protect delayed network retries and RE-A03; no server time expiry is added.
- Require JSON content type and ≤8192 byte body; timeout stalled bodies. Reject cross-origin Origin for API writes; no permissive CORS. Explicit asset allowlist, parameterized SQL, no arbitrary paths. Network default loopback. State tokens are local demo binding, not production authentication.

## UI contract

Original geometric top-down map shows exact graph and player marker, locations, inventory, hp, coins, tower progress and concise action feedback. Keyboard arrow/WASD and clickable move buttons. Narrow screens retain usable map/controls. No external assets, fonts or CDNs. No fake active trading UI; explain that trading is unavailable only when relevant after first completion.
- Form selectors: `#name`, `#profession`, `#join`; names may contain HTML but must be rendered as text.
- Movement: buttons `[data-move="west"]`, east, north, south; `#gather`, `#craft`.
- Readouts: `#player-name`, `#coins`, `#inventory-ore`, `#inventory-herb`, `#inventory-kit`, `#inventory-medicine`, `#tower-status`, `#message`.
- Persist token and any pending exact action body before request in localStorage; retry same ID/payload after network ambiguity or page reload. Do not turn one click into a fresh ID on retry. 1–2 second polling serializes state updates with actions, avoids stale polling response rollback. Join retries also reuse join_id. Separate session reset is explicit, never silently creates a new character on server/network error.
- Guidance tells players gather matching resource, return to town, craft, then tower. Never claims human onboarding/playtest passed. After first reward, explain next rounds need opposite-profession supply, not currently available until RE-2.

## Testing

Backend tests-first: pure rules (both professions routes, no mutation on refusal, adjacency, specialization, insufficient resource, deterministic encounter, backtrack, reset, one-time award), SQLite reopen/replay and HTTP malformed/body/token/static safety, process restart persistence. UI tests-first for meaningful client retry/state ordering behavior using Node built-in test runner if used, no packages. Orchestrator independently drives real browser via CDP; this is automated acceptance, not RE-3 human testing. All tests launched via agent-workspace launcher with distinct task IDs, evidence in AGENT_EVIDENCE_DIR. No dependencies or lockfiles.
