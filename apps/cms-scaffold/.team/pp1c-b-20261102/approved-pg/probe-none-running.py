from pathlib import Path
import subprocess,json,uuid,time
p=Path('.team/pp1c-b-20261102/approved-pg');image='sha256:6a8ca4b22705adf7134d2220ab8aadff634a6b76c816dba55e0409f8e5c180dc';name='pp1c-none-probe-'+uuid.uuid4().hex;node='/home/ckc/.local/node-v24.18.0/bin/node';record={'scope':'synthetic network-none Docker metadata probe only','image':image,'name':name}
a=['docker','create','--name',name,'--pull=never','--network=none','--read-only','--user=1000:1000','--cap-drop=ALL','--security-opt=no-new-privileges','--log-driver=none','--restart=no','--mount','type=bind,src='+node+',dst=/opt/pp1-node,readonly','--entrypoint=/opt/pp1-node',image,'-e','setTimeout(()=>{},3000)']
cid=subprocess.check_output(a,text=True).strip();record['id']=cid
try:
 subprocess.run(['docker','start',cid],check=True,capture_output=True);c=json.loads(subprocess.check_output(['docker','inspect',cid]))[0];assert c['Id']==cid and c['Name']=='/'+name and c['Image']==image and c['State']['Running'];record.update({'hostNetworkMode':c['HostConfig']['NetworkMode'],'networks':c['NetworkSettings']['Networks']});subprocess.run(['docker','wait',cid],check=True,capture_output=True,timeout=10);record['exited']=True
finally:
 (p/'none-running-probe.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record))
