"""Read-only M0 documentation link, scope and publication-boundary checks."""
from pathlib import Path
from urllib.parse import unquote
import json
import argparse
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--milestone', choices=['M0', 'M1'], default='M0')
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
component = root / 'platform/cloud-lab'
errors = []
links = 0
pinned = set()
files = sorted(component.rglob('*.md')) + [component / 'llms.txt']
for path in files:
    text = path.read_text()
    if re.search(r'https://github\.com/fallrising/(?:kernel|knowledge-base|journal)(?:/|\b)', text):
        errors.append(f'{path.relative_to(root)}: private repository link')
    if re.search(r'(?i)(?:account_id|database_id|api_token|client_secret)\s*=\s*["\'][^"\']+["\']', text):
        errors.append(f'{path.relative_to(root)}: inspect literal account/credential configuration')
    for target in re.findall(r'\[[^\]]*\]\(([^\s)]+)\)', text):
        links += 1
        match = re.match(r'https://github.com/fallrising/newclear/blob/([0-9a-f]{40})/(.+)', target)
        if match:
            pinned.add((match[1], match[2].split('#', 1)[0]))
        if re.match(r'[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
            continue
        local = unquote(target.split('#', 1)[0].split('?', 1)[0])
        dest = (path.parent / local).resolve()
        if not dest.is_relative_to(root) or not dest.exists():
            errors.append(f'{path.relative_to(root)}: broken/outside link {target}')
for sha, path in sorted(pinned):
    result = subprocess.run(['git', 'cat-file', '-e', f'{sha}:{path}'], cwd=root, capture_output=True)
    if result.returncode:
        errors.append(f'missing pinned source {sha}:{path}')

changed = set(subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=root, text=True).splitlines())
changed.update(subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=root, text=True).splitlines())
allowed = {
    'README.md', 'PORTFOLIO.md', 'PROJECTS.md', 'llms.txt',
    'docs/project-success/inventory.json', '.team/PLAN.md',
    '.team/tasks/T-810.md', '.team/tasks/T-811.md',
    '.team/reports/T-810.md', '.team/reports/T-811.md',
    '.team/cloud-lab-audit.py',
}
if args.milestone == 'M1':
    allowed.update({'.github/workflows/cloud-lab.yml', '.team/tasks/T-812.md', '.team/tasks/T-813.md', '.team/tasks/T-814.md', '.team/reports/T-812.md', '.team/reports/T-813.md', '.team/reports/T-814.md', '.team/tasks/T-815.md', '.team/tasks/T-816.md', '.team/reports/T-815.md', '.team/reports/T-816.md', '.team/tasks/T-817.md', '.team/reports/T-817.md', '.team/tasks/T-818.md', '.team/reports/T-818.md', '.team/tasks/T-819.md', '.team/reports/T-819.md', '.team/tasks/T-820.md', '.team/reports/T-820.md', '.team/tasks/T-821.md', '.team/reports/T-821.md', '.team/tasks/T-822.md', '.team/reports/T-822.md', '.team/tasks/T-823.md', '.team/reports/T-823.md', '.team/tasks/T-824.md', '.team/reports/T-824.md', '.team/tasks/T-825.md', '.team/reports/T-825.md', '.team/tasks/T-826.md', '.team/reports/T-826.md', '.team/tasks/T-827.md', '.team/reports/T-827.md'})
for path in sorted(changed):
    if path not in allowed and not path.startswith('platform/cloud-lab/'):
        errors.append(f'out-of-scope change: {path}')
for path in component.rglob('*'):
    if args.milestone == 'M0' and path.is_file() and path.suffix != '.md' and path.name != 'llms.txt':
        errors.append(f'non-document component file: {path.relative_to(root)}')
print(json.dumps({'document_files': len(files), 'links_inspected': links,
                  'pinned_sources_checked': len(pinned), 'changed_files': len(changed),
                  'errors': errors}, ensure_ascii=False, indent=2))
raise SystemExit(bool(errors))
