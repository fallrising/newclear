"""Real dispatcher exec/slot/receipt; stop the real runner before native preflight."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import console_grant_harness as harness
import execution_slot as slots
import remote_grant as grants

SCRIPTS = Path(__file__).resolve().parent


class CursorGrantHandoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.lab = Path(self.tmp.name).resolve()
        harness.copy_sources(self.lab, 'cursor')
        self.runner = self.lab/'scripts/run_cursor_work.py'
        self.runner.write_text('''import json,sys
from pathlib import Path
sys.path.insert(0, PRODUCTION_SCRIPTS)
import execution_slot as slots
import run_cursor_work as runner
lab=Path(__file__).resolve().parents[1]
runner.LAB=lab
calls=[]
def probe():
    calls.append('native_preflight_boundary')
    raise ValueError('stopped_before_native_or_credentials')
runner.probe=probe
outcomes=[]
with slots.execution_slot(lab):
    for _ in range(2):
        try: runner.main()
        except ValueError as error: outcomes.append(str(error))
print(json.dumps({'outcomes':outcomes,'preflight_calls':len(calls)}))
'''.replace('PRODUCTION_SCRIPTS', repr(str(SCRIPTS))))

    def child(self, code, *args):
        result = subprocess.run([sys.executable, '-c', code, str(self.lab), *args],
            env={'PYTHONPATH':str(SCRIPTS),'PATH':os.defpath}, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def dispatch(self, grant, fault='none'):
        return self.child('''import sys,json,os
from pathlib import Path
import office_dispatch as dispatch
import remote_grant as grants
lab=Path(sys.argv[1]);grant=sys.argv[2];fault=sys.argv[3]
dispatch.detect=lambda *a,**k: {'launch_prerequisites_present':True}
consume=grants.consume
def consume_with_fault(*a,**k):
    row=consume(*a,**k)
    receipt=lab/'state/remote-grants/consumed'/(grant+'.use.json')
    value=json.loads(receipt.read_text())
    if fault=='missing': receipt.unlink()
    elif fault=='source':
        p=lab/'scripts/cursor_task_hook.py';p.write_text(p.read_text()+'\\n# changed after consume\\n')
    elif fault!='none':
        if fault=='pid': value['pid']=os.getpid()+100000
        elif fault=='entry': value['entry']='cli'
        elif fault=='timestamp': value['consumed_at']=float('nan')
        receipt.write_text(json.dumps(value))
    return row
grants.consume=consume_with_fault
dispatch.launch('cursor',False,lab,remote_grant=grant)
''', grant, fault)

    def test_same_dispatcher_exec_can_claim_once_even_after_preflight_failure(self):
        row = grants.create(self.lab, 'cursor', 900)
        result = self.dispatch(row['id'])
        self.assertEqual(result, {'outcomes':['stopped_before_native_or_credentials','remote_grant_used'], 'preflight_calls':1})
        claim = self.lab/'state/remote-grants/consumed'/(row['id']+'.runner.json')
        self.assertTrue(claim.is_file())
        self.assertEqual(claim.stat().st_mode & 0o777, 0o600)
        self.assertTrue(grants.consumed(self.lab, row['id']))
        self.assertIsNone(grants.pending(self.lab, 'cursor'))
        self.assertEqual(slots.inspect_slot(self.lab)['status'], 'available')

    def test_fresh_processes_cannot_reuse_a_consumed_reference(self):
        row = grants.create(self.lab, 'cursor', 900)
        grants.consume(self.lab, row['id'], 'cursor', 'dispatcher')
        for _ in range(2):
            result = subprocess.run([sys.executable, str(self.runner), '--allow-remote', '--authorization-ref', row['id']],
                env={'PYTHONPATH':str(SCRIPTS),'PATH':os.defpath}, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            data = json.loads(result.stdout)
            self.assertEqual(data['preflight_calls'], 0)
            self.assertEqual(data['outcomes'], ['remote_grant_requires_dispatch_handoff']*2)
        self.assertTrue(grants.consumed(self.lab, row['id']))

    def test_wrong_or_missing_use_receipt_and_changed_source_never_reach_preflight(self):
        for fault in ('pid','entry','timestamp','missing','source'):
            with self.subTest(fault=fault):
                row = grants.create(self.lab, 'cursor', 900)
                result = self.dispatch(row['id'], fault)
                self.assertEqual(result['preflight_calls'], 0)
                self.assertNotIn('stopped_before_native_or_credentials', result['outcomes'])
                self.assertTrue(grants.consumed(self.lab, row['id']))
                self.assertFalse((self.lab/'state/remote-grants/consumed'/(row['id']+'.runner.json')).exists())

    def test_new_direct_operator_authorization_still_reaches_preflight_without_grant(self):
        result = subprocess.run([sys.executable, str(self.runner), '--allow-remote'],
            env={'PYTHONPATH':str(SCRIPTS),'PATH':os.defpath}, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data['preflight_calls'], 2)  # Two distinct explicit calls in this test only.
        self.assertFalse((self.lab/'state/remote-grants').exists())


if __name__ == '__main__': unittest.main()
