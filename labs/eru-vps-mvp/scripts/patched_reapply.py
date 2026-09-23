"""Explicit same-artifact reapply: verify and preserve the installed core patch."""
from labctl import read, identifier
from core_patch import artifact, readiness, PatchOperator, ALIAS
from labops import digest


def selection(project, build):
    _, checksum = artifact(project, build)
    revision = read(project / 'private/operations/core-revision.json')
    if revision.get('operation') != 'core-patch' or revision.get('artifact_sha256') != checksum:
        raise ValueError('artifact must match the recorded, deployed core patch')
    run = identifier(revision['run'])
    journal = read(project / 'private/operations/runs' / (run + '.json'))
    if journal.get('status') != 'complete' or journal.get('operation') != 'core-patch':
        raise ValueError('core patch deployment is not complete')
    return {'sha256': checksum, 'run': run}


def gate(op, build, health_file, snapshot):
    selected = selection(op.project, build)
    report = read(op.project / health_file)
    result = readiness(report)
    probe = PatchOperator(op.project)
    try:
        runtime = probe.core_runtime()
        footprint = probe.remote({'action': 'inspect', 'machine_id': snapshot['hosts'][ALIAS]['machine_id']})
    finally:
        op.events.extend(probe.events)
        op.save_journal()
    revision = read(op.root / 'core-revision.json')
    if runtime != revision['core_runtime'] or footprint['binary']['sha256'] != selected['sha256']:
        result['blockers'].append('running/owned core differs from the recorded patch')
    services = report['samples'][-1]['commands']['services']['stdout'] if report.get('samples') else ''
    if 'InvocationID=' + runtime['InvocationID'] not in services.splitlines():
        result['blockers'].append('health observations do not cover this core invocation')
    return {'artifact': build, 'health_file': health_file, 'health_sha256': digest(report),
            'selection': selected, 'runtime': runtime, 'footprint': footprint,
            'blockers': result['blockers']}
