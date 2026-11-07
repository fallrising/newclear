from pathlib import Path
import datetime, hashlib, json, shutil, subprocess, zipfile

root = Path.cwd()
evidence = root / '.team/pp1c-c-20261102/runtime'
evidence.mkdir(exist_ok=True)
gate = json.loads((root / '.team/pp1c-c-20261102/java-final.json').read_text())
assert gate['exit'] == 0 and gate['counts']['integrationTest']['tests'] == 223
jar = root / 'services/cms-api/build/libs/cms-api-0.1.0-SNAPSHOT.jar'
digest = hashlib.sha256(jar.read_bytes()).hexdigest()
assert digest == 'c77db33818be74674006328f990531543584983cb2ffe13351b605eb60ecfc15'
with zipfile.ZipFile(jar) as archive:
    assert archive.read('BOOT-INF/classes/com/fallrising/cms/ops/RestoreSessionRevoker.class')
base = 'sha256:1ad1f859e141f2296a7d49457414f84c2813ad8439e5b836cc0d9963ab491e09'
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
(root / 'local').mkdir(mode=0o700, exist_ok=True)
context = root / 'local/pp1c-c-image-20261102'
context.mkdir(mode=0o700)
destination = context / 'services/cms-api/build/libs'
destination.mkdir(parents=True)
shutil.copyfile(jar, destination / jar.name)
shutil.copyfile(root / 'docker/pp1-api.Dockerfile', context / 'Dockerfile')
command = ['docker', '--host', 'unix:///var/run/docker.sock', 'build', '--network=none', '--pull=false',
           '--build-arg', 'BASE_IMAGE=' + base, '--build-arg', 'PP1_SOURCE_COMMIT=' + head,
           '--build-arg', 'PP1_JAR_SHA256=' + digest, '--iidfile', str(evidence / 'image-id'), str(context)]
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
with (evidence / 'image-build.log').open('wb') as output:
    result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, timeout=180)
assert result.returncode == 0
receipt = {'sourceCommit': head, 'worktreeDirty': True, 'jarSha256': digest, 'baseImage': base,
           'image': (evidence / 'image-id').read_text().strip(), 'startedAt': started,
           'endedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'exitCode': result.returncode,
           'scope': 'approved C isolated integration only; no release/deploy'}
(evidence / 'image.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
