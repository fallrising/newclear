from pathlib import Path
import json,subprocess,hashlib
p=Path.cwd();e=p/'.team/pp1c-b-20261102';encoded=json.loads((e/'artifact-encoding.json').read_text());excluded={x['originalPath'] for x in encoded};files=set()
for base in ['.team/pp1c-b-20261101','.team/pp1c-b-20261102','.team/pp1c-pg-volume-20261102']:
 for f in (p/base).rglob('*'):
  if f.is_file() and f.suffix!='.class' and not f.is_symlink():files.add(str(f.relative_to(p)))
files.update(json.loads((e/'current-source-hashes.json').read_text()))
for n in [119,120,121,123,124,125,126,127,128,129]:
 for kind in ['tasks','reports']:
  f=f'.team/{kind}/T-{n}.md'
  if (p/f).exists():files.add(f)
files.update(['.team/PLAN.md','.team/pp1c-implementation-20261101/EVIDENCE.md','SUCCESS.md','docs/tasks/BOARD.md','docs/v2/README.md','docs/v2/contracts/PP1-recovery.md','docs/v2/contracts/PP1c-local-adapters.md','docs/v2/waves/PP1c.md'])
files-=excluded;files.discard('.team/pp1c-b-20261102/publication-candidates.json')
secrets=[f.read_bytes() for f in (p/'local/pp1').glob('*/secrets/spring.datasource.password') if f.is_file()]
bad=[]
for name in sorted(files):
 f=p/name;assert f.is_file() and not f.is_symlink();data=f.read_bytes()
 if any(len(s)>=16 and s in data for s in secrets):bad.append(name)
 if any(line.rstrip(b' \t')!=line for line in data.splitlines()):bad.append(name+': trailing whitespace')
assert not bad,bad
r={'scope':'explicit B source/docs/evidence publication candidates; excludes private local data and original whitespace-bearing generated artifacts','files':sorted(files),'fileCount':len(files),'checkedRealSecretFiles':len(secrets),'realSecretMatches':0,'excludedEncodedOriginals':sorted(excluded),'totalBytes':sum((p/n).stat().st_size for n in files)};(e/'publication-candidates.json').write_text(json.dumps(r,indent=2)+'\n');print({k:v for k,v in r.items() if k not in ['files','excludedEncodedOriginals']})
