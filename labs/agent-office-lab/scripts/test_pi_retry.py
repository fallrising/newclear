import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import execution_slot as slots
import office_dispatch as dispatch
import office_results as results
import pi_retry as retry


class RetryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.lab = Path(self.tmp.name); (self.lab/'runs').mkdir()
        self.fixture = {'marker':'fixture','values':[7,11,-2,9]}
        self.fingerprint = patch.object(retry, 'fingerprint', return_value='a'*64)
        self.fingerprint.start(); self.addCleanup(self.fingerprint.stop)

    def attempt(self, name, parent=None, mode='http_401', finish=True):
        out = self.lab/'runs'/name; out.mkdir(mode=0o700)
        with slots.execution_slot(self.lab) as slot:
            if parent: slot.select_retry(parent)
            meta, fixture = retry.register(self.lab, out, mode, dict(self.fixture, marker='fresh' if parent else 'fixture'))
        (out/'workspace').mkdir()
        (out/'workspace/input.json').write_text(json.dumps(fixture))
        if finish: self.report(out, mode)
        return out, meta

    def report(self, out, mode='http_401'):
        value = {'provider':'pi','status':'failed','model':'deepseek-flash','startup_only':False,
                 'model_inference_verified':False,'cleanup_errors':[],'remaining_owned_processes':0,
                 'office':{'provider':'pi','model':'deepseek/deepseek-flash','status':'failed','cleanup_completed':True}}
        if mode.startswith('http_'): value['fault_injection']={'source':'loopback','http_status':int(mode[5:])}
        if mode=='crash': value['crash_injection']={'source':'owned_cli','signal':'SIGKILL'}
        (out/'result.json').write_text(json.dumps(value)); return value

    def edit(self, path, **change):
        d=json.loads(path.read_text());d.update(change);path.write_text(json.dumps(d))

    def test_two_explicit_retries_preserve_fixture_and_reject_third_or_branch(self):
        root,_=self.attempt('pi-work-root'); original=(root/'result.json').read_bytes()
        first,meta=self.attempt('pi-work-first',root.name)
        self.assertEqual(meta['attempt'],1);self.assertEqual(meta['parent'],root.name)
        self.assertEqual(json.loads((first/'workspace/input.json').read_text()),self.fixture)
        with self.assertRaisesRegex(slots.SlotError,'latest'):retry.inspect(self.lab,root.name)
        last,meta=self.attempt('pi-work-last',first.name)
        self.assertEqual(meta['attempt'],2)
        with self.assertRaisesRegex(slots.SlotError,'retry_limit_reached'):retry.inspect(self.lab,last.name)
        self.assertEqual((root/'result.json').read_bytes(),original)
        self.assertEqual(json.loads((root/'attempts.json').read_text())['runs'],[root.name,first.name,last.name])
        rows=results.catalog([self.lab/'runs'])['runs']
        self.assertEqual({r['retry']['attempt'] for r in rows},{0,1,2})
        self.assertTrue(all(r['status']=='failed' for r in rows))

    def test_incomplete_child_blocks_parent_branch_and_cannot_retry(self):
        root,_=self.attempt('pi-work-root');child,_=self.attempt('pi-work-child',root.name,finish=False)
        with self.assertRaisesRegex(slots.SlotError,'latest'):retry.inspect(self.lab,root.name)
        with self.assertRaises(slots.SlotError):retry.inspect(self.lab,child.name)

    def test_success_startup_unknown_and_incomplete_cleanup_cannot_retry(self):
        out,_=self.attempt('pi-work-root',mode='task')
        for changes in ({'status':'completed'},{'status':'cancelled'},{'status':'interrupted'},
                        {'startup_only':True},{'remaining_owned_processes':1},{'remaining_owned_processes':False},
                        {'cleanup_errors':['unknown']}):
            self.report(out,'task');self.edit(out/'result.json',**changes)
            with self.assertRaisesRegex(slots.SlotError,'clean_failed'):retry.inspect(self.lab,out.name)

    def test_source_mode_fixture_and_lineage_changes_are_rejected(self):
        out,_=self.attempt('pi-work-root')
        with patch.object(retry,'fingerprint',return_value='b'*64):
            with self.assertRaisesRegex(slots.SlotError,'source_changed'):retry.inspect(self.lab,out.name)
        self.report(out,'http_429')
        with self.assertRaisesRegex(slots.SlotError,'mode_mismatch'):retry.inspect(self.lab,out.name)
        self.report(out)
        self.edit(out/'workspace/input.json',marker='changed')
        with self.assertRaisesRegex(slots.SlotError,'fixture_changed'):retry.inspect(self.lab,out.name)
        (out/'workspace/input.json').write_text(json.dumps(self.fixture))
        self.edit(out/'attempts.json',runs=[out.name,out.name])
        with self.assertRaisesRegex(slots.SlotError,'invalid_retry_history'):retry.inspect(self.lab,out.name)

    def test_path_links_legacy_and_malformed_records_rejected(self):
        out,_=self.attempt('pi-work-root')
        for name in ('../pi-work-root','1:pi-work-root','/tmp/pi-work-root'):
            with self.assertRaises(slots.SlotError):retry.inspect(self.lab,name)
        (self.lab/'runs/pi-work-link').symlink_to(out,target_is_directory=True)
        with self.assertRaises(slots.SlotError):retry.inspect(self.lab,'pi-work-link')
        original=(out/'attempt.json').read_text()
        for raw in ('{}','[]','{"schema":1,"schema":1}',original.replace('"attempt": 0','"attempt": true')):
            (out/'attempt.json').write_text(raw)
            with self.assertRaises(slots.SlotError):retry.inspect(self.lab,out.name)
        (out/'attempt.json').unlink();(out/'attempt.json').symlink_to(out/'result.json')
        with self.assertRaises(slots.SlotError):retry.inspect(self.lab,out.name)
        (out/'attempt.json').unlink()
        with self.assertRaises(slots.SlotError):retry.inspect(self.lab,out.name)

    def test_register_requires_slot_and_matching_mode(self):
        root,_=self.attempt('pi-work-root');out=self.lab/'runs/pi-work-child';out.mkdir(mode=0o700)
        with self.assertRaisesRegex(slots.SlotError,'execution_slot'):retry.register(self.lab,out,'task',self.fixture)
        with slots.execution_slot(self.lab) as slot:
            slot.select_retry(root.name)
            with self.assertRaisesRegex(slots.SlotError,'mode_mismatch'):retry.register(self.lab,out,'task',self.fixture)
        self.assertFalse((out/'attempt.json').exists())

    def test_acknowledgement_does_not_reset_retry_count(self):
        root,_=self.attempt('pi-work-root')
        first,_=self.attempt('pi-work-first',root.name)
        last,_=self.attempt('pi-work-last',first.name)
        with slots.execution_slot(self.lab): slots.mark_started()
        self.assertTrue(slots.acknowledge_stopped(self.lab))
        with self.assertRaisesRegex(slots.SlotError,'retry_limit_reached'): retry.inspect(self.lab,last.name)

    def test_stale_preview_is_rechecked_before_preflight_or_exec(self):
        root,_=self.attempt('pi-work-root')
        _,options=dispatch.retry_plan(root.name,self.lab)
        self.attempt('pi-work-child',root.name)
        with patch.object(dispatch,'detect') as detect, patch.object(os,'execve') as execute:
            with self.assertRaisesRegex(slots.SlotError,'latest'):
                dispatch.launch('pi',False,self.lab,retry_parent=root.name,**options)
            detect.assert_not_called();execute.assert_not_called()

    def test_invalid_receipt_cannot_be_displayed_as_success(self):
        root,_=self.attempt('pi-work-root',mode='task')
        self.edit(root/'result.json',status='completed')
        self.edit(root/'attempt.json',attempt=True)
        row=results.catalog([self.lab/'runs'])['runs'][0]
        self.assertEqual(row['status'],'invalid');self.assertNotIn('retry',row)

    def test_plan_is_read_only_and_paid_retry_still_requires_new_explicit_flag(self):
        for mode in retry.MODES:
            out,_=self.attempt('pi-work-'+mode,mode=mode)
            before=(out/'attempts.json').read_bytes()
            preview,options=dispatch.retry_plan(out.name,self.lab)
            self.assertEqual(preview['attempt'],1);self.assertEqual(preview['maximum_retries'],2)
            self.assertEqual(preview['remote'],mode=='task')
            self.assertEqual(before,(out/'attempts.json').read_bytes())
            with patch.object(dispatch,'detect') as detect:
                with self.assertRaises(slots.SlotError):
                    dispatch.launch('pi',mode!='task',self.lab,retry_parent=out.name,**options)
                detect.assert_not_called()

    def test_actual_exec_handoff_reserves_one_child_without_provider(self):
        root,_=self.attempt('pi-work-root')
        # Use the real fingerprint for the subprocess, but no provider or credentials.
        scripts=Path(__file__).resolve().parent
        (self.lab/'scripts').symlink_to(scripts,target_is_directory=True)
        self.edit(root/'attempt.json',source_sha256=self.fingerprint.temp_original(self.lab))
        child=self.lab/'runs/pi-work-child';child.mkdir(mode=0o700)
        inner=f'''from pathlib import Path
from execution_slot import execution_slot
from pi_retry import register
lab=Path({str(self.lab)!r})
with execution_slot(lab):
 meta,fixture=register(lab,Path({str(child)!r}),'http_401',{{'marker':'new','values':[1]}})
 assert meta['attempt']==1 and fixture['marker']=='fixture'
print('reserved')
'''
        outer=f'''from pathlib import Path
import os,sys
from execution_slot import execution_slot
with execution_slot(Path({str(self.lab)!r})) as slot:
 slot.select_retry({root.name!r})
 os.execve(sys.executable,[sys.executable,'-c',{inner!r}],slot.exec_env(os.environ))
'''
        result=subprocess.run([sys.executable,'-c',outer],env=dict(os.environ,PYTHONPATH=str(scripts)),capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout.strip(),'reserved')
        with self.assertRaisesRegex(slots.SlotError,'latest'):retry.inspect(self.lab,root.name)


if __name__=='__main__':unittest.main()
