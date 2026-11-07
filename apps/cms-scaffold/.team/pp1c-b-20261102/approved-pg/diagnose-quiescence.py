from pathlib import Path
import subprocess,json,time,datetime
p=Path('.team/pp1c-b-20261102');r=json.loads((p/'capture-runtime.json').read_text());rows=json.loads(subprocess.check_output(['docker','inspect',*r['ownedContainers']]));pg=next(c for c in rows if c['Config']['Labels']['com.docker.compose.service']=='postgres');assert pg['Config']['Labels']['com.docker.compose.project']==r['project'];cid=pg['Id'];out={'runId':r['runId'],'postgresId':cid,'scope':'read-only backend metadata observation after failed quiescence; no capture retry','healthcheck':pg['Config']['Healthcheck'],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
sql="""BEGIN READ ONLY;
DO $$ DECLARE rows json; BEGIN FOR i IN 1..2000 LOOP
PERFORM pg_stat_clear_snapshot();
SELECT json_agg(a) INTO rows FROM (SELECT pid,application_name,host(client_addr) AS client_addr,state,backend_type FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()) a;
IF rows IS NOT NULL THEN RAISE NOTICE 'BACKEND_METADATA %',rows; END IF;
PERFORM pg_sleep(0.01);
END LOOP; END $$;
ROLLBACK;
"""
try:
 subprocess.run(['docker','start',cid],check=True,capture_output=True)
 for _ in range(30):
  v=subprocess.run(['docker','exec',cid,'pg_isready','-U','cms_local','-d','cms'],capture_output=True)
  if v.returncode==0:break
  time.sleep(1)
 v=subprocess.run(['docker','exec','-i',cid,'psql','-X','-q','-U','cms_local','-d','cms','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,timeout=45)
 out['exit']=v.returncode;out['metadata']=v.stderr;out['stdout']=v.stdout
finally:
 subprocess.run(['docker','stop','--time','30',cid],check=True,capture_output=True);out['stopped']=True;(p/'approved-pg/quiescence-diagnostic.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out))
