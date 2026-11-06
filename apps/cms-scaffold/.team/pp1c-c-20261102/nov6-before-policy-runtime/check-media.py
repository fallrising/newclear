import hashlib, io, json, subprocess, sys, tarfile
request = json.loads(sys.stdin.buffer.read(1048577))
assert set(request) == {'containerId', 'files'}
container = request['containerId']
assert len(container) == 64 and all(c in '0123456789abcdef' for c in container)
result = subprocess.run(['docker', '--host', 'unix:///var/run/docker.sock', 'cp', container + ':/data/media', '-'],
                        capture_output=True, timeout=60)
assert result.returncode == 0 and not result.stderr and len(result.stdout) <= 16777216
expected = {file['objectKey']: file for file in request['files']}
seen = set()
with tarfile.open(fileobj=io.BytesIO(result.stdout)) as archive:
    for member in archive.getmembers():
        assert member.isdir() or member.isfile()
        if member.isdir():
            continue
        assert member.name.startswith('media/')
        name = member.name[len('media/'):]
        assert name in expected and name not in seen
        file = expected[name]
        data = archive.extractfile(member).read()
        assert str(len(data)) == file['byteSize'] and hashlib.sha256(data).hexdigest() == file['sha256']
        seen.add(name)
assert seen == set(expected)
header = {'version': 1, 'files': request['files']}
canonical = (json.dumps(header, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode()
print(json.dumps({'equal': True, 'fileCount': str(len(seen)),
                  'fileBytes': str(sum(int(file['byteSize']) for file in expected.values())),
                  'mediaHeaderSha256': hashlib.sha256(canonical).hexdigest()}))
