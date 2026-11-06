from pathlib import Path
import hashlib
import json
import re

root = Path.cwd()
evidence = root / '.team/pp1c-c-20261102'
index = []
publish = []
for path in sorted(evidence.rglob('*')):
    if not path.is_file() or path.name.endswith('.encoded.json'):
        continue
    if path.name in ['publication-encoding.json', 'publish-files.json']:
        continue
    if path.suffix in ['.class', '.pyc']:
        continue
    data = path.read_bytes()
    try:
        text = data.decode('utf-8')
    except UnicodeError:
        raise SystemExit('UNEXPECTED_BINARY_EVIDENCE')
    assert ('-----BEGIN ' + 'PRIVATE KEY-----') not in text
    assert not re.search(r'Using generated security password: (?!\[REDACTED GENERATED TEST PASSWORD\])[\w-]{20,}', text)
    whitespace = any(line.rstrip(b' \t\r') != line for line in data.split(b'\n'))
    if path.suffix in ['.log', '.diff'] or whitespace:
        encoded = path.with_name(path.name + '.encoded.json')
        record = {'version': 1, 'original': str(path.relative_to(evidence)), 'sha256': hashlib.sha256(data).hexdigest(),
                  'byteSize': str(len(data)), 'encoding': 'utf-8', 'text': text}
        encoded.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
        assert encoded.read_text().endswith('\n')
        index.append({k: v for k, v in record.items() if k != 'text'} | {'published': str(encoded.relative_to(evidence))})
        publish.append(str(encoded.relative_to(root)))
    else:
        publish.append(str(path.relative_to(root)))
for path in evidence.rglob('*.encoded.json'):
    if str(path.relative_to(root)) not in publish:
        publish.append(str(path.relative_to(root)))
(evidence / 'publication-encoding.json').write_text(json.dumps({'scope': 'Exact original bytes retained locally; generated logs/diffs encoded losslessly for whitespace and gitignore.', 'files': index}, indent=2) + '\n')
publish.append(str((evidence / 'publication-encoding.json').relative_to(root)))
publish.append(str((evidence / 'publish-files.json').relative_to(root)))
(evidence / 'publish-files.json').write_text(json.dumps(sorted(set(publish)), indent=2) + '\n')
print(json.dumps({'encodedOriginals': len(index), 'publishFiles': len(set(publish)), 'rawFilesDeleted': 0}))
