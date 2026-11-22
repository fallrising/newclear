"""Offline candidate evidence only: never extracts, restores, or starts a database."""
import argparse
import hashlib
import json
import os
import re
import stat
import tarfile

MAX_ARCHIVE = 512 * 1024**2
MAX_TOTAL = MAX_ARCHIVE
MAX_MEMBER = 64 * 1024**2
MAX_MEMBERS = 10000
MAX_RELATION = 8 * 1024**2
MAX_RELATIONS_TOTAL = 128 * 1024**2
CHUNK = 65536
WRITER = b'9c20ec74-f940-46fd-81e6-064b9dee93eb'
REVIEWER = b'54dc092e-a174-4af6-a48c-ac0ab54b3a33'
RELATION = re.compile(r'base/[0-9]+/[0-9]+(?:\.[0-9]+)?\Z')


class InvalidSnapshot(Exception):
    """The string is a fixed public reason, never raw input or an exception body."""


class _BoundedInfo(tarfile.TarInfo):
    # Reject extensions before tarfile consumes hidden metadata or sparse payloads.
    # Covered by tests on the supported repository CI Python runtime.
    def _proc_member(self, archive):
        if self.type not in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE):
            raise InvalidSnapshot('unsupported_member')
        if self.size < 0 or self.size > MAX_MEMBER:
            raise InvalidSnapshot('member_size_limit')
        return super()._proc_member(archive)


def _name(value):
    if value.startswith('./'):
        value = value[2:]
    if value in ('', '.'):
        return '.'
    if value.startswith('/') or '\\' in value or any(part in ('', '.', '..') for part in value.split('/')):
        raise InvalidSnapshot('unsafe_member')
    return value


def _identity(info):
    return info.st_size, info.st_mtime_ns, info.st_ctime_ns


def verify(path, expected_sha256):
    if not isinstance(expected_sha256, str) or not re.fullmatch('[0-9a-f]{64}', expected_sha256):
        raise InvalidSnapshot('invalid_digest')
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        raise InvalidSnapshot('input_unavailable') from None
    try:
        with os.fdopen(fd, 'rb') as source:
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise InvalidSnapshot('input_unavailable')
            if before.st_size > MAX_ARCHIVE:
                raise InvalidSnapshot('archive_limit')
            digest = hashlib.sha256()
            read_bytes = 0
            for block in iter(lambda: source.read(CHUNK), b''):
                read_bytes += len(block)
                if read_bytes > MAX_ARCHIVE:
                    raise InvalidSnapshot('archive_limit')
                digest.update(block)
            if digest.hexdigest() != expected_sha256:
                raise InvalidSnapshot('digest_mismatch')
            if before.st_size < 1024 or before.st_size % 512:
                raise InvalidSnapshot('archive_structure')
            source.seek(-1024, os.SEEK_END)
            if source.read(1024) != b'\0' * 1024:
                raise InvalidSnapshot('archive_structure')
            source.seek(0)
            names = set()
            members = total = relation_bytes = relation_files = 0
            validated_end = 0
            version = False
            markers = {'writer': False, 'reviewer': False}
            with tarfile.open(fileobj=source, mode='r:', tarinfo=_BoundedInfo) as archive:
                for member in archive:
                    members += 1
                    if members > MAX_MEMBERS:
                        raise InvalidSnapshot('member_count_limit')
                    name = _name(member.name)
                    if name in names:
                        raise InvalidSnapshot('duplicate_member')
                    names.add(name)
                    if not member.isfile() and not member.isdir():
                        raise InvalidSnapshot('unsupported_member')
                    if name == '.' and not member.isdir():
                        raise InvalidSnapshot('unsafe_member')
                    if member.size < 0 or member.size > MAX_MEMBER:
                        raise InvalidSnapshot('member_size_limit')
                    if member.isdir() and member.size:
                        raise InvalidSnapshot('archive_structure')
                    total += member.size
                    if total > MAX_TOTAL:
                        raise InvalidSnapshot('member_total_limit')
                    if member.offset_data + member.size > before.st_size - 1024:
                        raise InvalidSnapshot('archive_structure')
                    validated_end = member.offset_data + ((member.size + 511) // 512) * 512
                    if member.isdir():
                        continue
                    if name == 'PG_VERSION':
                        if member.size > 32:
                            raise InvalidSnapshot('version_mismatch')
                        with archive.extractfile(member) as data:
                            if data.read(32).strip() != b'18':
                                raise InvalidSnapshot('version_mismatch')
                        version = True
                    elif RELATION.fullmatch(name):
                        if member.size > MAX_RELATION:
                            raise InvalidSnapshot('relation_size_limit')
                        relation_files += 1
                        relation_bytes += member.size
                        if relation_bytes > MAX_RELATIONS_TOTAL:
                            raise InvalidSnapshot('relation_total_limit')
                        tail = b''
                        with archive.extractfile(member) as data:
                            for block in iter(lambda: data.read(CHUNK), b''):
                                joined = tail + block
                                markers['writer'] |= WRITER in joined
                                markers['reviewer'] |= REVIEWER in joined
                                tail = joined[-(max(len(WRITER), len(REVIEWER)) - 1):]
            # tarfile stops at the first zero header: validate the entire remainder.
            if before.st_size - validated_end < 1024:
                raise InvalidSnapshot('archive_structure')
            source.seek(validated_end)
            remaining = before.st_size - validated_end
            while remaining:
                block = source.read(min(CHUNK, remaining))
                if not block or any(block):
                    raise InvalidSnapshot('archive_structure')
                remaining -= len(block)
            if not version:
                raise InvalidSnapshot('version_missing')
            if _identity(before) != _identity(os.fstat(source.fileno())):
                raise InvalidSnapshot('input_changed')
            return {'status': 'candidate_only' if all(markers.values()) else 'no_matching_identity',
                    'sha256': expected_sha256, 'archive_bytes': before.st_size,
                    'members': members, 'member_bytes': total, 'postgres_major': 18,
                    'relation_files': relation_files, 'relation_bytes': relation_bytes,
                    'markers': markers, 'logical_restore_verified': False}
    except InvalidSnapshot:
        raise
    except (OSError, tarfile.TarError, ValueError, OverflowError, UnicodeError):
        raise InvalidSnapshot('archive_structure') from None


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise InvalidSnapshot('arguments')


def main():
    try:
        parser = _Parser(description=__doc__)
        parser.add_argument('archive')
        parser.add_argument('--sha256', required=True)
        args = parser.parse_args()
        result = verify(args.archive, args.sha256)
    except InvalidSnapshot as error:
        print(json.dumps({'status': 'rejected', 'reason': str(error)}))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
