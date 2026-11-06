"""Offline proposal examples only. Never imports or authorizes production adapters."""
from pathlib import Path
import copy
import hashlib
import json

root = Path.cwd()
evidence = root / '.team/pp1c-check-definition-20261102'
proposal = json.loads((root / 'docs/v2/contracts/fixtures/pp1c-check-definition-pairs-v1.json').read_text())
observed = json.loads((evidence / 'catalog-only-observations.json').read_text())
profile_keys = ['postgresImageDigest', 'postgresServerVersion', 'pgDumpVersion', 'pgRestoreVersion']
profile = {key: proposal[key] for key in profile_keys}
actual_profile = json.loads((evidence / 'pg-profile-observation.json').read_text())
assert {key: actual_profile[key] for key in profile_keys} == profile
assert actual_profile['targetPostgresImage'] == profile['postgresImageDigest']
assert proposal['status'] == 'APPROVED' and proposal['pairCount'] == len(proposal['pairs']) == 9
assert len({(p['tableName'], p['constraintName']) for p in proposal['pairs']}) == 9

def accepts_schema(table, source, target, observed_profile=profile):
    if source == target:
        return True
    if observed_profile != profile or source.keys() != target.keys():
        return False
    if source['columns'] != target['columns'] or source['indexes'] != target['indexes']:
        return False
    if len(source['constraints']) != len(target['constraints']):
        return False
    for left, right in zip(source['constraints'], target['constraints']):
        if left == right:
            continue
        matches = [pair for pair in proposal['pairs'] if pair['tableName'] == table
                   and pair['constraintName'] == left.get('name')]
        if len(matches) != 1:
            return False
        pair = matches[0]
        if any({k: v for k, v in item.items() if k != 'definition'} != pair['constraintMetadata'] for item in [left, right]):
            return False
        if left['definition'] != pair['sourceDefinition'] or right['definition'] != pair['restoredDefinition']:
            return False
    return True

source, target = observed['source-before'], observed['target-raw']
assert len(source['schemas']) == len(target['schemas']) == 20
assert all(accepts_schema(name, schema, target['schemas'][name]) for name, schema in source['schemas'].items())
negative = 0
for pair in proposal['pairs']:
    table = pair['tableName']
    left, right = source['schemas'][table], target['schemas'][table]
    assert accepts_schema(table, left, left) and accepts_schema(table, right, right)
    assert not accepts_schema(table, right, left)
    negative += 1
    for key in profile_keys:
        changed = dict(profile, **{key: 'UNAPPROVED'})
        assert not accepts_schema(table, left, right, changed)
        negative += 1
    for fault in ['literal', 'type', 'flag', 'name', 'table', 'column', 'index', 'missing', 'extra']:
        changed = copy.deepcopy(right)
        constraint = next(c for c in changed['constraints'] if c['name'] == pair['constraintName'])
        if fault == 'literal': constraint['definition'] += ' OR true'
        if fault == 'type': constraint['type'] = 'FOREIGN_KEY'
        if fault == 'flag': constraint['validated'] = False
        if fault == 'name': constraint['name'] += '_different'
        if fault == 'column': changed['columns'][0]['isNullable'] = not changed['columns'][0]['isNullable']
        if fault == 'index': changed['indexes'].append({'name': 'unexpected'})
        if fault == 'missing': changed['constraints'].remove(constraint)
        if fault == 'extra': changed['constraints'].append(copy.deepcopy(constraint))
        assert not accepts_schema('wrong_table' if fault == 'table' else table, left, changed)
        negative += 1
def db_hash(value):
    return hashlib.sha256((json.dumps(value['tables'], sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode()).hexdigest()
assert db_hash(source) == source['dbSnapshotSha256'] and db_hash(target) == target['dbSnapshotSha256']
assert db_hash(source) != db_hash(target)
assert all(a['tableName'] == b['tableName'] and a['rowsSha256'] == b['rowsSha256'] and a['rowCount'] == b['rowCount']
           for a, b in zip(source['tables'], target['tables'], strict=True))
result = {'proposalOnly': True, 'productionEnabled': False, 'directedPairs': 9, 'actualSchemasExplained': 20,
          'negativeCasesPassed': negative, 'sourceDbSnapshotSha256': db_hash(source),
          'proposedTargetRawSnapshotSha256': db_hash(target), 'rawHashesRemainDifferent': True}
(evidence / 'proposal-check.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
