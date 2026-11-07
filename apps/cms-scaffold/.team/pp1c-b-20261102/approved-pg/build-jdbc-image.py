from pathlib import Path
import json,subprocess,shutil,hashlib,zipfile,datetime
p=Path.cwd();e=p/'.team/pp1c-b-20261102';out=e/'approved-pg';gate=json.loads((out/'java-final.json').read_text());assert gate['exit']==0
jar=p/'services/cms-api/build/libs/cms-api-0.1.0-SNAPSHOT.jar';data=jar.read_bytes();sha=hashlib.sha256(data).hexdigest()
with zipfile.ZipFile(jar)as z:cls=z.read('BOOT-INF/classes/com/fallrising/cms/ops/RecoveryInventoryMain.class');assert b'host(client_addr)' in cls and b'client_addr::text' not in cls
base='sha256:1ad1f859e141f2296a7d49457414f84c2813ad8439e5b836cc0d9963ab491e09';head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();context=p/'local/pp1c-jdbc-image';context.mkdir(mode=0o700)
dest=context/'services/cms-api/build/libs';dest.mkdir(parents=True);shutil.copy2(jar,dest/jar.name);shutil.copy2(p/'docker/pp1-api.Dockerfile',context/'Dockerfile')
a=['docker','build','--network=none','--pull=false','--build-arg','BASE_IMAGE='+base,'--build-arg','PP1_SOURCE_COMMIT='+head,'--build-arg','PP1_JAR_SHA256='+sha,'--iidfile',str(out/'jdbc-image-id'),str(context)]
with(out/'jdbc-image-build.log').open('w')as f:subprocess.run(a,stdout=f,stderr=f,timeout=120,check=True)
shutil.copy2(e/'runtime-image-id',out/'previous-runtime-image-id');shutil.copy2(out/'jdbc-image-id',e/'runtime-image-id')
r={'sourceCommit':head,'worktreeDirty':True,'jarSha256':sha,'mainSourceSha256':hashlib.sha256((p/'services/cms-api/src/main/java/com/fallrising/cms/ops/RecoveryInventoryMain.java').read_bytes()).hexdigest(),'mainClassSha256':hashlib.sha256(cls).hexdigest(),'base':base,'image':(out/'jdbc-image-id').read_text().strip(),'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};(out/'jdbc-image.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
