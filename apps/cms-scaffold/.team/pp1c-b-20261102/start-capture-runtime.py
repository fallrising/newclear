from pathlib import Path
import subprocess,json,uuid,time,os
p=Path.cwd();e=p/'.team/pp1c-b-20261102';runid=uuid.uuid4().hex;root=p/'local/pp1'/runid;project='cms-pp1-local-'+runid
image=(e/'runtime-image-id').read_text().strip();node='/home/ckc/.local/node-v24.18.0/bin/node';compose='/home/ckc/.cache/devbox/toolchains/docker-compose-v5.6.1/docker-compose';env={**os.environ,'CMS_DOCKER_COMPOSE':compose}
def cmd(a,limit=120):
 r=subprocess.run(a,env=env,capture_output=True,text=True,timeout=limit)
 if r.returncode:raise RuntimeError('COMMAND_FAILED:'+a[0]+':'+str(r.returncode)+':'+r.stderr[-1000:])
 return r.stdout
record={'runId':runid,'root':str(root),'project':project,'apiImage':image,'scope':'B source capture fresh isolated runtime only'};(e/'capture-runtime.json').write_text(json.dumps(record,indent=2)+'\n')
try:
 receipt=json.loads(cmd([node,'scripts/local/prepare.mjs','--run-id',runid,'--api-image',image,'--node-image','sha256:6a8ca4b22705adf7134d2220ab8aadff634a6b76c816dba55e0409f8e5c180dc','--postgres-image','sha256:6a2e324ebe59af6031c4c1cd96c1d5072c2ebc36563d2196365e43b8297c062d']))
 record['prepared']=True;cmd([compose,'--env-file',str(root/'compose.env'),'-f','compose.pp1-local.yaml','-p',project,'up','-d','--wait','--wait-timeout','120'],180)
 record['healthy']=True
except Exception as x:record['failure']=str(x);raise
finally:(e/'capture-runtime.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record))
