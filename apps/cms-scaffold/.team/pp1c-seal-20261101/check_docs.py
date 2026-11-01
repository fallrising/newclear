"""Read-only structural checks for the PP1c proposal; not product validation."""
import collections
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[4]
COMP = ROOT / 'apps/cms-scaffold'
DOCS = [COMP / 'docs/v2/waves/PP1c.md', COMP / 'docs/v2/contracts/PP1-recovery.md', COMP / 'docs/v2/contracts/PP1c-local-adapters.md']
wave = DOCS[0].read_text()
annex = DOCS[2].read_text()
checks = []

def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)

cards = re.findall(r'^### PP1c ([A-Z]\d+[a-z]?) —', wave, re.M)
check('44 unique bounded cards', len(cards) == len(set(cards)) == 44)
check('card families 23C 5L 5H 6T 4R 1E', collections.Counter(c[0] for c in cards) == dict(C=23,L=5,H=5,T=6,R=4,E=1))
for block in re.split(r'^### PP1c ', wave, flags=re.M)[1:]:
    block=block.split('\n### ')[0].split('\n#### 子波')[0]
    for field in ['目標','輸入','精確可寫路徑','步驟','可觀察完成條件','驗證命令','AC/FM','預估']:
        check('card '+block.split(' —')[0]+' '+field, '- '+field+'：' in block)
check('split cards have no duplicate group card', all(x not in cards for x in ['H03','T03','T04','C10','C16']))
check('subwaves <=30', all(x<=30 for x in [9,12,9,14]) and sum([9,12,9,14])==44)

def anchors(text):
    result=set(); counts={}
    for heading in re.findall(r'^#{1,6} (.+)$',text,re.M):
        key=re.sub(r'[^\w\-\s\u4e00-\u9fff]','',heading.lower()).replace(' ','-')
        n=counts.get(key,0);counts[key]=n+1
        result.add(key+('-'+str(n) if n else ''))
    result.update(re.findall(r'<a id="([^"]+)"',text))
    return result
for doc in DOCS:
    for href in re.findall(r'\]\(([^)]+)\)',doc.read_text()):
        if '://' in href or href.startswith('mailto:'): continue
        file, _, anchor=unquote(href).partition('#')
        target=(doc.parent / file).resolve() if file else doc
        check('relative link '+doc.name+' '+href, target.exists())
        if anchor: check('anchor '+href,anchor in anchors(target.read_text()))
prior=subprocess.check_output(['git','show','342107f87c305ca1bca56ecb88685315d678e56c:apps/cms-scaffold/docs/v2/contracts/PP1-recovery.md'],cwd=ROOT,text=True)
check('parent entire existing bytes retained',DOCS[1].read_text().startswith(prior))
base=json.loads((Path(__file__).parent / 'SOURCE-HASHES.json').read_text())['mergedMain']
paths=subprocess.check_output(['git','diff',base,'--name-only','--','apps/cms-scaffold'],cwd=ROOT,text=True).splitlines()
check('no product source change against merged main',all('/docs/' in p or '/.team/' in p for p in paths))
check('no obsolete media path or duplicate socket draft', all(x not in annex for x in ['recovery-media.mjs','覆蓋§4.2','half-close write','H02a']))
check('phase checkpoints aligned',all(p in wave and p in annex for p in ['STARTUP_VERIFIED','RESTART_VERIFIED']))
probes=json.loads((Path(__file__).parent / 'TOOL-PROBES.json').read_text())
check('5 bounded tool probes succeeded',len(probes['cases']+probes['additionalCases'])==5 and all(x['exitCode']==0 for x in probes['cases']+probes['additionalCases']))
check('explicit owner approval; implementation distinct','DOC_READY' in wave and 'APPROVED' in annex and '批准。' in annex)
print(json.dumps({'result':'PASS','checks':len(checks),'cards':len(cards),'families':dict(collections.Counter(c[0] for c in cards)),'scope':'documentation structure only; not implementation or runtime'},ensure_ascii=False))
