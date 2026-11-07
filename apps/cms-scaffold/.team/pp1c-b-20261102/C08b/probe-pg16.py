from pathlib import Path
import subprocess,json,uuid,time,os,hashlib,re
root=Path('local/pp1c-format-probe');root.mkdir(mode=0o700,parents=True,exist_ok=True)
image='sha256:6a2e324ebe59af6031c4c1cd96c1d5072c2ebc36563d2196365e43b8297c062d'
name='cms-pp1c-format-'+uuid.uuid4().hex
prefix=['docker','--host=unix:///var/run/docker.sock']
def cmd(args,**kw):return subprocess.run(prefix+args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60,**kw).stdout
cid=cmd(['create','--pull=never','--name',name,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=999:999','--restart=no','--log-driver=none','--tmpfs=/var/lib/postgresql/data:rw,uid=999,gid=999,mode=0700','--tmpfs=/var/run/postgresql:rw,uid=999,gid=999,mode=0775','--tmpfs=/tmp:rw,nosuid,nodev','--env=POSTGRES_DB=cms','--env=POSTGRES_USER=cms_local','--env=POSTGRES_HOST_AUTH_METHOD=trust',image]).decode().strip()
assert re.fullmatch('[a-f0-9]{64}',cid)
receipt={'container_id':cid,'image_id':image,'purpose':'network-none synthetic PG16 custom archive compatibility only','source_fixture':'20 public tables, synthetic text columns; no credentials or application records'}
try:
    obj=json.loads(cmd(['inspect',cid]))[0];assert obj['Id']==cid and obj['Image']==image
    cmd(['start',cid])
    deadline=time.monotonic()+60
    while subprocess.run(prefix+['exec',cid,'pg_isready','-U','cms_local','-d','cms'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10).returncode:
        assert time.monotonic()<deadline;time.sleep(.5)
    java=Path('services/cms-api/src/main/java/com/fallrising/cms/ops/RecoveryInventory.java').read_text()
    columns={name:re.findall(r'"([^"]+)"',values)for name,values in re.findall(r'Map.entry\("([^"]+)", List.of\((.*?)\)\)',java)}
    assert len(columns)==20
    sql=''.join('CREATE TABLE public."'+table+'" ('+','.join('"'+col+'" text'for col in cols)+');'for table,cols in columns.items())
    cmd(['exec','-i',cid,'psql','-X','-v','ON_ERROR_STOP=1','-U','cms_local','-d','cms'],input=sql.encode())
    data=cmd(['exec',cid,'pg_dump','-U','cms_local','-d','cms','--format=custom','--no-owner','--no-privileges','--no-password'])
    path=root/'actual-pg16.dump';fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
    receipt.update({'dump_sha256':hashlib.sha256(data).hexdigest(),'byte_size':len(data),'postgresServerVersion':cmd(['exec',cid,'psql','-X','-q','-t','-A','-U','cms_local','-d','cms','-c','SHOW server_version;']).decode().strip(),'pgDumpOutput':cmd(['exec',cid,'pg_dump','--version']).decode().strip()})
finally:
    obj=json.loads(cmd(['inspect',cid]))[0];assert obj['Id']==cid and obj['Image']==image
    if obj['State']['Running']:cmd(['stop','--time','30',cid])
    receipt['stopped']=not json.loads(cmd(['inspect',cid]))[0]['State']['Running']
    Path('.team/pp1c-b-20261102/C08b/real-pg16-summary.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
