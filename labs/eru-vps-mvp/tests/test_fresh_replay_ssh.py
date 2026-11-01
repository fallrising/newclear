"""Copied support/helper source and real pinned adapter on synthetic transport."""
import ast
import base64
import copy
import io
from contextlib import redirect_stdout
import json
import sys
import unittest
from unittest.mock import patch

import fresh_replay_ssh as ssh
from fresh_bootstrap_render import canonical
from test_fresh_replay_host import Harness


class ReplaySSHTests(unittest.TestCase):
    def setUp(self): self.h=Harness(); self.addCleanup(self.h.close); self.dispatches=[]

    def transport(self,host,program,key):
        index=next(i for i,h in enumerate(self.h.plan['render']['hosts']) if h['alias']==host['alias'])
        self.assertEqual(key,self.h.keys[host['alias']])
        tree=ast.parse(program)
        request=json.loads(base64.b64decode(tree.body[-1].value.args[0].value))
        if request['operation']=='dispatch': self.dispatches.append(request['action']['step_index'])
        # Run the actual bundled modules and helper. Only root, clock, uid/gid
        # and bounded process runner use the explicit offline fixture seams.
        import os
        namespace={}
        with patch.dict(sys.modules):
            for statement in tree.body[:-1]:
                exec(compile(ast.Module(body=[statement],type_ignores=[]),'<copied-replay>','exec'),namespace)
            handle=namespace['handle']
            namespace['handle']=lambda r:handle(r,root=str(self.h.roots[index]),owner_uid=os.getuid(),
                    owner_gid=os.getgid(),now=self.h.now,runner=self.h.runner(index))
            out=io.StringIO()
            with redirect_stdout(out): exec(compile(ast.Module(body=[tree.body[-1]],type_ignores=[]),'<copied-request>','exec'),namespace)
        return out.getvalue().encode()

    def test_copied_bundle_pinned_four_host_probe_and_one_writer(self):
        adapter=ssh.SSHReplayAdapter(self.h.keys,transport=self.transport)
        first=adapter.observe(self.h.action(0))
        self.assertEqual(len(first['evidence']['captures']),4)
        adapter.dispatch(self.h.action(1),'b'*64)
        observed=adapter.observe(self.h.action(1))
        self.assertEqual(observed['state'],'complete'); self.assertEqual(self.dispatches,[1])
        self.assertEqual(observed['provenance']['intent_sha256'],'b'*64)

    def test_wrong_pinned_key_and_wire_mutation_have_zero_dispatches(self):
        keys=copy.deepcopy(self.h.keys); keys['ckc-disposable-01']=keys['ckc-disposable-02']
        with self.assertRaises(ValueError): ssh.SSHReplayAdapter(keys,transport=self.transport)
        action=self.h.action(1); action['step']='canary-cache'
        with self.assertRaises(ValueError): ssh.build_program({'schema_version':1,'operation':'dispatch','action':action,'intent_sha256':'b'*64})
        self.assertEqual(self.dispatches,[])
