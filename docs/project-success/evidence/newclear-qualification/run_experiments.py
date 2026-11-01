import os,sys,json,subprocess,time,socket,re,signal
from pathlib import Path
from datetime import datetime,timezone
out=Path(__file__).resolve().parent
root=Path(os.environ['QUALIFICATION_WORKTREE']).resolve()
kind=sys.argv[1];results=[]
env=os.environ.copy();env.update(GOMAXPROCS='2',GOFLAGS='-p=2')
def run(name,args,cwd,timeout):
 start=datetime.now(timezone.utc).isoformat();beg=time.monotonic();timed_out=False
 p=subprocess.Popen(args,cwd=cwd,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
 try:output=p.communicate(timeout=timeout)[0]
 except subprocess.TimeoutExpired:
  timed_out=True;os.killpg(p.pid,signal.SIGTERM)
  try:output=p.communicate(timeout=15)[0]
  except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL);output=p.communicate()[0]
 def clean(s):return re.sub(r'/home/[^/\s]+','<operator-home>',str(s).replace(str(root),'<worker-worktree>').replace(str(out),'<qualification-evidence>'))
 log=kind+'-'+name+'.log';(out/log).write_text(clean(output))
 results.append({'argv':[clean(a) for a in args],'cwd':clean(cwd),'start':start,'duration_seconds':round(time.monotonic()-beg,3),'exit_code':p.returncode,'timed_out':timed_out,'log':log})
 (out/(kind+'-commands.json')).write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results[-1]),flush=True)
 return p.returncode
if kind=='mkfk-core':
 project='qualification-mkfk-20261021';cwd=root/'systems/mkfk'
 for port in [19091,19092,19093,19291,19292,19293]:
  with socket.socket() as s:s.bind(('127.0.0.1',port))
 for resource in ['ps','volume','network']:
  args=['docker','ps','-aq'] if resource=='ps' else ['docker',resource,'ls','-q']
  assert not subprocess.check_output(args+['--filter','label=com.docker.compose.project='+project],text=True).strip()
 ids=subprocess.check_output(['docker','network','ls','-q'],text=True).split()
 for n in json.loads(subprocess.check_output(['docker','network','inspect']+ids,text=True)):
  assert all(c.get('Subnet')!='172.29.71.0/24' for c in (n.get('IPAM',{}).get('Config') or []))
 env.update(QUAL_MKFK_COMPOSE=str(out/'mkfk-compose.yaml'),QUAL_COMPOSE_TOOL=str(cwd/'.build/qualification-tools/docker-compose-linux-x86_64'))
 common=['COMPOSE_PROJECT='+project,'DOCKER='+str(out/'mkfk-docker')]
 try:run('demo',['make','demo']+common,cwd,600)
 finally:
  run('cleanup',['make','demo-down','DELETE_DATA=1']+common,cwd,120)
  left={r:subprocess.check_output((['docker','ps','-aq'] if r=='containers' else ['docker',r,'ls','-q'])+['--filter','label=com.docker.compose.project='+project],text=True).strip() for r in ['containers','volume','network']}
  (out/'mkfk-core-cleanup.json').write_text(json.dumps({'project':project,'remaining_resources':left},indent=2)+'\n')
  assert not any(left.values())
if kind in ['dim-browser-attempt2','dim-browser-attempt3']:
 image='mcr.microsoft.com/playwright:v1.49.1-jammy@sha256:019b822658965bf5f6d509472802797554360f2940e677b2afb0f17748d0d0e3'
 args=['docker','run','--rm','--name','qualification-dimgate-20261021','--network','none','--cpus','2','--memory','3g','--pids-limit','512','--shm-size','512m','--tmpfs','/app/node_modules/.vite-temp:rw,mode=1777,size=64m','--user',str(os.getuid())+':'+str(os.getgid()),'-v',str(root/'platform/dim-gate')+':/app:ro','-v',str(Path(os.environ['QUALIFICATION_NODE']))+':/usr/local/bin/node:ro','-v',str(Path.home()/'.cache/ms-playwright')+':/ms-playwright:ro','-v',str(out/'browser-bin')+':/qualification-bin:ro','-w','/app','-e','PATH=/qualification-bin:/usr/local/bin:/usr/bin:/bin','-e','PLAYWRIGHT_BROWSERS_PATH=/ms-playwright','-e','PLAYWRIGHT_HTML_OUTPUT_DIR=/tmp/playwright-report','-e','DIM_GATE_TEST_PORT=45173',image,'node','node_modules/@playwright/test/cli.js','test','e2e/foundation.spec.ts','e2e/m4-observability.spec.ts','--grep','production demo shell guards|Guide story preserves','--reporter=list','--output=/tmp/test-results']
 assert not subprocess.check_output(['docker','ps','-aq','--filter','name=^qualification-dimgate-20261021$'],text=True).strip()
 run('test',args,root/'platform/dim-gate',600)
