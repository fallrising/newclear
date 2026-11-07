from pathlib import Path
import subprocess,json,time,os,datetime,xml.etree.ElementTree as ET
p=Path.cwd();e=p/'.team/pp1c-c-20261102';args=['./gradlew','test','integrationTest',':services:cms-api:bootJar','--no-daemon','--no-parallel'];start=time.monotonic();r={'command':args,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
try:
 with (e/'java-final.log').open('w')as f:result=subprocess.run(args,env={**os.environ,'JAVA_HOME':'/home/ckc/.cache/devbox/toolchains/jdk-25.0.5+8'},stdout=f,stderr=f,timeout=900)
 r['exit']=result.returncode
finally:
 r['elapsedSeconds']=time.monotonic()-start;r['endedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();r['counts']={}
 for kind in ['test','integrationTest']:
  totals={key:0 for key in ['tests','failures','errors','skipped']}
  for file in (p/'services/cms-api/build/test-results'/kind).glob('TEST-*.xml'):
   root=ET.parse(file).getroot()
   for key in totals:totals[key]+=int(root.attrib.get(key,0))
  r['counts'][kind]=totals
 (e/'java-final.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps(r));raise SystemExit(r.get('exit',1))
