# Fresh dedicated firewall activation coordinator

## Scope and explicit limits

Continue [directory preparation](M3-FRESH-DIRECTORY-PREPARATION-2026-10-04.md) and file staging with a separately authorized controller operation and strict dedicated-table observation validator. Implement injected-adapter activation, durable intent, single dispatch, observation-only recovery and policy checks. This slice provides no production SSH/kernel adapter, execute CLI, effective key installation, tunnel configuration, reachability probe, reboot persistence, complete network-stage acceptance or VPS operation. Full ERU remains PARTIAL, formal remaining12 unchanged. Tests use synthetic evidence/fake adapters only.

The actual future adapter must atomically create the dedicated table only if absent, validate staged bytes/identity at the kernel operation boundary, preserve all other tables and retain its own durable provenance. Existing rendered table syntax is not by itself a no-clobber operation. The [official nft manual](https://netfilter.org/projects/nftables/manpage.html) distinguishes create (fails if table exists) from add. Schema reference: [upstream JSON documentation](https://git.netfilter.org/nftables/tree/doc/libnftables-json.adoc); installed libnftables-json(5) may be used for matching local package evidence. No actual nft command or namespace/kernel mutation is required or authorized by this slice.

## Frozen contract

Module `fresh_network_firewall.py` supplies OPERATION=`fresh-network-firewall-activation`, action(plan,digest,pending,index,staging_intent_sha,staging_receipt_sha), authorization, observation, intent_record, validate_intent, validate_receipt plus strict policy functions specified below. Existing identifier/hash/index bounds apply.

Action exact fields: schema_version:1,operation,plan_id,plan_sha256,run_id,execution_sha256,pending_sha256,host_index,host (same staging host including two exact planned files), staging_intent_sha256,staging_receipt_sha256, network. network exact controller_ip,private_interface,host_ips; derived from full current plan render, not supplied endpoints. host_ips four ordered unique approved private IPv4; controller distinct; iface tailscale0|wg0. Re-derive the expected rendered firewall via existing fresh_network_access._firewall and compare exact first-file bytes/hash; preserve full host/staged metadata validation. API action input validation fail closed, no arbitrary firewall expression.

Authorization exact existing staging authorization fields but operation=fresh-network-firewall-activation-authorization and scope=activate-fresh-firewall-only. Binds exact plan/execution/pending, true owner flag, current <=15-minute authorization. Directory/file-only authorization rejected. Stage safety flags remain false; successful public status firewall-active is bounded and is not network-ready.

Observation exact observed_at,host,directory,files,table. The first four fields must pass existing staging.observation against this host using staging_intent_sha256 (both before/after), preserving safe attributes, file hashes, incarnation and freshness. table before exact {kind:absent}; table after exact {kind:present,ruleset:<nft JSON document>,intent_sha256:<activation intent SHA>}. Missing/foreign provenance or mismatched policy reject. Creation-time chronology is checked against activation intent. Adapter-returned success is insufficient; a separate observer call is mandatory.

## Strict JSON policy verification

`expected_ruleset(action)` returns canonical unhandled nft JSON `{nftables:[table,chain,rule...]}` for the dedicated inet eru_fresh_access table and exact renderer semantics. `validate_ruleset(document,action)` accepts only the same ordered semantics, stripping a finite allowlist of output metadata (valid nonnegative integer handles and bounded leading metainfo) while rejecting unknown semantic fields, extra chains/tables/objects/rules/expressions, changed order, policy/hook/priority/flags, broad rules, unexpected counters/sets/jump/verdicts and bool-as-int. No generic recursive dropping of keys. Bounded strict types/depth/size, no duplicate-key or nonfinite JSON. Public function may accept only decoded dict, but a strict `decode_ruleset(raw:bytes)` must reject invalid raw inputs and be tested.

Expected table family inet/name eru_fresh_access; chain input type filter hook input prio -20 policy accept; loopback iifname lo accept first; allowed role-specific rules bind interface, IPv4 saddr/daddr, TCP dport, accept; final TCP management port set drop. All exact original management ports remain. Unknown legitimate nft normalization is conservatively rejected and documented as unvalidated until production fixtures exist, not silently accepted. No claim of kernel compatibility or reachability from synthetic JSON. Source tests must compare independent expected role policy and dangerous near-misses, not only call expected_ruleset twice.

## Durable coordinator

Module `fresh_network_firewall_ops.py`: activate_network_firewall(project,plan_id,expected_sha,authorization_file,authorization_sha,host_index,adapter,*,now=None,source_state=None); inspect_network_firewall(project,run_id,host_index,expected_intent_sha,*,now=None,source_state=None); reconcile_network_firewall(...,observer,*,now=None,source_state=None). Adapter observe(action), activate(action,intent_sha256); no production default.

AREA private/operations/fresh-rebuild/network-firewall. Retain reviewed directory/staging lifecycle gates, immutable local intent before dispatch, exact plan/source/pending/publication/current time checks, one execution/host slot independent of plan ID, local claim inode/empty ownership, ordered activation predecessor receipts and late receipt loser protection. Before any activation, validate all four complete file-staging receipts through the real staging session and current binding (same plan/execution/pending). Store the selected host's original staging intent/receipt digests in action. Recheck every staging publication/raw/current authority at final boundaries before dispatch and receipt; injected observation alone cannot replace those records. Use separate session objects without global mutation/monkeypatch. No directory/staging source changes needed. Public output blocked|uncertain|firewall-active, original false safety flags, optional digests, no private fields/errors. Reconcile only observes, no replay even if table is absent after an uncertain call.

## Team and gates

T-248 owns pure contract/nft JSON validator and tests. T-249 owns durable coordinator and tests. T-250 independently reviews both with disjoint adversarial tests. Root owns integration, docs, full gates, acceptance and authorized publication. Separate worktrees; no delegation by workers or external mutation.

RED→GREEN requires current exact four-host staging completion before activation, before table absence, one dispatch, immutable intent and persisted provenance, lost response only observe, no adoption/replay via another plan, cross-operation auth denial, ordered hosts, semantic nft policy near-misses, metadata/type/raw JSON strictness, staged bytes/incarnation/pending/source/raw publication/time drift, partial/late publication races, readonly inspection and redaction. Full native suite, original workflow, compileall, task/report/privacy/diff gates and independent review before acceptance. Expected kernel schema is narrowly supported; live fixtures and actual fixed adapter remain next work.

## Validation runtime budget

The new lifecycle and independent suites each take several minutes because they build and revalidate actual four-host local staging journals. Retain all existing and new safety tests; raise only the ERU-specific workflow timeout from10 to20minutes. This validation-support change does not alter triggers, permissions or checks and is included in independent review.

## Final local evidence

Root final frozen suite:944 tests/832.977seconds, zero failures/errors/skips. Independent combined gate:50/601.983seconds, no blocking findings. Initial integration1/36.011seconds used early policy; final full suite covers the final defensive-copy correction. Compileall, original workflow validation, task/report and public-scope/privacy gates pass. T-251 maps acceptance and limitations. No real nft, SSH, VPS, private data, release or deployment was used.
