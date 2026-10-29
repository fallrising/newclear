# Antigravity offline HTTP acceptance

This terminal-only check uses the existing gateway router with synthetic credentials,
temporary SQLite storage and a non-forwarding loopback fake server. It requires no
desktop, login, Docker, new dependency or real provider access. Scope and fixed
acceptance: [T-0434 / #702](tasks/T-0434-antigravity-isolation.md).

The normal binary has no Antigravity demo mode. Existing inference, project discovery
and Google refresh construct fixed official URLs; a base override alone does not
confine them. The native test executable contains an explicit per-instance transport
that maps only those three logical destinations to an already-bound loopback fixture.
Its mandatory proxy never resolves or forwards, rejects unknown destinations and
CONNECT, and does not follow redirects. Production OAuth allowlists and behavior stay
unchanged. Admin refresh/refresh-all, connection probes, host import and login are
outside this harness.

## Build and preserve the test executable

From `gateways/pokercase`, use Rust1.99.0 and Python3.11 or later. This fail-stop shell
block compiles without running tests, selects the reported test artifact, and verifies
its digest before and after copying to a separate file. This detects replacement
during the copy; the preserved file is then checked before every execution. Keep `agy-evidence` in a durable
working directory if the reports must survive temporary-file cleanup.

```sh
set -eu
mkdir -p agy-evidence
cargo +1.99.0 test --locked --bin thinrouter --no-run --message-format=json > agy-evidence/build.jsonl
python3 - <<'PY'
import hashlib, json, shutil
from pathlib import Path
root = Path('agy-evidence')
artifacts = [json.loads(line) for line in (root / 'build.jsonl').read_text().splitlines()]
paths = [a['executable'] for a in artifacts
         if a.get('reason') == 'compiler-artifact'
         and a.get('target', {}).get('name') == 'thinrouter'
         and a.get('profile', {}).get('test') and a.get('executable')]
assert len(paths) == 1, 'expected exactly one thinrouter test executable'
source, target = Path(paths[0]), root / 'thinrouter-tests'
digest = lambda p: hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()
before = digest(source)
shutil.copy2(source, target)
assert digest(source) == digest(target) == before, 'build output changed during copy'
(root / 'test.sha256').write_text(before + '\n')
PY
python3 scripts/antigravity_http_check.py \
  --test-binary agy-evidence/thinrouter-tests \
  --expected-test-sha256 "$(cat agy-evidence/test.sha256)" \
  --output-dir agy-evidence/results
```

Rerun the final Python command with the same preserved executable and digest. Check
is the default and only mode. The launcher clears inherited credentials/proxy/provider
configuration, verifies the executable before each launch, requires every transport
proof test to pass, then runs the exact HTTP acceptance test. A mismatch, failure,
timeout or interruption returns nonzero; it never proceeds from failed isolation to
HTTP acceptance. It owns and terminates its child process group.

## Read the report

The printed `report.json` contains transport proof identities/results and seven HTTP
stages: unrelated-provider refusal, buffered conversion/usage, discovery/cache,
proactive and bounded401 refresh, errors/fallback, existing stream forwarding/cleanup,
and reopen/reuse. Each actual fixture request records its sequence, method, exact local
destination and synthetic auth/body validation. Counts reconcile to those records;
reports retain no token values or request content. Cleanup requires joined servers,
released listeners, zero active streams and removed temporary data.

The initial acceptance observed37 inference sends,3 discovery calls and7 refresh calls,
with0 unexpected destinations;37 client inference requests and169 local admin requests
are separate counts. There were36 legacy usage rows, including failure rows. These are
fixture observations, not development-model usage or billing. Buffered15case checks
compare actual SQLite, admin JSON and CSV counters/costs. Source fixtures retain the
original `usageMetadata` shapes; existing persistence does not gain raw provenance.

Stream tests prove opaque byte forwarding and cleanup, including client drop and the
existing post-output stall limit. They do not prove Gemini streaming protocol support,
terminal success or durable stream accounting. Malformed successful JSON currently
returns400 with no usage row; this remains a recorded accounting gap. Reopen checks
preserve routes, keys and history without replay, then serve a new request.

T-0428's historical synthetic request reached the official endpoint and returned401.
No real credential/private database was read and no successful inference was observed,
but that event was not zero outbound. It is preserved and never repeated by this check.
Current proof is confinement of this reviewed application call tree, not a machine-wide
egress assertion. Real client/version/provider acceptance remains outstanding.
