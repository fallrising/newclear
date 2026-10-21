import os,sys,json,subprocess,time,socket,re
from pathlib import Path
from datetime import datetime,timezone
out=Path(__file__).resolve().parent
root=Path(os.environ['QUALIFICATION_WORKTREE']).resolve()/'systems/clarkq'
os.environ['PATH']=str(root.parent/'mkfk/.build/qualification-tools')+os.pathsep+os.environ['PATH']
project='qualification-clarkq-20261021';port=38580
assert not subprocess.check_output(['docker','ps','-aq','--filter','label=com.docker.compose.project='+project],text=True).strip()
with socket.socket() as s:s.bind(('127.0.0.1',port))
env=os.environ.copy();env.update(QUAL_CLARKQ_ROOT=str(root),CLARKQ_DEMO_PORT=str(port),CLARKQ_API_KEY='qualification-synthetic-key',CLARKQ_URL=f'http://127.0.0.1:{port}',CLARKQ_DEMO_PROJECT=project,CLARKQ_DEMO_COMPOSE=str(out/'clarkq-compose.yaml'))
compose=['docker','compose','-f',str(out/'clarkq-compose.yaml'),'-p',project]
results=[]
def run(name,argv,timeout):
 start=datetime.now(timezone.utc).isoformat();beg=time.monotonic()
 p=subprocess.run(argv,cwd=root,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
 text=p.stdout.replace(str(root),'<clarkq-worktree>').replace(str(out),'<qualification-evidence>');text=re.sub(r'/home/[^/\s]+','<operator-home>',text)
 log='clarkq-core-attempt2-'+name+'.log';(out/log).write_text(text)
 results.append({'argv':[a.replace(str(out),'<qualification-evidence>') for a in argv],'cwd':'systems/clarkq','start':start,'duration_seconds':round(time.monotonic()-beg,3),'exit_code':p.returncode,'log':log})
 (out/'clarkq-core-attempt2-commands.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results[-1]),flush=True)
 return p.returncode
try:
 if run('startup',compose+['up','-d','--build','--wait','clarkq'],600)==0:
  run('scenarios',['sh','demo/run-scenarios.sh'],240)
finally:
 run('cleanup',compose+['down','--volumes'],120)
 left=subprocess.check_output(['docker','ps','-aq','--filter','label=com.docker.compose.project='+project],text=True).strip()
 (out/'clarkq-core-attempt2-cleanup.json').write_text(json.dumps({'project':project,'remaining_containers':bool(left)})+'\n')
 assert not left
