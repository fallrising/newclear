import copy
import json
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from unittest.mock import Mock

from fixtures import CASES, oracle
from mock_api import Handler
from pg_adapter import sql_text
from policy import classify, decide


class PolicyTests(unittest.TestCase):
    def test_synthetic_cases(self):
        for name, text, _, _, _, action, route in CASES:
            with self.subTest(name=name):
                result = classify(text, oracle)
                self.assertEqual((result['action'], result['route']), (action, route))
                self.assertFalse(result['dispatch_performed'])

    def test_bad_inputs_never_call_provider(self):
        for value in (None, 1, '', '  ', '\0', '台' * 1366, '\ud800'):
            evaluator = Mock(side_effect=AssertionError('must not call'))
            self.assertEqual(classify(value, evaluator)['action'], 'block')
            evaluator.assert_not_called()

    def test_exact_byte_limit(self):
        evaluator = Mock(return_value=oracle('你好'))
        self.assertEqual(classify('a' * 4096, evaluator)['action'], 'allow')
        self.assertEqual(evaluator.call_count, 1)
        self.assertEqual(classify('a' * 4097, evaluator)['action'], 'block')
        self.assertEqual(evaluator.call_count, 1)

    def test_risk_boundaries(self):
        for p, action in ((0, 'allow'), (0.3499, 'allow'), (0.35, 'review'),
                          (0.8499, 'review'), (0.85, 'block'), (1, 'block')):
            answer = oracle('你好'); answer['risk']['noul'] = p
            self.assertEqual(decide(answer)['action'], action)

    def test_invalid_probabilities_do_not_allow(self):
        for p in (-0.01, 1.01, True, None, '0.1', float('nan'), float('inf'), 10 ** 1000):
            answer = oracle('你好'); answer['risk']['noul'] = p
            self.assertEqual(decide(answer)['action'], 'review')

    def test_malformed_envelopes(self):
        for answer in (None, [], {}, {'risk': []}, {'risk': {'type': 'choice'}},
                       {'risk': {'type': 'noul', 'noul': 0.1}}):
            self.assertEqual(decide(answer)['action'], 'review')

    def test_invalid_routes(self):
        changes = [ {'choice': 'admin'}, {'probabilities': {'small': 1}},
                    {'probabilities': {'small': 1, 'coding': 1, 'reasoning': 1}},
                    {'probabilities': {'small': True, 'coding': 0, 'reasoning': 0}},
                    {'confidence': float('nan')}, {'choice': 'coding'}, {'type': 'noul'}]
        for change in changes:
            answer = copy.deepcopy(oracle('你好')); answer['route'].update(change)
            self.assertEqual(decide(answer)['action'], 'review')

    def test_safety_uncertainty_precedes_route(self):
        answer = oracle('你好'); answer['risk']['noul'] = 0.50
        self.assertEqual(decide(answer)['route'], None)
        self.assertEqual(decide(answer)['action'], 'review')

    def test_routing_fallback_is_not_safety_fallback(self):
        answer = oracle('你好'); answer['route']['confidence'] = 0.74
        self.assertEqual(decide(answer)['route'], 'reasoning')
        answer['risk']['noul'] = 0.85
        self.assertEqual(decide(answer)['action'], 'block')
        self.assertIsNone(decide(answer)['route'])

    def test_provider_error_is_redacted(self):
        for error in (OSError('sensitive upstream'), TimeoutError('sensitive upstream'), ValueError('sensitive')):
            result = classify('你好', Mock(side_effect=error))
            self.assertEqual(result['action'], 'review')
            self.assertNotIn('sensitive', json.dumps(result))

    def test_unknown_mock_input_requires_review(self):
        self.assertEqual(classify('未收錄的任意輸入', oracle)['action'], 'review')

    def test_sql_literal_cannot_inject(self):
        value = "'); DROP TABLE sentinel; --\n\\! echo bad"
        expression = sql_text(value)
        self.assertNotIn('DROP', expression)
        self.assertNotIn('\\!', expression)


class MockContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()

    def post(self, row, headers=None):
        c = HTTPConnection(*self.server.server_address, timeout=2)
        body = {'state': {'rows': [row]}, 'questions': {'r0': {'type': 'noul'}}}
        c.request('POST', '/v1/systemone', json.dumps(body), headers or {})
        response = c.getresponse(); status = response.status; data = json.loads(response.read()); c.close()
        return status, data

    def test_shape_and_projection(self):
        status, data = self.post({'text': '你好'})
        self.assertEqual(status, 200)
        self.assertEqual(data['answers']['r0']['noul'], 0.01)
        self.assertEqual(self.post({'text': '你好', 'expected': 'allow'})[0], 422)

    def test_no_credential_accepted(self):
        self.assertEqual(self.post({'text': '你好'}, {'Authorization': 'Bearer synthetic'})[0], 403)

    def test_missing_answers_fixture(self):
        self.assertEqual(self.post({'text': '[missing-answer]'})[1]['answers'], {})
