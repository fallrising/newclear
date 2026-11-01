#!/usr/bin/env python3
"""Local MCP stdio transport for the fixed Cloud Lab bot bridge (Linux)."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import time

BRIDGE_SCRIPT = Path(__file__).with_name('bot_bridge.py')
_spec = importlib.util.spec_from_file_location('mcp_bot_bridge', BRIDGE_SCRIPT)
bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bridge)
VERSION = '2025-11-25'
MAX_FRAME = 16384
MAX_OUTPUT = 8192
CALL_TIMEOUT = 15
CALL_INTERVAL = 1
OPERATIONS = {'cloudlab_health_status': 'health.status', 'cloudlab_health_check': 'health.check'}
STATES = {'not_found', 'accepted', 'dispatching', 'unknown', 'validated', 'stale', 'unverified',
          'cancelled_before_dispatch', 'expired_before_dispatch', 'unconfirmed', 'denied', 'error'}
ERROR_CODES = {'INVALID_REQUEST', 'SUBMIT_NOT_ENABLED', 'UNSAFE_STATE', 'STATE_BUSY',
               'CONFIG_OR_STATE_UNAVAILABLE', 'UNSUPPORTED_RECIPE', 'CONTEXT_MISMATCH', 'STATE_CORRUPT'} | bridge.POLICY_CODES
RESULT_CODES = {'NO_LOCAL_REQUEST', 'ACK_UNCONFIRMED', 'AUTHORIZATION_DENIED', 'BOOTSTRAP_UNAVAILABLE',
                'REMOTE_UNCONFIRMED', 'SCOPE_MISMATCH', 'SERVER_TIME_INVALID', 'OBSERVATION_MISMATCH',
                'INVALID_RESPONSE', 'TRANSPORT_OR_RESPONSE_UNCONFIRMED', 'OBSERVED',
                'STALE_OBSERVATION', 'FRESH_VALIDATED_OBSERVATION', 'UNVERIFIED_OBSERVATION'} | bridge.POLICY_CODES


def encode(value):
    return json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(',', ':')).encode('utf-8')


def uncertain(request, code):
    return bridge.response(request, 'unconfirmed', code)


def validate_output(raw, request, returncode):
    """Never forward child free text, extra fields or mismatched request identity."""
    value = bridge.protocol.strict_json(raw)
    if not isinstance(value, dict):
        raise ValueError('output')
    if value.get('schema_version') == 'cloudlab.bot-error.v1':
        if set(value) != {'schema_version', 'code'} or value['code'] not in ERROR_CODES or returncode != 2:
            raise ValueError('error')
        return value
    if (set(value) != set(bridge.response(request, '', ''))
            or value['schema_version'] != 'cloudlab.bot-response.v1'
            or any(value[k] != request[k] for k in ('request_id', 'operation'))
            or value['state'] not in STATES or value['code'] not in RESULT_CODES):
        raise ValueError('response')
    if returncode != (1 if value['state'] in ('unconfirmed', 'denied', 'error') else 0):
        raise ValueError('exit')
    cid = value['command_id']
    if cid is not None and (not isinstance(cid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', cid)):
        raise ValueError('command')
    if value['observed_at'] is not None:
        bridge.protocol.timestamp(value['observed_at'])
    if value['state'] == 'validated':
        if value['verified'] is not True or value['health'] not in ('healthy', 'unhealthy') or cid is None or value['observed_at'] is None:
            raise ValueError('verified')
    elif value['verified'] is not False or value['health'] is not None:
        raise ValueError('unverified')
    return value


def run_bridge(request, config, state_dir, *, allow_submit=False, allow_loopback_http=False, policy_path=None):
    argv = [sys.executable, str(BRIDGE_SCRIPT), '--config', str(config), '--state-dir', str(state_dir)]
    if policy_path is not None:
        argv.extend(['--policy', str(policy_path)])
    if allow_submit:
        argv.append('--allow-submit')
    if allow_loopback_http:
        argv.append('--allow-loopback-http')
    child = None
    deadline = time.monotonic() + CALL_TIMEOUT
    try:
        child = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL, start_new_session=True)
        child.stdin.write(encode(request))  # Fixed validated envelope, well below pipe capacity.
        child.stdin.close()
        data = bytearray()
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not selector.select(remaining):
                    return uncertain(request, 'BRIDGE_TIMEOUT_UNCONFIRMED')
                chunk = os.read(child.stdout.fileno(), MAX_OUTPUT + 1 - len(data))
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > MAX_OUTPUT:
                    return uncertain(request, 'BRIDGE_OUTPUT_UNCONFIRMED')
        child.wait(timeout=max(0, deadline - time.monotonic()))
        return validate_output(bytes(data), request, child.returncode)
    except subprocess.TimeoutExpired:
        return uncertain(request, 'BRIDGE_TIMEOUT_UNCONFIRMED')
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        return uncertain(request, 'BRIDGE_OUTPUT_UNCONFIRMED')
    finally:
        if child is not None:
            # Also terminate any inherited group members; no child process is reusable.
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
            child.stdout.close()
            if not child.stdin.closed:
                child.stdin.close()


def tools(allow_submit):
    result = []
    for name, operation in OPERATIONS.items():
        if operation == 'health.check' and not allow_submit:
            continue
        result.append({'name': name,
            'description': ('Submit or recover one fixed node-health request. ' if operation == 'health.check'
                            else 'Read the outcome of an existing request without submitting a command. ')
                           + 'Preserve the same request_id for retries/status. accepted is not completion; inspect state, verified and health. Never replace an uncertain request with a new ID.',
            'inputSchema': {'type':'object', 'additionalProperties':False, 'required':['request_id'],
                'properties':{'request_id':{'type':'string', 'pattern':r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'}}},
            'annotations':{'readOnlyHint':operation == 'health.status', 'destructiveHint':False,
                           'idempotentHint':True, 'openWorldHint':True}})
    return result


def tool_result(value):
    return {'content':[{'type':'text', 'text':encode(value).decode()}], 'structuredContent':value,
            'isError':value.get('schema_version') == 'cloudlab.bot-error.v1' or value.get('state') in ('unconfirmed', 'denied', 'error')}


def tool_error(code):
    return tool_result({'schema_version':'cloudlab.bot-error.v1', 'code':code})


class RPCError(ValueError):
    def __init__(self, code):
        self.code = code


def require(ok, code=-32602):
    if not ok:
        raise RPCError(code)


def decode(raw):
    def pairs(items):
        out = {}
        for key, value in items:
            if key in out:
                raise ValueError('duplicate')
            out[key] = value
        return out
    def invalid(value):
        raise ValueError('nonfinite')
    value = json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=invalid)
    json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')
    return value


def serve(source, sink, invoke, *, allow_submit=False, clock=time.monotonic):
    initialized = ready = False
    last_call = None
    messages = {-32700:'Parse error', -32600:'Invalid Request', -32601:'Method not found',
                -32602:'Invalid params', -32000:'Session not ready'}
    def emit(value):
        sink.write(encode(value) + b'\n')
        sink.flush()
    def error(id, code):
        emit({'jsonrpc':'2.0', 'id':id, 'error':{'code':code, 'message':messages[code]}})
    while True:
        raw = source.readline(MAX_FRAME + 1)
        if not raw:
            return 0
        if len(raw) > MAX_FRAME or not raw.endswith(b'\n'):
            error(None, -32600)
            return 2
        try:
            value = decode(raw)
        except (ValueError, UnicodeError, RecursionError):
            error(None, -32700)
            continue
        id = None
        try:
            require(isinstance(value, dict) and value.get('jsonrpc') == '2.0'
                    and isinstance(value.get('method'), str)
                    and set(value) <= {'jsonrpc', 'id', 'method', 'params'}, -32600)
            method = value['method']
            params = value.get('params', {})
            if 'id' not in value:
                # Never dispatch requests sent as notifications, even tools/call.
                if method == 'notifications/initialized' and initialized and isinstance(params, dict):
                    ready = True
                continue
            require(type(value['id']) is int and abs(value['id']) <= 2**53-1
                    or isinstance(value['id'], str) and len(value['id']) <= 128, -32600)
            id = value['id']
            require(isinstance(params, dict), -32600)
            if method == 'initialize':
                require(not initialized, -32600)
                info = params.get('clientInfo')
                require(isinstance(params.get('protocolVersion'), str) and isinstance(params.get('capabilities'), dict)
                        and isinstance(info, dict) and isinstance(info.get('name'), str) and isinstance(info.get('version'), str))
                initialized = True
                answer = {'protocolVersion':VERSION, 'capabilities':{'tools':{'listChanged':False}},
                          'serverInfo':{'name':'cloud-lab-fixed-tools', 'version':'1.0.0'},
                          'instructions':'Use the same UUID for retries/status. Calls are serial, at most one per second. A timeout may have submitted work. Never infer task success from isError=false.'}
            elif method == 'ping':
                answer = {}
            else:
                require(ready, -32000)
                if method == 'tools/list':
                    require(set(params) <= {'_meta'})
                    answer = {'tools':tools(allow_submit)}
                elif method == 'tools/call':
                    name = params.get('name')
                    args = params.get('arguments')
                    require(set(params) <= {'name', 'arguments', '_meta'} and isinstance(name, str)
                            and name in OPERATIONS and isinstance(args, dict)
                            and (allow_submit or name != 'cloudlab_health_check'))
                    try:
                        if set(args) != {'request_id'}:
                            raise bridge.BridgeError('INVALID_REQUEST')
                        request = bridge.parse_request(encode({'schema_version':'cloudlab.bot-request.v1',
                                                               'operation':OPERATIONS[name], 'request_id':args['request_id']}))
                    except (bridge.BridgeError, ValueError):
                        answer = tool_error('INVALID_REQUEST')
                    else:
                        now = clock()
                        if last_call is not None and now-last_call < CALL_INTERVAL:
                            answer = tool_error('RATE_LIMITED')
                        else:
                            last_call = now
                            try:
                                outcome = invoke(request)
                            except Exception:
                                outcome = uncertain(request, 'BRIDGE_UNAVAILABLE_UNCONFIRMED')
                            answer = tool_result(outcome)
                else:
                    raise RPCError(-32601)
            emit({'jsonrpc':'2.0', 'id':id, 'result':answer})
        except RPCError as exc:
            error(id, exc.code)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--allow-submit', action='store_true')
    parser.add_argument('--policy', help='trusted private initialized policy')
    parser.add_argument('--allow-loopback-http', action='store_true', help='numeric loopback tests only')
    args = parser.parse_args(argv)
    def stop(signum, frame):
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    def invoke(request):
        return run_bridge(request, args.config, args.state_dir, allow_submit=args.allow_submit,
                          allow_loopback_http=args.allow_loopback_http, policy_path=args.policy)
    try:
        return serve(sys.stdin.buffer, sys.stdout.buffer, invoke, allow_submit=args.allow_submit)
    except (BrokenPipeError, OSError):
        return 1


if __name__ == '__main__':
    sys.exit(main())
