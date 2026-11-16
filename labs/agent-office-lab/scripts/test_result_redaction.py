import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest

import local_text_task
import office_results
import result_redaction as redaction


SECRET_A = 'SYNTHSECRET_0123456789abcdef'
SECRET_B = 'SYNTHSECRET_fedcba9876543210'


class ResultRedactionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def make_fixture_run(self, name='grok-work-test', marker='fixture', status='completed'):
        run = self.root / name
        (run / 'workspace').mkdir(parents=True)
        values = [2, 3]
        (run / 'workspace/input.json').write_text(json.dumps({'marker': marker, 'values': values}))
        raw = json.dumps({'marker': marker, 'total': sum(values)}, separators=(',', ':')).encode() + b'\n'
        (run / 'workspace/result.json').write_bytes(raw)
        office = {'status': 'completed', 'provider': 'grok', 'model': 'grok-4.6',
                  'artifact_sha256': hashlib.sha256(raw).hexdigest(), 'cleanup_completed': True,
                  'native_stop_verified': True, 'session_hook_verified': True,
                  'task_completed': True, 'native_model_selection_verified': True}
        report = {'status': status, 'provider': 'grok', 'model': 'grok-4.6',
                  'model_inference_verified': True, 'startup_only': False,
                  'cleanup_errors': [], 'copied_credentials_removed': True, 'office': office}
        (run / 'result.json').write_text(json.dumps(report))
        return run, report, raw

    def catalog_rows(self):
        return office_results.catalog([self.root])['runs']

    def test_helpers_regex_boundaries_surrogates_crlf_and_key_collision(self):
        for value in ('SYNTHSECRET_0123456789abcde', 'SYNTHSECRET_0123456789abcdef0',
                      'synthsecret_0123456789abcdef', 'SYNTHSECRET_0123456789ABCDEF',
                      'A' + SECRET_A, SECRET_A + '0'):
            self.assertEqual(redaction.redact(value), value)
        for boundary in ('', '_', '-', '.', '/', ' ', '\r\n'):
            self.assertEqual(redaction.redact(boundary + SECRET_A + boundary),
                             boundary + redaction.REDACTED + boundary)
        self.assertEqual(redaction.redact_tree({SECRET_A: [SECRET_B]}),
                         {redaction.REDACTED: [redaction.REDACTED]})
        text = 'xSYNTHSECRET_0123456789abcdef ' + SECRET_A + '\r\n' + SECRET_B + 'Z'
        self.assertIn('xSYNTHSECRET_0123456789abcdef', redaction.redact(text))
        self.assertIn(SECRET_B + 'Z', redaction.redact(text))
        self.assertIn('SYNTHSECRET_REDACTED\r\n', redaction.redact(text))
        self.assertEqual(redaction.redact('\ud83d\ude00 \ud800 ' + SECRET_A), '😀 � SYNTHSECRET_REDACTED')
        with self.assertRaises(redaction.RedactionError):
            redaction.redact_tree({SECRET_A: 1, 'SYNTHSECRET_REDACTED': 2})
        digest = redaction.display_sha256('\ud800' + SECRET_A)
        self.assertEqual(digest, hashlib.sha256('�SYNTHSECRET_REDACTED'.encode()).hexdigest())

    def test_catalog_projects_fixture_content_ref_export_and_html_defense(self):
        name = 'grok-work-' + SECRET_A
        self.make_fixture_run(name=name, marker=SECRET_A)
        row = self.catalog_rows()[0]
        self.assertEqual(row['status'], 'completed')
        self.assertEqual(row['id'], '1:grok-work-SYNTHSECRET_REDACTED')
        self.assertTrue(row['id_redacted'])
        self.assertEqual(row['root'], 1)
        self.assertEqual(row['ref'], redaction.make_ref(1, name))
        self.assertEqual(row['artifact']['content']['marker'], 'SYNTHSECRET_REDACTED')
        self.assertTrue(row['artifact']['redacted'])
        self.assertTrue(row['artifact']['export_canonical'])
        expected_export = json.dumps(row['artifact']['content'], sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n'
        self.assertEqual(row['artifact']['export_text'], expected_export)
        self.assertEqual(row['artifact']['display_sha256'], hashlib.sha256(expected_export.encode()).hexdigest())
        self.assertNotIn('SYNTHSECRET_0123456789abcdef', json.dumps(row, ensure_ascii=True))
        html = office_results.render_html({'runs': [dict(row, extra='</script>&' + SECRET_B)]})
        self.assertNotIn('</script>&', html)
        self.assertNotIn(SECRET_B, html)
        self.assertIn('\\u003c/script\\u003e', html)

    def test_project_row_does_not_trust_flags_and_is_idempotent(self):
        raw = {'id': '1:grok-work-' + SECRET_A, 'provider': 'grok', 'model': SECRET_A,
               'version': None, 'status': 'completed', 'cleanup_verified': True,
               'artifact': {'status': 'verified', 'content': {'marker': SECRET_A, 'total': 1}, 'redacted': False},
               'retry': {'root': 'pi-work-' + SECRET_A, 'parent': 'pi-work-' + SECRET_B, 'attempt': 1, 'private': SECRET_A},
               'redaction': {'policy': 'synthetic-v1', 'applied': False}}
        once = redaction.project_row(raw)
        twice = redaction.project_row(once)
        self.assertEqual(once, twice)
        self.assertTrue(once['artifact']['redacted'])
        self.assertTrue(once['redaction']['applied'])
        self.assertEqual(once['model'], 'SYNTHSECRET_REDACTED')
        self.assertEqual(once['ref'], redaction.make_ref(1, 'grok-work-' + SECRET_A))
        self.assertEqual(set(once['retry']), {'root', 'root_ref', 'parent', 'parent_ref', 'attempt'})
        self.assertEqual(once['retry']['root_ref'], redaction.make_ref(1, 'pi-work-' + SECRET_A))
        self.assertEqual(once['retry']['parent'], 'pi-work-SYNTHSECRET_REDACTED')
        self.assertNotIn(SECRET_A, json.dumps(once))
        self.assertNotIn(SECRET_B, json.dumps(once))

    def test_actual_normalize_tamper_and_failure_rows_are_projected_after_verification(self):
        run, report, raw = self.make_fixture_run(marker=SECRET_A, status='failed')
        (run / 'workspace/result.json').write_bytes(json.dumps({'marker': SECRET_A, 'total': 99}).encode())
        fd = os.open(run, os.O_RDONLY | os.O_DIRECTORY)
        try:
            row = office_results.normalize(fd, '1:grok-work-test')
        finally:
            os.close(fd)
        self.assertEqual(row['status'], 'failed')
        self.assertEqual(row['artifact']['status'], 'unverified')
        self.assertNotIn('content', row['artifact'])
        self.assertNotIn(SECRET_A, json.dumps(row))

        report['status'] = 'completed'
        (run / 'workspace/result.json').write_bytes(raw)
        report['office']['artifact_sha256'] = '0' * 64
        (run / 'result.json').write_text(json.dumps(report))
        self.assertEqual(self.catalog_rows()[0]['status'], 'unverified')

    def test_display_diff_recomputed_and_line_endings_preserved(self):
        for before, after in [('safe café\r\n'+SECRET_A, 'safe 😀\r\n'+SECRET_B), ('same\n', 'same\r\n')]:
            raw = {'id': 'plain', 'status': 'completed', 'artifact': {
                'kind': 'revision', 'status': 'verified', 'original': before, 'text': after,
                'target': SECRET_A+'.py', 'changed': True, 'diff': 'untrusted old diff'}}
            row = redaction.project_row(raw)
            artifact = row['artifact']
            self.assertTrue(artifact['display_changed'])
            self.assertNotIn('untrusted', artifact['diff'])
            self.assertNotIn(SECRET_A, artifact['diff'])
            self.assertEqual(artifact['text'], redaction.redact(after))
            self.assertEqual(artifact['display_diff_sha256'], hashlib.sha256(artifact['diff'].encode()).hexdigest())
            self.assertEqual(redaction.project_row(row), row)
        self.assertEqual(artifact['diff'], 'Only line endings or the final newline changed.')

    def test_revision_secret_only_change_recomputes_display_diff_and_preserves_raw_hashes(self):
        source = self.root / 'project'
        source.mkdir()
        before = 'token=' + SECRET_A + '\n'
        after = ('token=' + SECRET_B + '\n').encode()
        (source / 'note.md').write_text(before)
        receipt = local_text_task.request('project', 'rotate synthetic', local_text_task.snapshot(source), 'note.md')
        run = self.root / 'local-work-revision'
        workspace = run / 'workspace'
        workspace.mkdir(parents=True)
        local_text_task.prepare(workspace, receipt)
        (workspace / 'output.md').write_bytes(after)
        (run / 'text-task.json').write_bytes(local_text_task.encoded(receipt))
        artifact = local_text_task.output(workspace)
        change = local_text_task.revision(receipt, after)
        office = {'model': 'strata/local', 'status': 'completed', 'cleanup_completed': True,
                  'model_inference_verified': True, 'text_task_completed': True,
                  'artifact_sha256': artifact['sha256']}
        report = {'harness': 'office-opencode', 'provider': 'opencode', 'model': 'local',
                  'task': 'local_revision', 'status': 'completed', 'cleanup_errors': [],
                  'office_result': office, 'model_inference_verified': True,
                  'source_snapshot_unchanged': True, 'text_output': artifact,
                  'text_task': {'source_snapshot_sha256': local_text_task.digest(local_text_task.encoded(receipt['files']))},
                  'revision': {k: change[k] for k in ('target', 'before_sha256', 'after_sha256', 'changed')}}
        (run / 'result.json').write_text(json.dumps(report))
        row = self.catalog_rows()[0]
        art = row['artifact']
        self.assertEqual(row['status'], 'completed')
        self.assertEqual(art['before_sha256'], hashlib.sha256(before.encode()).hexdigest())
        self.assertTrue(art['changed'])
        self.assertFalse(art['display_changed'])
        self.assertEqual(art['diff'], '')
        self.assertEqual(art['original'], 'token=SYNTHSECRET_REDACTED\n')
        self.assertEqual(art['text'], 'token=SYNTHSECRET_REDACTED\n')
        self.assertEqual(art['display_original_sha256'], hashlib.sha256(art['original'].encode()).hexdigest())
        self.assertNotIn(SECRET_A, json.dumps(row))
        self.assertNotIn(SECRET_B, json.dumps(row))

    def test_fallback_for_redaction_collision_hides_success_and_raw_values(self):
        row = redaction.project_row({'id': 'plain', 'status': 'completed', 'provider': 'grok',
                                     'artifact': {'status': 'verified', 'content': {SECRET_A: 1, 'SYNTHSECRET_REDACTED': 2}}})
        self.assertEqual(row['status'], 'invalid')
        self.assertEqual(row['reason'], 'redaction_failed')
        self.assertEqual(row['artifact'], {'status': 'unavailable'})
        self.assertNotIn(SECRET_A, json.dumps(row))

    def test_literal_replacement_name_is_not_mistaken_for_projected_identity(self):
        name = 'local-work-SYNTHSECRET_REDACTED'
        row = redaction.project_row({'id': '1:' + name, 'status': 'failed'})
        self.assertFalse(row['id_redacted'])
        self.assertEqual(row['ref'], redaction.make_ref(1, name))
        self.assertEqual(redaction.project_row(row), row)

    def test_inconsistent_revision_fails_closed_instead_of_hiding_display_change(self):
        row = redaction.project_row({'id': 'plain', 'status': 'completed', 'artifact': {
            'status': 'verified', 'kind': 'revision', 'original': 'old', 'text': 'new', 'changed': False}})
        self.assertEqual(row['reason'], 'redaction_failed')
        self.assertEqual(row['status'], 'invalid')
        self.assertEqual(redaction.project_row(row), row)


if __name__ == '__main__':
    unittest.main()
