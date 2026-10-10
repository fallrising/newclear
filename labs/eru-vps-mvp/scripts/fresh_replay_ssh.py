"""Pinned four-host copied-source replay transport; observation cannot dispatch."""
import base64
import copy
from pathlib import Path

import fresh_replay as contract
import fresh_replay_host as helper
from fresh_bootstrap_render import canonical
from fresh_observation import ALIASES, public_key
from fresh_observation_ops import SSHReader
from fresh_rebuild import plan_digest

ERROR = 'fresh replay adapter rejected'
_BUNDLE = ('app_desired','fresh_rebuild','fresh_execution','fresh_observation',
           'fresh_network_access','fresh_network_staging_host','fresh_network_staging',
           'fresh_network_firewall','fresh_network_firewall_host','worker_payload',
           'fresh_bootstrap_render','fresh_bootstrap_host','labops','app_executor','fresh_replay')


def build_program(request):
    request=helper.validate_request(request)
    raw=canonical(request)
    directory=Path(__file__).resolve().parent
    lines=['import base64, sys, types']
    # Pre-create modules; cycles resolve to their registered canonical names.
    for name in _BUNDLE:
        lines.extend(['_module=types.ModuleType('+repr(name)+')', 'sys.modules['+repr(name)+']=_module'])
    for name in _BUNDLE:
        source=base64.b64encode((directory/(name+'.py')).read_bytes()).decode()
        lines.append('exec(compile(base64.b64decode('+repr(source)+"), '<fixed-replay-support>', 'exec'), sys.modules["+repr(name)+'].__dict__)')
    source=base64.b64encode((directory/'fresh_replay_host.py').read_bytes()).decode()
    lines.extend(['exec(compile(base64.b64decode('+repr(source)+"), '<fixed-replay-helper>', 'exec'), globals())",
                  'main('+repr(base64.b64encode(raw).decode())+')'])
    program='\n'.join(lines)+'\n'
    if len(program.encode())>helper.PROGRAM_LIMIT: raise ValueError(ERROR)
    return program


class SSHReplayAdapter:
    def __init__(self,host_keys,*,transport=None):
        if type(host_keys) is not dict or set(host_keys)!=set(ALIASES) or len({public_key(host_keys[a]) for a in ALIASES})!=4:
            raise ValueError(ERROR)
        self.keys=copy.deepcopy(host_keys); self.transport=SSHReader() if transport is None else transport

    def _send(self,action,operation,index=0,intent=None):
        contract.validate_action(action)
        host={k:action['render']['hosts'][index][k] for k in ('alias','node','ip','machine_id','boot_id','host_key_sha256')}
        key=self.keys[host['alias']]
        if public_key(key)!=host['host_key_sha256']: raise ValueError(ERROR)
        request={'schema_version':1,'operation':operation,'action':action}
        if operation=='capture': request['capture_index']=index
        if intent is not None: request['intent_sha256']=intent
        raw=self.transport(host,build_program(request),key)
        return helper._decode(raw,helper.LIMIT)

    def observe(self,action):
        value=self._send(action,'observe')
        value['evidence']['captures'] += [self._send(action,'capture',index) for index in range(1,4)]
        value['observed_at']=max(row['completed_at'] for row in value['evidence']['captures'])
        if value['state'] in ('complete','absent'):
            helper.validate_evidence(action,value,before=value['state']=='absent')
        return value

    def dispatch(self,action,intent_sha256):
        # One controller dispatch; each helper independently uses create-only
        # intent/result publication and refuses a second write of this action.
        return self._send(action,'dispatch',intent=intent_sha256)
