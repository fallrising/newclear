#!/usr/bin/env python3
"""Artifact-only N02 frontend on the real Linux native app, picker and IPC."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import struct
import subprocess
import tempfile
import time
import zlib


def command(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def digest_tree(root):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir() if p.is_file()}


def main():
    source = Path.cwd()
    artifacts = Path(os.environ['AGENT_ARTIFACTS_DIR']) / 'n02-webview'
    evidence = Path(os.environ['AGENT_EVIDENCE_DIR']) / 'n02-webview'
    artifacts.mkdir(exist_ok=True)
    evidence.mkdir(exist_ok=True)
    run = Path(tempfile.mkdtemp(prefix='run-', dir=artifacts))
    logs = evidence / run.name
    logs.mkdir()
    fixture = run / 'synthetic-root'
    fixture.mkdir()
    for index in range(5000):
        content = '\ufeff# Native smoke\r\n\r\n![pixel](pixel.png)\r\n' if index == 0 else f'# Synthetic file {index}\n'
        (fixture / f'f{index:04}.md').write_bytes(content.encode())
    def chunk(kind, payload):
        return struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload))
    png = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0\x22\xaa\x66\xff'))+chunk(b'IEND',b'')
    (fixture / 'pixel.png').write_bytes(png)
    original = digest_tree(fixture)
    frontend = run / 'frontend'
    frontend.mkdir()
    (frontend / 'index.html').write_text('<!doctype html><html><head><meta charset="utf-8"><title>N02 native smoke</title></head><body><div id="root"></div><script type="module" src="./entry.mjs"></script></body></html>')
    (frontend / 'entry.mjs').write_text('import '+json.dumps(str(source/'src/features/workspace/native-smoke.tsx'))+';\n')
    dist = run / 'dist'
    env = dict(os.environ, VITE_N02_SMOKE_ROOT=str(fixture), VITE_N02_SMOKE_RESULT='__N02_RESULT__')
    build_script = 'import {build} from "vite"; await build('+json.dumps({'configFile':str(source/'vite.config.ts'),'root':str(frontend),'build':{'outDir':str(dist),'emptyOutDir':False}})+');'
    with (logs/'build.log').open('w') as output:
        command(['node','--input-type=module','-e',build_script],env=env,stdout=output,stderr=subprocess.STDOUT)
        config=json.dumps({'build':{'beforeBuildCommand':None,'frontendDist':str(dist)}})
        command(['node','node_modules/@tauri-apps/cli/tauri.js','build','--debug','--no-bundle','--ci','--config',config],env=env,stdout=output,stderr=subprocess.STDOUT)
    binary=run/'flowshot-native-smoke'
    shutil.copy2(Path(os.environ['CARGO_TARGET_DIR'])/'debug/flowshot-tauri',binary)
    screenshot_source=run/'screenshot.c'
    screenshot_source.write_text('#include <gdk/gdk.h>\nint main(int argc,char**argv){gdk_init(&argc,&argv);GdkWindow*w=gdk_get_default_root_window();GdkPixbuf*p=gdk_pixbuf_get_from_window(w,0,0,gdk_window_get_width(w),gdk_window_get_height(w));return !gdk_pixbuf_save(p,argv[1],"png",NULL,NULL);}\n')
    flags=subprocess.check_output(['pkg-config','--cflags','--libs','gtk+-3.0'],text=True).split()
    command(['cc',str(screenshot_source),'-o',str(run/'screenshot'),*flags])
    env.update(XDG_DATA_HOME=str(run/'app-data'),XDG_CONFIG_HOME=str(run/'config'))
    database=run/'app-data/com.fallrising.flowshot/flowshot.sqlite3'
    result={'passed':False,'macosAcceptance':False,'fixtureFiles':5001}
    (logs/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    with (logs/'stdout.jsonl').open('w') as stdout,(logs/'stderr.log').open('w') as stderr:
        process=subprocess.Popen([str(binary)],env=env,stdout=stdout,stderr=stderr)
        try:
            deadline=time.monotonic()+50
            dialog_handled=False
            windows=[]
            while time.monotonic()<deadline:
                if process.poll() is not None:
                    raise RuntimeError(f'native process exited {process.returncode}')
                search=subprocess.run(['xdotool','search','--onlyvisible','--pid',str(process.pid)],capture_output=True,text=True,timeout=2,check=False)
                windows=[]
                for window in search.stdout.splitlines():
                    name=subprocess.run(['xdotool','getwindowname',window],capture_output=True,text=True,timeout=2,check=False).stdout.strip()
                    windows.append({'id':window,'name':name})
                    if not dialog_handled and name and name!='Flowshot':
                        command(['xdotool','windowfocus','--sync',window])
                        time.sleep(1)
                        command([str(run/'screenshot'),str(logs/'picker.png')],env=env)
                        command(['xdotool','key','--clearmodifiers','alt+o'])
                        dialog_handled=True
                if database.exists():
                    try:
                        with sqlite3.connect(database.as_uri()+'?mode=ro',uri=True,timeout=.1) as db:
                            row=db.execute("SELECT name FROM workspaces WHERE name LIKE '__N02_RESULT__%' ORDER BY created_at DESC LIMIT 1").fetchone()
                        if row:
                            frontend_result=json.loads(row[0][len('__N02_RESULT__'):])
                            result.update(frontend_result,pid=process.pid,windows=windows,dialogHandled=dialog_handled,sourceUnchanged=digest_tree(fixture)==original)
                            command([str(run/'screenshot'),str(logs/'window.png')],env=env)
                            result['passed']=bool(result.get('passed') and dialog_handled and result['sourceUnchanged'] and any(w['name']=='Flowshot' for w in windows))
                            (logs/'result.json').write_text(json.dumps(result,indent=2)+'\n')
                            print(json.dumps(result))
                            if not result['passed']:raise RuntimeError('N02 real WebView oracle failed')
                            return
                    except sqlite3.OperationalError:
                        pass
                time.sleep(.1)
            command([str(run/'screenshot'),str(logs/'timeout.png')],env=env)
            result.update(pid=process.pid,windows=windows,dialogHandled=dialog_handled,error='Timed out waiting for frontend evidence')
            (logs/'result.json').write_text(json.dumps(result,indent=2)+'\n')
            raise RuntimeError(result['error'])
        finally:
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)


if __name__=='__main__':
    main()
