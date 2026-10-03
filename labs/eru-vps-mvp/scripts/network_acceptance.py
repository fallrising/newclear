#!/usr/bin/env python3
"""Plan, verify, and clean a bounded worker host-network/CNI acceptance run."""
from datetime import datetime, timezone
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
import uuid

from labctl import ALIASES, OWNER, Operator, code_inputs, consistency_issues, load_inventory, membership, read
from labops import ClusterLock, atomic_json, digest

PROJECT = Path(__file__).resolve().parent.parent
NETWORK = 'private/operations/network'
TARGET_NODE = 'worker-4'
TARGET_ALIAS = 'ckc-disposable-04'
SOURCE_APP_PREFIX = 'erumvp'
EGRESS_HOST = 'ipv4.icanhazip.com'
FORWARD_CHAIN = 'ufw-before-forward'
DNS_BYPASS_CHAIN = 'DOCKER-USER'
DNS_UPSTREAM_DROP_CHAIN = 'ONEVPS-INGRESS'
EGRESS_RULE_MARKER = 'eru006-'
PLAN_ID = re.compile(r'\d{8}T\d{6}Z-[0-9a-f]{8}\Z')

# Runs only on an explicitly supplied ckc-disposable alias. Output includes
# private addresses for a private plan, but never emits raw firewall rules.
REMOTE_FACTS = r'''import hashlib,ipaddress,json,pathlib,re,socket,subprocess,sys
IMAGE = IMAGE_VALUE
TABLE = TABLE_VALUE
ENDPOINT = ENDPOINT_VALUE
def command(argv):
 p=subprocess.run(argv,capture_output=True,text=True,timeout=25)
 return p
def active(unit):
 p=command(['systemctl','is-active',unit])
 return p.stdout.strip() if p.returncode in (0,3,4) else 'unknown'
def sha(path):
 try:return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
 except FileNotFoundError:return None
def listeners():
 p=command(['ss','-H','-lnt'])
 result={str(port):[] for port in (22,80,2379,2380,5001)}
 if p.returncode:raise RuntimeError('ss failed')
 for line in p.stdout.splitlines():
  fields=line.split()
  if len(fields)<4:continue
  local=fields[3]
  try:port=int(local.rsplit(':',1)[1])
  except (ValueError,IndexError):continue
  if str(port) in result:result[str(port)].append(local)
 return {k:sorted(v) for k,v in result.items()}
def clean(value):
 if isinstance(value,dict):return {k:clean(v) for k,v in value.items() if k not in ('handle','counter')}
 if isinstance(value,list):return [clean(v) for v in value]
 return value
nft=command(['/usr/sbin/nft','-j','list','ruleset'])
if nft.returncode:raise RuntimeError('nft ruleset unavailable')
nft_json=json.loads(nft.stdout)
chains=[];forward_chains=[];tables=[]
for row in nft_json.get('nftables',[]):
 for kind,value in row.items():
  if kind=='table':tables.append({'family':value.get('family'),'name':value.get('name')})
  elif kind=='chain' and value.get('hook')=='input':
   chains.append({k:value.get(k) for k in ('family','table','name','type','hook','prio','policy')})
  if kind=='chain' and value.get('hook')=='forward':
   forward_chains.append({k:value.get(k) for k in ('family','table','name','type','hook','prio','policy')})
chains.sort(key=lambda x:(str(x.get('family')),str(x.get('table')),str(x.get('name'))))
forward_chains.sort(key=lambda x:(str(x.get('family')),str(x.get('table')),str(x.get('name'))))
tables.sort(key=lambda x:(str(x.get('family')),str(x.get('name'))))
global6=[]
p=command(['ip','-6','-j','addr','show','scope','global'])
if p.returncode==0:
 for link in json.loads(p.stdout):
  if link.get('ifname')=='tailscale0':continue
  for info in link.get('addr_info',[]):
   try:
    addr=ipaddress.ip_address(info.get('local',''))
    flags=info.get('flags',[])
    if addr.version==6 and addr.is_global and not {'temporary','deprecated'} & set(flags):global6.append(str(addr))
   except ValueError:pass
ts6=command(['tailscale','ip','-6'])
ufw=command(['ufw','status','verbose'])
if ufw.returncode not in (0,):raise RuntimeError('ufw status failed')
ufw_lines=[line.strip() for line in ufw.stdout.splitlines()]
ufw_default=next((x for x in ufw_lines if x.startswith('Default:')),None)
route_policy_match=re.search(r'\b(allow|deny|reject)\s+\(routed\)',ufw_default or '',re.I)
forward_probe=command(['/usr/sbin/iptables','-S','ufw-before-forward'])
forward_lines=forward_probe.stdout.splitlines() if forward_probe.returncode==0 else []
established_accept=False
for line in forward_lines:
 fields=line.split()
 try:state=fields[fields.index('--ctstate')+1].split(',')
 except (ValueError,IndexError):continue
 if 'ESTABLISHED' in state and 'RELATED' in state and fields[-2:]==['-j','ACCEPT']:
  established_accept=True
docker_user_probe=command(['/usr/sbin/iptables','-S','DOCKER-USER'])
ingress_probe=command(['/usr/sbin/iptables','-S','ONEVPS-INGRESS'])
root_forward_probe=command(['/usr/sbin/iptables','-S','FORWARD'])
def append_rules(output,chain):
 return [line.split() for line in output.splitlines() if line.startswith('-A '+chain+' ')]
docker_user_rules=append_rules(docker_user_probe.stdout,'DOCKER-USER')
ingress_rules=append_rules(ingress_probe.stdout,'ONEVPS-INGRESS')
root_forward_rules=append_rules(root_forward_probe.stdout,'FORWARD')
root_jumps=[row[row.index('-j')+1] for row in root_forward_rules if '-j' in row]
upstream_dns_path_verified=(docker_user_probe.returncode==0 and ingress_probe.returncode==0
 and root_forward_probe.returncode==0
 and docker_user_rules==[['-A','DOCKER-USER','-j','ONEVPS-INGRESS']]
 and bool(ingress_rules) and ingress_rules[-1]==['-A','ONEVPS-INGRESS','-j','DROP']
 and ['-A','ONEVPS-INGRESS','-p','tcp','-m','multiport','--dports','80,443','-j','ACCEPT'] in ingress_rules
 and root_jumps.count('DOCKER-USER')==1 and root_jumps.count('ufw-before-forward')==1
 and root_jumps.index('DOCKER-USER')<root_jumps.index('ufw-before-forward'))
ip_forward=command(['/sbin/sysctl','-n','net.ipv4.ip_forward'])
resolver_v4=[]
try:
 for line in pathlib.Path('/etc/resolv.conf').read_text().splitlines():
  fields=line.split()
  if len(fields)>1 and fields[0]=='nameserver':
   try:
    address=ipaddress.ip_address(fields[1])
    if address.version==4 and not (address.is_unspecified or address.is_loopback or address.is_link_local or address.is_multicast):
     resolver_v4.append(str(address))
   except ValueError:pass
except OSError:pass
endpoint_v4=[]
try:
 for row in socket.getaddrinfo(ENDPOINT,443,socket.AF_INET,socket.SOCK_STREAM):
  address=ipaddress.ip_address(row[4][0])
  if address.version==4 and address.is_global:endpoint_v4.append(str(address))
except OSError:pass
endpoint_v6=[]
try:
 for row in socket.getaddrinfo(ENDPOINT,443,socket.AF_INET6,socket.SOCK_STREAM):
  address=ipaddress.ip_address(row[4][0])
  if address.version==6:endpoint_v6.append(str(address))
except OSError:pass
bridge_egress={'endpoint':'https://' + ENDPOINT + '/','resolver_ipv4':sorted(set(resolver_v4)),
               'endpoint_ipv4':sorted(set(endpoint_v4)),'endpoint_ipv6':sorted(set(endpoint_v6))}
units=['ufw.service','tailscaled.service','docker.service','containerd.service','fail2ban.service']
if ROLE=='worker':units += ['eru-agent.service','eru-containerd-proxy.socket','eru-containerd-proxy.service']
else:units += ['eru-core.service','eru-etcd.service','eru-mvp-firewall.service']
service_state={unit:active(unit) for unit in units}
def ids(argv):
 p=command(argv)
 if p.returncode:raise RuntimeError('container list failed: '+argv[0])
 return sorted(x for x in p.stdout.splitlines() if x.strip())
eructr=ids(['ctr','--namespace','eru','containers','list','-q'])
task_result=command(['ctr','--namespace','eru','tasks','list'])
if task_result.returncode:raise RuntimeError('containerd task list failed')
eru_tasks=sorted(line.split()[0] for line in task_result.stdout.splitlines()[1:] if line.split())
docker=ids(['docker','ps','-aq'])
images=command(['ctr','--namespace','eru','images','list','-q'])
if images.returncode:raise RuntimeError('containerd image list failed')
stable_nft=clean(nft_json); volatile_sets=[]
for row in stable_nft.get('nftables',[]):
 value=row.get('set')
 if (isinstance(value,dict) and value.get('family')=='inet' and value.get('table')=='f2b-table'
         and value.get('name')=='addr-set-sshd'):
  value.pop('elem',None)
  volatile_sets.append({'family':'inet','table':'f2b-table','name':'addr-set-sshd'})
rules_hash=hashlib.sha256(json.dumps(stable_nft,sort_keys=True,separators=(',',':')).encode()).hexdigest()
try:owner=json.loads(pathlib.Path('/var/lib/eru-mvp/owner.json').read_text()).get('owner')
except (OSError,ValueError):owner=None
try:machine_id=pathlib.Path('/etc/machine-id').read_text().strip()
except OSError:machine_id=None
try:boot_id=pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()
except OSError:boot_id=None
print(json.dumps({
 'role':ROLE,'owner':owner,'machine_id':machine_id,'boot_id':boot_id,
 'iptables_v':command(['/usr/sbin/iptables','-V']).stdout.strip(),
 'ip6tables_v':command(['/usr/sbin/ip6tables','-V']).stdout.strip(),
 'global_ipv6':sorted(set(global6)), 'tailscale_ipv6':ts6.stdout.split(),
 'listeners':listeners(), 'services':service_state,
 'ufw_active':'Status: active' in ufw.stdout,
 'ufw_default_incoming':ufw_default,
 'ufw_default_routed':route_policy_match.group(1).lower() if route_policy_match else None,
 'ufw_80_rules':[x for x in ufw_lines if re.search(r'(^|\s)80/tcp\b',x)],
 'ufw_user_rules_sha256':{'v4':sha('/etc/ufw/user.rules'),'v6':sha('/etc/ufw/user6.rules')},
 'nft_input_chains':chains,'nft_forward_chains':forward_chains,
 'nft_volatile_sets':volatile_sets,'nft_rules_sha256':rules_hash,
 'ipv4_forward_enabled':ip_forward.returncode==0 and ip_forward.stdout.strip()=='1',
 'ufw_before_forward_available':forward_probe.returncode==0,
 'ufw_before_forward_established_accept':established_accept,
 'upstream_dns_path_verified':upstream_dns_path_verified,
 'bridge_egress':bridge_egress if ROLE=='worker' else None,
 'eru_container_ids':eructr,'eru_task_ids':eru_tasks,'docker_container_ids':docker,
 'locked_nginx_cached':any(x.strip()==IMAGE for x in images.stdout.splitlines()),
 'network_guard_table_exists':any(x.get('family')=='inet' and x.get('name')==TABLE for x in tables)
},sort_keys=True))
'''

LISTENER_OWNERSHIP = r'''import json,re,subprocess,sys
target=sys.argv[1]
def run(argv):
 p=subprocess.run(argv,capture_output=True,text=True,timeout=15)
 if p.returncode:raise RuntimeError('listener ownership query failed: '+argv[0])
 return p.stdout
tasks=run(['ctr','--namespace','eru','tasks','list'])
task=None
for line in tasks.splitlines()[1:]:
 fields=line.split()
 if len(fields)>=3 and fields[0]==target:
  try:task={'id':fields[0],'pid':int(fields[1]),'status':fields[2]}
  except ValueError:pass
def ppid(pid):
 try:
  text=open('/proc/%d/stat'%pid).read(); tail=text[text.rfind(')')+2:].split()
  return int(tail[1]) if len(tail)>1 else None
 except (OSError,ValueError,IndexError):return None
def comm(pid):
 try:
  text=open('/proc/%d/stat'%pid).read();return text[text.find('(')+1:text.rfind(')')]
 except OSError:return None
def descends(pid,parent):
 seen=set()
 while pid and pid not in seen:
  if pid==parent:return True
  seen.add(pid);pid=ppid(pid)
 return False
rows=[]
for family in (4,6):
 listen=run(['ss','-H','-'+str(family),'-lntp','( sport = :80 )'])
 for line in listen.splitlines():
  fields=line.split()
  if len(fields)<5:continue
  local=fields[3]
  pairs=re.findall(r'\("([^" ]+)",pid=(\d+)',line)
  processes=[{'name':name,'pid':int(pid),'owned':bool(task and descends(int(pid),task['pid']))} for name,pid in pairs]
  rows.append({'family':family,'local':local,'processes':processes})
print(json.dumps({'task':task,'listeners':rows},sort_keys=True))
'''

CONTAINER_NETWORK = r'''import json,os,subprocess,sys
identifier=sys.argv[1]
p=subprocess.run(['ctr','--namespace','eru','containers','info',identifier],capture_output=True,text=True,timeout=15)
if p.returncode:raise RuntimeError('container inspect failed')
d=json.loads(p.stdout);spec=d.get('Spec') or {}
if isinstance(spec,str):spec=json.loads(spec)
linux=spec.get('linux') or {}
namespaces=linux.get('namespaces') or []
labels=d.get('Labels') or {}
host_net=os.stat('/proc/1/ns/net')
isolated=False
for namespace in namespaces:
 if namespace.get('type')!='network':continue
 path=namespace.get('path')
 if not path:
  isolated=True;continue
 try:other=os.stat(path)
 except OSError:
  isolated=True;continue
 if (other.st_dev,other.st_ino)!=(host_net.st_dev,host_net.st_ino):isolated=True
print(json.dumps({'id':d.get('ID'),'image':d.get('Image'),
 'eru_network_ip':labels.get('eru.network.eru'),
 'network_namespace_isolated':isolated,
 'labels':{k:v for k,v in labels.items() if k.startswith('eru.') or k in ('owner','run')}}))
'''

CNI_RULES = r'''import json,subprocess,sys
TABLE='cni_plugins_masquerade'
def run(argv):
 p=subprocess.run(argv,capture_output=True,text=True,timeout=15)
 if p.returncode:raise RuntimeError('CNI nftables inspection failed')
 return json.loads(p.stdout)
tables=run(['/usr/sbin/nft','-j','list','tables'])
if not any(x.get('family')=='inet' and x.get('name')==TABLE
           for row in tables.get('nftables',[]) for kind,x in row.items() if kind=='table'):
 print('[]');sys.exit(0)
data=run(['/usr/sbin/nft','-a','-j','list','table','inet',TABLE])
rules=[]
for row in data.get('nftables',[]):
 for kind,value in row.items():
  if kind=='rule':
   rules.append({k:value.get(k) for k in ('family','table','chain','handle','comment','expr')})
print(json.dumps(rules,sort_keys=True))
'''

FORWARD_RULES = r'''import json,shlex,subprocess,sys
marker='eru006-'+sys.argv[1]+'-egress-'
p=subprocess.run(['/usr/sbin/iptables-save','-t','filter'],capture_output=True,text=True,timeout=15)
if p.returncode:raise RuntimeError('forwarding-rule inspection failed')
rows=[]
for line in p.stdout.splitlines():
 if not line.startswith('-A '):continue
 try:tokens=shlex.split(line)
 except ValueError:raise RuntimeError('forwarding rule could not be parsed')
 if '--comment' not in tokens:continue
 try:comment=tokens[tokens.index('--comment')+1]
 except IndexError:raise RuntimeError('forwarding rule comment is incomplete')
 if comment.startswith(marker):rows.append({'chain':tokens[1],'comment':comment,'tokens':tokens})
print(json.dumps(rows,sort_keys=True))
'''

FORWARD_RULE_TEST = r'''import json,subprocess
rule=['-s','192.0.2.10/32','-d','198.51.100.20/32','-p','udp','-m','udp','--dport','53',
      '-m','comment','--comment','eru006-preflight-dns-udp','-j','ACCEPT']
p=subprocess.run(['/usr/sbin/iptables','--wait','5','-C','DOCKER-USER']+rule,
                 capture_output=True,text=True,timeout=10)
row={'chain':'DOCKER-USER','exit_code':p.returncode,'tag_present':p.returncode==0,
     'syntax_ok':p.returncode in (0,1)}
print(json.dumps({'syntax_ok':row['syntax_ok'],'tag_present':row['tag_present'],'checks':[row]},sort_keys=True))
'''


def now():
    return datetime.now(timezone.utc).isoformat()


def valid_run_id(value):
    if not PLAN_ID.fullmatch(value):
        raise ValueError('invalid network acceptance ID')
    return value


def table_name(run_id):
    return 'eru006_' + valid_run_id(run_id).rsplit('-', 1)[1]


def canonical_addresses(values, version):
    result = []
    for raw in values:
        address = ipaddress.ip_address(raw)
        if address.version != version or address.is_unspecified or address.is_multicast:
            raise ValueError('invalid management source address family')
        normalized = str(address)
        if normalized not in result:
            result.append(normalized)
    return sorted(result, key=lambda value: int(ipaddress.ip_address(value)))


def guard_lines(run_id, sources):
    table = table_name(run_id)
    v4 = canonical_addresses(sources.get('ipv4', []), 4)
    v6 = canonical_addresses(sources.get('ipv6', []), 6)
    if not v4:
        raise ValueError('a reviewed management IPv4 source is required')
    lines = [f'add table inet {table}',
             f'add chain inet {table} input {{ type filter hook input priority -10; policy accept; }}']
    for family, values in ((4, v4), (6, v6)):
        proto = 'ip' if family == 4 else 'ip6'
        for index, address in enumerate(values):
            lines.append(f'add rule inet {table} input {proto} saddr {address} tcp dport 80 accept comment "eru006-{run_id}-allow{family}-{index}"')
    lines.append(f'add rule inet {table} input tcp dport 80 drop comment "eru006-{run_id}-drop-rest"')
    return '\n'.join(lines) + '\n'


def expected_guard(run_id, sources):
    install = guard_lines(run_id, sources).splitlines()
    lines = [f'table inet {table_name(run_id)} {{',
             ' chain input {',
             '  type filter hook input priority -10; policy accept;']
    lines.extend('  ' + line.removeprefix(f'add rule inet {table_name(run_id)} input ')
                 for line in install[2:])
    lines.extend([' }', '}'])
    return ' '.join(' '.join(lines).split())


def _normalize_guard_text(text):
    clean = '\n'.join(line for line in text.splitlines() if not line.startswith('# Warning:'))
    def normalize_priority(match):
        value = priority_number(match.group(1).strip())
        return 'priority ' + str(value) + ';' if value is not None else match.group(0)
    clean = re.sub(r'\bpriority\s+([^;]+);', normalize_priority, clean)
    return ' '.join(clean.split())


def verify_guard_text(text, run_id, sources):
    return _normalize_guard_text(text) == _normalize_guard_text(expected_guard(run_id, sources))


def priority_number(value):
    if isinstance(value, int):
        return value
    if value == 'filter':
        return 0
    match = re.fullmatch(r'filter\s*([+-])\s*(\d+)', str(value))
    if match:
        amount = int(match.group(2))
        return amount if match.group(1) == '+' else -amount
    return None


def _normalize_nft_ruleset(value):
    def clean(item):
        if isinstance(item, dict):
            return {key: clean(child) for key, child in item.items() if key not in ('handle','counter')}
        if isinstance(item, list):
            return [clean(child) for child in item]
        return item

    stable = clean(value)
    volatile = []
    for row in stable.get('nftables', []) if isinstance(stable, dict) else []:
        if not isinstance(row, dict):
            continue
        item = row.get('set')
        if (isinstance(item, dict) and item.get('family') == 'inet' and item.get('table') == 'f2b-table'
                and item.get('name') == 'addr-set-sshd'):
            item.pop('elem', None)
            volatile.append({'family':'inet','table':'f2b-table','name':'addr-set-sshd'})
    return stable, volatile


def _egress_forward_rule_specs(run_id, cni_ip, bridge_egress):
    valid_run_id(run_id)
    try:
        source = ipaddress.IPv4Address(cni_ip)
    except ipaddress.AddressValueError as exc:
        raise ValueError('run-owned CNI address is not IPv4') from exc
    if source.is_global or source.is_unspecified or source.is_loopback or source.is_link_local or source.is_multicast:
        raise ValueError('run-owned CNI address is outside the private bridge range')
    if bridge_egress.get('endpoint') != 'https://' + EGRESS_HOST + '/':
        raise ValueError('bridge egress endpoint differs from the reviewed HTTPS target')
    if bridge_egress.get('endpoint_ipv6'):
        raise ValueError('reviewed HTTPS endpoint has IPv6 DNS answers')
    resolvers = canonical_addresses(bridge_egress.get('resolver_ipv4', []), 4)
    endpoints = canonical_addresses(bridge_egress.get('endpoint_ipv4', []), 4)
    if not resolvers or not endpoints:
        raise ValueError('bridge egress plan has no IPv4 DNS resolver or HTTPS endpoint')
    if any(not ipaddress.IPv4Address(value).is_global for value in endpoints):
        raise ValueError('HTTPS endpoint address is not globally routed IPv4')
    rules = []
    prefix = 'eru006-' + run_id + '-egress-'
    for index, destination in enumerate(resolvers):
        rules.append({'chain':DNS_BYPASS_CHAIN,'source':str(source) + '/32','destination':destination + '/32',
                      'protocol':'udp','port':53,'target':'ACCEPT',
                      'comment':prefix + 'dns-' + str(index) + '-udp'})
    return rules


def _wget_probe_supported(help_output):
    text = str(help_output)
    has_server_response = '-S' in text or re.search(r'\[-[^]]*S[^]]*\]', text) is not None
    return ('usage: wget' in text.lower() and 'unrecognized option' not in text.lower()
            and has_server_response and all(flag in text for flag in ('-T', '-O', '-Y')))


def _wget_https_command():
    return 'wget -Y off -S -T 20 -O /dev/null https://' + EGRESS_HOST + '/'


def _nslookup_a_query_supported(help_output):
    text = str(help_output).lower()
    return ('usage: nslookup' in text and 'unrecognized option' not in text
            and '-type=query_type' in text)


def _nslookup_a_command(resolver):
    address = canonical_addresses([resolver], 4)
    if len(address) != 1:
        raise ValueError('bridge DNS resolver must be one IPv4 address')
    return 'nslookup -type=a ' + EGRESS_HOST + ' ' + address[0]


def _global_dns_ipv4_answers(output):
    sections = str(output).rsplit('Name:', 1)
    if len(sections) != 2:
        return []
    result = set()
    for raw in re.findall(r'(?<![\w.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![\w.])', sections[-1]):
        try:
            address = ipaddress.IPv4Address(raw)
        except ipaddress.AddressValueError:
            continue
        if address.is_global:
            result.add(str(address))
    return sorted(result, key=lambda value: int(ipaddress.IPv4Address(value)))


def _forward_rule_args(rule):
    return ['-s',rule['source'],'-d',rule['destination'],'-p',rule['protocol'],'-m',rule['protocol'],
            '--dport',str(rule['port']),'-m','comment','--comment',rule['comment'],'-j',rule.get('target','ACCEPT')]


def _forward_rule_tokens(rule):
    return ['-A',rule['chain'],*_forward_rule_args(rule)]


def _forward_rule_matches(tokens, rule):
    if not isinstance(tokens,list) or len(tokens)<4 or tokens[:2]!=['-A',rule.get('chain',FORWARD_CHAIN)]:
        return False
    values={}
    modules=[]
    index=2
    while index<len(tokens):
        option=tokens[index]
        if option=='-m':
            if index+1>=len(tokens):return False
            modules.append(tokens[index+1]);index+=2;continue
        if option not in ('-s','-d','-p','--dport','--comment','-j') or index+1>=len(tokens):
            return False
        if option in values:return False
        values[option]=tokens[index+1]
        index+=2
    try:
        source=ipaddress.ip_interface(values['-s'])
        destination=ipaddress.ip_interface(values['-d'])
        port=int(values['--dport'])
    except (KeyError,ValueError):
        return False
    expected_source=ipaddress.ip_interface(rule['source'])
    expected_destination=ipaddress.ip_interface(rule['destination'])
    return (source.version==4 and source.network.prefixlen==32
            and destination.version==4 and destination.network.prefixlen==32
            and source.ip==expected_source.ip and destination.ip==expected_destination.ip
            and values.get('-p')==rule['protocol'] and values.get('--dport')==str(rule['port'])
            and values.get('--comment')==rule['comment'] and values.get('-j')==rule.get('target','ACCEPT')
            and sorted(modules)==sorted([rule['protocol'],'comment']))


def _forward_rule_command(rule, action):
    command = ['sudo','-n','/usr/sbin/iptables','--wait','5']
    if action == 'insert':
        return command + ['-I',rule['chain'],'1'] + _forward_rule_args(rule)
    if action == 'delete':
        return command + ['-D',rule['chain']] + _forward_rule_args(rule)
    if action == 'check':
        return command + ['-C',rule['chain']] + _forward_rule_args(rule)
    raise ValueError('unsupported exact forwarding rule action')


def _forward_run_targets_from_rows(rows, report, run_id):
    expected = {item.get('comment'):item for item in report.get('egress_forward_rules', [])}
    marker = 'eru006-' + valid_run_id(run_id) + '-egress-'
    result = []
    seen = set()
    for row in rows:
        comment = row.get('comment') if isinstance(row, dict) else None
        if not isinstance(comment, str) or not comment.startswith(marker):
            continue
        target = expected.get(comment)
        if target is None or comment in seen:
            raise ValueError('run-tagged forward rule has no unique plan-bound owner')
        if row.get('chain') != target.get('chain', FORWARD_CHAIN) or not _forward_rule_matches(row.get('tokens'), target):
            raise ValueError('run-tagged forward rule differs from its exact source/destination/port plan')
        seen.add(comment)
        result.append(target)
    return sorted(result, key=lambda item:item['comment'])


def _tailscale_addresses(family):
    result = subprocess.run(['tailscale', 'ip', '-' + str(family)], capture_output=True,
                            text=True, timeout=10)
    if result.returncode:
        return []
    values = []
    for item in result.stdout.split():
        try:
            value = ipaddress.ip_address(item.split('%')[0])
            if value.version == family:
                values.append(str(value))
        except ValueError:
            continue
    return sorted(set(values), key=lambda item: int(ipaddress.ip_address(item)))


def _ssh_public_addresses(alias):
    config = subprocess.run(['ssh', '-G', alias], capture_output=True, text=True,
                            timeout=10, check=True).stdout
    host = next((line.split(None, 1)[1] for line in config.splitlines()
                 if line.startswith('hostname ')), None)
    if not host:
        return []
    try:
        rows = socket.getaddrinfo(host, 22, type=socket.SOCK_STREAM)
    except OSError:
        return []
    result = set()
    for row in rows:
        try:
            address = ipaddress.ip_address(row[4][0].split('%')[0])
            if address.is_global:
                result.add(str(address))
        except ValueError:
            continue
    return sorted(result, key=lambda item: (ipaddress.ip_address(item).version, int(ipaddress.ip_address(item))))


def _route(address):
    ip = ipaddress.ip_address(address)
    family = '-4' if ip.version == 4 else '-6'
    result = subprocess.run(['ip', family, '-j', 'route', 'get', str(ip)],
                            capture_output=True, text=True, timeout=10)
    if result.returncode:
        return {'available': False, 'device': None, 'source': None}
    try:
        rows = json.loads(result.stdout)
        row = rows[0] if rows else {}
        return {'available': bool(row.get('dev')), 'device': row.get('dev'),
                'source': row.get('prefsrc') or row.get('src')}
    except (ValueError, IndexError, TypeError):
        return {'available': False, 'device': None, 'source': None}


def _tcp_reachable(address, port, timeout=3):
    ip = ipaddress.ip_address(address)
    family = socket.AF_INET if ip.version == 4 else socket.AF_INET6
    endpoint = (str(ip), port) if ip.version == 4 else (str(ip), port, 0, 0)
    try:
        with socket.socket(family, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            sock.connect(endpoint)
        return {'reachable': True, 'error': None}
    except OSError as exc:
        return {'reachable': False, 'error': type(exc).__name__}


def _remote_facts(op, alias, role, image, table, include_egress=False):
    script = (REMOTE_FACTS.replace('IMAGE_VALUE', repr(image))
              .replace('TABLE_VALUE', repr(table))
              .replace('ENDPOINT_VALUE', repr(EGRESS_HOST))
              .replace('ROLE', repr(role)))
    output = op.command(alias, ['sudo', '-n', 'python3', '-'], script, timeout=40)
    facts = json.loads(output)
    if not include_egress:
        facts.pop('bridge_egress', None)
    return facts


def _remote_guard_test(op, alias, table):
    script = guard_lines('20260924T000000Z-' + table.rsplit('_', 1)[-1],
                         {'ipv4': ['192.0.2.10'], 'ipv6': ['2001:db8::10']})
    # Use the real unique table name but only nft --check; no rules are installed.
    script = script.replace(table_name('20260924T000000Z-' + table.rsplit('_', 1)[-1]), table)
    result = op.command(alias, ['sudo', '-n', '/usr/sbin/nft', '--check', '-f', '-'],
                        script, check=False, timeout=20)
    event = op.events[-1]
    return {'exit_code': event.get('exit_code'), 'stderr': event.get('stderr', '')[:500]}


def _reviewed_ufw_tcp80_rules(lines):
    normalized = '\n'.join(' '.join(line.split()) for line in lines)
    ipv4 = re.search(r'(?m)^80/tcp\s+ALLOW\s+IN\s+Anywhere(?:\s|$)', normalized)
    ipv6 = re.search(r'(?m)^80/tcp\s+\(v6\)\s+ALLOW\s+IN\s+Anywhere\s+\(v6\)(?:\s|$)', normalized)
    return bool(ipv4), bool(ipv6)


def _input_chain_safe(chains):
    priorities = []
    for chain in chains:
        if chain.get('hook') != 'input':
            continue
        value = priority_number(chain.get('prio'))
        if value is None:
            return False, priorities
        priorities.append(value)
    return bool(priorities) and all(-10 < value for value in priorities), sorted(priorities)


def _port22_paths(public):
    paths = {}
    for group, addresses in public.items():
        paths[group] = []
        for address in addresses:
            route = _route(address)
            control = _tcp_reachable(address, 22)
            paths[group].append({'address': address, 'route': route,
                                 'tcp22': control['reachable'], 'tcp22_error': control['error']})
    return paths


def _route_path_blockers(paths, required=()):
    blockers = []
    for group, rows in paths.items():
        if not rows and group in required:
            blockers.append(group + ': no public endpoint to probe')
        for row in rows:
            if not row['route']['available'] or row['route']['device'] == 'tailscale0':
                blockers.append(group + ': public route is unavailable or uses Tailscale')
            if not row['tcp22']:
                blockers.append(group + ': public TCP/22 control probe failed')
    return blockers


def build_network_plan(op, run_id, snapshot):
    inventory = op.inventory
    target = next(x for x in inventory if x['node'] == TARGET_NODE)
    core = inventory[0]
    image = json.loads((op.project / 'artifacts.amd64.lock.json').read_text())['nginx']['image']
    table = table_name(run_id)
    worker_facts = _remote_facts(op, TARGET_ALIAS, 'worker', image, table, include_egress=True)
    bridge_egress = worker_facts.pop('bridge_egress', None)
    core_facts = _remote_facts(op, core['alias'], 'core', image, table)
    source4 = _tailscale_addresses(4)
    source6 = _tailscale_addresses(6)
    target_tail6 = worker_facts['tailscale_ipv6']
    public = {
        'worker4_v4': [x for x in _ssh_public_addresses(TARGET_ALIAS) if ipaddress.ip_address(x).version == 4],
        'worker4_v6': worker_facts['global_ipv6'],
        'core_v4': [x for x in _ssh_public_addresses(core['alias']) if ipaddress.ip_address(x).version == 4],
        'core_v6': core_facts['global_ipv6'],
    }
    paths = _port22_paths(public)
    network = {'target': {'node': TARGET_NODE, 'alias': TARGET_ALIAS, 'tailnet_ipv4': target['ip'],
                          'tailnet_ipv6': target_tail6},
               'sources': {'ipv4': source4, 'ipv6': source6}, 'public': public,
               'public_path_controls': paths,
               'remote_baseline': {TARGET_ALIAS: worker_facts, core['alias']: core_facts},
               'bridge_egress': bridge_egress,
               'nft_guard_table': table, 'locked_image': image, 'blockers': []}
    blockers = network['blockers']
    if not source4:
        blockers.append('B has no Tailscale IPv4 source address')
    if not worker_facts['tailscale_ipv6']:
        blockers.append('worker-4 has no Tailscale IPv6 address')
    elif source6:
        ping = subprocess.run(['tailscale', 'ping', '--c=1', '--timeout=5s', target_tail6[0]],
                              capture_output=True, text=True, timeout=10)
        network['private_ipv6_ping'] = {'exit_code': ping.returncode}
        if ping.returncode:
            blockers.append('B-to-worker-4 Tailscale IPv6 control probe failed')
    private_route = _route(target['ip'])
    network['private_ipv4_route'] = private_route
    if not private_route['available'] or private_route['device'] != 'tailscale0' or private_route['source'] not in source4:
        blockers.append('B-to-worker-4 management IPv4 route is not bound to this controller Tailscale address')
    blockers += _route_path_blockers(paths, required=('worker4_v4', 'worker4_v6', 'core_v4'))
    if not public['worker4_v4']:
        blockers.append('worker-4 has no public IPv4 endpoint to test')
    if not public['worker4_v6']:
        blockers.append('worker-4 has no public IPv6 endpoint to test')
    if not public['core_v4']:
        blockers.append('core has no public IPv4 endpoint to test management ports')
    safe, priorities = _input_chain_safe(worker_facts['nft_input_chains'])
    network['existing_input_priorities'] = priorities
    if not safe:
        blockers.append('cannot prove the temporary priority -10 guard precedes every existing input base chain')
    if 'nf_tables' not in worker_facts['iptables_v'] or 'nf_tables' not in worker_facts['ip6tables_v']:
        blockers.append('worker-4 is not using the nft-backed IPv4/IPv6 firewall backend')
    if worker_facts['network_guard_table_exists']:
        blockers.append('run-specific nftables table already exists')
    if not worker_facts['ufw_active']:
        blockers.append('worker-4 UFW is not active')
    if worker_facts['listeners'].get('80'):
        blockers.append('worker-4 already has a TCP/80 host listener')
    if any(worker_facts['listeners'].get(str(port)) for port in (2379, 2380, 5001)):
        blockers.append('worker-4 already has a management-port listener')
    ufw_v4, ufw_v6 = _reviewed_ufw_tcp80_rules(worker_facts['ufw_80_rules'])
    if not ufw_v4:
        blockers.append('worker-4 baseline no longer has the reviewed IPv4 TCP/80 Anywhere rule')
    if not ufw_v6:
        blockers.append('worker-4 baseline no longer has the reviewed IPv6 TCP/80 Anywhere rule')
    if not worker_facts['locked_nginx_cached']:
        blockers.append('locked nginx image is not already cached on worker-4')
    for unit in ('ufw.service','tailscaled.service','docker.service','containerd.service','fail2ban.service',
                 'eru-agent.service','eru-containerd-proxy.socket'):
        if worker_facts['services'].get(unit) != 'active':
            blockers.append('worker-4 protected service is not active: ' + unit)
    if any(len(core_facts['listeners'].get(str(port), [])) == 0 for port in (2379, 2380, 5001)):
        blockers.append('core management listener baseline is incomplete')
    if not core_facts['ufw_active']:
        blockers.append('core UFW is not active')
    if core_facts['services'].get('fail2ban.service') != 'active':
        blockers.append('core Fail2ban protection is not active')
    if not worker_facts['ipv4_forward_enabled']:
        blockers.append('worker-4 IPv4 forwarding is disabled')
    if not worker_facts['ufw_before_forward_available']:
        blockers.append('worker-4 UFW forward chain is unavailable')
    if not worker_facts['ufw_before_forward_established_accept']:
        blockers.append('worker-4 UFW forward chain has no established reply allowance')
    if not worker_facts.get('upstream_dns_path_verified'):
        blockers.append('worker-4 upstream forwarding path before UFW DNS exceptions cannot be verified')
    if worker_facts['ufw_default_routed'] not in ('allow','deny','reject'):
        blockers.append('worker-4 routed UFW default policy could not be verified')
    if not any(row.get('family')=='ip' and row.get('hook')=='forward'
               for row in worker_facts['nft_forward_chains']):
        blockers.append('worker-4 IPv4 forward hook is unavailable')
    if not bridge_egress or not bridge_egress.get('resolver_ipv4'):
        blockers.append('worker-4 has no usable IPv4 DNS resolver for the bridge egress probe')
    if not bridge_egress or not bridge_egress.get('endpoint_ipv4'):
        blockers.append('worker-4 could not resolve the IPv4-only HTTPS endpoint')
    if bridge_egress and bridge_egress.get('endpoint_ipv6'):
        blockers.append('HTTPS endpoint has IPv6 DNS answers; IPv4-only probe is unsafe')
    existing_forward = _remote_forward_rules(op, run_id)
    network['existing_run_forward_rule_count'] = len(existing_forward)
    if existing_forward:
        blockers.append('run-specific bridge egress forward rules already exist')
    forward_syntax = _remote_forward_rule_test(op)
    network['forward_rule_syntax'] = forward_syntax
    if not forward_syntax.get('syntax_ok') or forward_syntax.get('tag_present'):
        blockers.append('worker-4 rejected the read-only bridge forward-rule syntax check')
    syntax = _remote_guard_test(op, TARGET_ALIAS, table)
    network['nft_dry_run'] = syntax
    if syntax.get('exit_code') != 0:
        blockers.append('worker-4 rejected the temporary nftables rule batch in --check mode')
    if snapshot['workloads']:
        blockers.append('network acceptance requires an empty ERU workload cluster')
    if worker_facts['eru_container_ids'] or worker_facts['eru_task_ids']:
        blockers.append('worker-4 ERU runtime is not empty')
    network['blockers'] = sorted(set(blockers))
    return network


def _network_root(op):
    return op.project / NETWORK


def _record_path(op, run_id):
    return _network_root(op) / 'evidence' / (valid_run_id(run_id) + '.json')


def _owned_workloads(op, run_id, report):
    valid_run_id(run_id)
    apps = {}
    for mode, appdata in report.get('apps', {}).items():
        if mode not in ('host', 'eru'):
            raise ValueError('cleanup report contains an unsupported network mode')
        expected = SOURCE_APP_PREFIX + hashlib.sha256((run_id + ':' + mode).encode()).hexdigest()[:12]
        app = appdata.get('app')
        if app != expected or app in apps:
            raise ValueError('cleanup report app name is not bound to this run')
        apps[app] = mode
    result = []
    for row in op.cli('workload', 'list'):
        identifier = row.get('id', '')
        matches = [app for app in apps if isinstance(identifier, str) and identifier.startswith(app + '_')]
        if not matches:
            continue
        if len(matches) != 1:
            raise ValueError('workload ID ambiguously matches this run')
        app = matches[0]
        labels = row.get('labels') or {}
        if (row.get('nodename') != TARGET_NODE or labels.get('owner') != OWNER
                or labels.get('run') != run_id):
            raise ValueError('run-owned workload has unexpected owner, run or node labels')
        result.append({'id': identifier, 'node': TARGET_NODE, 'app': app, 'run': run_id})
    return sorted(result, key=lambda item: item['id'])


def _save_report(op, run_id, report):
    atomic_json(_record_path(op, run_id), report)
    op.journal['network_evidence'] = str(_record_path(op, run_id).relative_to(op.project))
    op.save_journal()


def _remote_table_list(op):
    output = op.command(TARGET_ALIAS, ['sudo','-n','/usr/sbin/nft','-j','list','tables'])
    return {(x.get('family'),x.get('name')) for row in json.loads(output).get('nftables',[])
            for key,x in row.items() if key=='table'}


def _apply_guard(op, network):
    run_id = op.journal['id']
    table = network['nft_guard_table']
    if ('inet', table) in _remote_table_list(op):
        raise ValueError('run-specific guard table appeared after preflight')
    batch = guard_lines(run_id, network['sources'])
    op.journal['guard_apply_started'] = True
    op.stage('installing-tcp80-guard')
    op.command(TARGET_ALIAS, ['sudo','-n','/usr/sbin/nft','-f','-'], batch, timeout=20)
    op.journal['guard_installed'] = True
    text = op.command(TARGET_ALIAS, ['sudo','-n','/usr/sbin/nft','list','table','inet',table])
    if not verify_guard_text(text, run_id, network['sources']):
        raise RuntimeError('installed nftables guard differs from the exact run plan')
    op.stage('tcp80-guard-verified')


def _guard_present_exact(op, run_id, network):
    table = network['nft_guard_table']
    if ('inet', table) not in _remote_table_list(op):
        return False
    text = op.command(TARGET_ALIAS, ['sudo','-n','/usr/sbin/nft','list','table','inet',table])
    if not verify_guard_text(text, run_id, network['sources']):
        raise ValueError('run-specific table exists but does not match its reviewed guard; refusing deletion')
    return True


def _remove_guard(op, run_id, network):
    if not op.journal.get('guard_apply_started'):
        return True
    if not _guard_present_exact(op, run_id, network):
        return True
    op.stage('removing-tcp80-guard')
    op.command(TARGET_ALIAS, ['sudo','-n','/usr/sbin/nft','delete','table','inet',network['nft_guard_table']], timeout=20)
    return not _guard_present_exact(op, run_id, network)


def _spec(app, run_id):
    return f'''appname: {app}
entrypoints:
  web:
    commands: [nginx, -g, "daemon off;"]
    restart: always
labels:
  owner: {OWNER}
  run: {run_id}
'''


def _deploy(op, run_id, network, mode, report):
    app = SOURCE_APP_PREFIX + hashlib.sha256((run_id + ':' + mode).encode()).hexdigest()[:12]
    report['apps'][mode] = {'app': app, 'node': TARGET_NODE, 'network': mode, 'workload_ids': []}
    _save_report(op, run_id, report)
    payload = _spec(app, run_id)
    writer = ('import os,tempfile\nfd,path=tempfile.mkstemp(prefix="eru006-network-",suffix=".yaml")\n'
              'with os.fdopen(fd,"w") as f:f.write(' + repr(payload) + ')\nprint(path)\n')
    spec_path = op.command(op.core['alias'], ['python3','-'], writer).strip()
    if not re.fullmatch(r'/tmp/eru006-network-[A-Za-z0-9_-]+\.yaml', spec_path):
        raise RuntimeError('unexpected temporary spec path')
    try:
        op.stage('deploying-' + mode + '-nginx')
        op.command(op.core['alias'], ['sudo','-n','/usr/local/bin/eru-cli','--eru',op.core['ip']+':5001',
            'workload','deploy','--pod','eru','--node',TARGET_NODE,'--entry','web','--image',network['locked_image'],
            '--network',mode,'--count','1','--cpu','.25','--memory','128M','--storage','256M',spec_path], timeout=180)
    finally:
        op.command(op.core['alias'], ['rm','--',spec_path], check=False, timeout=20)
        if op.events[-1].get('exit_code') != 0:
            raise RuntimeError('temporary workload spec could not be removed from core')
    rows = op.cli('workload','list',app)
    if len(rows)!=1 or rows[0].get('nodename')!=TARGET_NODE:
        raise RuntimeError(mode + ' workload count or placement changed')
    labels=rows[0].get('labels') or {}
    if labels.get('owner')!=OWNER or labels.get('run')!=run_id:
        raise RuntimeError(mode + ' workload owner/run labels changed')
    identifier=rows[0]['id']
    report['apps'][mode]['workload_ids']=[identifier]
    report['apps'][mode]['labels']={'owner':labels.get('owner'),'run':labels.get('run')}
    _save_report(op,run_id,report)
    return identifier


def _container_network(op, identifier):
    return json.loads(op.command(TARGET_ALIAS,['sudo','-n','python3','-',identifier],CONTAINER_NETWORK))


def _listener_ownership(op, identifier):
    return json.loads(op.command(TARGET_ALIAS,['sudo','-n','python3','-',identifier],LISTENER_OWNERSHIP))


def _remote_cni_rules(op):
    return json.loads(op.command(TARGET_ALIAS, ['sudo','-n','python3','-'], CNI_RULES))


def _remote_forward_rules(op, run_id):
    run_id = valid_run_id(run_id)
    output = op.command(TARGET_ALIAS, ['sudo','-n','python3','-',run_id], FORWARD_RULES)
    return json.loads(output)


def _remote_forward_rule_test(op):
    output = op.command(TARGET_ALIAS, ['sudo','-n','python3','-'], FORWARD_RULE_TEST)
    return json.loads(output)


def _forward_run_targets(op, report, run_id):
    rows = _remote_forward_rules(op, run_id)
    return _forward_run_targets_from_rows(rows, report, run_id)


def _install_egress_forward_rules(op, run_id, network, cni_ip, report):
    rules = _egress_forward_rule_specs(run_id, cni_ip, network['bridge_egress'])
    report['egress_forward_rules'] = rules
    report['egress_forward_rules_installed'] = []
    _save_report(op, run_id, report)
    if _forward_run_targets(op, report, run_id):
        raise ValueError('run-specific bridge egress rules already exist before installation')
    for rule in rules:
        op.stage('installing-bridge-egress-forward-rule')
        op.command(TARGET_ALIAS, _forward_rule_command(rule, 'insert'), timeout=20)
        report['egress_forward_rules_installed'].append(rule['comment'])
        _save_report(op, run_id, report)
    if _forward_run_targets(op, report, run_id) != sorted(rules, key=lambda item:item['comment']):
        raise RuntimeError('installed bridge egress rules differ from their exact run plan')
    report['egress_forward_rules_verified'] = True
    _save_report(op, run_id, report)


def _remove_egress_forward_rules(op, run_id, report, expected_targets=None):
    live = _forward_run_targets(op, report, run_id)
    if expected_targets is not None and live != expected_targets:
        raise ValueError('run-owned bridge egress forward rule set changed after cleanup plan')
    for rule in live:
        op.stage('removing-bridge-egress-forward-rule')
        op.command(TARGET_ALIAS, _forward_rule_command(rule, 'delete'), timeout=20)
    remaining = _forward_run_targets(op, report, run_id)
    if remaining:
        raise RuntimeError('run-owned bridge egress forward rule remains after exact cleanup')
    return len(live)


def _cni_rule_identity(rule):
    def clean(value):
        if isinstance(value, dict):
            return {key: clean(child) for key, child in value.items() if key not in ('handle','counter')}
        if isinstance(value, list):
            return [clean(child) for child in value]
        return value
    return {key: clean(rule.get(key)) for key in ('family','table','chain','comment','expr')}


def _cni_rule_target(rule, workload_id, expected_ip=None):
    suffix = ', net: eru, if: eth0, id: ' + workload_id
    comment = rule.get('comment') or ''
    if not comment.endswith(suffix):
        return None
    if (rule.get('family') != 'inet' or rule.get('table') != 'cni_plugins_masquerade'
            or rule.get('chain') != 'masq_checks'):
        raise ValueError('run-owned CNI rule is outside the reviewed masquerade chain')
    handle = rule.get('handle')
    if not isinstance(handle, int) or handle < 1:
        raise ValueError('run-owned CNI rule has no safe numeric handle')
    expressions = rule.get('expr') or []
    source = {'match': {'left': {'payload': {'field': 'saddr', 'protocol': 'ip'}},
                        'op': '==', 'right': None}}
    destination = {'match': {'left': {'payload': {'field': 'daddr', 'protocol': 'ip'}},
                             'op': '!=', 'right': None}}
    source_hits = []
    destination_hits = []
    masquerade_hits = 0
    source_left = source['match']['left']
    destination_left = destination['match']['left']
    for item in expressions:
        match = item.get('match') if isinstance(item, dict) else None
        if (isinstance(match, dict) and set(match)=={'left','op','right'}
                and match.get('left')==source_left and match.get('op')=='=='):
            source_hits.append(match.get('right'))
        if (isinstance(match, dict) and set(match)=={'left','op','right'}
                and match.get('left')==destination_left and match.get('op')=='!='):
            destination_hits.append(match.get('right'))
        if item == {'masquerade': None}:
            masquerade_hits += 1
    if len(expressions) != 3 or len(source_hits) != 1 or len(destination_hits) != 1 or masquerade_hits != 1:
        raise ValueError('run-owned CNI rule does not match the reviewed source/destination NAT shape')
    raw_prefix = destination_hits[0]
    if not isinstance(raw_prefix, dict) or set(raw_prefix) != {'prefix'}:
        raise ValueError('run-owned CNI NAT rule has an unexpected bridge-prefix expression')
    prefix = raw_prefix['prefix']
    if not isinstance(prefix, dict) or set(prefix) != {'addr','len'} or not isinstance(source_hits[0], str):
        raise ValueError('run-owned CNI NAT rule has an invalid IPv4 source or bridge prefix')
    try:
        source_ip = str(ipaddress.IPv4Address(source_hits[0]))
        network = ipaddress.ip_network(str(prefix['addr']) + '/' + str(prefix['len']), strict=False)
    except (TypeError, ValueError) as exc:
        raise ValueError('run-owned CNI NAT rule has an invalid IPv4 source or bridge prefix') from exc
    if network.version != 4:
        raise ValueError('run-owned CNI NAT rule has an unexpected bridge-prefix address family')
    if expected_ip is not None and source_ip != str(ipaddress.IPv4Address(expected_ip)):
        raise ValueError('run-owned CNI rule source differs from the recorded CNI workload IP')
    identity = _cni_rule_identity(rule)
    return {'workload_id': workload_id, 'cni_ip': source_ip, 'table': identity['table'],
            'chain': identity['chain'], 'handle': handle, 'comment': identity['comment'],
            'fingerprint': digest(identity), 'identity': identity}


def _cni_run_targets_from_rules(rules, report, run_id):
    appdata = report.get('apps', {}).get('eru')
    if not appdata:
        return []
    expected_app = SOURCE_APP_PREFIX + hashlib.sha256((run_id + ':eru').encode()).hexdigest()[:12]
    if appdata.get('app') != expected_app:
        raise ValueError('CNI cleanup app is not bound to this run')
    known_ids = set(appdata.get('workload_ids', []))
    container = report.get('cni_container') or {}
    container_id = container.get('id')
    container_ip = container.get('eru_network_ip')
    targets = []
    for rule in rules:
        comment = rule.get('comment') or ''
        id_marker = ', id: '
        if id_marker not in comment:
            continue
        workload_id = comment.rsplit(id_marker, 1)[1]
        if not workload_id.startswith(expected_app + '_'):
            continue
        if known_ids and workload_id not in known_ids:
            raise ValueError('CNI NAT rule ID differs from the run-owned workload list')
        if container_id is not None and container_id != workload_id:
            raise ValueError('CNI NAT rule ID differs from the inspected bridge container')
        expected_ip = container_ip if container_id == workload_id else None
        target = _cni_rule_target(rule, workload_id, expected_ip)
        if target:
            targets.append(target)
    if len(targets) > 1:
        raise ValueError('multiple CNI NAT rules match one run-owned bridge workload')
    return sorted(targets, key=lambda item: item['workload_id'])


def _cni_run_targets(op, report, run_id):
    if not report.get('apps', {}).get('eru'):
        return []
    return _cni_run_targets_from_rules(_remote_cni_rules(op), report, run_id)


def _remove_cni_run_rules(op, run_id, report, expected_targets=None):
    if not report.get('apps', {}).get('eru'):
        return 0
    live = _cni_run_targets(op, report, run_id)
    expected = expected_targets if expected_targets is not None else report.get('cni_masquerade_rules')
    if expected is not None:
        expected_fingerprints = {item['fingerprint'] for item in expected}
        if not {item['fingerprint'] for item in live} <= expected_fingerprints:
            raise ValueError('CNI NAT rule changed after it was bound to the run')
    for target in live:
        op.stage('removing-run-owned-cni-nat-rule')
        op.command(TARGET_ALIAS, ['sudo','-n','/usr/sbin/nft','delete','rule','inet',
            target['table'],target['chain'],'handle',str(target['handle'])], timeout=20)
    remaining = _cni_run_targets(op, report, run_id)
    if remaining:
        raise RuntimeError('run-owned CNI NAT rule remains after exact cleanup')
    return len(live)


def _remove_cni_plan_targets(op, run_id, report, targets):
    current = _cni_run_targets(op, report, run_id)
    if current != targets:
        raise ValueError('run-owned CNI NAT rule set changed after cleanup plan')
    return _remove_cni_run_rules(op, run_id, report, expected_targets=targets)


def _verify_host_network(op, run_id, network, identifier, report):
    row = _container_network(op, identifier)
    report['host_container'] = row
    if row.get('id') != identifier or network['locked_image'].split('@')[-1] not in str(row.get('image')):
        raise RuntimeError('host workload runtime ID/image differs from the locked plan')
    if row.get('eru_network_ip') or row.get('network_namespace_isolated'):
        raise RuntimeError('host workload acquired a bridge IP or separate network namespace')
    if row.get('labels',{}).get('owner')!=OWNER or row.get('labels',{}).get('run')!=run_id:
        raise RuntimeError('host container ownership labels differ from the plan')
    deadline=time.monotonic()+20
    ownership=None
    while time.monotonic()<deadline:
        ownership=_listener_ownership(op,identifier)
        if ownership.get('listeners'):
            break
        time.sleep(1)
    report['host_listener_ownership']=ownership
    task=ownership.get('task') or {}
    listeners=ownership.get('listeners') or []
    if task.get('id')!=identifier or task.get('status')!='RUNNING' or not listeners:
        raise RuntimeError('host TCP/80 listener is not bound to the run-owned container task')
    procs=[p for item in listeners for p in item.get('processes',[])]
    if not procs or any(x.get('name')!='nginx' or not x.get('owned') for x in procs):
        raise RuntimeError('TCP/80 listener process is not an nginx descendant of the run-owned task')
    has4=any(item.get('family')==4 and item.get('local') in ('0.0.0.0:80','*:80')
              for item in listeners)
    has6=any(item.get('family')==6 and item.get('local') in ('[::]:80','*:80')
              for item in listeners)
    if not has4 or not has6:
        raise RuntimeError('locked nginx does not listen on both IPv4 and IPv6 host port 80')
    report['host_network_verified']=True


def _private_http(network):
    address=network['target']['tailnet_ipv4']
    source=network['sources']['ipv4'][0]
    last=None
    for _ in range(20):
        conn=None
        try:
            conn=http.client.HTTPConnection(address,80,timeout=3,source_address=(source,0))
            conn.request('GET','/')
            response=conn.getresponse(); body=response.read(32768)
            if response.status==200 and b'Welcome to nginx!' in body:
                return {'status':response.status,'source_bound':True,'body':'nginx welcome marker'}
            last={'status':response.status,'body':'unexpected'}
        except OSError as exc:
            last={'error':type(exc).__name__}
        finally:
            if conn:conn.close()
        time.sleep(1)
    raise RuntimeError('B-to-worker-4 private HTTP did not return nginx 200: '+str(last))


def _test_reachability(address, port, should_reach, timeout=2):
    result=_tcp_reachable(address,port,timeout)
    if result['reachable']!=should_reach:
        raise RuntimeError(('unexpectedly reachable' if result['reachable'] else 'unexpectedly unreachable')+
                           ' public TCP/'+str(port)+' probe')
    return result


def _probe_public(network, report):
    results={'worker4_tcp80':[],'core_management':[]}
    for address in network['public']['worker4_v4']+network['public']['worker4_v6']:
        result=_test_reachability(address,80,False)
        results['worker4_tcp80'].append({'family':ipaddress.ip_address(address).version,**result})
    for address in network['public']['core_v4']+network['public']['core_v6']:
        for port in (2379,2380,5001):
            result=_test_reachability(address,port,False)
            results['core_management'].append({'family':ipaddress.ip_address(address).version,'port':port,**result})
    report['public_probes']=results


def _cni_egress(op, run_id, network, report):
    before_rules = _remote_cni_rules(op)
    before_fingerprints = sorted(digest(_cni_rule_identity(rule)) for rule in before_rules)
    report['cni_masquerade_before_sha256'] = digest(before_fingerprints)
    _save_report(op, run_id, report)
    bridge_id=_deploy(op,run_id,network,'eru',report)
    report['cni_container']=_container_network(op,bridge_id)
    if report['cni_container'].get('id')!=bridge_id or not report['cni_container'].get('eru_network_ip'):
        raise RuntimeError('bridge workload has no Eru CNI IP label')
    cni_targets=[]
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
        cni_targets=_cni_run_targets(op,report,run_id)
        if cni_targets:
            break
        time.sleep(1)
    if len(cni_targets)!=1:
        raise RuntimeError('bridge workload has no unique run-owned CNI masquerade rule')
    if cni_targets[0]['fingerprint'] in before_fingerprints:
        raise RuntimeError('run-owned CNI NAT rule was already present before bridge deployment')
    report['cni_masquerade_rules']=cni_targets
    _save_report(op,run_id,report)
    base=['sudo','-n','/usr/local/bin/eru-cli','--eru',op.core['ip']+':5001','workload','exec',bridge_id,'--','/bin/sh','-c']
    resolver_output=op.command(op.core['alias'],base+['cat /etc/resolv.conf'],check=False,timeout=30)
    resolver_event=op.events[-1]
    if resolver_event.get('exit_code')!=0:
        raise RuntimeError('bridge workload resolver configuration could not be read')
    resolver_v4=[]
    for line in resolver_output.splitlines():
        fields=line.split()
        if len(fields)>1 and fields[0]=='nameserver':
            try:
                address=ipaddress.ip_address(fields[1])
                if address.version==4:
                    resolver_v4.append(str(address))
            except ValueError:
                raise RuntimeError('bridge workload has an invalid DNS nameserver')
    resolver_v4=sorted(set(resolver_v4),key=lambda value:int(ipaddress.ip_address(value)))
    expected_resolvers=network['bridge_egress']['resolver_ipv4']
    report['cni_resolver']={'ipv4_nameserver_count':len(resolver_v4),
                            'matches_worker_ipv4_resolvers':resolver_v4==expected_resolvers}
    _save_report(op,run_id,report)
    if resolver_v4!=expected_resolvers:
        raise RuntimeError('bridge workload IPv4 DNS servers differ from the reviewed worker resolver')
    help_output=op.command(op.core['alias'],base+['wget --help'],check=False,timeout=30)
    event=op.events[-1]
    combined_help=help_output+'\n'+event.get('stderr','')
    if event.get('exit_code') not in (0,1) or not _wget_probe_supported(combined_help):
        raise RuntimeError('locked nginx image wget lacks the required HTTPS probe options')
    nslookup_help=op.command(op.core['alias'],base+['nslookup --help'],check=False,timeout=30)
    nslookup_event=op.events[-1]
    combined_nslookup_help=nslookup_help+'\n'+nslookup_event.get('stderr','')
    if nslookup_event.get('exit_code') not in (0,1) or not _nslookup_a_query_supported(combined_nslookup_help):
        raise RuntimeError('locked nginx image nslookup lacks explicit A-query support')
    report['cni_http_client']='busybox-wget'
    report['cni_dns_client']='busybox-nslookup'
    report['cni_endpoint']={'hostname':EGRESS_HOST,
                            'planned_ipv4_count':len(network['bridge_egress']['endpoint_ipv4']),
                            'planned_ipv6_count':len(network['bridge_egress'].get('endpoint_ipv6',[])),
                            'ipv4_only_dns':not network['bridge_egress'].get('endpoint_ipv6')}
    _save_report(op,run_id,report)
    _install_egress_forward_rules(op,run_id,network,report['cni_container']['eru_network_ip'],report)
    resolver=canonical_addresses(network['bridge_egress']['resolver_ipv4'],4)[0]
    dns_query=_nslookup_a_command(resolver)
    dns_output=op.command(op.core['alias'],base+[dns_query],check=False,timeout=30)
    dns_event=op.events[-1]
    answers=_global_dns_ipv4_answers(dns_output+'\n'+dns_event.get('stderr',''))
    planned=set(network['bridge_egress']['endpoint_ipv4'])
    report['cni_dns']={'exit_code':dns_event.get('exit_code'),'ipv4_answer_count':len(answers),
                       'answers_match_plan':bool(answers) and set(answers)<=planned}
    _save_report(op,run_id,report)
    if dns_event.get('exit_code')!=0 or not answers or not set(answers)<=planned:
        raise RuntimeError('bridge DNS query returned no plan-bound IPv4 answers')
    output=op.command(op.core['alias'],base+[_wget_https_command()],check=False,timeout=50)
    event=op.events[-1]
    combined=output+'\n'+event.get('stderr','')
    report['cni_egress']={'exit_code':event.get('exit_code'),
                         'http_200':bool(re.search(r'HTTP/[0-9.]+\s+200\b',combined)),
                         'ipv4_only':True,'ipv4_only_dns':not network['bridge_egress'].get('endpoint_ipv6'),
                         'client':report['cni_http_client'],'endpoint':'https://' + EGRESS_HOST + '/'}
    if event.get('exit_code')!=0 or not report['cni_egress']['http_200']:
        raise RuntimeError('bridge workload HTTPS request did not return HTTP 200')


def _cleanup_workloads(op,run_id,report):
    report['egress_forward_rules_removed'] = _remove_egress_forward_rules(op,run_id,report)
    for mode,appdata in report.get('apps',{}).items():
        app=appdata['app']
        rows=op.cli('workload','list',app)
        for row in rows:
            labels=row.get('labels') or {}
            if (row.get('nodename')!=TARGET_NODE or labels.get('owner')!=OWNER or labels.get('run')!=run_id
                    or not row.get('id','').startswith(app+'_')):
                raise ValueError('refusing workload cleanup after owner/run/node/app mismatch')
        appdata['workload_ids']=sorted(set(appdata.get('workload_ids',[]))|{r['id'] for r in rows})
        _save_report(op,run_id,report)
        for row in rows:
            op.stage('removing-' + mode + '-workload')
            op.command(op.core['alias'],['sudo','-n','/usr/local/bin/eru-cli','--eru',op.core['ip']+':5001',
                        'workload','remove','--force',row['id']],timeout=120)
        if op.cli('workload','list',app):
            raise RuntimeError(mode+' workload remains after exact cleanup')
    image=json.loads((op.project/'artifacts.amd64.lock.json').read_text())['nginx']['image']
    facts=_remote_facts(op,TARGET_ALIAS,'worker',image,table_name(run_id))
    if facts['eru_container_ids'] or facts['eru_task_ids']:
        raise RuntimeError('worker-4 ERU runtime still has a container/task; ingress guard retained')
    if facts['listeners']['80']:
        raise RuntimeError('worker-4 TCP/80 listener remains; ingress guard retained')
    report['cni_masquerade_rules_removed'] = _remove_cni_run_rules(op, run_id, report)
    return True


def _restore_baseline(op,plan,report):
    current=op.snapshot()
    report['post_snapshot']=current
    if membership(current)!=membership(plan['snapshot']):
        raise RuntimeError('cluster workload/node/resource membership differs from the pre-run baseline')
    if current['hosts']!=plan['snapshot']['hosts']:
        raise RuntimeError('worker/core runtime or host identity differs from the pre-run baseline')
    facts={}
    for alias,role in ((TARGET_ALIAS,'worker'),(op.core['alias'],'core')):
        facts[alias]=_remote_facts(op,alias,role,plan['network']['locked_image'],plan['network']['nft_guard_table'])
        if facts[alias]!=plan['network']['remote_baseline'][alias]:
            raise RuntimeError(alias+' firewall/listener/service baseline did not restore exactly')
    report['post_network_facts']=facts
    report['baseline_restored']=True


def _execute(op,plan):
    run_id=plan['id'];network=plan['network']
    report={'run_id':run_id,'started_at':now(),'status':'running','target':network['target'],
            'nft_guard_table':network['nft_guard_table'],'apps':{},'events':[],
            'plan_sha256':digest(plan),'tests':{},'cleanup':{'complete':False}}
    _save_report(op,run_id,report)
    test_error=None
    try:
        op.stage('network-preflight-recheck')
        current_bindings={'inventory':load_inventory(op.project),'inputs':code_inputs(op.project),'cluster':op.cluster()}
        if current_bindings!=plan['bindings']:
            raise ValueError('inventory, generation or pinned project inputs changed; create a new plan')
        current=op.snapshot()
        issues=consistency_issues(current,op.inventory)
        health=op.health()
        if health['exit_code']:issues.append('etcd health failed; mutations blocked')
        if issues:raise ValueError('; '.join(issues))
        if current['hosts']!=plan['snapshot']['hosts'] or membership(current)!=membership(plan['snapshot']):
            raise ValueError('host identity/role/runtime or cluster state changed; create a new plan')
        dynamic=build_network_plan(op,run_id,current)
        if dynamic!=network:
            raise ValueError('network addresses, routes, firewall or protected services changed; create a new plan')
        op.stage('network-preflight-passed')
        _apply_guard(op,network)
        host_id=_deploy(op,run_id,network,'host',report)
        _verify_host_network(op,run_id,network,host_id,report)
        report['tests']['private_http']=_private_http(network)
        _save_report(op,run_id,report)
        _probe_public(network,report)
        _verify_host_network(op,run_id,network,host_id,report)
        report['tests']['public_probe_listener_still_owned']=True
        _save_report(op,run_id,report)
        _cni_egress(op,run_id,network,report)
        report['tests']['host_network']='pass'
        report['tests']['public_ingress_and_management_ports']='pass'
        report['tests']['cni_https_egress']='pass'
    except BaseException as exc:
        test_error=exc
        report['status']='failed'
        report['error']=type(exc).__name__+': '+str(exc)
    finally:
        try:
            workloads_ok=_cleanup_workloads(op,run_id,report)
            report['cleanup']['workloads_removed']=workloads_ok
            if workloads_ok:
                report['cleanup']['guard_removed']=_remove_guard(op,run_id,network)
            else:
                report['cleanup']['guard_removed']=False
                raise RuntimeError('workload cleanup incomplete; retained TCP/80 guard for external safety')
            if not report['cleanup']['guard_removed']:
                raise RuntimeError('temporary TCP/80 guard remains; create a new cleanup plan')
            if op.journal.get('guard_apply_started') or report['apps']:
                _restore_baseline(op,plan,report)
                report['cleanup']['baseline_restored']=True
            else:
                report['cleanup']['baseline_restored']=None
                report['cleanup']['note']='no remote mutation was attempted'
            report['cleanup']['complete']=True
        except BaseException as exc:
            report['cleanup']['error']=type(exc).__name__+': '+str(exc)
            report['status']='failed'
        report['finished_at']=now()
        if report.get('status')!='failed' and not report['cleanup']['complete']:
            report['status']='failed'
        elif report.get('status')!='failed':
            report['status']='complete'
        _save_report(op,run_id,report)
    if test_error:
        raise test_error
    if report['status']!='complete':
        raise RuntimeError(report.get('cleanup',{}).get('error','network acceptance or cleanup failed'))
    return report


def _plan(op):
    snap=op.snapshot()
    blockers=consistency_issues(snap,op.inventory)
    health=op.health()
    if health['exit_code']:blockers.append('etcd health failed; mutations blocked')
    run_id=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]
    network=build_network_plan(op,run_id,snap)
    blockers+=network['blockers']
    bindings={'inventory':op.inventory,'inputs':code_inputs(op.project),'cluster':op.cluster()}
    revision=subprocess.run(['git','-C',str(op.project),'rev-parse','HEAD'],capture_output=True,text=True)
    plan={'schema':1,'id':run_id,'created_at':now(),'operation':'network-acceptance',
          'target':TARGET_NODE,'bindings':bindings,'snapshot':snap,'etcd_health':health,
          'network':network,'executable':not blockers,'blockers':sorted(set(blockers)),
          'mutation_hosts':[op.core['alias'],TARGET_ALIAS],
          'steps':['Install one run-owned nftables input chain at priority -10 for TCP/80 only',
                   'Deploy one locked host-network nginx on worker-4 and verify process/task ownership',
                   'Probe management-private HTTP, public IPv4/IPv6 ingress, and public management ports',
                   'Deploy one locked bridge workload, check its resolver and BusyBox wget/nslookup support, require the HTTPS endpoint to have no IPv6 DNS answers, verify the existing TCP/443 path, temporarily allow only scoped UDP/53 in DOCKER-USER, then verify the explicit A query matches plan',
                   'Run one IPv4 HTTPS request and remove the exact tagged DNS rule, workloads, CNI NAT rule and temporary input table',
                   'Compare worker and core firewall/service/listener baselines'],
          'source_commit':revision.stdout.strip() if revision.returncode==0 else None}
    envelope={'plan':plan,'sha256':digest(plan)}
    root=_network_root(op)
    atomic_json(root/'plans'/(run_id+'.json'),envelope)
    atomic_json(root/'observations'/(run_id+'.json'),op.events)
    return envelope


def _execute_plan(op,run_id,expected_hash):
    envelope=read(_network_root(op)/'plans'/(valid_run_id(run_id)+'.json'))
    plan=envelope['plan']
    if digest(plan)!=envelope['sha256'] or expected_hash!=envelope['sha256']:
        raise ValueError('network plan hash mismatch')
    if plan.get('operation')!='network-acceptance' or not plan.get('executable'):
        raise ValueError('network plan is not executable: '+'; '.join(plan.get('blockers',[])))
    path=_network_root(op)/'runs'/(run_id+'.json')
    if path.exists():raise ValueError('run already exists; reconcile and create a new plan instead of replaying')
    op.journal_path=path
    op.journal={'id':run_id,'operation':'network-acceptance','plan_hash':expected_hash,
                'status':'running','started_at':now(),'controller_pid':os.getpid(),'events':[],
                'cluster_id':plan['bindings']['cluster']['cluster_id'],
                'generation':plan['bindings']['cluster']['generation'],
                'inventory_hash':digest(plan['bindings']['inventory']),
                'source_commit':plan['source_commit'],'network_evidence':str(_record_path(op,run_id).relative_to(op.project))}
    op.stage('preflight')
    try:
        report=_execute(op,plan)
        op.journal.update(status='complete',finished_at=now(),cleanup_complete=True)
        op.stage('complete')
    except BaseException as exc:
        op.journal.update(status='failed',failed_at=op.journal.get('stage'),finished_at=now(),
                          cleanup_complete=bool(read(_record_path(op,run_id)).get('cleanup',{}).get('complete')),
                          error=type(exc).__name__+': '+str(exc))
        op.save_journal()
        raise
    return op.journal



def _cleanup_plan(op,source_run):
    source_run=valid_run_id(source_run);root=_network_root(op)
    source_envelope=read(root/'plans'/(source_run+'.json'))
    source_plan=source_envelope['plan'];source_journal=read(root/'runs'/(source_run+'.json'))
    report=read(_record_path(op,source_run))
    if source_plan.get('operation')!='network-acceptance':
        raise ValueError('cleanup source is not a network acceptance run')
    if digest(source_plan)!=source_envelope.get('sha256'):
        raise ValueError('cleanup source plan hash mismatch')
    if (source_journal.get('id')!=source_run
            or source_journal.get('plan_hash')!=source_envelope['sha256']
            or report.get('run_id')!=source_run
            or report.get('plan_sha256')!=source_envelope['sha256']):
        raise ValueError('cleanup source plan, journal and evidence do not match')
    if source_journal.get('status')=='running':
        raise ValueError('reconcile the interrupted run before creating a cleanup plan')
    if source_journal.get('cleanup_complete') or report.get('cleanup',{}).get('complete'):
        raise ValueError('source run cleanup is already complete')
    snap=op.snapshot();targets=_owned_workloads(op,source_run,report)
    cni_targets=_cni_run_targets(op,report,source_run)
    forward_targets=_forward_run_targets(op,report,source_run)
    remote={}
    for alias,role in ((TARGET_ALIAS,'worker'),(op.core['alias'],'core')):
        remote[alias]=_remote_facts(op,alias,role,source_plan['network']['locked_image'],
                                    source_plan['network']['nft_guard_table'])
    blockers=[]
    if {w['id'] for w in snap['workloads'] if w.get('nodename')==TARGET_NODE}!={x['id'] for x in targets}:
        blockers.append('worker-4 contains a workload outside this cleanup plan')
    target_ids = {x['id'] for x in targets}
    if not set(remote[TARGET_ALIAS]['eru_container_ids']) <= target_ids:
        blockers.append('worker-4 runtime contains a container outside the run-owned workload set')
    if not set(remote[TARGET_ALIAS]['eru_task_ids']) <= target_ids:
        blockers.append('worker-4 runtime contains a task outside the run-owned workload set')
    try:guard_present=_guard_present_exact(op,source_run,source_plan['network'])
    except (RuntimeError,ValueError) as exc:
        guard_present=False;blockers.append('temporary guard cannot be proven exact: '+str(exc))
    if guard_present and not source_journal.get('guard_apply_started'):
        blockers.append('run journal does not prove this plan attempted to create the present guard')
    if not targets and not guard_present and not cni_targets and not forward_targets:
        blockers.append('no run-owned workload, CNI NAT rule, forward exception or temporary guard needs cleanup')
    if snap['hosts'][TARGET_ALIAS]['containers'] and set(snap['hosts'][TARGET_ALIAS]['containers'].splitlines())!={x['id'] for x in targets}:
        blockers.append('worker-4 runtime contains a container outside this cleanup scope')
    run_id=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]
    bindings={'inventory':op.inventory,'inputs':code_inputs(op.project),'cluster':op.cluster()}
    plan={'schema':1,'id':run_id,'operation':'network-cleanup','source_run':source_run,
          'source_plan_sha256':source_envelope['sha256'],'source_journal_sha256':digest(source_journal),
          'source_evidence_sha256':digest(report),'bindings':bindings,'snapshot':snap,
          'remote_baseline':remote,'targets':targets,'cni_targets':cni_targets,
          'forward_targets':forward_targets,'guard_present':guard_present,
          'guard_table':source_plan['network']['nft_guard_table'],'source_network':source_plan['network'],
          'executable':not blockers,'blockers':sorted(set(blockers)),
          'mutation_hosts':[op.core['alias'],TARGET_ALIAS],
          'steps':['Revalidate exact run-owned workload IDs, labels, CNI NAT fingerprints and tagged forward rules',
                   'Delete only this run’s exact DNS/HTTPS forward exceptions, workloads and CNI NAT rule',
                   'Verify worker-4 TCP/80 has no listener, then delete only the exact run table',
                   'Compare remaining cluster, runtime, services and firewall state'],
          'source_apps':sorted(value['app'] for value in report.get('apps',{}).values())}
    envelope={'plan':plan,'sha256':digest(plan)}
    atomic_json(root/'plans'/(run_id+'.json'),envelope)
    atomic_json(root/'observations'/(run_id+'.json'),op.events)
    return envelope


def _cleanup_plan_execute(op,run_id,expected_hash):
    root=_network_root(op);run_id=valid_run_id(run_id)
    envelope=read(root/'plans'/(run_id+'.json'));plan=envelope['plan']
    if digest(plan)!=envelope['sha256'] or expected_hash!=envelope['sha256']:
        raise ValueError('network cleanup plan hash mismatch')
    if plan.get('operation')!='network-cleanup' or not plan.get('executable'):
        raise ValueError('network cleanup plan is not executable: '+'; '.join(plan.get('blockers',[])))
    path=root/'runs'/(run_id+'.json')
    if path.exists():raise ValueError('cleanup plan already has a run; reconcile, do not replay')
    op.journal_path=path
    op.journal={'id':run_id,'operation':'network-cleanup','source_run':plan['source_run'],
                'plan_hash':expected_hash,'status':'running','started_at':now(),'controller_pid':os.getpid(),
                'events':[],'cluster_id':plan['bindings']['cluster']['cluster_id'],
                'generation':plan['bindings']['cluster']['generation'],
                'inventory_hash':digest(plan['bindings']['inventory'])}
    op.stage('preflight')
    try:
        source_run=plan['source_run']
        source_envelope=read(root/'plans'/(source_run+'.json'))
        source_journal=read(root/'runs'/(source_run+'.json'))
        report=read(_record_path(op,source_run))
        if (digest(source_envelope['plan'])!=source_envelope['sha256']
                or source_envelope['sha256']!=plan['source_plan_sha256']
                or source_journal.get('id')!=source_run
                or source_journal.get('status')=='running'
                or source_journal.get('plan_hash')!=source_envelope['sha256']
                or report.get('run_id')!=source_run
                or report.get('plan_sha256')!=source_envelope['sha256']
                or digest(source_journal)!=plan['source_journal_sha256']
                or digest(report)!=plan['source_evidence_sha256']):
            raise ValueError('source plan, journal or evidence changed; create a new cleanup plan')
        bindings={'inventory':load_inventory(op.project),'inputs':code_inputs(op.project),'cluster':op.cluster()}
        if bindings!=plan['bindings']:
            raise ValueError('inventory, generation or pinned project inputs changed')
        before=op.snapshot()
        health=op.health()
        if health['exit_code']:raise ValueError('etcd health failed; cleanup plan is stale')
        if before['hosts']!=plan['snapshot']['hosts'] or membership(before)!=membership(plan['snapshot']):
            raise ValueError('cluster state changed since cleanup plan; create a new plan')
        for alias,role in ((TARGET_ALIAS,'worker'),(op.core['alias'],'core')):
            current=_remote_facts(op,alias,role,plan['source_network']['locked_image'],plan['guard_table'])
            if current!=plan['remote_baseline'][alias]:
                raise ValueError(alias+' changed since cleanup plan; create a new plan')
        if _owned_workloads(op,source_run,report)!=plan['targets']:
            raise ValueError('run-owned workload set changed since cleanup plan')
        if _cni_run_targets(op,report,source_run)!=plan.get('cni_targets',[]):
            raise ValueError('run-owned CNI NAT rule set changed since cleanup plan')
        if _forward_run_targets(op,report,source_run)!=plan.get('forward_targets',[]):
            raise ValueError('run-owned bridge egress forward rule set changed since cleanup plan')
        report['egress_forward_rules_removed'] = _remove_egress_forward_rules(
            op,source_run,report,expected_targets=plan.get('forward_targets',[]))
        op.stage('removing-owned-workloads')
        for target in plan['targets']:
            op.command(op.core['alias'],['sudo','-n','/usr/local/bin/eru-cli','--eru',op.core['ip']+':5001',
                        'workload','remove','--force',target['id']],timeout=120)
        if _owned_workloads(op,source_run,report):
            raise RuntimeError('run-owned workload remains after cleanup')
        facts=_remote_facts(op,TARGET_ALIAS,'worker',plan['source_network']['locked_image'],plan['guard_table'])
        if (facts['eru_container_ids'] or facts['eru_task_ids'] or facts['listeners']['80']):
            raise RuntimeError('worker-4 still has a container, task or TCP/80 listener; ingress guard retained')
        _remove_cni_plan_targets(op,source_run,report,plan.get('cni_targets',[]))
        if _cni_run_targets(op,report,source_run):
            raise RuntimeError('run-owned CNI NAT rule remains after cleanup')
        if _forward_run_targets(op,report,source_run):
            raise RuntimeError('run-owned bridge egress forward rule remains after cleanup')
        if plan['guard_present']:
            if not _guard_present_exact(op,source_run,plan['source_network']):
                raise RuntimeError('run-specific guard disappeared or changed before cleanup')
            op.command(TARGET_ALIAS,['sudo','-n','/usr/sbin/nft','delete','table','inet',plan['guard_table']],timeout=20)
        if _guard_present_exact(op,source_run,plan['source_network']):
            raise RuntimeError('run-specific nftables table remains after cleanup')
        final=op.snapshot()
        removed={x['id'] for x in plan['targets']}
        before_rows={x['id']:x for x in before['workloads'] if x['id'] not in removed}
        final_rows={x['id']:x for x in final['workloads']}
        if before_rows!=final_rows:raise RuntimeError('cleanup changed an unrelated workload')
        if before['pods']!=final['pods']:raise RuntimeError('cleanup changed pod membership')
        issues=consistency_issues(final,op.inventory)
        if issues:raise RuntimeError('post-cleanup consistency issue: '+'; '.join(issues))
        old_nodes={x['name']:x for x in before['nodes']};new_nodes={x['name']:x for x in final['nodes']}
        if old_nodes.keys()!=new_nodes.keys():raise RuntimeError('cleanup changed node membership')
        for name,old in old_nodes.items():
            new=new_nodes[name]
            if name==TARGET_NODE:
                if {k:v for k,v in old.items() if k!='resource_usage'}!={k:v for k,v in new.items() if k!='resource_usage'}:
                    raise RuntimeError('cleanup changed non-resource worker metadata')
            elif old!=new:raise RuntimeError('cleanup changed another worker')
        for alias,old in before['hosts'].items():
            new=final['hosts'][alias]
            if alias!=TARGET_ALIAS:
                if old!=new:raise RuntimeError('cleanup changed a host outside worker-4')
                continue
            for key in ('machine_id','boot_id','tailscale','docker'):
                if old.get(key)!=new.get(key):raise RuntimeError('cleanup changed worker-4 '+key)
            old_cont=set(old['containers'].splitlines());new_cont=set(new['containers'].splitlines())
            if old_cont-new_cont!=(old_cont & removed) or new_cont-old_cont:raise RuntimeError('cleanup changed an unrelated ERU container')
            old_task_ids={line.split()[0] for line in old['tasks'].splitlines()[1:] if line.split()}
            new_task_ids={line.split()[0] for line in new['tasks'].splitlines()[1:] if line.split()}
            if old_task_ids-new_task_ids!=(old_task_ids & removed) or new_task_ids-old_task_ids:
                raise RuntimeError('cleanup changed an unrelated runtime task')
        for alias,role in ((TARGET_ALIAS,'worker'),(op.core['alias'],'core')):
            after_facts=_remote_facts(op,alias,role,plan['source_network']['locked_image'],plan['guard_table'])
            baseline=plan['source_network']['remote_baseline'][alias]
            if after_facts!=baseline:raise RuntimeError(alias+' firewall/service/listener baseline did not restore')
        op.journal['cleanup_after']=final
        op.journal['cleanup_complete']=True
        source_journal['cleanup_complete']=True;source_journal['cleanup_plan']=run_id
        atomic_json(root/'runs'/(source_run+'.json'),source_journal)
        report.setdefault('cleanup',{}).update(complete=True,cleanup_plan=run_id,workloads_removed=True,
                                               guard_removed=True,egress_forward_rules_removed=True)
        atomic_json(_record_path(op,source_run),report)
        op.journal.update(status='complete',finished_at=now())
        op.stage('complete')
    except BaseException as exc:
        op.journal.update(status='failed',failed_at=op.journal.get('stage'),finished_at=now(),
                          error=type(exc).__name__+': '+str(exc))
        op.save_journal()
        raise
    return op.journal


def _reconcile(op, run_id):
    run_id = valid_run_id(run_id)
    root = _network_root(op)
    envelope = read(root / 'plans' / (run_id + '.json'))
    plan = envelope['plan']
    if digest(plan) != envelope.get('sha256'):
        raise ValueError('reconcile plan hash mismatch')
    journal_path = root / 'runs' / (run_id + '.json')
    journal = read(journal_path)
    if journal.get('id') != run_id or journal.get('plan_hash') != envelope['sha256']:
        raise ValueError('reconcile journal does not match the plan')
    operation = plan.get('operation')
    if operation == 'network-acceptance':
        source_run = run_id
        source_envelope = envelope
        network = plan['network']
    elif operation == 'network-cleanup':
        source_run = valid_run_id(plan['source_run'])
        source_envelope = read(root / 'plans' / (source_run + '.json'))
        if digest(source_envelope['plan']) != source_envelope.get('sha256'):
            raise ValueError('cleanup source plan hash mismatch')
        network = plan['source_network']
    else:
        raise ValueError('unsupported network reconcile operation')
    baseline_snapshot = source_envelope['plan']['snapshot']

    observation = {'at': now(),
                   'policy': 'Read-only reconciliation; no remote command replay or automatic cleanup.',
                   'run_id': run_id, 'events': []}
    try:
        snapshot = op.snapshot()
        observation['snapshot'] = snapshot
        facts = {}
        for alias, role in ((TARGET_ALIAS, 'worker'), (op.core['alias'], 'core')):
            facts[alias] = _remote_facts(op, alias, role, network['locked_image'],
                                         network['nft_guard_table'])
        observation['network_facts'] = facts
        report = read(_record_path(op, source_run))
        owned = _owned_workloads(op, source_run, report)
        observation['run_owned_workloads'] = owned
        cni_targets = _cni_run_targets(op, report, source_run)
        observation['run_owned_cni_rules'] = cni_targets
        forward_targets = _forward_run_targets(op, report, source_run)
        observation['run_owned_forward_rules'] = forward_targets
        guard_present = _guard_present_exact(op, source_run, network)
        observation['guard_present_exact'] = guard_present
        baseline = network['remote_baseline']
        remote_restored = all(facts[alias] == baseline[alias] for alias in baseline)
        snapshot_restored = (snapshot['hosts'] == baseline_snapshot['hosts']
                             and membership(snapshot) == membership(baseline_snapshot))
        no_owned_artifacts = not owned and not cni_targets and not forward_targets and not guard_present
        observation['cleanup_state'] = {
            'owned_workload_count': len(owned),
            'owned_cni_rule_count': len(cni_targets),
            'owned_forward_rule_count': len(forward_targets),
            'guard_present_exact': guard_present,
            'remote_baseline_restored': remote_restored,
            'cluster_and_host_baseline_restored': snapshot_restored,
            'cleanup_complete': no_owned_artifacts and remote_restored and snapshot_restored,
        }
        if operation == 'network-cleanup' and observation['cleanup_state']['cleanup_complete']:
            source_journal_path = root / 'runs' / (source_run + '.json')
            source_journal = read(source_journal_path)
            if source_journal.get('status') != 'running':
                source_journal.update(cleanup_complete=True, cleanup_reconciled_at=now(),
                                      cleanup_plan=run_id)
                atomic_json(source_journal_path, source_journal)
                report.setdefault('cleanup', {}).update(
                    complete=True, cleanup_plan=run_id, workloads_removed=True,
                    guard_removed=True, egress_forward_rules_removed=True,
                    recovered_by_read_only_reconcile=True)
                atomic_json(_record_path(op, source_run), report)
                observation['cleanup_state']['source_journal_repaired'] = True
        elif operation == 'network-acceptance' and observation['cleanup_state']['cleanup_complete']:
            journal['cleanup_complete'] = True
            observation['cleanup_state']['journal_cleanup_complete'] = True
    except Exception as exc:
        observation['error'] = type(exc).__name__ + ': ' + str(exc)

    observation['events'] = op.events
    suffix = 'reconcile-' + uuid.uuid4().hex[:8]
    atomic_json(root / 'observations' / (run_id + '-' + suffix + '.json'), observation)
    if journal['status'] == 'running':
        journal.update(status='interrupted', failed_at=journal.get('stage'), reconciled_at=now())
    else:
        journal['reconciled_at'] = now()
    safe_keys = ('error', 'guard_present_exact', 'cleanup_state')
    journal['reconciliation'] = {key: observation[key] for key in safe_keys if key in observation}
    if 'run_owned_workloads' in observation:
        journal['reconciliation']['run_owned_workload_count'] = len(observation['run_owned_workloads'])
    if 'run_owned_cni_rules' in observation:
        journal['reconciliation']['run_owned_cni_rule_count'] = len(observation['run_owned_cni_rules'])
    if 'run_owned_forward_rules' in observation:
        journal['reconciliation']['run_owned_forward_rule_count'] = len(observation['run_owned_forward_rules'])
    if observation.get('cleanup_state', {}).get('cleanup_complete'):
        journal['cleanup_complete'] = True
    atomic_json(journal_path, journal)
    return journal


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('plan',help='Read live state and write a private, hash-bound network acceptance plan')
    execute=sub.add_parser('execute',help='Execute one network acceptance plan exactly once')
    execute.add_argument('--plan',required=True);execute.add_argument('--sha256',required=True)
    reconcile=sub.add_parser('reconcile',help='Read actual state after a failed/interrupted run; never mutates')
    reconcile.add_argument('--run',required=True)
    cleanup_plan=sub.add_parser('cleanup-plan',help='Create a new exact cleanup plan after reconcile')
    cleanup_plan.add_argument('--run',required=True,help='source network acceptance run ID')
    cleanup=sub.add_parser('cleanup-execute',help='Execute one reviewed cleanup plan exactly once')
    cleanup.add_argument('--plan',required=True);cleanup.add_argument('--sha256',required=True)
    status=sub.add_parser('status',help='Show private local run summaries without remote access')
    status.add_argument('--run')
    args=parser.parse_args();os.umask(0o077)
    if args.command=='status':
        root=_network_root(Operator())/'runs'
        if args.run:
            data=read(root/(valid_run_id(args.run)+'.json'))
            print(json.dumps({k:data.get(k) for k in ('id','operation','status','stage','failed_at',
                'finished_at','cleanup_complete','reconciled_at','reconciliation')},indent=2))
        else:
            print(json.dumps([{k:read(p).get(k) for k in ('id','operation','status','stage','cleanup_complete')}
                              for p in sorted(root.glob('*.json'))],indent=2))
        return
    with ClusterLock(PROJECT):
        op=Operator()
        if args.command=='plan':
            envelope=_plan(op);plan=envelope['plan']
            summary={k:plan[k] for k in ('id','operation','target','executable','blockers','mutation_hosts','steps')}
            summary.update(sha256=envelope['sha256'],path=str(_network_root(op)/'plans'/(plan['id']+'.json')))
            print(json.dumps(summary,indent=2))
        elif args.command=='execute':
            journal=_execute_plan(op,args.plan,args.sha256)
            print(json.dumps({k:journal.get(k) for k in ('id','status','stage','cleanup_complete')},indent=2))
        elif args.command=='cleanup-plan':
            envelope=_cleanup_plan(op,args.run);plan=envelope['plan']
            summary={k:plan.get(k) for k in ('id','operation','source_run','executable','blockers',
                'guard_present','mutation_hosts','steps')}
            summary['target_count']=len(plan.get('targets',[]))
            summary['cni_rule_count']=len(plan.get('cni_targets',[]));summary['sha256']=envelope['sha256']
            summary['path']=str(_network_root(op)/'plans'/(plan['id']+'.json'))
            print(json.dumps(summary,indent=2))
        elif args.command=='cleanup-execute':
            journal=_cleanup_plan_execute(op,args.plan,args.sha256)
            print(json.dumps({k:journal.get(k) for k in ('id','operation','status','stage','cleanup_complete')},indent=2))
        else:
            journal=_reconcile(op,args.run)
            print(json.dumps({k:journal.get(k) for k in ('id','status','stage','reconciled_at','reconciliation')},indent=2))


if __name__=='__main__':
    try:main()
    except (RuntimeError,ValueError,OSError,subprocess.SubprocessError,KeyError) as exc:
        print('ERROR:',str(exc),file=sys.stderr)
        raise SystemExit(1)
