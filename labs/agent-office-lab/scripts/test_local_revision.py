import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import local_text_task as task
import office_console as console
import office_results as results


class RevisionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name).resolve();self.source=self.root/'project';self.source.mkdir()
        self.before='def add(a, b):\n    return a - b\n'
        self.after=b'def add(a, b):\n    return a + b\n'
        (self.source/'calc.py').write_text(self.before)
        self.data=task.request('project','Fix addition',task.snapshot(self.source),'calc.py')

    def test_receipt_target_schema_and_content_contract(self):
        self.assertEqual(self.data['schema'],2);self.assertEqual(task.validate_request(self.data),self.data)
        for change in [{'target':'../calc.py'},{'target':'absent.py'},{'target':None},{'schema':1},{'schema':True},{'extra':1}]:
            with self.assertRaises(ValueError):task.validate_request(dict(self.data,**change))
        workspace=self.root/'workspace';workspace.mkdir()
        prompt=task.prepare(workspace,self.data)
        self.assertIn('First read source/calc.py',prompt);self.assertIn('complete revised file content',prompt)
        parent=self.root/'state/console'/('a'*24);parent.mkdir(parents=True)
        receipt=parent/('b'*32+'.task.json');raw=task.encoded(self.data);receipt.write_bytes(raw)
        self.assertEqual(task.load_request(self.root,receipt,task.digest(raw)),self.data)

    def test_diff_is_recomputed_and_line_endings_are_explicit(self):
        change=task.revision(self.data,self.after)
        self.assertIn('-    return a - b',change['diff']);self.assertIn('+    return a + b',change['diff'])
        self.assertEqual(change['before_sha256'],task.digest(self.before.encode()))
        self.assertFalse(task.revision(self.data,self.before.encode())['changed'])
        endings=task.revision(self.data,self.before.rstrip().encode())
        self.assertTrue(endings['changed']);self.assertIn('line endings',endings['diff'])
        for output in [b'',b'\0bad',b'x'*65537,b'line\n'*4097]:
            with self.assertRaises(ValueError):task.revision(self.data,output)

    def test_project_listing_and_plan_reject_missing_changed_or_mixed_target(self):
        app=console.Console(self.root,projects=[self.source]);self.addCleanup(app.close)
        listing=app.project_files('project-1');self.assertEqual(listing['files'][0]['name'],'calc.py')
        self.assertNotIn('return',json.dumps(listing));self.assertNotIn(str(self.source),json.dumps(listing))
        selection={'provider':'opencode','mode':'revision','project':'project-1','prompt':'Fix addition','target':'calc.py'}
        plan=app.plan(selection);self.assertEqual(plan['plan']['task'],'local_revision')
        for change in [{'target':'unknown.py'},{'target':None},{'mode':'text'},{'provider':'pi'}]:
            with self.assertRaises(console.ConsoleError):app.plan(dict(selection,**change))
        with self.assertRaises(console.ConsoleError):app.project_files('../project')
        (self.source/'calc.py').write_text('changed')
        with patch('office_console.subprocess.Popen') as spawn:
            with self.assertRaisesRegex(console.ConsoleError,'plan_changed'):app.execute(plan['plan_id'])
            spawn.assert_not_called()

    def test_result_rechecks_original_receipt_output_and_metadata(self):
        run=self.root/'run';workspace=run/'workspace';workspace.mkdir(parents=True)
        task.prepare(workspace,self.data);(workspace/'output.md').write_bytes(self.after)
        (run/'text-task.json').write_bytes(task.encoded(self.data))
        change=task.revision(self.data,self.after);artifact=task.output(workspace)
        office={'model':'strata/local','status':'completed','cleanup_completed':True,'model_inference_verified':True,'text_task_completed':True,'artifact_sha256':artifact['sha256']}
        report={'harness':'office-opencode','model':'local','task':'local_revision','status':'completed','cleanup_errors':[],
                'office_result':office,'model_inference_verified':True,'source_snapshot_unchanged':True,'text_output':artifact,
                'text_task':{'source_snapshot_sha256':task.digest(task.encoded(self.data['files']))},
                'revision':{k:change[k] for k in ('target','before_sha256','after_sha256','changed')}}
        def read():
            (run/'result.json').write_text(json.dumps(report));fd=os.open(run,os.O_RDONLY|os.O_DIRECTORY)
            try:return results.normalize(fd,'local-work-revision')
            finally:os.close(fd)
        row=read();self.assertEqual(row['status'],'completed');self.assertEqual(row['artifact']['kind'],'revision')
        self.assertEqual(row['artifact']['name'],'calc.py');self.assertEqual(row['artifact']['diff'],change['diff'])
        self.assertTrue(row['content_review_required'])
        report['text_task']=None;self.assertEqual(read()['status'],'unverified')
        report['text_task']={'source_snapshot_sha256':task.digest(task.encoded(self.data['files']))}
        (workspace/'source/calc.py').write_text('tampered');self.assertEqual(read()['status'],'unverified')
        (workspace/'source/calc.py').unlink();(workspace/'source/calc.py').symlink_to(self.source/'calc.py');self.assertEqual(read()['status'],'unverified')
        (workspace/'source/calc.py').unlink();(workspace/'source/calc.py').write_text(self.before)
        report['revision']['target']='other.py';self.assertEqual(read()['status'],'unverified')
        report['revision']['target']='calc.py'
        (run/'text-task.json').write_text('{}');self.assertEqual(read()['status'],'unverified')


if __name__=='__main__':unittest.main()
