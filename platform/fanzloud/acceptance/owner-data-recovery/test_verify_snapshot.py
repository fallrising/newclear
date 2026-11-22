import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import verify_snapshot as probe


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / 'private-secret-name.tar'

    def bundle(self, entries=None):
        if entries is None:
            entries = [('PG_VERSION', b'18\n'), ('base/42/123', probe.WRITER + b' ' + probe.REVIEWER)]
        with tarfile.open(self.archive, 'w') as archive:
            root = tarfile.TarInfo('.'); root.type = tarfile.DIRTYPE; archive.addfile(root)
            for name, value in entries:
                member = tarfile.TarInfo('./' + name)
                if isinstance(value, bytes):
                    member.size = len(value); archive.addfile(member, io.BytesIO(value))
                else:
                    member.type = value[1]; member.linkname = '/private-secret'; archive.addfile(member)
        return hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def check(self, entries=None):
        return probe.verify(self.archive, self.bundle(entries))

    def rejected(self, reason, entries=None):
        digest = self.bundle(entries)
        with self.assertRaises(probe.InvalidSnapshot) as caught:
            probe.verify(self.archive, digest)
        self.assertEqual(str(caught.exception), reason)

    def test_both_markers_only_nominate_candidate_and_never_extract(self):
        result = self.check()
        self.assertEqual(result['status'], 'candidate_only')
        self.assertFalse(result['logical_restore_verified'])
        self.assertEqual(set(p.name for p in self.root.iterdir()), {self.archive.name})

    def test_single_marker_is_not_matching_identity(self):
        result = self.check([('PG_VERSION', b'18\n'), ('base/42/123', probe.WRITER)])
        self.assertEqual(result['status'], 'no_matching_identity')
        self.assertEqual(result['markers'], {'writer': True, 'reviewer': False})

    def test_markers_outside_relations_do_not_count(self):
        result = self.check([('PG_VERSION', b'18\n'), ('postmaster.opts', probe.WRITER + probe.REVIEWER)])
        self.assertEqual(result['markers'], {'writer': False, 'reviewer': False})

    def test_chunk_boundary_marker_is_detected(self):
        with patch.object(probe, 'CHUNK', 40):
            result = self.check([('PG_VERSION', b'18\n'), ('base/42/123.1', b'x' * 38 + probe.WRITER + probe.REVIEWER)])
        self.assertEqual(result['status'], 'candidate_only')

    def test_wrong_digest(self):
        self.bundle()
        with self.assertRaisesRegex(probe.InvalidSnapshot, '^digest_mismatch$'):
            probe.verify(self.archive, '0' * 64)

    def test_version_required(self):
        self.rejected('version_missing', [('base/42/123', b'')])
        self.rejected('version_mismatch', [('PG_VERSION', b'16\n')])

    def test_duplicate_names(self):
        self.rejected('duplicate_member', [('PG_VERSION', b'18'), ('PG_VERSION', b'18')])

    def test_unsafe_paths(self):
        for name in ['../escape', 'base/../escape', '/absolute', 'base\\escape', './PG_VERSION']:
            with self.subTest(name=name):
                self.rejected('unsafe_member', [(name, b'18')])

    def test_links_and_specials(self):
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE]:
            with self.subTest(kind=kind):
                self.rejected('unsupported_member', [('PG_VERSION', b'18'), ('link', ('kind', kind))])

    def test_hidden_extended_metadata_is_rejected_before_processing(self):
        with tarfile.open(self.archive, 'w', format=tarfile.PAX_FORMAT) as archive:
            member = tarfile.TarInfo('PG_VERSION')
            member.size = 3
            member.pax_headers = {'comment': 'PRIVATE-CANARY'}
            archive.addfile(member, io.BytesIO(b'18\n'))
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        with self.assertRaisesRegex(probe.InvalidSnapshot, '^unsupported_member$'):
            probe.verify(self.archive, digest)

    def test_declared_oversize_is_rejected_before_payload_read(self):
        member = tarfile.TarInfo('PG_VERSION')
        member.size = probe.MAX_MEMBER + 1
        self.archive.write_bytes(member.tobuf() + b'\0' * 1536)
        digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        with self.assertRaisesRegex(probe.InvalidSnapshot, '^member_size_limit$'):
            probe.verify(self.archive, digest)

    def test_archive_limit(self):
        digest = self.bundle()
        with patch.object(probe, 'MAX_ARCHIVE', 100):
            with self.assertRaisesRegex(probe.InvalidSnapshot, '^archive_limit$'):
                probe.verify(self.archive, digest)

    def test_member_count_size_and_relation_budgets(self):
        for constant, value, reason in [('MAX_MEMBERS', 1, 'member_count_limit'), ('MAX_MEMBER', 1, 'member_size_limit'), ('MAX_TOTAL', 1, 'member_total_limit'), ('MAX_RELATION', 1, 'relation_size_limit'), ('MAX_RELATIONS_TOTAL', 1, 'relation_total_limit')]:
            with self.subTest(constant=constant):
                digest = self.bundle()
                with patch.object(probe, constant, value):
                    with self.assertRaisesRegex(probe.InvalidSnapshot, '^' + reason + '$'):
                        probe.verify(self.archive, digest)

    def test_malformed_and_truncated(self):
        for value in [b'not an archive', b'X' * 1024 + b'\0' * 1024]:
            self.archive.write_bytes(value)
            with self.assertRaises(probe.InvalidSnapshot):
                probe.verify(self.archive, hashlib.sha256(value).hexdigest())
        self.bundle(); data = self.archive.read_bytes()[:1600]; self.archive.write_bytes(data)
        with self.assertRaisesRegex(probe.InvalidSnapshot, '^archive_structure$'):
            probe.verify(self.archive, hashlib.sha256(data).hexdigest())

    def test_nonzero_trailing_archive_content_rejected(self):
        self.bundle()
        original = self.archive.read_bytes()
        with tarfile.open(self.archive, 'r:') as archive:
            last = archive.getmembers()[-1]
            end = last.offset_data + ((last.size + 511) // 512) * 512
        unsafe = tarfile.TarInfo('../unvalidated').tobuf()
        variants = [original + unsafe + b'\0' * 1024,
                    original + b'X' * 512 + b'\0' * 1024,
                    original[:end] + b'\0' * 512 + unsafe + b'\0' * 1024]
        for data in variants:
            with self.subTest(bytes=len(data)):
                self.archive.write_bytes(data)
                digest = hashlib.sha256(data).hexdigest()
                with self.assertRaisesRegex(probe.InvalidSnapshot, '^archive_structure$'):
                    probe.verify(self.archive, digest)

    def test_symlink_input_rejected(self):
        digest = self.bundle(); link = self.root / 'link'; link.symlink_to(self.archive)
        with self.assertRaisesRegex(probe.InvalidSnapshot, '^input_unavailable$'):
            probe.verify(link, digest)

    def test_cli_fixed_error_without_private_path_or_raw_data(self):
        self.bundle()
        result = subprocess.run([sys.executable, str(Path(probe.__file__)), str(self.archive), '--sha256', '0' * 64], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stdout), {'status': 'rejected', 'reason': 'digest_mismatch'})
        self.assertEqual(result.stderr, '')
        self.assertNotIn('private-secret', result.stdout)


if __name__ == '__main__':
    unittest.main()
