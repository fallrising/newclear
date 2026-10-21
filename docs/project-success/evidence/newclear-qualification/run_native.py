import json,os,re,signal,subprocess,sys,time
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(os.environ['QUALIFICATION_WORKTREE']).resolve()
OUT=Path(__file__).resolve().parent
BASE='b97319d74f8442b5173ef42be72a0aa757d87df0'
GROUPS={
'clarkq':('systems/clarkq',[( ['make','vet','test','build'],600)]),
'mkfk':('systems/mkfk',[( ['make','fmt-check','vet'],300),(['make','test'],900),(['make','test-race'],900),(['make','test-model','test-integration'],900),(['make','test-chaos','CHAOS_PROFILE=short'],600)]),
'dim-gate':('platform/dim-gate',[( ['pnpm','install','--frozen-lockfile'],600),(['pnpm','lint'],180),(['pnpm','typecheck'],180),(['pnpm','test'],300),(['pnpm','check:docs'],120),(['pnpm','check:contracts'],120),(['pnpm','check:ci'],120),(['pnpm','check:architecture'],120),(['pnpm','build','--mode','demo'],300)]),
'pg-jev-router':('labs/pg-jev-router',[( ['make','check','demo'],180),(['make','integration'],900)]),
'wotar':('systems/wotar/secure-mqtt-e2ee',[( ['make','install'],600),(['make','doctor'],120),(['make','lint','typecheck','test'],600)])}
def scrub(text):
 text=text.replace(str(ROOT),'<worker-worktree>').replace(str(OUT),'<qualification-evidence>')
 text=re.sub(r'/home/[^/\s]+','<operator-home>',text)
 return text
GROUPS.update({
'mkfk-full-chaos':('systems/mkfk',[(['make','test-chaos','CHAOS_PROFILE=full','CHAOS_SEED=1792597790'],600)]),
'dim-browser-install':('platform/dim-gate',[(['pnpm','exec','playwright','install','chromium'],600)]),
'dim-browser':('platform/dim-gate',[(['pnpm','exec','playwright','test','e2e/foundation.spec.ts','e2e/m4-observability.spec.ts','--grep','production demo shell guards|Guide story preserves'],600)]),
'wotar-unit':('systems/wotar/secure-mqtt-e2ee',[(['make','test'],600)]),
'wotar-types':('systems/wotar/secure-mqtt-e2ee',[(['make','typecheck'],300)])
})
name=sys.argv[1]
cwd,commands=GROUPS[name]
env=os.environ.copy();env['GOMAXPROCS']='2';env['GOFLAGS']='-p=2';env['UV_NO_PROGRESS']='1';env['DIM_GATE_TEST_PORT']='45173'
results=[]
for i,(argv,timeout) in enumerate(commands,1):
 start=datetime.now(timezone.utc).isoformat();begin=time.monotonic()
 proc=subprocess.Popen(argv,cwd=ROOT/cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
 expired=False
 try:output,_=proc.communicate(timeout=timeout)
 except subprocess.TimeoutExpired:
  expired=True;os.killpg(proc.pid,signal.SIGTERM)
  try:output,_=proc.communicate(timeout=15)
  except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);output,_=proc.communicate()
 log=f'{name}-{i:02d}.log';(OUT/log).write_text(scrub(output))
 entry={'argv':argv,'cwd':cwd,'source_commit':BASE,'start':start,'end':datetime.now(timezone.utc).isoformat(),'duration_seconds':round(time.monotonic()-begin,3),'exit_code':proc.returncode,'timed_out':expired,'log':log,'env_overrides':{'GOMAXPROCS':'2','GOFLAGS':'-p=2'}}
 results.append(entry);(OUT/f'{name}-commands.json').write_text(json.dumps(results,indent=2)+'\n')
 print(json.dumps(entry),flush=True)
 if proc.returncode:break
