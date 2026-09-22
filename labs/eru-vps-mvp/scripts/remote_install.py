"""Root-side scoped installer, delivered over the controller's admin SSH alias.

Only accepts the controller-generated payload. Existing unowned files are
refused. Ownership/checksum records persist after every write so interrupted
runs can be examined and resumed. No changes to sshd, sudoers or containerd.
"""
import hashlib
import json
import os
from pathlib import Path
import pwd
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path('/var/lib/eru-mvp')
OWNER = ROOT / 'owner.json'


def run(argv):
    print(json.dumps({'command': argv}), flush=True)
    p = subprocess.run(argv, capture_output=True, text=True, timeout=90)
    if p.stdout:
        print(p.stdout.strip(), flush=True)
    if p.returncode:
        raise RuntimeError(f'{argv[0]} failed ({p.returncode}): {p.stderr}')
    return p.stdout


def main(config):
    if os.geteuid() != 0:
        raise RuntimeError('requires root')
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    state = json.loads(OWNER.read_text()) if OWNER.exists() else {'owner': 'eru-vps-mvp', 'files': {}}
    if state.get('owner') != 'eru-vps-mvp':
        raise RuntimeError('ownership mismatch')
    if config['role'] == 'core':
        # A release reapply must never silently replace a locally validated fix.
        for journal in (ROOT / 'core-updates').glob('*/journal.json'):
            if json.loads(journal.read_text()).get('stage') != 'rolled-back':
                raise RuntimeError('core patch/update journal exists; use explicit core update/recovery, not release reapply')

    def persist():
        temp = ROOT / 'owner.json.tmp'
        temp.write_text(json.dumps(state, indent=2) + '\n')
        temp.chmod(0o600)
        temp.replace(OWNER)

    def install(path, content, mode):
        target = Path(path)
        if target.is_symlink():
            raise RuntimeError(f'refusing symlink: {path}')
        data = content.encode() if isinstance(content, str) else content
        digest = hashlib.sha256(data).hexdigest()
        if target.exists():
            current = hashlib.sha256(target.read_bytes()).hexdigest()
            recorded = state['files'].get(path)
            if recorded is None or current != recorded:
                raise RuntimeError(f'refusing existing unowned or changed file: {path}')
            if current == digest:
                target.chmod(mode)
                return False
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as f:
            f.write(data)
            temporary = Path(f.name)
        temporary.chmod(mode)
        # Save intended digest first; interrupted replacement fails closed.
        state['files'][path] = digest
        persist()
        temporary.replace(target)
        print(json.dumps({'installed': path, 'sha256': digest}), flush=True)
        return True

    # Re-check deployment assumptions before any service/config changes.
    if run(['id', '-un', str(pwd.getpwnam('ckc').pw_uid)]).strip() != 'ckc':
        raise RuntimeError('unexpected admin principal')
    policy = run(['/usr/sbin/sshd', '-T'])
    if 'permitrootlogin no\n' not in policy:
        raise RuntimeError('expected existing root-login prohibition')
    run(['systemctl', 'is-active', 'containerd', 'docker'])
    expected = run(['containerd', '--version'])
    if 'v2.3.5 ' not in expected:
        raise RuntimeError('unreviewed containerd version')
    # Never replace the Docker runtime or its packages.
    for artifact in config['artifacts']:
        if not artifact['files']:
            continue
        with tempfile.TemporaryDirectory(prefix='eru-install-') as directory:
            archive = Path(directory) / 'archive'
            digest = hashlib.sha256()
            request = urllib.request.Request(artifact['url'], headers={'User-Agent': 'eru-vps-mvp-installer'})
            with urllib.request.urlopen(request, timeout=30) as source, archive.open('wb') as output:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    output.write(chunk)
            if digest.hexdigest() != artifact['sha256']:
                raise RuntimeError('archive checksum mismatch')
            with tarfile.open(archive) as tar:
                for binary, destination in artifact['files'].items():
                    entries = [m for m in tar.getmembers() if m.isfile() and Path(m.name).name == binary]
                    if len(entries) != 1:
                        raise RuntimeError(f'archive member ambiguous or absent: {binary}')
                    with tar.extractfile(entries[0]) as source:
                        install(destination, source.read(), 0o755)

    for file in config['files']:
        install(file['path'], file['content'], file['mode'])

    if config['role'] == 'core':
        key = Path('/etc/eru/ssh_key')
        if not key.exists():
            run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'eru-vps-mvp-core', '-f', str(key)])
            state['key_generated'] = True
            persist()
        elif not state.get('key_generated'):
            raise RuntimeError('refusing unknown existing core key')
        key.chmod(0o600)
        run(['nft', '--check', '-f', '/etc/eru/mvp-firewall.nft'])
    else:
        user = pwd.getpwnam('ckc')
        sshdir = Path(user.pw_dir) / '.ssh'
        sshdir.mkdir(mode=0o700, exist_ok=True)
        if sshdir.is_symlink():
            raise RuntimeError('refusing symlink ssh directory')
        # OneVPS uses a Match User ckc AuthorizedKeysFile outside the home.
        effective = run(['/usr/sbin/sshd', '-T', '-C',
                         'user=ckc,host=' + config['core_ip'] + ',addr=' + config['core_ip']])
        key_paths = next(line.split()[1:] for line in effective.splitlines()
                         if line.startswith('authorizedkeysfile '))
        if key_paths != ['/etc/ssh/onevps-personal-admin/ckc.keys']:
            raise RuntimeError('unreviewed effective AuthorizedKeysFile: ' + repr(key_paths))
        auth = Path(key_paths[0])
        original = auth.stat()
        if original.st_uid != 0 or original.st_mode & 0o022:
            raise RuntimeError('unsafe existing admin key file')
        if auth.is_symlink():
            raise RuntimeError('refusing symlink authorized_keys')
        text = auth.read_text() if auth.exists() else ''
        line = config['authorized_key']
        if line not in text.splitlines():
            # Refuse replacement of a previous task key; explicit rotation required.
            if any('eru-vps-mvp-core' in x for x in text.splitlines()):
                raise RuntimeError('existing task key differs; explicit rotation required')
            with tempfile.NamedTemporaryFile(dir=auth.parent, delete=False) as f:
                f.write((text.rstrip('\n') + '\n' + line + '\n').lstrip('\n').encode())
                temp = Path(f.name)
            temp.chmod(original.st_mode & 0o777)
            os.chown(temp, original.st_uid, original.st_gid)
            temp.replace(auth)
            state['authorized_key'] = line
            state['authorized_key_path'] = str(auth)
            persist()
        inactive = sshdir / 'authorized_keys'
        if inactive.exists() and not inactive.is_symlink():
            old = inactive.read_text().splitlines()
            if line in old:
                kept = [entry for entry in old if entry != line]
                if kept:
                    inactive.write_text('\n'.join(kept) + '\n')
                else:
                    inactive.unlink()
        os.chown(sshdir, user.pw_uid, user.pw_gid)
        sshdir.chmod(0o700)

    run(['systemd-analyze', 'verify', *config['verify_units']])
    run(['systemctl', 'daemon-reload'])
    for unit in config['start_units']:
        run(['systemctl', 'enable', '--now', unit])
        run(['systemctl', 'is-active', unit])
    persist()
    print(json.dumps({'role': config['role'], 'install_complete': True}), flush=True)


if __name__ == '__main__':
    main(CONFIG)
