import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import local_text_task as task
import office_console as console
import office_dispatch as dispatch
import office_results as results
import local_opencode


class TextTaskTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name).resolve();self.source=self.root/'notes';self.source.mkdir()
        (self.source/'brief.md').write_text('Owner supplied source\n')

    def test_snapshot_receipt_and_source_preservation(self):
        (self.source/'.env').write_text('excluded')
        (self.source/'ignored.bin').write_bytes(b'\0')
        files=task.snapshot(self.source);self.assertEqual(files,{'brief.md':'Owner supplied source\n'})
        data=task.request('notes','Summarize this',files)
        workspace=self.root/'workspace';workspace.mkdir();prompt=task.prepare(workspace,data)
        self.assertIn('Summarize this',prompt);self.assertTrue(task.sources_unchanged(workspace,data))
        (workspace/'output.md').write_text('A summary\n');self.assertEqual(task.output(workspace)['name'],'output.md')
        (workspace/'source/brief.md').write_text('changed');self.assertFalse(task.sources_unchanged(workspace,data))
        self.assertEqual(task.snapshot(self.source),files)
        parent=self.root/'state/console'/('a'*24);parent.mkdir(parents=True)
        receipt=parent/('b'*32+'.task.json');raw=task.encoded(data);receipt.write_bytes(raw)
        self.assertEqual(task.load_request(self.root,receipt,task.digest(raw)),data)
        receipt.write_text('{}')
        with self.assertRaises(ValueError):task.load_request(self.root,receipt,task.digest(raw))

    def test_links_special_files_limits_and_paths_fail_closed(self):
        for name in ['../secret.md','/secret.md','a/../secret.md','.env','a//b.md','a\\b.md']:
            with self.assertRaises(ValueError):task.relative(name)
        link=self.source/'linked.md';link.symlink_to(self.source/'brief.md')
        with self.assertRaises(ValueError):task.snapshot(self.source)
        link.unlink();os.mkfifo(link)
        with self.assertRaises(ValueError):task.snapshot(self.source)
        link.unlink();link.write_text('x'*(task.MAX_FILE+1))
        with self.assertRaises(ValueError):task.snapshot(self.source)
        link.unlink();alias=self.root/'alias';alias.symlink_to(self.source)
        with self.assertRaises(OSError):task.snapshot(alias)
        for prompt in ['', 'x'*2001, '\0bad']:
            with self.assertRaises(ValueError):task.request('notes',prompt,{'a.md':'text'})
        for i in range(16):(self.source/f'{i}.txt').write_text('small')
        with self.assertRaises(ValueError):task.snapshot(self.source)

    def test_console_registered_project_and_stale_plan(self):
        app=console.Console(self.root,projects=[self.source]);self.addCleanup(app.close)
        selection={'provider':'opencode','mode':'text','project':'project-1','prompt':'Read brief.md and write a summary'}
        plan=app.plan(selection);self.assertTrue(plan['executable']);self.assertNotIn('command',plan['plan'])
        self.assertNotIn(str(self.source),json.dumps(app.snapshot()))
        (self.source/'brief.md').write_text('changed')
        with patch('office_console.subprocess.Popen') as spawn:
            with self.assertRaisesRegex(console.ConsoleError,'plan_changed'):app.execute(plan['plan_id'])
            spawn.assert_not_called()
        for update in [{'provider':'grok'},{'project':'../notes'},{'path':str(self.source)}]:
            with self.assertRaises(console.ConsoleError):app.plan(dict(selection,**update))
        plan=app.plan(selection)
        with patch('office_console.subprocess.Popen') as spawn,patch('office_console.threading.Thread'):
            app.execute(plan['plan_id']);args=spawn.call_args.args[0]
            self.assertEqual(args[2],'local-text');self.assertNotIn(selection['prompt'],args)
            request_path=Path(args[args.index('--request')+1]);sha=args[args.index('--sha256')+1]
            self.assertEqual(task.load_request(self.root,request_path,sha)['prompt'],selection['prompt'])
            with self.assertRaises(console.ConsoleError):app.execute(plan['plan_id'])
            app.active=None

    def test_text_config_isolates_home_and_denies_shell(self):
        fake=self.root/'lab';(fake/'configs').mkdir(parents=True)
        source=Path(local_opencode.LAB)/'configs/opencode-strata-local.json'
        (fake/'configs/opencode-strata-local.json').write_bytes(source.read_bytes())
        sdk=fake/'tools/opencode-plugin';(sdk/'node_modules').mkdir(parents=True)
        for name in ['package.json','package-lock.json']:(sdk/name).write_text('{}')
        run=self.root/'run';workspace=run/'workspace';workspace.mkdir(parents=True)
        (run/'text-task.json').write_text('{}');worker=run/'worker';worker.mkdir()
        with patch.object(local_opencode,'LAB',fake):
            _,env=local_opencode.prepare(worker,workspace)
        config=json.loads((worker/'opencode.json').read_text())
        self.assertEqual(config['permission'],{'*':'deny','read':'allow','edit':'allow'})
        self.assertEqual(Path(env['HOME']),worker/'home')
        self.assertIn('local_text_boundary.mjs',config['plugin'][0])
        self.assertIn('(deny file-write* (subpath ',(worker/'opencode.sb').read_text())
        self.assertFalse(config['compaction']['auto'])

    def test_dispatch_rechecks_receipt_before_any_probe(self):
        with patch('office_dispatch.detect') as detect:
            with self.assertRaises((ValueError,OSError)):dispatch.launch_text_task(self.root/'bad','a'*64,self.root)
            detect.assert_not_called()

    def test_text_result_requires_native_model_hash_and_cleanup(self):
        run=self.root/'run';(run/'workspace').mkdir(parents=True)
        (run/'workspace/output.md').write_text('<script>plain text</script>\n')
        artifact=task.output(run/'workspace')
        office={'model':'strata/local','status':'completed','cleanup_completed':True,'model_inference_verified':True,'text_task_completed':True,'artifact_sha256':artifact['sha256']}
        report={'harness':'office-opencode','model':'local','task':'local_text','status':'completed','cleanup_errors':[],
                'office_result':office,'model_inference_verified':True,'source_snapshot_unchanged':True,'text_output':artifact}
        def read():
            (run/'result.json').write_text(json.dumps(report));fd=os.open(run,os.O_RDONLY|os.O_DIRECTORY)
            try:return results.normalize(fd,'local-work-test')
            finally:os.close(fd)
        row=read();self.assertEqual(row['status'],'completed');self.assertTrue(row['content_review_required']);self.assertEqual(row['artifact']['text'],'<script>plain text</script>\n')
        report['cleanup_errors']=['remaining'];self.assertEqual(read()['status'],'unverified');report['cleanup_errors']=[]
        report['source_snapshot_unchanged']=False;self.assertEqual(read()['status'],'unverified');report['source_snapshot_unchanged']=True
        (run/'workspace/output.md').write_text('tampered');self.assertEqual(read()['artifact']['status'],'unverified')
        (run/'workspace/output.md').unlink();(run/'workspace/output.md').symlink_to(self.source/'brief.md')
        self.assertEqual(read()['artifact']['status'],'unverified')


if __name__=='__main__':unittest.main()
