from pathlib import Path
import subprocess,json,uuid
image='sha256:6a2e324ebe59af6031c4c1cd96c1d5072c2ebc36563d2196365e43b8297c062d';d=['docker','--host','unix:///var/run/docker.sock'];results=[]
def call(a):return subprocess.run(d+a,check=True,capture_output=True,text=True,timeout=30).stdout
for tool in ['pg_dump','pg_restore']:
 cid=call(['create','--pull=never','--name','cms-pp1c-pgdata-proposal-'+uuid.uuid4().hex,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=1000:1000','--log-driver=none','--restart=no','--tmpfs=/tmp:rw,nosuid,nodev,size=67108864','--tmpfs=/var/lib/postgresql/data:ro,nosuid,nodev,noexec,size=1048576','--entrypoint=/usr/local/bin/'+tool,image,'--version']).strip()
 before=json.loads(call(['inspect',cid]))[0];out=call(['start','--attach',cid]);after=json.loads(call(['inspect',cid]))[0]
 results.append({'tool':tool,'id':cid,'image':image,'mounts':before['Mounts'],'tmpfs':before['HostConfig']['Tmpfs'],'network':before['HostConfig']['NetworkMode'],'output':out.strip(),'exit':after['State']['ExitCode'],'status':after['State']['Status'],'proposalOnly':True})
 assert before['Mounts']==[] and after['State']['ExitCode']==0 and after['State']['Status']=='exited'
Path('.team/pp1c-b-20261102/pg-volume-proposal-probe.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results))
