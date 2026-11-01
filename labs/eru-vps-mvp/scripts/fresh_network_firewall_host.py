"""Fixed create-only firewall helper. Imports perform no host IO."""
import base64
import copy
from datetime import datetime, timezone
import os
import selectors
import signal
import subprocess
import sys
import time

import fresh_network_firewall as policy
import fresh_network_staging_host as support

LIMIT = support.LIMIT
SLOT = '.fresh-network-firewall'
SLOT_PATH = 'etc/eru/' + SLOT
NFT = '/usr/sbin/nft'
INVENTORY = (NFT, '-j', '-n', '-a', 'list', 'tables', 'inet')
LIST_TABLE = (NFT, '-j', '-n', '-a', 'list', 'table', 'inet', 'eru_fresh_access')
CREATE = (NFT, '-j', '-n', '-a', '-f', '-')
ERROR = 'network firewall unavailable'


def validate_request(request):
    """Pure strict data boundary, including independent policy derivation."""
    policy._bounded(request)
    fields = {'schema_version', 'operation', 'action'}
    if type(request) is dict and request.get('operation') == 'activate':
        fields.add('intent_sha256')
    support._exact(request, fields)
    if (type(request['schema_version']) is not int or request['schema_version'] != 1
            or request['operation'] not in ('observe', 'activate')):
        raise ValueError('invalid firewall request')
    if 'intent_sha256' in request:
        support._match(request['intent_sha256'], r'[0-9a-f]{64}')
    policy._validate_action(request['action'])
    return copy.deepcopy(request)


def _run_process(argv, input_bytes=None, *, timeout=10, output_limit=LIMIT):
    """Bound all three pipes without communicate's unbounded accumulation."""
    if input_bytes is not None and (type(input_bytes) is not bytes or len(input_bytes) > LIMIT):
        raise ValueError(ERROR)
    process, poller = None, selectors.DefaultSelector()
    output, total = bytearray(), 0
    try:
        process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, shell=False, start_new_session=True, close_fds=True,
            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}, cwd='/')
        pending = memoryview(input_bytes or b'')
        for stream in (process.stdout, process.stderr):
            os.set_blocking(stream.fileno(), False)
            poller.register(stream, selectors.EVENT_READ)
        if pending:
            os.set_blocking(process.stdin.fileno(), False)
            poller.register(process.stdin, selectors.EVENT_WRITE)
        else:
            process.stdin.close()
        deadline = time.monotonic() + timeout
        while poller.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError(ERROR)
            for key, _ in poller.select(remaining):
                stream = key.fileobj
                if stream is process.stdin:
                    written = os.write(stream.fileno(), pending[:65536])
                    pending = pending[written:]
                    if not pending:
                        poller.unregister(stream)
                        stream.close()
                else:
                    block = os.read(stream.fileno(), 65536)
                    if not block:
                        poller.unregister(stream)
                        stream.close()
                    else:
                        total += len(block)
                        if total > output_limit:
                            raise ValueError(ERROR)
                        if stream is process.stdout:
                            output.extend(block)
        remaining = deadline - time.monotonic()
        if remaining <= 0 or process.wait(timeout=remaining) != 0:
            raise ValueError(ERROR)
        return bytes(output)
    except Exception:
        raise ValueError(ERROR) from None
    finally:
        poller.close()
        if process is not None:
            # Kill the whole original group, including descendants retaining pipes.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()


def _runner(argv, input_bytes=None):
    if tuple(argv) not in (INVENTORY, LIST_TABLE, CREATE):
        raise ValueError(ERROR)
    if (tuple(argv) == CREATE) != (type(input_bytes) is bytes):
        raise ValueError(ERROR)
    return _run_process(argv, input_bytes)


def _objects(document):
    objects = document['nftables']
    if objects and type(objects[0]) is dict and 'metainfo' in objects[0]:
        support._exact(objects[0], {'metainfo'})
        meta = objects[0]['metainfo']
        support._exact(meta, {'version', 'release_name', 'json_schema_version'})
        if (type(meta['json_schema_version']) is not int or meta['json_schema_version'] != 1
                or any(type(meta[k]) is not str or not 1 <= len(meta[k]) <= 128
                       or any(ord(c) < 32 or ord(c) > 126 for c in meta[k])
                       for k in ('version', 'release_name'))):
            raise ValueError(ERROR)
        objects = objects[1:]
    return objects


def _handle(body):
    value = body.get('handle')
    if type(value) is not int or not 1 <= value <= 2**64 - 1:
        raise ValueError(ERROR)
    return value


def _inventory(runner):
    objects = _objects(policy.decode_ruleset(runner(INVENTORY)))
    names = set()
    for row in objects:
        support._exact(row, {'table'})
        table = row['table']
        support._exact(table, {'family', 'name', 'handle'})
        if table['family'] != 'inet':
            raise ValueError(ERROR)
        support._match(table['name'], r'[A-Za-z_][A-Za-z0-9_.-]{0,255}')
        _handle(table)
        if table['name'] in names:
            raise ValueError(ERROR)
        names.add(table['name'])
    return 'eru_fresh_access' in names


def _ruleset(runner, action):
    document = policy.decode_ruleset(runner(LIST_TABLE))
    policy.validate_ruleset(document, action)
    objects = _objects(document)
    handles = [_handle(next(iter(row.values()))) for row in objects]
    # Preserve every semantic field and every handle; only leading metainfo varies.
    normalized = {'nftables': objects}
    return document, support._sha(support._bytes(normalized)), handles


def _staging_action(action):
    result = {k: copy.deepcopy(v) for k, v in action.items()
              if k not in ('network', 'staging_intent_sha256', 'staging_receipt_sha256')}
    result['operation'] = support.OPERATION
    return result


class _Session(support._Session):
    def check(self):
        super().check()
        if SLOT_PATH in self.dirs:
            self._directory(self.dirs[SLOT_PATH], private=True)


def _staged(session, action, now):
    observed = session.observe(now)
    if any(row.get('kind') != 'regular' or
           row.get('intent_sha256') != action['staging_intent_sha256'] for row in observed['files']):
        raise ValueError(ERROR)
    return observed


def _exists(session):
    try:
        os.stat(SLOT, dir_fd=session.dirs['etc/eru'], follow_symlinks=False)
        return True
    except FileNotFoundError:
        return False


def _entries(session, wanted):
    if set(os.listdir(session.dirs[SLOT_PATH])) != set(wanted):
        raise ValueError(ERROR)
    session.check()


def _complete(action, intent_sha, digest, handles):
    return {'schema_version': 1, 'action_sha256': support._sha(support._bytes(action)),
            'intent_sha256': intent_sha, 'ruleset_sha256': digest, 'handles': handles}


def _present(session, action, runner):
    if SLOT_PATH not in session.dirs:
        session.directory(SLOT_PATH)
    _entries(session, {'intent.json', 'complete.json'})
    raw = session.read(SLOT_PATH + '/intent.json', True)
    record = support._decode(raw)
    support._exact(record, {'schema_version', 'action', 'intent_sha256'})
    support._match(record['intent_sha256'], r'[0-9a-f]{64}')
    if raw != support._bytes({'schema_version': 1, 'action': action,
                             'intent_sha256': record['intent_sha256']}):
        raise ValueError(ERROR)
    document, digest, handles = _ruleset(runner, action)
    complete = _complete(action, record['intent_sha256'], digest, handles)
    if session.read(SLOT_PATH + '/complete.json', True) != support._bytes(complete):
        raise ValueError(ERROR)
    _entries(session, {'intent.json', 'complete.json'})
    return {'kind': 'present', 'ruleset': document, 'intent_sha256': record['intent_sha256']}


def _observe(session, action, runner, now):
    staged = _staged(session, action, now)
    slot, table = _exists(session), _inventory(runner)
    if slot != table:
        raise ValueError(ERROR)
    if table:
        result = _present(session, action, runner)
        _staged(session, action, now)
        # Independent final table read catches same-policy table recreation.
        final = _present(session, action, runner)
        if support._sha(support._bytes({'nftables': _objects(result['ruleset'])})) != \
                support._sha(support._bytes({'nftables': _objects(final['ruleset'])})):
            raise ValueError(ERROR)
        result = final
    else:
        result = {'kind': 'absent'}
        _staged(session, action, now)
        if _inventory(runner) or _exists(session):
            raise ValueError(ERROR)
    session.check()
    staged['observed_at'] = (now or datetime.now(timezone.utc)).isoformat()
    return {**staged, 'table': result}


def handle(request, *, root='/', owner_uid=0, owner_gid=0, now=None, runner=None):
    """Fixture seams are local only. No existing claim is repaired or replayed."""
    session, claimed = None, False
    try:
        request = validate_request(request)
        action, runner = request['action'], runner or _runner
        session = _Session(root, owner_uid, owner_gid, _staging_action(action))
        _staged(session, action, now)
        if request['operation'] == 'observe':
            return _observe(session, action, runner, now)
        if _exists(session) or _inventory(runner):
            raise ValueError(ERROR)
        parent = session.dirs['etc/eru']
        os.mkdir(SLOT, mode=0o700, dir_fd=parent)
        created = os.stat(SLOT, dir_fd=parent, follow_symlinks=False)
        slotfd = session.directory(SLOT_PATH)
        opened = os.fstat(slotfd)
        if ((created.st_dev, created.st_ino) != (opened.st_dev, opened.st_ino)
                or os.listdir(slotfd)):
            raise ValueError(ERROR)
        claimed = True
        os.fsync(parent)
        _entries(session, set())
        _staged(session, action, now)
        intent = {'schema_version': 1, 'action': action, 'intent_sha256': request['intent_sha256']}
        session.publish(SLOT_PATH, 'intent.json', support._bytes(intent))
        _entries(session, {'intent.json'})
        _staged(session, action, now)
        objects = policy.expected_ruleset(action)['nftables']
        batch = {'nftables': [{'create': objects[0]}] + [{'add': row} for row in objects[1:]]}
        _entries(session, {'intent.json'})
        output = runner(CREATE, support._bytes(batch))
        if type(output) is not bytes or len(output) > LIMIT:
            raise ValueError(ERROR)
        _, digest, handles = _ruleset(runner, action)
        _staged(session, action, now)
        _entries(session, {'intent.json'})
        session.publish(SLOT_PATH, 'complete.json', support._bytes(
            _complete(action, request['intent_sha256'], digest, handles)))
        return _observe(session, action, runner, now)
    except BaseException as error:
        if claimed:
            try:
                fd = session.dirs[SLOT_PATH]
                marker = os.open('.firewall-failed', os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                 | os.O_NOFOLLOW, 0o600, dir_fd=fd)
                try:
                    os.fsync(marker)
                finally:
                    os.close(marker)
                os.fsync(fd)
            except OSError:
                pass
        if not isinstance(error, Exception):
            raise
        raise ValueError(ERROR) from None
    finally:
        if session is not None:
            session.close()


def main(encoded):
    try:
        if type(encoded) is not str or len(encoded) > 4 * ((LIMIT + 2) // 3):
            raise ValueError(ERROR)
        raw = base64.b64decode(encoded, validate=True)
        if base64.b64encode(raw).decode('ascii') != encoded:
            raise ValueError(ERROR)
        result = handle(support._decode(raw))
        out = policy._bounded(result)
        print(out.decode('utf-8'))
    except Exception:
        print(ERROR, file=sys.stderr)
        raise SystemExit(1) from None
