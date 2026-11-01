import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest

import office_results as results


class OfficeResultsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def make_run(self, provider='grok', name=None):
        name = name or ('local-work-test' if provider == 'opencode' else f'{provider}-work-test')
        run = self.root / name
        (run / 'workspace').mkdir(parents=True)
        (run / 'workspace/input.json').write_text(json.dumps({'marker': 'fixture', 'values': [7, 11, -2, 9]}))
        raw = b'{"marker":"fixture","total":25}\n'
        (run / 'workspace/result.json').write_bytes(raw)
        model = {'grok': 'grok-4.6', 'pi': 'deepseek-flash', 'cursor': 'composer-2.5', 'opencode': 'local-model'}[provider]
        office = {'status': 'completed', 'provider': provider,
                  'model': {'pi': 'deepseek/', 'opencode': 'strata/'}.get(provider, '') + model,
                  'artifact_sha256': hashlib.sha256(raw).hexdigest(), 'cleanup_completed': True,
                  'native_stop_verified': True, 'session_hook_verified': True, 'task_completed': True,
                  'native_model_selection_verified': True, 'file_task_passed': True,
                  'agent_settled_verified': True, 'office_native_status_verified': True,
                  'model_inference_verified': True, 'session': 'PRIVATE_SESSION', 'error': 'PRIVATE_ERROR'}
        report = {'status': 'completed', 'provider': provider, 'model': model,
                  'model_inference_verified': True, 'startup_only': False,
                  'cleanup_errors': [], 'copied_credentials_removed': True, 'elapsed_s': 18.1,
                  'office_result' if provider == 'opencode' else 'office': office,
                  'auth': 'PRIVATE_SECRET', 'url': 'PRIVATE_URL'}
        if provider == 'opencode':
            report['harness'] = 'office-opencode'
        (run / 'result.json').write_text(json.dumps(report))
        return run, report

    def read(self):
        return results.catalog([self.root])['runs']

    def test_four_provider_provenance_and_content(self):
        for provider in results.PROVIDERS:
            self.make_run(provider)
        rows = self.read()
        self.assertEqual({r['provider'] for r in rows}, set(results.PROVIDERS))
        self.assertTrue(all(r['status'] == 'completed' for r in rows))
        self.assertTrue(all(r['artifact']['content']['total'] == 25 for r in rows))
        self.assertEqual(next(r['model'] for r in rows if r['provider'] == 'pi'), 'deepseek/deepseek-flash')
        self.assertNotIn('PRIVATE', json.dumps(rows))
        self.assertNotIn(str(self.root), json.dumps(rows))

    def test_failure_stop_startup_and_incomplete_never_complete(self):
        for index, (status, startup, expected) in enumerate([
            ('failed', False, 'failed'), ('stopped', False, 'stopped'), ('cancelled', False, 'cancelled'),
            ('interrupted', False, 'stopped'), ('completed', True, 'startup_only'),
            ('starting', False, 'incomplete'),
        ]):
            run, report = self.make_run(name=f'grok-work-case{index}')
            report.update(status=status, startup_only=startup)
            (run / 'result.json').write_text(json.dumps(report))
            row = next(r for r in self.read() if r['id'].endswith(run.name))
            self.assertEqual(row['status'], expected)

    def test_missing_native_evidence_model_or_cleanup(self):
        for index, change in enumerate([
            lambda r: r.update(model_inference_verified=False),
            lambda r: r['office'].update(native_stop_verified=False),
            lambda r: r['office'].update(model='other-model'),
            lambda r: r['office'].update(provider='pi'),
            lambda r: r['office'].update(status='interrupted'),
            lambda r: r.update(cleanup_errors=['PRIVATE_ERROR']),
            lambda r: r.update(copied_credentials_removed=False),
        ]):
            run, report = self.make_run(name=f'grok-work-case{index}')
            change(report)
            (run / 'result.json').write_text(json.dumps(report))
        self.assertTrue(all(r['status'] == 'unverified' for r in self.read()))
        self.assertNotIn('PRIVATE', json.dumps(self.read()))

    def test_content_and_hash_tampering(self):
        for index, raw in enumerate([b'{"marker":"fixture","total":26}',
                                     b'{"marker": "fixture", "total": 25}']):
            run, _ = self.make_run(name=f'grok-work-case{index}')
            (run / 'workspace/result.json').write_bytes(raw)
        self.assertTrue(all(r['status'] == 'unverified' for r in self.read()))
        self.assertTrue(all('content' not in r['artifact'] for r in self.read()))

    def test_fault_acceptance_never_counts_as_successful_task(self):
        run, report = self.make_run('pi')
        (run / 'workspace/result.json').unlink()
        report['office']['native_error_verified'] = True
        report.update(status='failed', fault_injection={'source': 'loopback', 'http_status': 401}, failure_check_passed=True,
                      model_inference_verified=False, client_requests=1, external_requests=0, remaining_owned_processes=0)
        (run / 'result.json').write_text(json.dumps(report))
        row = self.read()[0]
        self.assertEqual(row['status'], 'failed')
        self.assertEqual(row['test_scenario'], 'injected_http_401')
        self.assertTrue(row['failure_check_passed'])
        del report['remaining_owned_processes']
        (run / 'result.json').write_text(json.dumps(report))
        self.assertFalse(self.read()[0]['failure_check_passed'])
        report['status'] = 'completed'
        (run / 'result.json').write_text(json.dumps(report))
        self.assertEqual(self.read()[0]['status'], 'unverified')
        self.assertFalse(self.read()[0]['failure_check_passed'])

    def test_malformed_fault_metadata_is_invalid_not_completed(self):
        run, report = self.make_run('pi')
        for fault in ('private', {'source':'loopback','http_status':200}, {'source':'loopback','http_status':401.0}, {'source':'remote','http_status':401}):
            report['fault_injection'] = fault
            (run / 'result.json').write_text(json.dumps(report))
            self.assertEqual(self.read()[0]['status'], 'invalid')

    def test_missing_artifact_or_report(self):
        run, _ = self.make_run()
        (run / 'workspace/result.json').unlink()
        self.assertEqual(self.read()[0]['artifact']['status'], 'unavailable')
        (run / 'result.json').unlink()
        self.assertEqual(self.read()[0]['status'], 'incomplete')

    def test_bad_report_types_duplicate_keys_nonfinite_and_oversize(self):
        run, _ = self.make_run()
        for raw in ('[]', '{', '{"status":"completed","status":"failed"}',
                    '{"elapsed_s":NaN}', ' ' * (2 * 1024 * 1024 + 1)):
            (run / 'result.json').write_text(raw)
            self.assertEqual(self.read()[0]['status'], 'invalid')

    def test_artifact_rejects_extra_fields_booleans_and_injection(self):
        run, report = self.make_run()
        for payload in ({'marker': 'fixture', 'total': 25, 'secret': 'PRIVATE'},
                        {'marker': '</script><script>alert(1)</script>', 'total': 25},
                        {'marker': 'fixture', 'total': True}):
            raw = json.dumps(payload).encode()
            (run / 'workspace/result.json').write_bytes(raw)
            report['office']['artifact_sha256'] = hashlib.sha256(raw).hexdigest()
            (run / 'result.json').write_text(json.dumps(report))
            self.assertEqual(self.read()[0]['status'], 'unverified')
            self.assertNotIn('content', self.read()[0]['artifact'])

    def test_directory_and_file_symlinks(self):
        run, _ = self.make_run()
        (self.root / 'grok-work-link').symlink_to(run, target_is_directory=True)
        self.assertEqual(next(r['status'] for r in self.read() if r['id'].endswith('link')), 'invalid')
        outside = self.root / 'private.json'
        outside.write_text('{"secret":"PRIVATE"}')
        for target in (run / 'result.json', run / 'workspace/result.json'):
            original = target.read_bytes()
            target.unlink(); target.symlink_to(outside)
            row = next(r for r in self.read() if r['id'].endswith('test'))
            self.assertNotEqual(row['status'], 'completed')
            self.assertNotIn('PRIVATE', json.dumps(row))
            target.unlink(); target.write_bytes(original)
        (run / 'workspace').rename(run / 'actual-workspace')
        (run / 'workspace').symlink_to(run / 'actual-workspace', target_is_directory=True)
        self.assertEqual(next(r for r in self.read() if r['id'].endswith('test'))['status'], 'unverified')

    def test_root_symlink_and_unavailable_root(self):
        link = self.root / 'link'; link.symlink_to(self.root, target_is_directory=True)
        for root in (link, self.root / 'missing'):
            with self.assertRaises(results.InvalidRun):
                results.catalog([root])

    def test_fifo_does_not_block(self):
        run, _ = self.make_run()
        (run / 'result.json').unlink(); os.mkfifo(run / 'result.json')
        self.assertEqual(self.read()[0]['status'], 'invalid')

    def test_malformed_optional_types_and_huge_elapsed_do_not_crash(self):
        run, report = self.make_run()
        report.update(elapsed_s=10**500, version={'bad': 'PRIVATE'})
        (run / 'result.json').write_text(json.dumps(report))
        self.assertEqual(self.read()[0]['status'], 'completed')
        self.assertIsNone(self.read()[0]['version'])
        self.assertNotIn('elapsed_seconds', self.read()[0])
        report['office'] = []
        (run / 'result.json').write_text(json.dumps(report))
        self.assertEqual(self.read()[0]['status'], 'invalid')

    def test_multiple_roots_have_distinct_ids(self):
        self.make_run()
        rows = results.catalog([self.root, self.root])['runs']
        self.assertEqual(len({r['id'] for r in rows}), 2)

    def test_html_escapes_script_terminators(self):
        html = results.render_html({'runs': [{'model': '</script><script>alert(1)</script>'}]})
        self.assertNotIn('</script><script>alert(1)', html)
        self.assertIn('\\u003c/script\\u003e', html)

    def test_cli_filters_invalid_id_and_exclusive_private_output(self):
        self.make_run()
        output = self.root / 'snapshot.html'
        args = ['--runs-root', str(self.root)]
        with contextlib.redirect_stdout(io.StringIO()) as stdout:
            self.assertEqual(results.main(args + ['--provider', 'grok', '--show', '1:grok-work-test']), 0)
            self.assertEqual(len(json.loads(stdout.getvalue())['runs']), 1)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(results.main(args + ['--show', '../../private']), 1)
            self.assertEqual(results.main(args + ['--html', str(output)]), 0)
            original = output.read_bytes()
            self.assertEqual(results.main(args + ['--html', str(output)]), 1)
            self.assertEqual(output.read_bytes(), original)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)

    def test_unrelated_names_and_credentials_are_not_scanned(self):
        (self.root / 'auth.json').write_text('PRIVATE')
        (self.root / 'unrelated').mkdir()
        (self.root / 'unrelated/result.json').write_text('PRIVATE')
        self.assertEqual(self.read(), [])


if __name__ == '__main__':
    unittest.main()
