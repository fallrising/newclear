import http.client
import json
import unittest
import threading
from unittest.mock import patch

from deepseek_relay import Relay


class RelayFailures(unittest.TestCase):
    payload = json.dumps({'model': 'deepseek-flash', 'stream': True,
                          'messages': [{'role': 'user', 'content': 'synthetic'}]}).encode()

    def request(self, relay, body=None, token='fixture-token'):
        conn = http.client.HTTPConnection('127.0.0.1', relay.server.server_address[1], timeout=5)
        try:
            conn.request('POST', '/v1/chat/completions', self.payload if body is None else body,
                         {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    def start(self, **kwargs):
        relay = Relay('fixture-token', **kwargs)
        relay.start(); self.addCleanup(relay.close)
        return relay

    def test_injected_errors_never_construct_https_and_stop_after_one_request(self):
        for status in (401, 429):
            relay = self.start(fault_status=status)
            with patch('deepseek_relay.http.client.HTTPSConnection', side_effect=AssertionError('external connection forbidden')) as https:
                code, _ = self.request(relay)
                self.assertEqual(code, status)
                self.assertEqual(self.request(relay)[0], 400)
                https.assert_not_called()
            self.assertEqual(relay.external_requests, 0)
            self.assertEqual(relay.client_requests, 2)
            self.assertEqual(len(relay.records), 1)
            self.assertEqual(relay.records[0]['origin'], 'injected_loopback')
            self.assertTrue(relay.budget.stopped)

    def test_fault_injection_rejects_any_real_key_and_unknown_status(self):
        for status, key in ((401, 'fake-key'), (429, ''), (200, None), ('401', None), (True, None)):
            with self.assertRaises(ValueError):
                Relay('token', key, fault_status=status)

    def test_held_request_never_connects_upstream_and_blocks_concurrent_request(self):
        relay = self.start(hold_request=True)
        errors = []
        def request():
            try:
                self.request(relay)
            except http.client.RemoteDisconnected:
                errors.append('closed_without_response')
        with patch('deepseek_relay.http.client.HTTPSConnection', side_effect=AssertionError('external forbidden')) as https:
            worker = threading.Thread(target=request)
            worker.start()
            try:
                self.assertTrue(relay.request_held.wait(3))
                self.assertTrue(worker.is_alive())
                self.assertEqual(self.request(relay)[0], 400)
                self.assertEqual(relay.external_requests, 0)
                self.assertEqual(relay.records[0]['origin'], 'held_loopback')
            finally:
                relay.release_request.set(); worker.join(3)
            https.assert_not_called()
        self.assertFalse(worker.is_alive())
        self.assertEqual(errors, ['closed_without_response'])
        self.assertEqual(relay.records[0]['status'], 'interrupted')
        self.assertTrue(relay.budget.stopped)

    def test_held_request_cannot_mix_credentials_or_http_fault(self):
        for options in ({'api_key':'key'}, {'api_key':''}, {'fault_status':401}):
            with self.assertRaises(ValueError):
                Relay('token', hold_request=True, **options)

    def test_auth_and_payload_validation_precede_injection(self):
        relay = self.start(fault_status=401)
        self.assertEqual(self.request(relay, token='wrong')[0], 401)
        self.assertEqual(relay.client_requests, 0)
        self.assertEqual(self.request(relay, body=b'{}')[0], 400)
        self.assertEqual(relay.records, [])
        self.assertEqual(relay.external_requests, 0)

    def test_startup_gate_still_refuses_model_requests(self):
        relay = self.start()
        with patch('deepseek_relay.http.client.HTTPSConnection') as https:
            self.assertEqual(self.request(relay)[0], 403)
            https.assert_not_called()
        self.assertEqual(relay.records, [])

    def test_upstream_errors_preserve_code_but_never_expose_body_or_key(self):
        for status, expected in ((401, 401), (429, 429), (500, 502)):
            relay = self.start(api_key='private-fixture-key')
            with patch('deepseek_relay.http.client.HTTPSConnection') as https:
                response = https.return_value.getresponse.return_value
                response.status = status
                response.read.side_effect = AssertionError('must not read upstream error body')
                code, body = self.request(relay)
                self.assertEqual(code, expected)
                self.assertNotIn(b'private-fixture-key', body)
                self.assertEqual(self.request(relay)[0], 400)
                self.assertEqual(https.return_value.request.call_count, 1)
            self.assertEqual(relay.external_requests, 1)

    def test_successful_stream_path_is_unchanged(self):
        relay = self.start(api_key='private-fixture-key')
        with patch('deepseek_relay.http.client.HTTPSConnection') as https:
            response = https.return_value.getresponse.return_value
            response.status = 200
            response.__iter__.return_value = iter([
                b'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
                b'data: [DONE]\n\n'])
            code, body = self.request(relay)
        self.assertEqual(code, 200); self.assertIn(b'[DONE]', body)
        self.assertEqual(relay.records[0]['status'], 'completed')
        self.assertEqual(relay.records[0]['output_tokens'], 2)
        self.assertFalse(relay.budget.stopped)


if __name__ == '__main__':
    unittest.main()
