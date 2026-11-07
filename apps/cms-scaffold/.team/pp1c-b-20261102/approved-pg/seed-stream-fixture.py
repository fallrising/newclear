from pathlib import Path
import json,subprocess,hashlib,time,datetime
p=Path('.team/pp1c-b-20261102');r=json.loads((p/'capture-runtime.json').read_text());assert r['healthy'];ids=subprocess.check_output(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project='+r['project']],text=True).split();assert len(ids)==3
rows=json.loads(subprocess.check_output(['docker','inspect',*ids]));assert all(c['Id'] in ids and c['Config']['Labels']['com.docker.compose.project']==r['project'] for c in rows)
pg=next(c for c in rows if c['Config']['Labels']['com.docker.compose.service']=='postgres')['Id'];r['ownedContainers']=ids;(p/'capture-runtime.json').write_text(json.dumps(r,indent=2)+'\n')
sql="""BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM cms_audit_event) THEN RAISE EXCEPTION 'FIXTURE_NOT_EMPTY'; END IF; END $$;
INSERT INTO cms_audit_event(id,category,action,outcome,detail_json)
SELECT md5('pp1c-b-stream-'||i)::uuid,'PP1C_FIXTURE','STREAM_BACKPRESSURE','success',
 jsonb_build_object('synthetic',(SELECT string_agg(md5(i::text||':'||j::text),'') FROM generate_series(1,1024) j))
FROM generate_series(1,4096) i;
COMMIT;
SELECT json_build_object('rows',count(*),'syntheticPayloadBytes',sum(octet_length(detail_json->>'synthetic')),'totalDetailBytes',sum(octet_length(detail_json::text))) FROM cms_audit_event;
"""
start=time.monotonic();v=subprocess.run(['docker','exec','-i',pg,'psql','-X','-q','-t','-A','-U','cms_local','-d','cms','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,timeout=180)
record={'runId':r['runId'],'postgresId':pg,'scope':'fresh synthetic fixture created before workflow; existing schema only','sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'exit':v.returncode,'elapsedSeconds':time.monotonic()-start,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
if v.returncode==0:record['counts']=json.loads(v.stdout.strip());assert record['counts']['rows']==4096 and record['counts']['syntheticPayloadBytes']==134217728
else:record['fixedFailure']='FIXTURE_INSERT_FAILED'
(p/'approved-pg/stream-fixture.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record));raise SystemExit(v.returncode)
