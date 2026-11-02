#!/usr/bin/env python3
"""Authenticated loopback console for fixed local Office tasks. Never executes paid runs."""
import argparse
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import threading
import time
from urllib.parse import urlsplit

import office_dispatch as dispatch
import office_results as results
from execution_slot import SlotError
from remote_cli import private_directory

LAB = Path(__file__).resolve().parents[1]
ASSETS = {'/': ('office_console.html', 'text/html'), '/console.js': ('office_console.js', 'text/javascript'),
          '/console.css': ('office_console.css', 'text/css')}


class ConsoleError(ValueError):
    pass


def selection_plan(selection, lab=LAB):
    if not isinstance(selection, dict): raise ConsoleError('invalid_selection')
    if set(selection) == {'retry_id'}:
        return dispatch.retry_plan(selection['retry_id'], lab)[0]
    if set(selection) != {'provider', 'mode'}: raise ConsoleError('invalid_selection')
    provider, mode = selection['provider'], selection['mode']
    if not isinstance(provider, str) or provider not in dispatch.SPECS or not isinstance(mode, str):
        raise ConsoleError('invalid_selection')
    options = {}
    if mode == 'terminal' and provider == 'opencode': options['keep_open'] = True
    elif mode in ('http_401','http_429') and provider == 'pi': options['check_failure'] = int(mode[5:])
    elif mode == 'crash' and provider == 'pi': options['check_crash'] = True
    elif mode != 'task': raise ConsoleError('invalid_selection')
    return dispatch.plan(provider, **options)


def report_reference(text, lab):
    """Only a validated run name from this owned process's private output may be read."""
    candidates = re.findall(r'^Artifacts: (.+)$', text, re.M)
    for match in re.finditer(r'^\{', text, re.M):
        try:
            value, _ = json.JSONDecoder().raw_decode(text[match.start():])
            if isinstance(value, dict) and isinstance(value.get('artifacts'), str): candidates.append(value['artifacts'])
        except ValueError: pass
    for name in candidates:
        path = Path(name)
        if path.parent == lab / 'runs' and results.RUN_NAME.fullmatch(path.name): return path.name
    return None


def terminal_link(value):
    if not isinstance(value, str) or len(value) > 2048: return None
    try:
        url = urlsplit(value)
        if (url.scheme == 'http' and url.hostname == '127.0.0.1' and url.port and not url.username
                and not url.password and not url.query and url.path == '/login'
                and re.fullmatch(r'key=[A-Za-z0-9_-]{16,256}',url.fragment)):
            return value
    except ValueError: pass
    return None


class Console:
    def __init__(self, lab=LAB, roots=None):
        self.lab = lab
        private_directory(lab / 'runs', root=lab)
        self.roots = roots or [lab / 'runs']
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock()
        self.plans, self.jobs, self.checks = {}, {}, {}
        self.active = None
        self.closing = False
        self.directory = private_directory(lab / 'state/console' / secrets.token_hex(12), root=lab)

    def plan(self, selection):
        preview = selection_plan(selection, self.lab)
        with self.lock:
            self.plans = {k:v for k,v in self.plans.items() if v['expires'] > time.monotonic()}
            if len(self.plans) >= 32: raise ConsoleError('too_many_plans')
            key = secrets.token_hex(16)
            self.plans[key] = {'selection':selection, 'expires':time.monotonic()+300, 'preview':preview}
        return {'plan_id':key, 'plan':preview, 'executable':not preview['remote']}

    def execute(self, key):
        with self.lock:
            if self.closing: raise ConsoleError('console_closing')
            if self.active is not None: raise ConsoleError('execution_busy')
            chosen = self.plans.pop(key, None) if isinstance(key, str) else None
            if chosen is None or chosen['expires'] <= time.monotonic(): raise ConsoleError('plan_expired_or_used')
            preview = selection_plan(chosen['selection'], self.lab)  # Recheck stale retry state.
            if preview != chosen['preview']: raise ConsoleError('plan_changed')
            if preview['remote']: raise ConsoleError('remote_execution_requires_cli')
            # All argv originate in the fixed dispatcher, never in arbitrary browser text.
            command = [sys.executable, str(self.lab / 'scripts/office_dispatch.py'), *preview['command'][2:]]
            if '--allow-remote' in command: raise ConsoleError('remote_execution_requires_cli')
            key = secrets.token_hex(16)
            log = self.directory / (key + '.log')
            fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as stream:
                process = subprocess.Popen(command, cwd=self.lab, stdin=subprocess.DEVNULL, stdout=stream,
                                           stderr=subprocess.STDOUT, start_new_session=True)
            job = {'id':key, 'provider':preview['provider'], 'phase':'running', 'process':process,
                   'log':log, 'run_id':None, 'exit_code':None, 'keep_open':preview.get('keep_open',False)}
            self.jobs[key] = job; self.active = key
            # Keep completed jobs bounded; runs on disk remain untouched.
            while len(self.jobs) > 20: self.jobs.pop(next(iter(self.jobs)))
            threading.Thread(target=self.watch, args=(job,), daemon=True).start()
            return {'job_id':key}

    def watch(self, job):
        code = job['process'].wait()
        with self.lock:
            job['exit_code'] = code; job['phase'] = 'finished'
            if self.active == job['id']: self.active = None

    def stop(self, key):
        with self.lock:
            job = self.jobs.get(key) if isinstance(key, str) else None
            if job is None or self.active != key: raise ConsoleError('no_owned_active_job')
            if job['phase'] != 'stopping' and job['process'].poll() is None:
                job['process'].send_signal(signal.SIGINT)
                job['phase'] = 'stopping'
        return {'status':'stopping'}

    def job_view(self, job):
        row = {k:job[k] for k in ('id','provider','phase','exit_code','run_id')}
        # Bounded private output is used only to locate the run; never returned to the browser.
        with job['log'].open('rb') as stream: raw = stream.read(2*1024*1024+1)
        if len(raw) <= 2*1024*1024:
            job['run_id'] = report_reference(raw.decode('utf8', errors='replace'), self.lab)
            row['run_id'] = job['run_id']
        if job['run_id']:
            root_fd = os.open(self.lab / 'runs', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                fd = os.open(job['run_id'], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
                try:
                    row['result'] = results.normalize(fd, job['run_id'])
                    if job['keep_open'] and job['process'].poll() is None and job['phase'] == 'running':
                        try:
                            ready, _ = results.read_json(fd, ('office-ready.json',), 4096)
                            link = terminal_link(ready.get('sign_in'))
                            if link: row['terminal_url'] = link
                        except FileNotFoundError: pass
                finally: os.close(fd)
            finally: os.close(root_fd)
        return row

    def snapshot(self):
        with self.lock:
            jobs = []
            for job in reversed(list(self.jobs.values())):
                try: jobs.append(self.job_view(job))
                except (OSError, ValueError):
                    jobs.append({k:job[k] for k in ('id','provider','phase','exit_code','run_id')})
            return {'active_job':self.active, 'jobs':jobs, 'checks':dict(self.checks),
                    'results':results.catalog(self.roots)}

    def detect(self, provider):
        if not isinstance(provider,str) or provider not in dispatch.SPECS: raise ConsoleError('invalid_provider')
        with self.lock:
            if self.active is not None: raise ConsoleError('execution_busy')
            value = dispatch.detect(provider, self.lab)
            # Deliberate whitelist: probe errors, raw CLI text and paths never reach HTTP.
            self.checks[provider] = {k:value[k] for k in ('provider','cli_compatible','credentials',
                                                        'runtime','launch_prerequisites_present')}
            return self.checks[provider]

    def close(self):
        with self.lock:
            self.closing = True
            job = self.jobs.get(self.active)
            if job and job['process'].poll() is None:
                if job['phase'] != 'stopping': self.stop(job['id'])
                process = job['process']
            else: process = None
        if process:
            try: process.wait(timeout=45)
            except subprocess.TimeoutExpired:
                print('Owned runner has not exited; cleanup is unconfirmed. Check its private run before continuing.', file=sys.stderr)


def serve(console, port=0):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass

        def reply(self, status, value, content_type='application/json'):
            body = json.dumps(value, ensure_ascii=False).encode() if content_type=='application/json' else value
            self.send_response(status)
            self.send_header('Content-Type', content_type+'; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Referrer-Policy','no-referrer')
            self.send_header('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
            self.end_headers(); self.wfile.write(body)

        def authorized(self, mutate=False):
            origin = f'http://127.0.0.1:{self.server.server_port}'
            if self.headers.get_all('Host') != [origin[7:]]: return False
            supplied = self.headers.get('Origin')
            if (mutate and supplied != origin) or (supplied is not None and supplied != origin): return False
            if self.headers.get('Sec-Fetch-Site') == 'cross-site': return False
            return hmac.compare_digest(self.headers.get('Authorization','').encode(), ('Bearer '+console.token).encode())

        def do_GET(self):
            if self.path in ASSETS:
                if self.headers.get_all('Host') != [f'127.0.0.1:{self.server.server_port}']:
                    self.reply(403, {'error':'forbidden'}); return
                name, kind = ASSETS[self.path]
                self.reply(200, Path(__file__).with_name(name).read_bytes(), kind); return
            if not self.authorized(): self.reply(403,{'error':'forbidden'}); return
            if self.path != '/api/state': self.reply(404,{'error':'not_found'}); return
            try: self.reply(200,console.snapshot())
            except (OSError,ValueError): self.reply(409,{'error':'results_unavailable'})

        def do_POST(self):
            self.connection.settimeout(5)
            if not self.authorized(True): self.reply(403,{'error':'forbidden'}); return
            if self.headers.get('Content-Type') != 'application/json': self.reply(415,{'error':'json_required'}); return
            try:
                lengths = self.headers.get_all('Content-Length')
                if self.headers.get('Transfer-Encoding') or not lengths or len(lengths)!=1: raise ValueError()
                size = int(lengths[0])
                if not 0 < size <= 4096: raise ValueError()
                raw = self.rfile.read(size)
                if len(raw)!=size: raise ValueError()
                data = json.loads(raw,object_pairs_hook=results.reject_duplicates)
                if not isinstance(data,dict): raise ValueError()
            except (OSError,ValueError,RecursionError): self.reply(400,{'error':'invalid_request'}); return
            try:
                if self.path == '/api/plan': value = console.plan(data)
                elif self.path == '/api/execute' and set(data)=={'plan_id'}: value = console.execute(data['plan_id'])
                elif self.path == '/api/stop' and set(data)=={'job_id'}: value = console.stop(data['job_id'])
                elif self.path == '/api/detect' and set(data)=={'provider'}: value = console.detect(data['provider'])
                else: self.reply(404,{'error':'not_found'}); return
                self.reply(200,value)
            except (ConsoleError,SlotError) as error: self.reply(409,{'error':str(error)})
            except (OSError,ValueError,TypeError,subprocess.SubprocessError): self.reply(409,{'error':'operation_failed'})

        def do_OPTIONS(self): self.reply(405,{'error':'method_not_allowed'})
    server = ThreadingHTTPServer(('127.0.0.1',port),Handler)
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=0)
    parser.add_argument('--runs-root',type=Path,action='append',help='Additional read-only run histories; only this checkout can execute')
    args = parser.parse_args()
    console = Console(roots=[LAB/'runs',*(args.runs_root or [])])
    server = serve(console,args.port)
    print(f'http://127.0.0.1:{server.server_port}/#token={console.token}',flush=True)
    def stop(*_): raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM,stop)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: console.close(); server.server_close()


if __name__=='__main__': main()
