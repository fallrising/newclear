from pathlib import Path
import hashlib
import json
import os
import stat
import subprocess

root = Path.cwd()
evidence = root / '.team/pp1c-c-20261102/runtime'
runtime = json.loads((evidence / 'source-runtime.json').read_text())
result = json.loads((evidence / 'core-result.json').read_text())
assert result['sourceRunId'] == runtime['runId'] and result['success']
assert result['phase'] == 'SESSIONS_REVOKED' and not result.get('stopFailure')
source = Path(runtime['root'])
base = source / 'maintenance'
operation = base / 'operations' / result['operationId']
bundle = source / 'bundles' / result['backupId']
protected = source / 'protected-copy' / result['backupId']
encoder = json.JSONEncoder(sort_keys=True, ensure_ascii=False, separators=(',', ':'))

def canonical_hash(value):
    digest = hashlib.sha256()
    for chunk in encoder.iterencode(value):
        digest.update(chunk.encode())
    digest.update(b'\n')
    return digest.hexdigest()

def private_hash(path):
    info = path.lstat()
    assert stat.S_ISREG(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o600
    assert info.st_uid == os.getuid() and info.st_gid == os.getgid() and info.st_nlink == 1
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

manifest = json.loads((bundle / 'manifest.json').read_text())
artifact_hashes = {}
for name in ['db.dump', 'inventory.json', 'media.package', 'manifest.json', 'local-complete.json']:
    digest = private_hash(bundle / name)
    assert private_hash(protected / name) == digest
    artifact_hashes[name] = digest
for artifact in manifest['artifacts']:
    assert artifact_hashes[artifact['path']] == artifact['sha256']
    assert str((bundle / artifact['path']).stat().st_size) == artifact['byteSize']
inventories = {}
for name in ['source-before', 'source-after', 'target-raw', 'target-revoked']:
    path = operation / 'inventories' / (name + '.json')
    value = json.loads(path.read_text())
    assert private_hash(path) == canonical_hash(value)
    assert len(value['tables']) == 20 and len({t['tableName'] for t in value['tables']}) == 20
    for table in value['tables']:
        assert table['rowCount'] == str(len(table['rows']))
        for field, payload in [('schemaSha256', table['schema']), ('rowsSha256', table['rows']),
                               ('snapshotSha256', {'schema': table['schema'], 'rows': table['rows']})]:
            assert table[field] == canonical_hash(payload)
    summary = [{k: t[k] for k in ['tableName', 'schemaSha256', 'rowsSha256', 'rowCount']} for t in value['tables']]
    assert value['dbSnapshotSha256'] == canonical_hash(summary)
    assert value['mediaHeaderSha256'] == canonical_hash({'version': 1, 'files': value['files']})
    inventories[name] = value
policy_path = root / 'docs/v2/contracts/fixtures/pp1c-check-definition-pairs-v1.json'
assert hashlib.sha256(policy_path.read_bytes()).hexdigest() == 'f25157feb8a0c027f1b8930c4fad64fe7e0291e0745702d2e2a3b727533e856a'
policy = json.loads(policy_path.read_text())
assert policy['status'] == 'APPROVED' and len(policy['pairs']) == policy['pairCount'] == 9

def schemas_equivalent(name, left, right, manifest):
    if left == right:
        return True
    profile = {'postgresImageDigest': manifest['release']['postgresImageDigest'],
               'postgresServerVersion': manifest['release']['postgresServerVersion'],
               'pgDumpVersion': manifest['toolchain']['pgDumpVersion'],
               'pgRestoreVersion': manifest['toolchain']['pgRestoreVersion']}
    if any(profile[key] != policy[key] for key in profile) or left.keys() != right.keys():
        return False
    if {k: v for k, v in left.items() if k != 'constraints'} != {k: v for k, v in right.items() if k != 'constraints'}:
        return False
    if len(left['constraints']) != len(right['constraints']):
        return False
    for source, target in zip(left['constraints'], right['constraints'], strict=True):
        if source == target:
            continue
        pairs = [pair for pair in policy['pairs'] if pair['tableName'] == name and pair['constraintName'] == source.get('name')]
        if len(pairs) != 1:
            return False
        pair = pairs[0]
        if any({k: v for k, v in item.items() if k != 'definition'} != pair['constraintMetadata'] for item in [source, target]):
            return False
        if source['definition'] != pair['sourceDefinition'] or target['definition'] != pair['restoredDefinition']:
            return False
    return True

source_raw, target_raw = inventories['source-before'], inventories['target-raw']
assert source_raw == inventories['source-after']
assert all(source_raw[key] == target_raw[key] for key in ['version', 'assets', 'variants', 'files', 'mediaHeaderSha256'])
for left, right in zip(source_raw['tables'], target_raw['tables'], strict=True):
    assert left['tableName'] == right['tableName']
    assert schemas_equivalent(left['tableName'], left['schema'], right['schema'], manifest)
    assert all(left[key] == right[key] for key in ['rows', 'rowsSha256', 'rowCount'])
assert private_hash(operation / 'inventories/source-before.json') == artifact_hashes['inventory.json']
before, after = inventories['target-raw'], inventories['target-revoked']
comparison_path = operation / 'raw-comparison.json'
comparison = json.loads(comparison_path.read_text())
assert private_hash(comparison_path) == canonical_hash(comparison)
assert comparison == result['rawComparison'] and comparison['equal'] is True
assert comparison['manifestSha256'] == artifact_hashes['manifest.json']
assert comparison['sourceInventorySha256'] == artifact_hashes['inventory.json']
assert comparison['targetInventorySha256'] == private_hash(operation / 'inventories/target-raw.json')
assert comparison['targetIdentitySha256'] == canonical_hash(result['targetIdentity'])
for item, source_table, target_table in zip(comparison['tables'], source_raw['tables'], target_raw['tables'], strict=True):
    assert item['tableName'] == source_table['tableName'] == target_table['tableName'] and item['schemaEqual'] and item['rowsEqual']
    for prefix, table in [('source', source_table), ('target', target_table)]:
        assert item[prefix + 'SchemaSha256'] == table['schemaSha256']
        assert item[prefix + 'RowsSha256'] == table['rowsSha256']
        assert item[prefix + 'RowCount'] == table['rowCount']
assert all(before[k] == after[k] for k in ['version', 'assets', 'variants', 'files', 'mediaHeaderSha256'])
tables = {t['tableName']: t for t in before['tables']}
changed = {t['tableName']: t for t in after['tables']}
for name in tables:
    assert tables[name]['schema'] == changed[name]['schema']
    if name not in ['cms_session', 'cms_audit_event']:
        assert tables[name] == changed[name]
receipt = result['sessionCommit']
assert set(receipt) == {'operationId', 'backupId', 'auditEventId', 'revokedCount', 'committed'}
assert receipt['committed'] and receipt['operationId'] == result['operationId'] and receipt['backupId'] == result['backupId']
commit_files = list((operation / 'helper').glob('*/commit-receipt.json'))
assert len(commit_files) == 1 and json.loads(commit_files[0].read_text()) == receipt
assert private_hash(commit_files[0]) == canonical_hash(receipt)
commit_request = json.loads((commit_files[0].parent / 'request.json').read_text())
assert commit_request['rawProofSha256'] == private_hash(comparison_path)
assert commit_request['targetId'] == result['targetIdentity']['targetId']
assert commit_request['mode'] == 'REVOKE_SESSIONS' and commit_request['side'] == 'target'
old_audit = tables['cms_audit_event']['rows']
new_audit = changed['cms_audit_event']['rows']
added = [row for row in new_audit if row['id'] == receipt['auditEventId']]
assert len(added) == 1 and [row for row in new_audit if row['id'] != receipt['auditEventId']] == old_audit
audit = added[0]
assert audit['category'] == 'AUTH' and audit['action'] == 'PRODUCTION_SESSIONS_INVALIDATED_AFTER_RESTORE'
assert {k: v for k, v in audit.items() if k not in ['at', 'detail_json']} == {
    'id': receipt['auditEventId'], 'actor_principal_id': None, 'category': 'AUTH',
    'action': 'PRODUCTION_SESSIONS_INVALIDATED_AFTER_RESTORE', 'target_type': 'restore',
    'target_id': None, 'surface': 'admin', 'outcome': 'ok', 'ip': None}
assert json.loads(audit['detail_json']) == {'operationId': result['operationId'], 'backupId': result['backupId'],
    'targetRef': result['targetIdentity']['targetId'], 'revokedCount': receipt['revokedCount']}
sessions = {row['id']: row for row in changed['cms_session']['rows']}
old_sessions = tables['cms_session']['rows']
assert len(sessions) == len(old_sessions)
revoked = 0
for row in old_sessions:
    expected = dict(row)
    if row['revoked_at'] is None:
        expected['revoked_at'] = audit['at']
        revoked += 1
    assert sessions[row['id']] == expected
assert str(revoked) == receipt['revokedCount']
lease = json.loads((base / 'lease.json').read_text())
journal = json.loads((base / 'operations' / (result['operationId'] + '.json')).read_text())
assert lease['phase'] == 'SESSIONS_REVOKED' and lease['helper'] is None
assert manifest['release']['apiImageDigest'] == runtime['image'] == result['targetIdentity']['images']['api']
assert manifest['release']['postgresImageDigest'] == lease['source']['images']['postgres'] == result['targetIdentity']['images']['postgres']
assert lease['target']['creationPhase'] == 'BLANK_VERIFIED' and lease['target']['identity'] == result['targetIdentity']
assert comparison['sourceIdentitySha256'] == canonical_hash(lease['source'])
assert journal['records'][-1]['event'] == 'END' and journal['records'][-1]['phase'] == 'SESSIONS_REVOKED'
assert (base / 'operation.lock').exists()
docker = ['docker', '--host', 'unix:///var/run/docker.sock']
container_ids = [v['id'] for v in runtime['containers'].values()] + list(result['targetIdentity']['containerIds'].values())
assert len(set(container_ids)) == 6
containers = json.loads(subprocess.check_output(docker + ['inspect', *container_ids], text=True))
assert all(not c['State']['Running'] for c in containers)
for role in ['cms-api', 'ingress']:
    target_id = result['targetIdentity']['containerIds'][role]
    container = next(c for c in containers if c['Id'] == target_id)
    assert container['State']['StartedAt'] == '0001-01-01T00:00:00Z' and container['RestartCount'] == 0
safe = {'sourceRunId': runtime['runId'], 'targetRunId': result['targetRunId'], 'operationId': result['operationId'],
    'backupId': result['backupId'], 'all20TablesAndDerivedHashesRecomputed': True, 'sourceBeforeAfterByteExact': True, 'targetRawMatchesApprovedFinitePolicy': True,
    'sourceRawDbSnapshotSha256': source_raw['dbSnapshotSha256'], 'targetPreRevokeRawDbSnapshotSha256': target_raw['dbSnapshotSha256'],
    'onlyExactRevokeAndOneAuthDelta': True, 'revokedCount': str(revoked), 'artifactSha256': artifact_hashes,
    'rawComparisonSha256': private_hash(comparison_path), 'commitReceiptSha256': private_hash(commit_files[0]),
    'fileCount': str(len(before['files'])), 'mediaHeaderSha256': before['mediaHeaderSha256'],
    'allSixContainersStopped': True, 'targetAppsNeverStarted': True, 'lockRetained': True, 'fullDProof': False}
(evidence / 'core-independent-readback.json').write_text(json.dumps(safe, indent=2) + '\n')
print(json.dumps(safe))
