#!/usr/bin/env python3
"""Bounded startup probe; keeps existing Strata configuration and logs untouched."""
import datetime
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.request

LAB = Path(__file__).resolve().parents[1]
STRATA = Path(os.environ.get('STRATA_HOME', str(LAB.parent / 'strata-mac'))).expanduser().resolve()

def main():
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    out = LAB / 'runs' / ('strata-probe-' + stamp)
    out.mkdir(parents=True)
    report = {'started_at': stamp, 'status': 'starting', 'inference_tested': False}
    config = json.loads((STRATA / 'source/strata-q2_0.json').read_text())
    config['log'] = str(out / 'engine.log')
    (out / 'config.json').write_text(json.dumps(config, indent=2) + '\n')
    with socket.socket() as sock:
        if sock.connect_ex(('127.0.0.1', 8080)) == 0:
            report.update(status='blocked', error='Port 8080 occupied; existing service untouched')
            (out / 'result.json').write_text(json.dumps(report, indent=2))
            return 2
    env = dict(os.environ, PYTHONUNBUFFERED='1')
    for key, path in {'XDG_CACHE_HOME': '.cache', 'XDG_CONFIG_HOME': '.config',
                      'XDG_DATA_HOME': '.local/share', 'HF_HOME': '.cache/huggingface',
                      'TMPDIR': '.cache/tmp'}.items():
        env[key] = str(STRATA / path)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    process = None
    started = time.monotonic()
    try:
        with (out / 'server.log').open('w') as log:
            process = subprocess.Popen([sys.executable, str(STRATA / 'source/serve/server.py'),
                '--engine', 'strata', '--config', str(out / 'config.json'),
                '--host', '127.0.0.1', '--port', '8080'], cwd=STRATA / 'source', env=env,
                stdout=log, stderr=subprocess.STDOUT)
            while time.monotonic() - started < 60:
                if process.poll() is not None:
                    raise RuntimeError(f'Strata startup exited with code {process.returncode}')
                try:
                    with opener.open('http://127.0.0.1:8080/health', timeout=2) as response:
                        health = json.load(response)
                    if health.get('loaded'):
                        report.update(status='ready', health=health)
                        break
                except (OSError, ValueError):
                    pass
                time.sleep(1)
            else:
                raise TimeoutError('Startup exceeded 60 seconds')
    except Exception as exc:
        report.update(status='failed', error=str(exc))
    finally:
        if process is not None:
            import psutil
            try:
                children = psutil.Process(process.pid).children(recursive=True)
            except psutil.NoSuchProcess:
                children = []
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            for child in children:
                try:
                    child.terminate()
                except psutil.NoSuchProcess:
                    pass
            _, alive = psutil.wait_procs(children, timeout=5)
            for child in alive:
                try:
                    child.kill()
                except psutil.NoSuchProcess:
                    pass
            _, alive = psutil.wait_procs(alive, timeout=5)
            report['owned_descendants_stopped'] = not alive
            report['server_exit_code'] = process.returncode
        report['elapsed_s'] = time.monotonic() - started
        (out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(dict(report, artifacts=str(out)), indent=2))
    return 0 if report['status'] == 'ready' else 1

if __name__ == '__main__':
    sys.exit(main())
