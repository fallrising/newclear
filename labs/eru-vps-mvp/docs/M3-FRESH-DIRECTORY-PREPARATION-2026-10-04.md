# Fresh network directory preparation

## Goal and boundaries

Bridge bare replacement facts (no `/etc/eru`) to [fixed file staging](M3-FRESH-NETWORK-SSH-STAGING-2026-10-04.md) (existing root:root0700). Add a separately authorized durable controller operation, fixed SSH adapter and standard-library remote helper; directory creation only. No file payload, chmod/adoption of existing directories, activation, execute CLI, live SSH/VPS/private inputs, dependency, generation or barrier change. Formal remaining12 and overall PARTIAL stay explicit.

## Frozen action and wire

`fresh_network_directory.py`: OPERATION=`fresh-network-directory-preparation`; action derived from current network plan/pending/index with exact fields schema_version:1, operation, plan_id, plan_sha256, run_id, execution_sha256, pending_sha256, host_index, host, directory. host exact alias,node,ip,machine_id,boot_id,host_key_sha256 (same fixed four-host order and strict validation as file staging). directory exact path=/etc/eru,uid=0,gid=0,mode=0700 (string). No payload/other path/command.

Authorization is exact existing file-staging authorization schema but operation=`fresh-network-directory-preparation-authorization`, scope=`prepare-network-directory-only`; same plan/execution/pending binding, owner_confirmed true and <=15-minute window. File-staging authorization must never authorize directory preparation.

Observation exact observed_at,host,directory. Before: directory={path:/etc/eru,kind:absent}. After: directory={path:/etc/eru,kind:directory,uid:0,gid:0,mode:0700,device:<nonnegative int>,inode:<positive int>,intent_sha256:<64hex>}. No bool-as-int; host exact, timestamp fresh and after intent. Persisted provenance and target inode/device must match. Subsequent file staging can add contents without invalidating directory identity; directory observation makes no claim about payload contents.

Host module `fresh_network_directory_host.py`: validate_request(request), handle(request, *, root='/', owner_uid=0, owner_gid=0, now=None), main(encoded). Request exact schema_version:1,operation:observe|prepare,action; prepare also intent_sha256. Strict bounded JSON <=256KiB, duplicate/nonfinite/depth/type/path overrides rejected before IO. Direct-import test seams unavailable on wire. main production defaults, only observation stdout, generic errors. Standard library plus reviewed existing host helper support allowed; transmitted program must bundle fixed support so remote repo installation is unnecessary.

SSH module `fresh_network_directory_ssh.py`: SSHNetworkDirectoryAdapter(host_keys, *, transport=None); observe(action), prepare(action,intent_sha256); build_program(request). Exact copied distinct four Ed25519 keys, digest match before single transport, same SSHReader argv/memfd/timeout/no-retry; generic redaction and strict response. Bundle actual reviewed helper source without executing imports locally, fixed data-only base64 request, remote command unchanged. No dynamic user imports/code/commands.

## Remote journal and safe directory creation

All ancestors and identity files pinned nofollow, safe owner/mode/nlink, bounded raw bytes; check machine/boot/Ed25519 before and after every publication, as existing helper. Root-controlled assertions require trusted root and isolated writers; no claim to defeat compromised root or atomic whole-host snapshots.

Permanent claim path `/etc/.eru-fresh-directory` outside absent target; no-clobber mkdir and parent fsync. Pin newly claimed dev/inode, compare opened descriptor and empty entries before owning it; losing/unowned caller cannot poison someone else's journal. Canonical immutable intent={schema_version:1,action,intent_sha256}, filefsync→no-clobberlink→unlink-own-temp→dirfsync and raw/inode recheck before creating target. No target creation until intent durably verified.

Target mkdir `/etc/eru`0700 only if absent (symlink/files/empty/matching-existing all refuse). Pin opened target dev/inode and exact owner/mode; fsync target and parent, recheck raw journal, ancestors and incarnation. No permission repair. Complete={schema_version:1,action_sha256,intent_sha256,directory:{device,inode}} canonical immutable publication. Observe succeeds only after exact journal entries intent.json+complete.json, valid canonical raw records, matching action/intent/incarnation and target identity; before-state only when BOTH journal and target absent. Partial/unknown/temp/failure states reject. Failure retains claim/target with marker when owned; no retry/cleanup/rollback. Complete response lost permits only observe-based recovery. Follow existing non-atomic mkdir→first-stat trust boundary explicitly.

## Controller lifecycle

`fresh_network_directory_ops.py`: prepare_network_directory(project,plan_id,expected_sha,authorization_file,authorization_sha,host_index,adapter,*,now=None,source_state=None); inspect_network_directory(project,run_id,host_index,expected_intent_sha,*,now=None,source_state=None); reconcile_network_directory(...,observer,*,now=None,source_state=None).

Permanent local AREA=`private/operations/fresh-rebuild/network-directory`, one execution/host slot. Preserve current plan rederivation, authorization/fence/pending/publication/raw/source/final-time checks from existing staging coordinator; sequential four-host predecessor receipts; durable local intent before adapter.prepare, no replay via new plan, post-observe required, recovery observer only, immutable receipt and late-loser protection. Output status blocked|uncertain|prepared with existing false stage_accepted/generation_changed/external_fence_verified, dispatch_attempted, optional intent_sha256/receipt_sha256; no payload or private error text. Existing source may be reused carefully but no global monkeypatch or weakening original gates. File staging and its prior journals remain unchanged.

## Acceptance and delegation

T-244 owns host helper (and narrowly scoped reusable support changes if necessary) plus filesystem tests. T-245 owns contract/coordinator/SSH adapter and tests. T-246 independently reviews with separate adversarial tests. Root owns integration/documentation/acceptance. Every worker isolated, explicit scope/budget, no nested delegation or Git/external mutation.

Required RED→GREEN: preexisting target never altered; durable intent before target; partial/lostreply no replay; journal/target/identity swaps, raw tampering, mode/owner/hardlinks, claim loser, fsync failures, strict wire/trust/no transport on mismatch, current authorization rejection, pending/source/freshness drift, offline inspect no writes, genuine directory→file-staging integration on local synthetic roots. Full native suite, original workflow, compileall, team/privacy/diff gates and independent review required. Local fixture ownership mapping is explicit, not root deployment evidence.

## Initial integration evidence

The root's three synthetic integration tests passed (19.558s): all four directory preparations in order followed by core file staging; lost prepare response recovered only by observation then file staging; file-only authorization rejected before transport. The host support change adds only an internal require_eru flag, default true, to reuse pinned IO while the target is absent. The SSH bundle was executed in isolated Python with no repository imports, substituting only handle to avoid privileged IO. Initial missing-module RED and a corrected fixture nesting mistake are retained separately from product verification. Final candidate hashes and repository-wide acceptance remain the evidence gate's responsibility.

The new coordinator deliberately uses a scoped adaptation of the reviewed file-staging lifecycle with its own authorization, operation and journal area. It does not replace legacy journals or broaden the existing staging authorization. The local claim also pins mkdir/open identity and emptiness before allowing failure markers. Shared lifecycle extraction is deferred to avoid changing both audited operations during this behavior addition.

## Final local evidence

Root57 tests／21.787s、independent79／107.028s及full893／316.562s通過，full無failure/error/skip。之後僅source-drift test改為實際sha欄位，root單獨1test／1.235s與independent1test／1.238s通過，production未變；完整結果不混稱已跑過最後test edit。compileall、原workflow、frozenhash及team/privacy/diff gates通過。[T-247 evidence gate](../.team/reports/T-247.md) 接受本地slice，完整fresh仍PARTIAL。下一步network activation/observations，接bootstrap/probes、generation commit/seal與live acceptance。
