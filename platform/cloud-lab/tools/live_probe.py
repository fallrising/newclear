#!/usr/bin/env python3
"""Bounded Cloud Lab HTTPS probe. Read-only unless --submit-readonly is explicit."""
import argparse
from datetime import datetime, timezone
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import time
import urllib.error
import urllib.request
import uuid

COMPONENT = Path(__file__).resolve().parents[1]
REPOSITORY = COMPONENT.parents[1]
_spec = importlib.util.spec_from_file_location('cloudlab_probe_protocol', COMPONENT / 'adapters/node-health/runner.py')
_protocol = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_protocol)
LIMIT = 32768
ANONYMOUS_PATHS = ('/', '/styles.css', '/dashboard.mjs', '/api/bootstrap', '/api/commands')


class ProbeError(ValueError):
    """Only stable, non-sensitive diagnostic codes are exposed."""


def utc(seconds):
    return datetime.fromtimestamp(int(seconds), timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'), sort_keys=True).encode('utf-8')


def directory_fd(path):
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in Path(path).parts[1:]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise


def private_read(path):
    path = Path(os.path.abspath(path))
    try:
        parent = directory_fd(path.parent)
        try:
            fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            with os.fdopen(fd, 'rb') as source:
                metadata = os.fstat(source.fileno())
                if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077 or metadata.st_nlink != 1:
                    raise ProbeError('UNSAFE_PRIVATE_FILE')
                data = source.read(LIMIT + 1)
                if len(data) > LIMIT:
                    raise ProbeError('PRIVATE_FILE_TOO_LARGE')
                return data
        finally:
            os.close(parent)
    except OSError as error:
        raise ProbeError('PRIVATE_FILE_UNAVAILABLE') from error


def private_write(directory, name, data):
    try:
        parent = directory_fd(directory)
        try:
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
            with os.fdopen(fd, 'wb') as output:
                os.fchmod(output.fileno(), 0o600)
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            os.fsync(parent)
        finally:
            os.close(parent)
    except OSError as error:
        raise ProbeError('EVIDENCE_WRITE_FAILED') from error


def sign_headers(config, method, path, body, now, nonce=None):
    nonce = nonce or secrets.token_hex(16)
    message = '\n'.join(['CLOUDLAB-M1', config['audience'], config['credential_id'], str(config['generation']), method, path, str(int(now)), nonce, hashlib.sha256(body).hexdigest()]).encode('utf-8')
    headers = {'Accept':'application/json', 'X-Lab-Key-Id':config['credential_id'], 'X-Lab-Time':str(int(now)), 'X-Lab-Nonce':nonce,
               'X-Lab-Signature':hmac.new(bytes.fromhex(config['secret_hex']), message, hashlib.sha256).hexdigest()}
    if method == 'POST':
        headers['Content-Type'] = 'application/json'
    if 'cloudflare_access_client_id' in config:
        headers['CF-Access-Client-Id'] = config['cloudflare_access_client_id']
        headers['CF-Access-Client-Secret'] = config['cloudflare_access_client_secret']
    return headers


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HTTPSClient:
    def __init__(self, base_url, *, auth_status_only=False):
        self.base_url = base_url
        self.auth_status_only = auth_status_only
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        self.opener.addheaders = [("User-Agent", "cloud-lab-m1/1.0")]

    def __call__(self, method, path, body, headers):
        # This client only accepts internal fixed paths, never a response-provided URL.
        if not path.startswith('/api/commands/') and path not in (*ANONYMOUS_PATHS, '/api/commands'):
            raise ProbeError('UNSUPPORTED_PROBE_ROUTE')
        request = urllib.request.Request(self.base_url + path, body if method == 'POST' else None, headers, method=method)
        try:
            try:
                response = self.opener.open(request, timeout=5)
            except urllib.error.HTTPError as response_error:
                response = response_error
            with response:
                status = response.code
                if self.auth_status_only and status in (401, 403):
                    # Access may deny with HTML or a large body; do not parse it.
                    return status, None
                if not headers.get('X-Lab-Signature'):
                    # Anonymous denied bodies may be large Access HTML; never retain them.
                    return status, None
                raw = response.read(LIMIT + 1)
                if len(raw) > LIMIT:
                    raise ProbeError('RESPONSE_TOO_LARGE')
                if response.headers.get_content_type() != 'application/json':
                    raise ProbeError('NON_JSON_RESPONSE')
                try:
                    parsed = _protocol.strict_json(raw)
                except ValueError as error:
                    raise ProbeError('INVALID_RESPONSE_JSON') from error
                return status, parsed
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise ProbeError('NETWORK_UNAVAILABLE') from error


def run_probe(config_path, output_path, *, submit=False, resume=False, wait_seconds=0,
              transport=None, clock=time.time, sleep=time.sleep, allow_loopback_http=False):
    if type(wait_seconds) is not int or not 0 <= wait_seconds <= 120 or (resume and not submit):
        raise ProbeError('INVALID_PROBE_OPTIONS')
    try:
        config = _protocol.strict_json(private_read(config_path))
        _protocol.Config.from_dict(config, allow_loopback_http=allow_loopback_http)
    except ValueError as error:
        raise ProbeError('INVALID_PRIVATE_CONFIG') from error
    output = Path(os.path.abspath(output_path))
    if output.is_relative_to(REPOSITORY) or any(p.is_symlink() or (p/'.git').is_symlink() or (p/'.git').exists() for p in (output, *output.parents)):
        raise ProbeError('UNSAFE_EVIDENCE_DIRECTORY')
    fingerprint = hashlib.sha256(encode({k:config[k] for k in ('base_url','audience','credential_id','generation','workspace_id','resource_ref','recipe_ref')})).hexdigest()
    if resume:
        if not output.is_dir() or output.stat().st_uid != os.getuid() or output.stat().st_mode & 0o077:
            raise ProbeError('UNSAFE_EVIDENCE_DIRECTORY')
        if private_read(output/'context.json') != encode({'profile_sha256':fingerprint}):
            raise ProbeError('RESUME_CONTEXT_MISMATCH')
    else:
        try:
            parent = directory_fd(output.parent)
            try:
                info = os.fstat(parent)
                if info.st_uid != os.getuid() or info.st_mode & 0o022:
                    raise ProbeError('UNSAFE_EVIDENCE_PARENT')
                os.mkdir(output.name, mode=0o700, dir_fd=parent)
                os.fsync(parent)
            finally:
                os.close(parent)
        except OSError as error:
            raise ProbeError('EVIDENCE_DIRECTORY_EXISTS_OR_UNAVAILABLE') from error
        private_write(output, 'context.json', encode({'profile_sha256':fingerprint}))
    send = transport or HTTPSClient(config['base_url'].rstrip('/'))
    result = {'schema_version':'cloudlab.probe.v1','checked_at':utc(clock()),'checks':[], 'readiness_passed':False,
              'execution':'not_requested','execution_passed':False,'human_access_verified':False,
              'backup_restore_verified':False,'mobile_verified':False}

    def check(name, passed, code, http_status=None):
        item = {'name':name,'passed':passed,'code':code}
        if http_status is not None:
            item['http_status'] = http_status
        result['checks'].append(item)

    def signed(method, path, body=b''):
        return send(method, path, body, sign_headers(config, method, path, body, clock()))

    try:
        for index, path in enumerate(ANONYMOUS_PATHS):
            try:
                status, _ = send('GET', path, b'', {})
                denied = status in (301,302,303,307,308,401,403)
                check(f'anonymous-{index}',denied,'DENIED_OR_REDIRECTED' if denied else 'ANONYMOUS_EXPOSURE',status)
            except ProbeError:
                check(f'anonymous-{index}',False,'ANONYMOUS_PROBE_UNAVAILABLE')
        if not all(x['passed'] for x in result['checks']):
            return result
        status, bootstrap = signed('GET','/api/bootstrap')
        if status != 200 or not isinstance(bootstrap,dict):
            check('authenticated-bootstrap',False,'AUTHENTICATED_READ_FAILED',status)
            return result
        scope = all(bootstrap.get(k) == config[k] for k in ('workspace_id','resource_ref','recipe_ref'))
        capabilities = bootstrap.get('capabilities')
        scope = scope and isinstance(capabilities,list) and all(isinstance(item,str) for item in capabilities) and 'commands:read' in capabilities
        check('authenticated-bootstrap',bool(scope),'SCOPE_MATCH' if scope else 'SCOPE_MISMATCH',status)
        if not scope:
            return result
        status, listing = signed('GET','/api/commands')
        readable = status == 200 and isinstance(listing,dict) and isinstance(listing.get('commands'),list)
        check('command-read',readable,'READABLE' if readable else 'COMMAND_READ_FAILED',status)
        if not readable:
            return result
        result['readiness_passed'] = True
        if not submit:
            return result
        if not {'commands:submit','node:health:read'}.issubset(capabilities):
            check('submit-scope',False,'SUBMIT_SCOPE_DENIED')
            result['execution'] = 'not_authorized'
            return result
        if resume:
            raw = private_read(output/'submission.json')
            if private_read(output/'submission.sha256') != hashlib.sha256(raw).hexdigest().encode():
                raise ProbeError('RESUME_COMMAND_CHANGED')
            command = _protocol.strict_json(raw)
            if not all(command.get(k) == config[k] for k in ('workspace_id','resource_ref','recipe_ref')):
                raise ProbeError('RESUME_SCOPE_MISMATCH')
        else:
            try:
                start = _protocol.timestamp(bootstrap['now'])
            except (KeyError,ValueError) as error:
                raise ProbeError('SERVER_TIME_INVALID') from error
            command = {'schema_version':'cloudlab.command.v1','schema_minor':0,
                'workspace_id':config['workspace_id'],'resource_ref':config['resource_ref'],'recipe_ref':config['recipe_ref'],
                'parameters':{'max_sample_age_seconds':30},'idempotency_key':str(uuid.uuid4()),'not_before':utc(start),
                'dispatch_deadline':utc(start+60),'execution_deadline':utc(start+120),'timeout_seconds':10,'output_budget_bytes':16384}
            raw = encode(command)
            private_write(output,'submission.json',raw)
            private_write(output,'submission.sha256',hashlib.sha256(raw).hexdigest().encode())
        result['execution'] = 'unconfirmed'
        acknowledgement = None
        for attempt in range(3):
            try:
                status, body = signed('POST','/api/commands',raw)
                if status == 202 and isinstance(body,dict):
                    acknowledgement = body.get('command')
                    break
                if status not in (429,503):
                    check('command-admission',False,'COMMAND_NOT_ACCEPTED',status)
                    return result
            except ProbeError:
                pass
            if attempt < 2:
                sleep(1)
        if not isinstance(acknowledgement,dict) or acknowledgement.get('command') != command or not isinstance(acknowledgement.get('command_id'),str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',acknowledgement['command_id']):
            check('command-admission',False,'ADMISSION_UNCONFIRMED')
            return result
        result['execution'] = 'accepted'
        check('command-admission',True,'DURABLE_ACK')
        command_id = acknowledgement['command_id']
        # Bounded request count also holds when a test/inaccurate clock does not advance.
        for attempt in range((wait_seconds+4)//5):
            if attempt:
                sleep(min(5,wait_seconds))
            status, body = signed('GET','/api/commands/'+command_id)
            observed = body.get('command') if isinstance(body,dict) else None
            if status != 200 or not isinstance(observed,dict) or observed.get('command_id') != command_id or observed.get('command') != command:
                raise ProbeError('OBSERVATION_MISMATCH')
            if observed.get('delivery') == 'reconciling':
                result['execution'] = 'unknown'
                return result
            if observed.get('delivery') == 'result_recorded':
                evidence = observed.get('result')
                if not isinstance(evidence,dict) or not isinstance(evidence.get('validation'),dict):
                    raise ProbeError('INVALID_RESULT_SHAPE')
                finished = _protocol.timestamp(evidence.get('finished_at'))
                fresh = 0 <= int(clock())-finished <= command['parameters']['max_sample_age_seconds']
                passed = evidence.get('owner_outcome') == 'succeeded' and evidence.get('validation',{}).get('status') == 'passed' and evidence.get('health') in ('healthy','unhealthy') and fresh
                result['execution'] = 'validated' if passed else 'unverified'
                result['execution_passed'] = passed
                check('execution-evidence',passed,'FRESH_VALIDATED_OBSERVATION' if passed else 'UNVERIFIED_OBSERVATION')
                return result
        return result
    except (ProbeError,ValueError,KeyError) as error:
        check('probe',False,str(error) if isinstance(error,ProbeError) else 'INVALID_RESPONSE')
        return result
    finally:
        name = ('probe-'+uuid.uuid4().hex+'.json') if resume else 'probe.json'
        private_write(output,name,encode(result)+b'\n')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True)
    destination = parser.add_mutually_exclusive_group(required=True)
    destination.add_argument('--evidence')
    destination.add_argument('--resume',help='reuse saved exact submission bytes; requires --submit-readonly')
    parser.add_argument('--submit-readonly',action='store_true')
    parser.add_argument('--wait-seconds',type=int,default=0)
    parser.add_argument('--allow-loopback-http',action='store_true',help='local tests only')
    args = parser.parse_args(argv)
    try:
        result = run_probe(args.config,args.evidence or args.resume,submit=args.submit_readonly,resume=bool(args.resume),
                           wait_seconds=args.wait_seconds,allow_loopback_http=args.allow_loopback_http)
        # Fixed summary only: no URL, identifiers, payload, header or credential logging.
        print(json.dumps({'readiness_passed':result['readiness_passed'],'execution':result['execution'],'execution_passed':result['execution_passed']}))
        return 0 if result['readiness_passed'] and (not args.submit_readonly or result['execution_passed']) else 1
    except (ProbeError,ValueError,OSError):
        print('Probe configuration or evidence unavailable',file=sys.stderr)
        return 2


if __name__=='__main__':
    sys.exit(main())
