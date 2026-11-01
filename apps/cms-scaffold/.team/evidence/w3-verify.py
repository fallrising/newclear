"""Deterministic source, preservation, test-result and contract evidence for W3."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / '.team/evidence'
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def save(name, value):
    (EVIDENCE / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
protected = json.loads((EVIDENCE / 'w3-protected-manifest.json').read_text())
for file, expected in protected.items():
    assert digest(ROOT / file) == expected, f'Protected file changed: {file}'
assert (ROOT / 'services/cms-api/src/main/resources/openapi/openapi.yaml').read_bytes() == (ROOT / 'docs/v2/contracts/BW5.openapi.yaml').read_bytes()
fixture_differences = []
for file in (ROOT / 'packages/mocks/fixtures').glob('*'):
    if file.is_file() and file.read_bytes() != (ROOT / 'docs/v2/contracts/fixtures' / file.name).read_bytes():
        fixture_differences.append(file.name)
# Both fixture trees are protected by the BW5 source hashes above. Their historical
# differences are deliberately retained, not normalized to the old W3 rehearsal.
assert sorted(fixture_differences) == ['admin-content-types.json', 'capabilities.json', 'principals.json', 'work-content-types.json', 'work-entries.json']
files = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], cwd=ROOT, text=True).splitlines()
source = {f: digest(ROOT / f) for f in sorted(set(files)) if (ROOT / f).is_file() and f.startswith(('apps/', 'packages/', 'services/', 'e2e-mock/')) and not f.endswith('.env')}
save('w3-source-manifest.json', source)
counts = dict(tests=0, failures=0, errors=0, skipped=0)
for file in (ROOT / 'services/cms-api/build/test-results/test').glob('TEST-*.xml'):
    result = ET.parse(file).getroot()
    for key in counts:
        counts[key] += int(result.get(key, 0))
assert counts == dict(tests=339, failures=0, errors=0, skipped=0), counts
log = (EVIDENCE / 'w3-tests.log').read_text()
frontend = [int(n) for n in re.findall(r'Tests\s+(\d+) passed', log)]
assert len(frontend) == 8 and 'failed' not in log.lower(), frontend
save('w3-verification-summary.json', {'status': 'IN_PROGRESS', 'java': counts, 'frontendWorkspaceCounts': frontend, 'frontendTests': sum(frontend), 'protectedFiles': len(protected), 'sourceFiles': len(source), 'runtimeOpenApiEqualsBw5': True, 'fixturesPreservedFromBw5': True, 'preExistingFixtureDifferences': sorted(fixture_differences), 'publication': 'Owner authorized dependency declared; pending required remote CI and publication; not deployed.'})
print(json.dumps({'java': counts, 'frontend': frontend, 'total': sum(frontend), 'protected': len(protected), 'source': len(source)}))
