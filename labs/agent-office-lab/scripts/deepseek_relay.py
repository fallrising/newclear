"""One-run loopback relay: credentials stay out of Office and its worker."""
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading

MODEL = 'deepseek-flash'
MAX_REQUESTS = 4
MAX_BODY = 32768
MAX_OUTPUT = 512


def bounded_payload(raw):
    if len(raw) > MAX_BODY:
        raise ValueError('request_too_large')
    payload = json.loads(raw)
    if not isinstance(payload, dict) or payload.get('model') != MODEL or payload.get('stream') is not True:
        raise ValueError('unexpected_model_or_mode')
    if not isinstance(payload.get('messages'), list) or not payload['messages']:
        raise ValueError('missing_messages')
    # Force a single short, non-thinking response, including on every subsequent tool turn.
    payload.pop('max_completion_tokens', None)
    payload['max_tokens'] = MAX_OUTPUT
    payload['n'] = 1
    payload['thinking'] = {'type': 'disabled'}
    payload['stream_options'] = {'include_usage': True}
    return json.dumps(payload).encode()


class Budget:
    def __init__(self):
        self.requests = 0
        self.stopped = False
        self.active = False
        self.lock = threading.Lock()

    def reserve(self):
        with self.lock:
            if self.stopped or self.active or self.requests >= MAX_REQUESTS:
                raise ValueError('request_limit_or_stopped')
            self.requests += 1
            self.active = True

    def finish(self, failed=False):
        with self.lock:
            self.active = False
            self.stopped |= failed


class Relay:
    def __init__(self, token, api_key=None):
        self.token = token
        self.api_key = api_key  # None is the startup-only gate; it cannot forward any request.
        self.budget = Budget()
        self.records = []
        relay = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass  # No headers, credentials, prompts or provider errors are printed.

            def error(self, code, reason):
                body = json.dumps({'error': {'message': reason, 'type': 'lab_limit'}}).encode()
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                self.connection.settimeout(60)
                if self.path not in ('/chat/completions', '/v1/chat/completions'):
                    self.error(404, 'unsupported_endpoint'); return
                if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + relay.token):
                    self.error(401, 'unauthorized'); return
                if relay.api_key is None:
                    self.error(403, 'startup_only_no_remote_requests'); return
                try:
                    if self.headers.get('Transfer-Encoding'):
                        raise ValueError('unsupported_encoding')
                    length = int(self.headers.get('Content-Length', '-1'))
                    if not 0 < length <= MAX_BODY:
                        raise ValueError('request_size_limit')
                    raw = self.rfile.read(length)
                    if len(raw) != length:
                        raise ValueError('incomplete_request')
                    body = bounded_payload(raw)
                    relay.budget.reserve()
                except (ValueError, OSError):
                    self.error(400, 'invalid_request_or_budget_exhausted'); return
                record = {'request': relay.budget.requests, 'model': MODEL, 'max_output_tokens': MAX_OUTPUT,
                          'status': 'failed', 'input_bytes': length}
                relay.records.append(record)
                conn = http.client.HTTPSConnection('api.deepseek.com', timeout=60)
                failed = True
                try:
                    conn.request('POST', '/chat/completions', body, {'Authorization': 'Bearer ' + relay.api_key,
                                  'Content-Type': 'application/json', 'Accept': 'text/event-stream'})
                    response = conn.getresponse()
                    record['http_status'] = response.status
                    if response.status != 200:
                        self.error(502, 'provider_request_failed'); return
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/event-stream')
                    self.end_headers()
                    done = False
                    for line in response:
                        if line.startswith(b'data: '):
                            data = line[6:].strip()
                            if data == b'[DONE]':
                                done = True
                            else:
                                try:
                                    event = json.loads(data)
                                    usage = event.get('usage')
                                    if usage:
                                        for target, source in (('input_tokens', 'prompt_tokens'), ('output_tokens', 'completion_tokens')):
                                            if isinstance(usage.get(source), int): record[target] = usage[source]
                                    for choice in event.get('choices', []):
                                        if choice.get('finish_reason'):
                                            record['finish_reason'] = choice['finish_reason']
                                except (ValueError, AttributeError):
                                    pass
                        self.wfile.write(line)
                        self.wfile.flush()
                    failed = not done or record.get('finish_reason') == 'length'
                    record['status'] = 'completed' if not failed else 'failed'
                except (OSError, http.client.HTTPException):
                    record['reason'] = 'provider_transport_or_client_closed'
                finally:
                    relay.budget.finish(failed)
                    conn.close()

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self):
        self.thread.start()
        return self.server.server_address[1]

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
