"""Private source/evidence snapshot only; never includes local/ DB/media/secrets or volumes."""
from pathlib import Path
import datetime
import hashlib
import io
import json
import os
import subprocess
import tarfile

root = Path.cwd()
destination = Path('/home/ckc/test/backup/cms-pp1c-c-20261106-verified')
os.umask(0o077)
destination.mkdir(mode=0o700, exist_ok=False)
selected = set()
for scope in ['scripts/local', 'scripts/ops', 'services/cms-api/src', 'docs/v2', '.team']:
    for path in (root / scope).rglob('*'):
        if path.is_symlink():
            raise RuntimeError('SYMLINK_SOURCE_NOT_ARCHIVED')
        if path.is_file() and path.suffix not in ['.class', '.pyc']:
            selected.add(path)
for name in ['AGENTS.md', 'README.md', 'SUCCESS.md', 'compose.pp1-local.yaml', 'docs/tasks/BOARD.md']:
    selected.add(root / name)

def digest(data):
    return hashlib.sha256(data).hexdigest()

entries = {}
for path in sorted(selected):
    entries[str(path.relative_to(root))] = digest(path.read_bytes())
patch = subprocess.check_output(['git', 'diff', '--binary', '--', '.'], cwd=root)
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
manifest = {'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'sourceHead': head, 'dirty': True, 'filesSha256': entries,
            'trackedPatchSha256': digest(patch),
            'excluded': 'local/ credentials/raw DB/media/bundles and Docker volumes retained in place; not offsite/DB backup'}
archive = destination / 'source-evidence.tar.gz'
with archive.open('xb') as output:
    with tarfile.open(fileobj=output, mode='w:gz') as tar:
        for path in sorted(selected):
            tar.add(path, arcname=str(path.relative_to(root)), recursive=False)
        for name, data in [('_preservation/git-tracked.patch', patch),
                           ('_preservation/source-files.json', (json.dumps(manifest, indent=2) + '\n').encode())]:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o600
            tar.addfile(info, io.BytesIO(data))
    output.flush()
    os.fsync(output.fileno())
with tarfile.open(archive, 'r:gz') as tar:
    members = tar.getmembers()
    for name, expected in entries.items():
        assert digest(tar.extractfile(name).read()) == expected
    assert digest(tar.extractfile('_preservation/git-tracked.patch').read()) == digest(patch)
    assert json.load(tar.extractfile('_preservation/source-files.json')) == manifest
assert all(digest((root / name).read_bytes()) == expected for name, expected in entries.items())
record = {'recordedAt': manifest['recordedAt'], 'archive': str(archive),
          'sha256': hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest(),
          'selectedFiles': len(entries), 'tarEntries': len(members), 'allReadbackHashesMatched': True,
          'sourceHead': head, 'productUncommitted': True, 'rawRuntimeExcludedAndRetained': True}
(destination / 'README.md').write_text('# CMS PP1c C verified source/evidence snapshot\n\n'
    'Component-relative source/evidence plus binary tracked diff and source-file SHA manifest. '
    'Private 0700 directory/0600 archive. All selected bytes independently read back; '
    'local DB/media/bundles/credentials and Docker volumes remain in retained C/old worktrees. '
    'This archive is not DB/offsite backup or full D proof.\n\n' + json.dumps(record, indent=2) + '\n')
(root / '.team/pp1c-c-20261102/source-preservation-20261106.json').write_text(json.dumps(record, indent=2) + '\n')
for folder in [destination, destination.parent]:
    descriptor = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
print(json.dumps(record))
