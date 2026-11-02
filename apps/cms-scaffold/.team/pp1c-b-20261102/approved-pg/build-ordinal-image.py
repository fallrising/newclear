from pathlib import Path
import json,subprocess,shutil,hashlib,zipfile,datetime
p=Path.cwd();e=p/'.team/pp1c-b-20261102';out=e/'approved-pg';assert 'BUILD SUCCESSFUL' in (p/'.team/pp1c-b-20261102/T128/ordinal-order/green-native.log').read_text()
jar=p/'services/cms-api/build/libs/cms-api-0.1.0-SNAPSHOT.jar';data=jar.read_bytes();sha=hashlib.sha256(data).hexdigest()
with zipfile.ZipFile(jar)as z:cls=z.read('BOOT-INF/classes/com/fallrising/cms/ops/RecoveryInventoryMain.class');assert b'host(client_addr)' in cls and b'client_addr::text' not in cls
with zipfile.ZipFile(jar)as z: inventoryClass=z.read('BOOT-INF/classes/com/fallrising/cms/ops/RecoveryInventory.class');assert b'ORDER BY information_schema.columns.ordinal_position' in inventoryClass
base='sha256:1ad1f859e141f2296a7d49457414f84c2813ad8439e5b836cc0d9963ab491e09';head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip();context=p/'local/pp1c-ordinal-image';context.mkdir(mode=0o700)
dest=context/'services/cms-api/build/libs';dest.mkdir(parents=True);shutil.copy2(jar,dest/jar.name);shutil.copy2(p/'docker/pp1-api.Dockerfile',context/'Dockerfile')
a=['docker','build','--network=none','--pull=false','--build-arg','BASE_IMAGE='+base,'--build-arg','PP1_SOURCE_COMMIT='+head,'--build-arg','PP1_JAR_SHA256='+sha,'--iidfile',str(out/'ordinal-image-id'),str(context)]
with(out/'ordinal-image-build.log').open('w')as f:subprocess.run(a,stdout=f,stderr=f,timeout=120,check=True)
shutil.copy2(e/'runtime-image-id',out/'previous-ordinal-runtime-image-id');shutil.copy2(out/'ordinal-image-id',e/'runtime-image-id')
r={'sourceCommit':head,'worktreeDirty':True,'jarSha256':sha,'scope':'focused53tests passed; complete Java gate pending after capture', 'inventoryClassSha256':hashlib.sha256(inventoryClass).hexdigest(),'inventorySourceSha256':hashlib.sha256((p/'services/cms-api/src/main/java/com/fallrising/cms/ops/RecoveryInventory.java').read_bytes()).hexdigest(),'mainSourceSha256':hashlib.sha256((p/'services/cms-api/src/main/java/com/fallrising/cms/ops/RecoveryInventoryMain.java').read_bytes()).hexdigest(),'mainClassSha256':hashlib.sha256(cls).hexdigest(),'base':base,'image':(out/'ordinal-image-id').read_text().strip(),'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};(out/'ordinal-image.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
