"""Fresh, bounded source snapshots; no provider processes."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from agent_workforce.native_session_source import CodexSessionSource, SessionSourceError


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.leaf = self.root / 'sessions'
        self.leaf.mkdir(mode=0o700)
        self.journal = self.root / 'journal'
        self.journal.mkdir(mode=0o700)
        self.source = CodexSessionSource(self.leaf)
        self.expected = dict(cwd='/synthetic/work', model='model', cli_version='0.163.0',
                             prompt_sha256=hashlib.sha256(b'prompt').hexdigest())
        self.intent = self.source.prepare(self.expected)
        self.sid = '00000000-0000-4000-8000-000000000001'
        self.binding = 'a' * 64
        self.closure = 'b' * 64

    def create(self, raw=b'{}\n', name=None):
        p = self.leaf / (name or ('rollout-test-' + self.sid + '.jsonl'))
        p.write_bytes(raw)
        p.chmod(0o600)
        return p

    def read(self):
        return self.source.capture(self.intent, self.sid, self.journal,
                                   binding_digest=self.binding, closure_digest=self.closure)

    def test_sealed_reopen_does_not_read_live_source(self):
        p = self.create()
        first = self.read()
        self.assertEqual(first['raw'], b'{}\n')
        p.write_bytes(b'changed\n')
        self.assertEqual(self.read(), first)
        self.assertEqual(first['manifest']['sha256'], hashlib.sha256(b'{}\n').hexdigest())

    def test_old_file_and_duplicate_matches_rejected(self):
        self.create()
        self.intent = self.source.prepare(self.expected)
        with self.assertRaises(SessionSourceError): self.read()
        self.create(name='rollout-other-' + self.sid + '.jsonl')
        with self.assertRaises(SessionSourceError): self.read()

    def test_missing_and_bad_session_id(self):
        with self.assertRaises(SessionSourceError): self.read()
        for sid in ('../escape', '', 'not-a-uuid'):
            with self.subTest(sid=sid), self.assertRaises(SessionSourceError):
                self.source.capture(self.intent, sid, self.journal,
                                    binding_digest=self.binding, closure_digest=self.closure)

    def test_symlink_fifo_hardlink_and_mode(self):
        p = self.create(); target = self.root/'target'; p.rename(target)
        p.symlink_to(target)
        with self.assertRaises((SessionSourceError,OSError)): self.read()
        p.unlink(); os.mkfifo(p,0o600)
        with self.assertRaises(SessionSourceError): self.read()
        p.unlink(); os.link(target,p)
        with self.assertRaises(SessionSourceError): self.read()
        p.unlink(); p.write_bytes(b'{}\n');p.chmod(0o644)
        with self.assertRaises(SessionSourceError): self.read()

    def test_root_symlink_and_replacement(self):
        alias=self.root/'alias'; alias.symlink_to(self.leaf)
        with self.assertRaises(SessionSourceError): CodexSessionSource(alias)
        self.leaf.rename(self.root/'old');self.leaf.mkdir(mode=0o700);self.create()
        with self.assertRaises(SessionSourceError): self.read()

    def test_source_growth_is_rejected(self):
        p=self.create(); original=os.read; mutated=[]
        def mutate(fd,n):
            raw=original(fd,n)
            if raw == b'{}\n' and not mutated:
                mutated.append(True)
                with p.open('ab') as f:f.write(b'{}\n')
            return raw
        with patch('agent_workforce.native_session_source.os.read',side_effect=mutate):
            with self.assertRaises(SessionSourceError): self.read()

    def test_bounds(self):
        self.create(b'x' * (2*1024*1024+1))
        with self.assertRaises(SessionSourceError): self.read()
        for i in range(1024): (self.leaf/str(i)).touch()
        with self.assertRaises(SessionSourceError): self.source.prepare(self.expected)

    def test_manifest_tamper_missing_blob_and_binding(self):
        self.create();result=self.read()
        manifest=self.journal/result['manifest_name'];blob=self.journal/result['manifest']['blob']
        with self.assertRaises(SessionSourceError):
            self.source.capture(self.intent,self.sid,self.journal,
                                binding_digest='c'*64,closure_digest=self.closure)
        blob.write_bytes(b'bad\n')
        with self.assertRaises(SessionSourceError):self.read()
        blob.unlink()
        with self.assertRaises(SessionSourceError):self.read()
        manifest.write_text('{"invalid":true}')
        with self.assertRaises(SessionSourceError):self.read()

    def test_partial_blob_does_not_recapture(self):
        self.create(); real_replace=os.replace
        def fault(src,dst,*args,**kwargs):
            if str(dst).endswith('.json'):raise OSError('manifest fault')
            return real_replace(src,dst,*args,**kwargs)
        with patch('agent_workforce.native_session_source.os.replace',side_effect=fault):
            with self.assertRaises(OSError): self.read()
        with self.assertRaises(SessionSourceError):self.read()

    def test_committed_seal_loss_never_recaptures(self):
        self.create(); first=self.read()
        (self.journal/first['manifest_name']).unlink()
        (self.journal/first['manifest']['blob']).unlink()
        with self.assertRaises(SessionSourceError):
            self.source.capture(self.intent,self.sid,self.journal,
                binding_digest=self.binding,closure_digest=self.closure,
                expected_seal=first['manifest'])

    def test_explicit_private_ancestor_accepts_native_group_bits(self):
        self.leaf.chmod(0o775)
        with self.assertRaises(SessionSourceError): CodexSessionSource(self.leaf)
        self.source=CodexSessionSource(self.leaf, private_ancestor=True)
        self.intent=self.source.prepare(self.expected)
        self.assertEqual(self.intent['access_policy'], 'owned-private-ancestor-v1')
        self.assertIsNotNone(self.intent['private_anchor'])
        p=self.create();p.chmod(0o664)
        first=self.read()
        self.assertEqual(first['raw'], b'{}\n')
        self.assertEqual(self.read(), first)
        blob=self.journal/first['manifest']['blob']
        blob.chmod(0o664)
        with self.assertRaises(SessionSourceError): self.read()

    def test_private_ancestor_is_required_and_descendants_must_be_owned(self):
        original=os.fstat
        def no_private(fd):
            info=original(fd); values=list(info)
            if info.st_uid==os.getuid():values[0]=(info.st_mode & ~0o777)|0o755
            return os.stat_result(values)
        with patch('agent_workforce.native_session_source.os.fstat', side_effect=no_private):
            with self.assertRaises(SessionSourceError): CodexSessionSource(self.leaf,private_ancestor=True)
        identity=self.root.stat().st_ino
        def other_owner(fd):
            info=original(fd);values=list(info)
            if info.st_ino==identity:values[4]=os.getuid()+1
            return os.stat_result(values)
        with patch('agent_workforce.native_session_source.os.fstat', side_effect=other_owner):
            with self.assertRaises(SessionSourceError): CodexSessionSource(self.leaf,private_ancestor=True)

    def test_ancestor_mode_drift_during_capture_is_rejected(self):
        self.source=CodexSessionSource(self.leaf,private_ancestor=True)
        self.intent=self.source.prepare(self.expected);self.create()
        original=os.read;changed=[]
        def mutate(fd,n):
            raw=original(fd,n)
            if raw==b'{}\n' and not changed:
                changed.append(True);self.root.chmod(0o755)
            return raw
        with patch('agent_workforce.native_session_source.os.read',side_effect=mutate):
            with self.assertRaises(SessionSourceError):self.read()
        self.assertFalse(list(self.journal.glob('session-seal-*')))

    def test_ancestor_policy_cannot_relax_journal_directory(self):
        self.source=CodexSessionSource(self.leaf,private_ancestor=True)
        self.intent=self.source.prepare(self.expected);self.create();self.journal.chmod(0o775)
        with self.assertRaises(SessionSourceError):self.read()

    def test_private_ancestor_symlink_swap_and_sealed_replay(self):
        self.source=CodexSessionSource(self.leaf,private_ancestor=True)
        self.intent=self.source.prepare(self.expected);self.create()
        original=os.read;changed=[];moved=self.root.with_name(self.root.name+'-moved')
        def mutate(fd,n):
            raw=original(fd,n)
            if raw==b'{}\n' and not changed:
                changed.append(True);self.root.rename(moved);self.root.symlink_to(moved)
            return raw
        try:
            with patch('agent_workforce.native_session_source.os.read',side_effect=mutate):
                with self.assertRaises(SessionSourceError):self.read()
        finally:
            if changed:self.root.unlink();moved.rename(self.root)
        self.assertFalse(list(self.journal.glob('session-seal-*')))
        first=self.read()
        self.leaf.rename(self.root/'gone')
        restored=CodexSessionSource.restore(self.intent)
        self.assertEqual(restored.capture(self.intent,self.sid,self.journal,
            binding_digest=self.binding,closure_digest=self.closure,expected_seal=first['manifest']),first)

    def test_private_source_rejects_special_files_and_world_write(self):
        self.source=CodexSessionSource(self.leaf,private_ancestor=True)
        self.intent=self.source.prepare(self.expected)
        p=self.create();p.chmod(0o666)
        with self.assertRaises(SessionSourceError):self.read()
        p.unlink();os.mkfifo(p,0o600)
        with self.assertRaises(SessionSourceError):self.read()
        p.unlink();target=self.root/'target';target.write_bytes(b'{}\n');target.chmod(0o600)
        p.symlink_to(target)
        with self.assertRaises(SessionSourceError):self.read()
        p.unlink();os.link(target,p)
        with self.assertRaises(SessionSourceError):self.read()

    def test_private_source_owner_drift_is_rejected(self):
        self.source=CodexSessionSource(self.leaf,private_ancestor=True)
        self.intent=self.source.prepare(self.expected);p=self.create();inode=p.stat().st_ino
        original=os.fstat;seen=[]
        def changed(fd):
            info=original(fd)
            if info.st_ino==inode:
                seen.append(True)
                if len(seen)>1:
                    values=list(info);values[4]=os.getuid()+1
                    return os.stat_result(values)
            return info
        with patch('agent_workforce.native_session_source.os.fstat',side_effect=changed):
            with self.assertRaises(SessionSourceError):self.read()

    def test_capture_requires_expected_intent(self):
        self.create();self.intent['root_identity']['ino']+=1
        with self.assertRaises(SessionSourceError):self.read()


if __name__ == '__main__': unittest.main()
