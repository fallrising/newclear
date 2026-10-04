"""Real Postgres/PLPython/pg-jev -> HTTP fixture -> Python policy tests."""
import json
import time
import unittest
from fixtures import CASES
from pg_adapter import SETTINGS, evaluate, psql, sql_text
from policy import RISK_CONDITION, classify


class ExtensionIntegrationTests(unittest.TestCase):
    def test_version_and_unprivileged_client(self):
        self.assertEqual(psql('SELECT jev_version();'), ['0.2.1'])
        self.assertEqual(psql("SELECT rolsuper FROM pg_roles WHERE rolname=current_user;"), ['f'])

    def test_all_synthetic_cases_through_extension(self):
        for name, text, _, _, _, action, route in CASES:
            with self.subTest(case=name):
                result = classify(text, evaluate)
                self.assertEqual((result['action'], result['route']), (action, route))
        self.assertEqual(psql('SELECT count(*) FROM lab_sentinel;'), ['1'])

    def test_errors_are_review_not_allow(self):
        for text in ('[http-error]', '[missing-answer]', '[invalid-answer]', '[timeout]'):
            with self.subTest(text=text):
                start = time.monotonic()
                result = classify(text, evaluate)
                self.assertEqual(result['action'], 'review')
                self.assertIsNone(result['route'])
                self.assertLess(time.monotonic() - start, 9)

    def test_unknown_input_is_uncertain(self):
        self.assertEqual(classify('not in oracle', evaluate)['action'], 'review')

    def test_same_session_cache(self):
        query = "SELECT jev_prob(m, %s) FROM (SELECT '你好'::text AS text OFFSET 0) m;" % sql_text(RISK_CONDITION)
        lines = psql(SETTINGS + query + 'SELECT jev_stats();' + query + 'SELECT jev_stats();')
        before, after = json.loads(lines[1]), json.loads(lines[3])
        self.assertEqual(before['requests'], 1)
        self.assertEqual(after['requests'], before['requests'])
        self.assertGreater(after['cache_hits'], before['cache_hits'])
        print('CACHE', json.dumps({'requests_before': before['requests'], 'requests_after': after['requests'],
                                   'cache_hits': after['cache_hits']}))

    def test_batch_table_and_budget(self):
        values = ','.join('(%s)' % sql_text(c[1]) for c in CASES)
        setup = SETTINGS + "SET jev.batch_size='20'; SET jev.max_rows_per_statement='20';"
        setup += 'CREATE TEMP TABLE batch(text text); INSERT INTO batch VALUES ' + values + ';'
        sql = setup + 'SELECT jev_prob(b, %s) FROM batch b;' % sql_text(RISK_CONDITION)
        lines = psql(sql + 'SELECT jev_stats();')
        self.assertEqual(sorted(map(float, lines[:-1])), sorted(c[2] for c in CASES))
        stats = json.loads(lines[-1])
        self.assertEqual(stats['rows_evaluated'], len(CASES))
        self.assertLess(stats['requests'], len(CASES))
        print('BATCH', json.dumps({'rows': stats['rows_evaluated'], 'requests': stats['requests']}))
        with self.assertRaises(OSError):
            psql(setup + "SET jev.max_rows_per_statement='1';" +
                 'SELECT jev_prob(b, %s) FROM batch b;' % sql_text(RISK_CONDITION))
