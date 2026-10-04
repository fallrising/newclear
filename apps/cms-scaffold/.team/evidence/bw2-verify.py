"""Verify source preservation and report test counts without storing machine/session data."""
from pathlib import Path
import hashlib
import json
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def junit(task):
    result = dict(tests=0, failures=0, errors=0, skipped=0)
    files = list((ROOT / 'services/cms-api/build/test-results' / task).glob('TEST-*.xml'))
    assert files, f'Missing {task} XML'
    for path in files:
        suite = ET.parse(path).getroot()
        for key in result:
            result[key] += int(suite.attrib.get(key, 0))
    return result


def manifest():
    listed = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '--', '.'], cwd=ROOT, text=True)
    selected = []
    for name in set(listed.splitlines()):
        if name.startswith(('.team/', 'docs/')):
            continue
        path = ROOT / name
        if not path.is_file():
            continue
        if name.startswith(('services/', 'packages/', 'apps/', 'e2e-mock/', 'scripts/')) or name.endswith(('.json', '.kts', '.properties', '.config.ts')):
            selected.append(name)
    return {name: sha(ROOT / name) for name in sorted(selected)}


if __name__ == '__main__':
    current = manifest()
    (ROOT / '.team/evidence/bw2-gate-source-manifest.json').write_text(json.dumps(current, indent=2) + '\n')
    for task in ['test', 'integrationTest']:
        print(task, json.dumps(junit(task)))
    print('sourceFiles', len(current))
