"""Build a private, worker-only bootstrap plan from an owner-verified replacement host."""
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
from pathlib import Path
import uuid

from labops import atomic_json, digest
from worker_payload import build_worker_payload
from core_release import validation_record

WORKER_INDEX = {
    'ckc-disposable-02': ('worker-2', 2),
    'ckc-disposable-03': ('worker-3', 3),
    'ckc-disposable-04': ('worker-4', 4),
}
POST_REIMAGE_BLOCKER = (
    'Generation commit and recovery executor are not implemented'
)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _safe_json(path, label):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError(label + ' is missing or unsafe')
    try:
        raw = path.read_bytes()
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(label + ' is not valid JSON') from exc
    if not isinstance(data, dict):
        raise ValueError(label + ' is malformed')
    return data, hashlib.sha256(raw).hexdigest()


def _source_plan(operator, plan_id, expected_hash):
    from reimage_prepare import _load_plan, require_prepared

    plan, host = _load_plan(operator, plan_id, expected_hash)
    preparation = require_prepared(operator, plan, expected_hash)
    return plan, host, preparation


def plan_reimage_worker(operator, source_plan_id, expected_hash):
    """Build the worker payload and exact re-registration intent; never connects remotely."""
    from labctl import code_inputs, load_inventory
    from reimage_receipt import load_receipt, verify_local_hostkeys
    from reimage_host import REQUIRED_FACTS, validate_facts

    source_plan, host, preparation = _source_plan(
        operator, source_plan_id, expected_hash)
    source_plan_id = source_plan['id']

    receipt_record_path = operator.root / 'reimage-receipts' / (source_plan_id + '.json')
    receipt_record, receipt_record_sha256 = _safe_json(receipt_record_path, 'recorded owner reimage receipt')
    if (receipt_record.get('plan_id') != source_plan_id
            or receipt_record.get('plan_sha256') != expected_hash
            or receipt_record.get('status') != 'owner-receipt-recorded'
            or receipt_record.get('remote_mutation_performed') is not False
            or receipt_record.get('preparation') != preparation):
        raise ValueError('owner receipt record does not match the source plan and preparation')
    receipt = load_receipt(operator.project, receipt_record.get('receipt_path', ''),
                           plan=source_plan, plan_sha256=expected_hash)
    if (receipt.get('sha256') != receipt_record.get('receipt_sha256')
            or receipt.get('receipt') != receipt_record.get('receipt')):
        raise ValueError('owner receipt changed after it was recorded')
    trusted = verify_local_hostkeys(receipt['receipt']['target']['alias'],
                                    receipt['receipt']['host_key_fingerprints'],
                                    operator.trusted_hostkeys_dir)
    if trusted != receipt_record.get('trusted_host_key_file_check'):
        raise ValueError('replacement host trust file changed after receipt recording')

    observation_path = operator.root / 'reimage-observations' / (source_plan_id + '.json')
    observation_record, observation_record_sha256 = _safe_json(observation_path, 'replacement host observation')
    observation = observation_record.get('observation')
    if (observation_record.get('plan_id') != source_plan_id
            or observation_record.get('plan_sha256') != expected_hash
            or observation_record.get('status') != 'replacement-host-readonly-verified'
            or observation_record.get('remote_mutation_performed') is not False
            or observation_record.get('receipt_sha256') != receipt['sha256']
            or not isinstance(observation, dict)
            or observation_record.get('observation_sha256') != digest(observation)):
        raise ValueError('replacement host observation is missing, changed or bound to another receipt')
    if (observation.get('ssh_verified_by_strict_host_key_check') is not True
            or observation.get('host_key_file_check') != trusted):
        raise ValueError('replacement host strict SSH trust check is missing or changed')
    facts = {key: observation.get(key) for key in REQUIRED_FACTS}
    expected_replacement = {
        **receipt['receipt']['replacement'],
        'host_key_fingerprints': receipt['receipt']['host_key_fingerprints'],
    }
    validate_facts(facts, expected_replacement)

    alias = host['alias']
    if alias not in WORKER_INDEX or WORKER_INDEX[alias][0] != source_plan['node']:
        raise ValueError('replacement target alias and node are not a reviewed worker pair')
    index = WORKER_INDEX[alias][1]
    old_machine_id = source_plan['provider_reimage_intent']['target']['machine_id']
    if (receipt['receipt']['target']['machine_id'] != old_machine_id
            or receipt['receipt']['replacement']['machine_id'] == old_machine_id
            or receipt['receipt']['replacement']['boot_id'] ==
               source_plan['snapshot']['hosts'][alias]['boot_id']):
        raise ValueError('replacement machine or boot identity does not represent a new host incarnation')

    old_nodes = [row for row in source_plan['snapshot']['nodes'] if row.get('name') == source_plan['node']]
    if len(old_nodes) != 1:
        raise ValueError('source plan lacks exactly one prior worker registration')
    old_node = old_nodes[0]
    if (old_node.get('podname') != 'eru'
            or old_node.get('labels', {}).get('owner') != 'eru-vps-mvp'):
        raise ValueError('prior worker pod or owner identity is outside the reviewed scope')
    try:
        capacity = json.loads(old_node['resource_capacity'])
        if not isinstance(capacity, dict):
            raise ValueError
    except (TypeError, KeyError, json.JSONDecodeError) as exc:
        raise ValueError('prior worker resource capacity is unreadable') from exc

    current_bindings = {
        'inventory': load_inventory(operator.project),
        'inputs': code_inputs(operator.project),
        'cluster': operator.cluster(),
        'provider_reimage_intent': source_plan['bindings']['provider_reimage_intent'],
    }
    if current_bindings != source_plan['bindings']:
        raise ValueError('inventory, generation, intent or pinned inputs changed; create a new provider reimage plan')
    core_ip = next(row['ip'] for row in source_plan['bindings']['inventory'] if row['role'] == 'core')
    worker_host = {
        'alias': alias, 'node': source_plan['node'], 'index': index,
        'ip': observation['tailscale_ipv4'],
    }
    artifacts_lock_path = operator.project / 'artifacts.amd64.lock.json'
    artifacts_lock = json.loads(artifacts_lock_path.read_text())
    payload = build_worker_payload(worker_host, core_ip, artifacts_lock)
    if payload['role'] != 'worker' or {row['repository'] for row in payload['artifacts']} != {
            'projecteru2/agent', 'containernetworking/plugins'}:
        raise ValueError('replacement payload contains non-worker artifacts')
    worker_files = [
        {'path': row['path'], 'mode': row['mode'],
         'sha256': hashlib.sha256(row['content'].encode()).hexdigest()}
        for row in payload['files']
    ]
    registration = {
        'node': source_plan['node'],
        'podname': old_node['podname'],
        'endpoint': 'containerd://ckc@' + str(ipaddress.ip_address(observation['tailscale_ipv4'])) + ':22',
        'labels': old_node['labels'],
        'resource_capacity': old_node['resource_capacity'],
    }
    core_release = validation_record(
        operator.project, 'patches/core-v0.1.5-safe-node-add.validation.json')
    plan = {
        'schema': 1,
        'id': datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8],
        'created_at': _now(),
        'operation': 'provider-reimage-worker-bootstrap',
        'source_reimage_plan': {'id': source_plan_id, 'sha256': expected_hash},
        'source_receipt_record_sha256': receipt_record_sha256,
        'source_observation_record_sha256': observation_record_sha256,
        'source_observation_sha256': observation_record['observation_sha256'],
        'preparation_summary_sha256': preparation['summary_sha256'],
        'bindings': current_bindings,
        'target': {
            'alias': alias, 'node': source_plan['node'], 'index': index,
            'old_machine_id': old_machine_id,
            'machine_id': observation['machine_id'], 'boot_id': observation['boot_id'],
            'os_release': observation['os_release'],
            'tailscale_ipv4': observation['tailscale_ipv4'],
            'docker_version': observation['docker_version'],
            'containerd_version': observation['containerd_version'],
        },
        'registration': registration,
        'worker_payload': payload,
        'worker_payload_sha256': digest(payload),
        'resulting_cluster': {
            'cluster_id': current_bindings['cluster']['cluster_id'],
            'generation': current_bindings['cluster']['generation'] + 1,
        },
        'worker_files': worker_files,
        'artifacts_lock_sha256': hashlib.sha256(artifacts_lock_path.read_bytes()).hexdigest(),
        'worker_install': {
            'executable': True,
            'blockers': [],
            'steps': [
                'Revalidate the owner receipt, strict host trust, fresh host identity and unchanged core membership',
                'Install only locked ERU agent/CNI artifacts and worker configuration; preserve OS, SSH/Tailscale and Docker/containerd',
                'Start only eru-containerd-proxy.socket; leave eru-agent stopped and disabled',
                'Verify installed owner manifest, preserved services, empty runtime and absent worker registration',
            ],
        },
        'worker_registration': {
            'executable': True,
            'blockers': [],
            'core_release': core_release,
            'steps': [
                'Verify the running core binary matches the reviewed Bypass-at-Add release',
                'Add the exact prior worker identity and resource map; require Bypass=true',
                'Start only eru-agent and wait for available=true while Bypass remains true',
                'Stop before smoke, node up, inventory update or cluster generation commit',
            ],
        },
        'mutation_hosts': [operator.core['alias'], alias],
        'executable': False,
        'blockers': [POST_REIMAGE_BLOCKER],
        'steps': [
            'Revalidate owner receipt, host observation, trust file and core membership',
            'Install only locked agent/CNI artifacts and six ERU worker files; preserve OS, SSH/Tailscale, Docker/containerd',
            'Add the prior worker name/capacity at the verified replacement Tailscale endpoint',
            'Fence the new registration before starting eru-agent; require availability while still fenced',
            'Run target smoke and other-worker guards; resume scheduling only after all checks pass',
            'Commit the new worker address and cluster generation after verified resume',
        ],
    }
    path = operator.root / 'reimage-bootstrap-plans' / (plan['id'] + '.json')
    if path.exists() or path.is_symlink():
        raise ValueError('worker bootstrap plan already exists; do not overwrite it')
    envelope = {'plan': plan, 'sha256': digest(plan)}
    atomic_json(path, envelope)
    return envelope
