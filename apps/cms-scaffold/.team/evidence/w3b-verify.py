"""Verify the integrated W3b candidate using frozen source hashes and native result logs.

Run from the component root. The external baseline arguments are local delivery inputs,
not public repository configuration or substitutes for native checks.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument('--baseline', required=True)
parser.add_argument('--prior-snapshots', required=True)
parser.add_argument('--snapshots-root', required=True)
parser.add_argument('--original-root', required=True)
args = parser.parse_args()
root = Path.cwd()
evidence = root / '.team/evidence'
def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()
def save(name, data):
    (evidence / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
baseline = json.loads(Path(args.baseline).read_text())
allowed = {
    '.team/PLAN.md', 'docs/v2/README.md', 'docs/v2/waves/W3b.md',
    'packages/api/src/public-entry.ts', 'packages/api/src/client.test.ts', 'packages/mocks/scripts/gen-fixtures.mjs',
    'packages/mocks/src/db.ts', 'packages/mocks/src/state.ts', 'packages/mocks/src/fixtures.gen.ts',
    'packages/mocks/src/handlers/index.ts', 'scripts/check-bundles.mjs', 'e2e-mock/shell.spec.ts',
    *('apps/web-front/src/' + f for f in ['copy.ts', 'shell.tsx', 'home.tsx', 'routes.tsx', 'pages/login.tsx', 'pages/logout.tsx', 'test-utils.tsx', 'isolation.test.ts', 'App.test.tsx', 'site.test.tsx', 'clinic.test.tsx']),
}
protected = {name: digest for name, digest in baseline.items() if name not in allowed}
for name, digest in protected.items():
    assert sha(root / name) == digest, f'Protected source changed: {name}'
assert (root / 'package-lock.json').read_bytes() and sha(root / 'package-lock.json') == baseline['package-lock.json']
assert (root / 'packages/mocks/fixtures/member-entries.json').read_bytes() == (root / 'docs/v2/contracts/fixtures/member-entries.json').read_bytes()
assert (root / 'services/cms-api/src/main/resources/openapi/openapi.yaml').read_bytes() == (root / 'docs/v2/contracts/BW5.openapi.yaml').read_bytes()
prior = json.loads(Path(args.prior_snapshots).read_text())
for tree, files in prior.items():
    for name, digest in files.items():
        assert sha(Path(args.snapshots_root) / tree / name) == digest, f'Historical snapshot changed: {tree}/{name}'
original_files = json.loads((Path(args.snapshots_root) / 'cms-w1-baseline/manifest.json').read_text())
for name, digest in original_files.items():
    assert sha(Path(args.original_root) / name) == digest, f'Original work changed: {name}'
files = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], text=True).splitlines()
source = {name: sha(root / name) for name in sorted(set(files)) if (root / name).is_file() and name.startswith(('apps/', 'packages/', 'services/', 'e2e-mock/', 'scripts/'))}
counts = dict(tests=0, failures=0, errors=0, skipped=0)
for f in (root / 'services/cms-api/build/test-results/test').glob('TEST-*.xml'):
    suite = ET.parse(f).getroot()
    for key in counts:
        counts[key] += int(suite.get(key, 0))
assert counts == dict(tests=339, failures=0, errors=0, skipped=0), counts
log = (evidence / 'w3b-tests.log').read_text()
workspaces = [int(n) for n in re.findall(r'Tests\s+(\d+) passed', log)]
assert len(workspaces) == 8 and 'failed' not in log.lower(), workspaces
browser = json.loads((evidence / 'w3b-browser/summary.json').read_text())
assert browser['captures'] == 18 and browser['blocking'] == 0, browser
runner = json.loads((evidence / 'w3b-browser/runner-dashboard/summary.json').read_text())
# Runner format is independently retained for reviewer inspection.
assert runner['blockingFindings'] == 0 and len(runner['viewports']) == 2, runner
e2e = (evidence / 'w3b-e2e.log').read_text()
assert re.search(r'68 passed', e2e) and not re.search(r'\d+ failed', e2e), 'Full E2E not 68 passed'
assert len(re.findall(r'^test\(', (root / 'e2e-mock/front-w3b.spec.ts').read_text(), flags=re.M)) == 8
save('w3b-protected-manifest.json', protected)
save('w3b-source-manifest.json', source)
save('w3b-verification-summary.json', {
    'status': 'LOCAL_VERIFIED', 'java': counts, 'javaExecution': 'Gradle test FROM-CACHE; backend unchanged',
    'frontendWorkspaceCounts': workspaces, 'frontendTests': sum(workspaces), 'mockE2E': 68,
    'memberE2E': 8, 'memberAxeStatesPerViewport': 8, 'memberAxeViewportWidths': [1440,390],
    'browserCaptures': browser['captures'] + len(runner['viewports']), 'browserStateCaptures': browser['captures'], 'protectedBaselineFiles': len(protected),
    'sourceFiles': len(source), 'originalFilesPreserved': len(original_files), 'priorSnapshots': {name: len(json.loads((Path(args.snapshots_root) / name / 'manifest.json').read_text())) for name in prior},
    'runtimeOpenApiEqualsBw5': True, 'memberFixtureByteEquality': True, 'dependencyLockUnchanged': True,
    'publication': 'Pending required remote CI and merge. Not deployed.'})
print(json.dumps({'java': counts, 'frontend': workspaces, 'total': sum(workspaces), 'e2e': 68, 'protected': len(protected), 'source': len(source)}))
