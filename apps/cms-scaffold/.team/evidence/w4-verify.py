"""Check W4 protected baseline, historical snapshots and native gate evidence.
Run at the component root; local snapshot arguments are not public configuration.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
import xml.etree.ElementTree as ET

p=argparse.ArgumentParser()
p.add_argument('--baseline',required=True)
p.add_argument('--prior-snapshots',required=True)
p.add_argument('--snapshots-root',required=True)
p.add_argument('--original-root',required=True)
a=p.parse_args()
r=Path.cwd(); evidence=r/'.team/evidence'
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def save(name,value): (evidence/name).write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
baseline=json.loads(Path(a.baseline).read_text())
allowed={'.team/PLAN.md','README.md','docs/v2/README.md','docs/v2/waves/W4.md','docs/v2/03-personal-use-readiness.md','apps/web-admin/vite.config.ts','e2e-mock/shell.spec.ts','packages/ui/src/index.ts','packages/mocks/scripts/gen-fixtures.mjs','packages/mocks/src/db.ts','packages/mocks/src/guards.ts','packages/mocks/src/fixtures.gen.ts','packages/mocks/src/handlers.test.ts','packages/mocks/src/handlers/admin.ts',*('packages/api/src/'+s+'.ts' for s in ['admin','keys','schema','index','client.test'])}
allowed.update({'packages/mocks/fixtures/admin-content-types.json','packages/mocks/fixtures/work-content-types.json'})
protected={name:d for name,d in baseline.items() if name not in allowed and not name.startswith('apps/web-admin/src/')}
for name,d in protected.items(): assert sha(r/name)==d, 'Protected change: '+name
prior=json.loads(Path(a.prior_snapshots).read_text())
for tree,files in prior.items():
 for name,d in files.items(): assert sha(Path(a.snapshots_root)/tree/name)==d, 'Snapshot changed: '+tree+'/'+name
original=json.loads((Path(a.snapshots_root)/'cms-w1-baseline/manifest.json').read_text())
for name,d in original.items(): assert sha(Path(a.original_root)/name)==d, 'Original work changed: '+name
for name in ['roles.json','role-permissions.json','audit-events.json','audit-settings.json','member-entries.json','admin-content-types.json','work-content-types.json']:
 f=r/'packages/mocks/fixtures'/name
 assert f.read_bytes()==(r/'docs/v2/contracts/fixtures'/name).read_bytes(), 'Fixture diverged: '+name
assert (r/'services/cms-api/src/main/resources/openapi/openapi.yaml').read_bytes()==(r/'docs/v2/contracts/BW5.openapi.yaml').read_bytes()
files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],text=True).splitlines()
source={name:sha(r/name) for name in sorted(set(files)) if (r/name).is_file() and name.startswith(('apps/','packages/','services/','e2e-mock/','scripts/'))}
counts=dict(tests=0,failures=0,errors=0,skipped=0)
for f in (r/'services/cms-api/build/test-results/test').glob('TEST-*.xml'):
 suite=ET.parse(f).getroot()
 for k in counts: counts[k]+=int(suite.get(k,0))
assert counts==dict(tests=339,failures=0,errors=0,skipped=0),counts
log=(evidence/'w4-tests.log').read_text()
workspace=[int(n) for n in re.findall(r'Tests\s+(\d+) passed',log)]
assert len(workspace)==8 and not re.search(r'Tests[^\n]*\d+ failed',log),workspace
assert re.search(r'68 passed',(evidence/'w4-e2e.log').read_text())
gates=json.loads((evidence/'w4-final-gates.json').read_text())
assert [g['name'] for g in gates]==['codegen','fixture-gen','lint','typecheck','tests','build','bundle'],gates
assert all(g['exitCode']==0 for g in gates),gates
browser=json.loads((evidence/'w4-browser/summary.json').read_text())
assert browser['captures']==14 and browser['blocking']==0,browser
visual=json.loads((evidence/'w4-visual-review.json').read_text())
assert visual['status']=='passed' and len(visual['inspected'])>=4,visual
save('w4-protected-manifest.json',protected)
save('w4-source-manifest.json',source)
save('w4-verification-summary.json',{'status':'LOCAL_VERIFIED','java':counts,'javaExecution':'Gradle FROM-CACHE; backend unchanged','frontendWorkspaceCounts':workspace,'frontendTests':sum(workspace),'mockE2E':68,'visualSmokeCaptures':browser['captures'],'rootInspectedCaptures':len(visual['inspected']),'w4AppendixAE2E':'Deferred to W5 per specification; not executed or claimed','protectedBaselineFiles':len(protected),'sourceFiles':len(source),'originalFilesPreserved':len(original),'priorSnapshots':{name:len(files) for name,files in prior.items()},'runtimeOpenApiEqualsBw5':True,'fixtureByteEquality':'Four new governance fixtures, member fixture and two corrected type fixtures; other historical fixture projections preserved','dependencyLockUnchanged':True,'publication':'Pending required remote CI, review and merge. No deployment.'})
print(json.dumps({'java':counts,'frontend':workspace,'frontendTotal':sum(workspace),'mockE2E':68,'visualSmokeCaptures':browser['captures'],'rootInspectedCaptures':len(visual['inspected']),'protected':len(protected),'snapshots':len(prior)}))
