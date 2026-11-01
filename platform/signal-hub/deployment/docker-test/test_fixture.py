"""Behavior checks for synthetic integration fixtures; all data is owned temporary data."""
import hashlib
import hmac
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

import fixture


class ProducerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.state = Path(self.temp.name)
        self.token = self.state / 'token'
        self.token.write_text('synthetic-token\n')

    def produce(self, kind='release', count=1):
        fixture.produce(kind, 'http://127.0.0.1:18080/v1/events', self.token,
                        self.state / 'state', 0.01, count, sleep=lambda _: None)

    def test_transport_retry_keeps_bytes_and_persists_before_send(self):
        bodies = []
        def send(url, token, body, **kwargs):
            bodies.append(body)
            with sqlite3.connect(self.state / 'state/producer.sqlite') as db:
                self.assertEqual(db.execute('SELECT body FROM runs').fetchone()[0], body)
            if len(bodies) == 1:
                raise OSError('synthetic timeout after commit')
            return 200, b'{"seq":17,"duplicate":true}'
        with patch.object(fixture, 'post', side_effect=send):
            self.produce()
        self.assertEqual(bodies[0], bodies[1])
        with sqlite3.connect(self.state / 'state/producer.sqlite') as db:
            self.assertEqual(db.execute('SELECT receipt_status FROM runs').fetchone()[0], 200)

    def test_resume_precedes_new_count_and_run_index_survives(self):
        captured = []
        with patch.object(fixture, 'post', return_value=(403, b'{}')):
            with self.assertRaises(fixture.FixtureError):
                self.produce()
        with sqlite3.connect(self.state / 'state/producer.sqlite') as db:
            pending = db.execute('SELECT body FROM runs').fetchone()[0]
        def send(url, token, body, **kwargs):
            captured.append(body)
            return 202, b'{"seq":7}'
        with patch.object(fixture, 'post', side_effect=send):
            self.produce(count=1)
        self.assertEqual(captured[0], pending)
        self.assertNotEqual(json.loads(captured[0])['id'], json.loads(captured[1])['id'])
        with sqlite3.connect(self.state / 'state/producer.sqlite') as db:
            self.assertEqual(db.execute('SELECT run_index FROM runs ORDER BY run_index').fetchall(), [(1,), (2,)])

    def test_bounded_transient_retries_and_nonretry_receipt(self):
        with patch.object(fixture, 'post', return_value=(503, b'{}')) as send:
            with self.assertRaises(fixture.FixtureError):
                self.produce()
            self.assertEqual(send.call_count, 3)
        with patch.object(fixture, 'post', return_value=(200, b'{"seq":1}')) as send:
            with self.assertRaises(fixture.FixtureError):
                self.produce()
            self.assertEqual(send.call_count, 1)

    def test_completed_source_markers_and_current_time(self):
        from datetime import datetime, timezone
        for kind, event_type in [('release', 'release.deploy.succeeded'),
                                 ('inspection', 'inspection.check.passed')]:
            body = fixture.envelope(kind, 9)
            event = json.loads(body)
            self.assertEqual(event['source'], 'urn:example:' + kind + ':docker')
            self.assertEqual(event['type'], event_type)
            self.assertIn('Docker test', event['summary'])
            self.assertTrue(event['data']['synthetic'])
            self.assertEqual(event['data']['run_index'], 9)
            age = datetime.now(timezone.utc) - datetime.fromisoformat(event['time'].replace('Z', '+00:00'))
            self.assertLess(abs(age.total_seconds()), 5)

    def test_invalid_receipts_rejected(self):
        for status, response in [(202, b'{"seq":true}'), (202, b'{"seq":0}'),
                                 (200, b'{"seq":2,"duplicate":false}'),
                                 (202, b'{"seq":2,"error":{}}')]:
            with self.subTest(status=status, response=response):
                with self.assertRaises(fixture.FixtureError):
                    fixture.check_receipt(status, response)


    def test_http_transport_uses_ingest_media_type_and_refuses_redirect(self):
        from http.server import BaseHTTPRequestHandler, HTTPServer
        observed = []
        redirect = [False]
        class Upstream(BaseHTTPRequestHandler):
            def do_POST(handler):
                body = handler.rfile.read(int(handler.headers['Content-Length']))
                observed.append((handler.path, handler.headers['Content-Type'], body))
                if redirect[0]:
                    handler.send_response(307)
                    handler.send_header('Location', '/credential-trap')
                    handler.end_headers()
                else:
                    handler.send_response(202)
                    handler.end_headers()
                    handler.wfile.write(b'{"seq":23}')
            def log_message(self, *_):
                pass
        server = HTTPServer(('127.0.0.1', 0), Upstream)
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.shutdown)
        url = 'http://127.0.0.1:' + str(server.server_port) + '/v1/events'
        fixture.produce('release', url, self.token, self.state / 'state', 0.01, 1)
        self.assertEqual(observed[0][1], 'application/cloudevents+json')
        redirect[0] = True
        with self.assertRaises(fixture.FixtureError):
            fixture.produce('release', url, self.token, self.state / 'state', 0.01, 1)
        self.assertEqual(len(observed), 2)
        self.assertEqual([item[0] for item in observed], ['/v1/events', '/v1/events'])


class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'receiver.sqlite'
        self.secret = b'unchanged synthetic secret\n'
        self.receiver = fixture.Receiver(self.path, self.secret)
        self.body = fixture.envelope('release', 1)

    def headers(self, body=None, timestamp='1000', delivery_id='docker-hook:17'):
        body = self.body if body is None else body
        signature = 'v1=' + hmac.new(self.secret, ('v1.' + timestamp + '.' + delivery_id + '.').encode('ascii') + body, hashlib.sha256).hexdigest()
        return {'Signalhub-Timestamp': timestamp, 'Signalhub-Delivery-Id': delivery_id,
                'Signalhub-Signature': signature}

    def accept(self, headers=None, body=None):
        return self.receiver.accept(self.headers() if headers is None else headers,
                                    self.body if body is None else body, now=1000)

    def test_durable_duplicate_and_conflict(self):
        self.assertEqual(self.accept()[0], 202)
        self.receiver = fixture.Receiver(self.path, self.secret)
        self.assertEqual(self.accept(), (200, {'duplicate': True}))
        changed = fixture.envelope('release', 2)
        self.assertEqual(self.accept(self.headers(body=changed), changed)[0], 409)
        with sqlite3.connect(self.path) as db:
            row = db.execute('SELECT delivery_id,body,body_sha256,received_at FROM deliveries').fetchone()
        self.assertEqual(row[:3], ('docker-hook:17', self.body, hashlib.sha256(self.body).hexdigest()))
        self.assertTrue(row[3].endswith('Z'))

    def test_authentication_precedes_duplicate_lookup(self):
        self.assertEqual(self.accept()[0], 202)
        for change in [{'Signalhub-Signature': 'v1=' + '0' * 64},
                       {'Signalhub-Timestamp': '01000'},
                       {'Signalhub-Delivery-Id': 'hook:0'},
                       {'Signalhub-Signature': self.headers()['Signalhub-Signature'].upper()}]:
            headers = self.headers()
            headers.update(change)
            self.assertEqual(self.accept(headers)[0], 401)
        for timestamp in ['699', '1301']:
            self.assertEqual(self.accept(self.headers(timestamp=timestamp))[0], 401)
        for timestamp in ['700', '1300']:
            self.assertEqual(self.accept(self.headers(timestamp=timestamp))[0], 200)

    def test_structured_event_can_omit_optional_data(self):
        event = json.loads(self.body)
        del event['data']
        body = json.dumps(event).encode()
        self.assertEqual(self.accept(self.headers(body=body), body)[0], 202)

    def test_body_must_be_structured_event_and_strict_json(self):
        for body in [b'{}', b'[]', b'{"specversion":"1.0","specversion":"1.0"}', b'NaN', self.body.replace(b'"run_index":1', b'"run_index":1e999')]:
            self.assertEqual(self.accept(self.headers(body=body), body)[0], 400)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM deliveries').fetchone()[0], 0)


    def test_http_receiver_authentication_and_duplicate_headers(self):
        import http.client
        import time
        server = fixture.http_server(('127.0.0.1', 0), self.receiver)
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.shutdown)
        for expected in [202, 200]:
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            self.addCleanup(connection.close)
            connection.request('POST', '/webhook', self.body, self.headers(timestamp=str(int(time.time()))))
            response = connection.getresponse()
            self.assertEqual(response.status, expected)
            response.read()
        connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=3)
        self.addCleanup(connection.close)
        connection.putrequest('POST', '/webhook')
        for name, value in self.headers(timestamp=str(int(time.time()))).items():
            connection.putheader(name, value)
        connection.putheader('Signalhub-Delivery-Id', 'docker-hook:18')
        connection.putheader('Content-Length', str(len(self.body)))
        connection.endheaders(self.body)
        response = connection.getresponse()
        self.assertEqual(response.status, 401)
        response.read()


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.relay = fixture.Relay(self.path, 'http://127.0.0.1:18080', b'synthetic-token')
        self.body = b'{ "version":"4", "alerts": [{"status":"firing"}] }'

    def test_member_failure_is_non2xx_and_bytes_captured(self):
        response = b'{"results":[{"index":0,"status":409,"error":{"code":"conflict"}}]}'
        with patch.object(fixture, 'post', return_value=(200, response)) as send:
            status, result = self.relay.accept(self.body)
        self.assertEqual(status, 502)
        self.assertIn('member', result['error'])
        self.assertEqual(send.call_args.args[0], 'http://127.0.0.1:18080/v1/adapters/alertmanager')
        self.assertEqual(send.call_args.args[2], self.body)
        with sqlite3.connect(self.path / 'relay.sqlite') as db:
            self.assertEqual(db.execute('SELECT seq,request,response,hub_status,status FROM captures').fetchone(),
                             (1, self.body, response, 200, 502))

    def test_duplicate_success_and_missing_members_fail(self):
        ok = b'{"results":[{"index":0,"status":200,"seq":17,"duplicate":true}]}'
        with patch.object(fixture, 'post', return_value=(200, ok)):
            self.assertEqual(self.relay.accept(self.body)[0], 200)
        for response in [b'{"results":[]}', b'{"results":[{"index":1,"status":202,"seq":1}]}',
                         b'{"results":[{"index":0,"status":200,"seq":1}]}']:
            with patch.object(fixture, 'post', return_value=(200, response)):
                self.assertEqual(self.relay.accept(self.body)[0], 502)

    def test_http_health_route_and_bounded_body(self):
        server = fixture.http_server(('127.0.0.1', 0), self.relay)
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.shutdown)
        url = 'http://127.0.0.1:' + str(server.server_port)
        with urllib.request.urlopen(url + '/healthz') as response:
            self.assertEqual(response.status, 200)
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(url + '/records')
        self.assertEqual(error.exception.code, 404)
        request = urllib.request.Request(url + '/webhook', data=b'{}', method='POST',
                                         headers={'Content-Length': str(fixture.MAX_BODY + 1)})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        self.assertEqual(error.exception.code, 413)
        with patch.object(fixture, 'post', return_value=(200, b'{"results":[{"index":0,"status":202,"seq":1}]}')):
            request = urllib.request.Request(url + '/webhook', data=self.body, method='POST')
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)


if __name__ == '__main__':
    unittest.main()
