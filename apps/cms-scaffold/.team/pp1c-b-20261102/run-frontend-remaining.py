from pathlib import Path
import subprocess,json,time
root=Path('.team/pp1c-b-20261102');results=[]
commands=[('front-serial',['npm','run','test','-w','@cms/web-front','--','--maxWorkers=1']),('lint',['npm','run','lint']),('typecheck',['npm','run','typecheck']),('build',['npm','run','build']),('bundle',['npm','run','test:bundle']),('measure-bundle',['npm','run','measure:bundle'])]
for name,cmd in commands:
    start=time.monotonic()
    with (root/(name+'.log')).open('w') as log:
        try: code=subprocess.run(cmd,stdout=log,stderr=subprocess.STDOUT,timeout=900).returncode
        except subprocess.TimeoutExpired: code=124
    results.append({'name':name,'command':cmd,'exit':code,'elapsed_seconds':time.monotonic()-start})
    (root/'frontend-remaining-results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(name,code,flush=True)
    if code: raise SystemExit(code)
