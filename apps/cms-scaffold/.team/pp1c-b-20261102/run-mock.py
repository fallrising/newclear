from pathlib import Path
import subprocess,json,uuid,time
p=Path.cwd();e=p/'.team/pp1c-b-20261102';w=p/'local/pp1c-mock-20261102';name='cms-pp1c-mock-'+uuid.uuid4().hex
image='sha256:6a8ca4b22705adf7134d2220ab8aadff634a6b76c816dba55e0409f8e5c180dc'
a=['docker','run','--name',name,'--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--read-only','--tmpfs','/tmp:rw,mode=1777','--shm-size','256m','--mount',f'type=bind,src={w},dst=/work','--mount',f'type=bind,src={p/"node_modules"},dst=/work/node_modules,readonly','--tmpfs','/work/node_modules/.vite-temp:uid=1000,gid=1000','--tmpfs','/work/node_modules/.vite:uid=1000,gid=1000','--mount','type=bind,src=/home/ckc/.local/node-v24.18.0,dst=/opt/node,readonly','--mount','type=bind,src=/home/ckc/.cache/ms-playwright/chromium-1243/chrome-linux64,dst=/browser,readonly','-e','CI=1','-e','HOME=/tmp','-e','PLAYWRIGHT_CHROMIUM_EXECUTABLE=/browser/chrome','-w','/work','--entrypoint','/opt/node/bin/npm',image,'run','e2e:mock']
t=time.monotonic();result={'command':a,'image':image}
try:
 with (e/'mock-e2e-container.log').open('w') as f:r=subprocess.run(a,stdout=f,stderr=f,timeout=900)
 result['exit']=r.returncode
finally:
 info=subprocess.run(['docker','inspect','--format','{{.Id}} {{.State.Status}}',name],capture_output=True,text=True);result['container']=info.stdout.strip()
 if info.returncode==0 and info.stdout.split()[-1]=='running':subprocess.run(['docker','stop','--time','5',info.stdout.split()[0]],capture_output=True,timeout=15)
 result['elapsedSeconds']=time.monotonic()-t;(e/'mock-e2e-container.json').write_text(json.dumps(result,indent=2)+'\n')
raise SystemExit(result.get('exit',1))
