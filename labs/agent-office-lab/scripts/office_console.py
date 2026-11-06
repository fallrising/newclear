#!/usr/bin/env python3
"""Authenticated loopback console with explicit server-granted Pi remote tasks."""
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

import local_text_task as text_task
import office_dispatch as dispatch
import office_results as results
import remote_grant as grants
from execution_slot import SlotError, inspect_slot
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
    elif mode == 'host_restart' and provider == 'pi': options['check_host_restart'] = True
    elif mode == 'resume' and provider == 'pi': options['check_resume'] = True
    elif mode == 'cancel' and provider == 'pi': options['check_cancel'] = True
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
    def __init__(self, lab=LAB, roots=None, projects=None, remote_grant_providers=()):
        self.lab = lab
        self.projects = {}
        for i, path in enumerate(projects or []):
            path = Path(os.path.abspath(Path(path).expanduser()))
            fd = text_task.directory(path); os.close(fd)
            if path == Path(path.anchor) or len(path.parts) < 3: raise ConsoleError('project_root_too_broad')
            self.projects[f'project-{i+1}'] = path
        private_directory(lab / 'runs', root=lab)
        self.roots = roots or [lab / 'runs']
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock()
        self.plans, self.jobs, self.checks = {}, {}, {}
        self.remote_grant_providers = tuple(dict.fromkeys(remote_grant_providers))
        if any(provider != 'pi' for provider in self.remote_grant_providers): raise ConsoleError('invalid_remote_grant_provider')
        self.active = None
        self.closing = False
        self.directory = private_directory(lab / 'state/console' / secrets.token_hex(12), root=lab)

    def preview(self, selection):
        if isinstance(selection,dict) and selection.get('mode') in ('text','revision'):
            revision = selection['mode']=='revision'
            keys={'provider','mode','project','prompt'} | ({'target'} if revision else set())
            if set(selection) != keys or selection['provider'] != 'opencode' or (revision and not isinstance(selection['target'],str)):
                raise ConsoleError('invalid_selection')
            project = selection['project']
            if not isinstance(project,str) or project not in self.projects: raise ConsoleError('unknown_project')
            try:
                path = self.projects[project]
                data = text_task.request(path.name,selection['prompt'],text_task.snapshot(path),selection.get('target'))
            except (OSError,ValueError,UnicodeError): raise ConsoleError('project_text_unavailable') from None
            return {'provider':'opencode','model':dispatch.SPECS['opencode']['model'],'remote':False,
                    'task':'local_revision' if revision else 'local_text','target':data.get('target'),'project':data['project'],'prompt':data['prompt'],
                    'source_files':list(data['files']),'source_bytes':sum(len(v.encode()) for v in data['files'].values()),
                    'request_sha256':text_task.digest(text_task.encoded(data)), 'output':'output.md',
                    'original_directory_modified':False}, data
        return selection_plan(selection,self.lab), None

    def project_files(self, project):
        if not isinstance(project,str) or project not in self.projects: raise ConsoleError('unknown_project')
        try: files=text_task.snapshot(self.projects[project])
        except (OSError,ValueError,UnicodeError): raise ConsoleError('project_text_unavailable') from None
        return {'files':[{'name':name,'sha256':text_task.digest(content.encode()),'bytes':len(content.encode())} for name,content in files.items()]}

    def _authorization(self, preview):
        if not preview['remote']:
            return None, True, None, 300
        if preview.get('retry_of') or preview['provider'] not in self.remote_grant_providers:
            return {'kind':'cli_required','reason':'remote_grants_not_enabled'}, False, None, 300
        row = grants.pending(self.lab, preview['provider'])
        if row is None:
            return {'kind':'cli_required','reason':'no_valid_grant'}, False, None, 300
        ttl = max(0.0, min(300.0, row['expires_at'] - time.time()))
        return {'kind':'server_grant','fingerprint':grants.fingerprint(row['id']),'expires_at':row['expires_at']}, True, row['id'], ttl

    def plan(self, selection):
        preview, _ = self.preview(selection)
        authorization, executable, grant_id, ttl = self._authorization(preview)
        if authorization is not None:
            preview = dict(preview, authorization=authorization)
        with self.lock:
            self.plans = {k:v for k,v in self.plans.items() if v['expires'] > time.monotonic()}
            if len(self.plans) >= 32: raise ConsoleError('too_many_plans')
            key = secrets.token_hex(16)
            self.plans[key] = {'selection':selection, 'expires':time.monotonic()+ttl, 'preview':preview, 'grant_id':grant_id}
        return {'plan_id':key, 'plan':preview, 'executable':executable}

    def execute(self, key):
        with self.lock:
            if self.closing: raise ConsoleError('console_closing')
            if self.active is not None: raise ConsoleError('execution_busy')
            chosen = self.plans.pop(key, None) if isinstance(key, str) else None
            if chosen is None or chosen['expires'] <= time.monotonic(): raise ConsoleError('plan_expired_or_used')
            preview, text_data = self.preview(chosen['selection'])  # Recheck source snapshot or stale retry state.
            if preview['remote'] and chosen.get('grant_id'):
                saved = dict(chosen['preview']); saved.pop('authorization', None)
                if preview != saved: raise ConsoleError('plan_changed')
                current = grants.inspect(self.lab, chosen['grant_id'], preview['provider'])
                grant_id = current['id']
                preview = dict(preview, authorization={'kind':'server_grant','fingerprint':grants.fingerprint(grant_id),'expires_at':current['expires_at']})
                if preview != chosen['preview']: raise ConsoleError('plan_changed')
            else:
                authorization, executable, grant_id, _ = self._authorization(preview)
                if authorization is not None:
                    preview = dict(preview, authorization=authorization)
                if preview != chosen['preview']: raise ConsoleError('plan_changed')
                if preview['remote']:
                    if chosen.get('grant_id') is None or not executable: raise ConsoleError('remote_execution_requires_cli')
            shared = inspect_slot(self.lab)['status']
            if shared != 'available':
                raise ConsoleError({'busy':'execution_busy','cleanup_unconfirmed':'cleanup_unconfirmed'}.get(shared,'execution_state_unavailable'))
            # All argv originate in the fixed dispatcher, never in arbitrary browser text.
            if text_data:
                request_path = self.directory / (secrets.token_hex(16)+'.task.json')
                fd = os.open(request_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                with os.fdopen(fd,'wb') as stream: stream.write(text_task.encoded(text_data))
                command = [sys.executable,str(self.lab/'scripts/office_dispatch.py'),'local-text',
                           '--request',str(request_path),'--sha256',preview['request_sha256'],'--execute']
            elif preview['remote']:
                command = [sys.executable, str(self.lab / 'scripts/office_dispatch.py'), 'run', 'pi', '--execute', '--remote-grant', chosen['grant_id']]
            else:
                command = [sys.executable, str(self.lab / 'scripts/office_dispatch.py'), *preview['command'][2:]]
            if '--allow-remote' in command: raise ConsoleError('remote_execution_requires_cli')
            key = secrets.token_hex(16)
            log = self.directory / (key + '.log')
            fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as stream:
                process = self.spawn(command, stream)
            job = {'id':key, 'provider':preview['provider'], 'phase':'running', 'process':process,
                   'log':log, 'run_id':None, 'exit_code':None, 'keep_open':preview.get('keep_open',False),
                   'remote':preview['remote'], 'authorization_fingerprint':grants.fingerprint(chosen['grant_id']) if chosen.get('grant_id') else None,
                   'grant_id':chosen.get('grant_id')}
            self.jobs[key] = job; self.active = key
            # Keep completed jobs bounded; runs on disk remain untouched.
            while len(self.jobs) > 20: self.jobs.pop(next(iter(self.jobs)))
            threading.Thread(target=self.watch, args=(job,), daemon=True).start()
            return {'job_id':key}

    def spawn(self, command, log):
        return subprocess.Popen(command, cwd=self.lab, stdin=subprocess.DEVNULL, stdout=log,
                                stderr=subprocess.STDOUT, start_new_session=True)

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
        row['remote'] = bool(job.get('remote'))
        row['authorization_fingerprint'] = job.get('authorization_fingerprint')
        if job.get('grant_id'):
            try: row['authorization_consumed'] = grants.consumed(self.lab, job['grant_id'])
            except (OSError, ValueError): row['authorization_consumed'] = None
        else:
            row['authorization_consumed'] = False
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
            pending, grant_errors = [], []
            for provider in self.remote_grant_providers:
                try:
                    row = grants.pending(self.lab, provider)
                    if row is not None: pending.append(grants.public(row))
                except grants.GrantError as error:
                    grant_errors.append({'provider':provider,'error':str(error)})
            return {'active_job':self.active, 'jobs':jobs, 'checks':dict(self.checks),
                    'projects':[{'id':key,'name':path.name} for key,path in self.projects.items()],
                    'shared_execution':inspect_slot(self.lab),
                    'remote_grants':{'enabled_providers':list(self.remote_grant_providers),'pending':pending,'errors':grant_errors},
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
                if self.path == '/api/project' and set(data)=={'project'}: value=console.project_files(data['project'])
                elif self.path == '/api/plan': value = console.plan(data)
                elif self.path == '/api/execute' and set(data)=={'plan_id'}: value = console.execute(data['plan_id'])
                elif self.path == '/api/stop' and set(data)=={'job_id'}: value = console.stop(data['job_id'])
                elif self.path == '/api/detect' and set(data)=={'provider'}: value = console.detect(data['provider'])
                else: self.reply(404,{'error':'not_found'}); return
                self.reply(200,value)
            except grants.GrantError as error: self.reply(409,{'error':str(error)})
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
    parser.add_argument('--project',type=Path,action='append',help='Register an explicit text source directory; original files remain unchanged')
    parser.add_argument('--accept-remote-grant',choices=['pi'],action='append',default=[])
    args = parser.parse_args()
    console = Console(roots=[LAB/'runs',*(args.runs_root or [])],projects=args.project,remote_grant_providers=args.accept_remote_grant)
    server = serve(console,args.port)
    print(f'http://127.0.0.1:{server.server_port}/#token={console.token}',flush=True)
    def stop(*_): raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM,stop)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: console.close(); server.server_close()


if __name__=='__main__': main()
