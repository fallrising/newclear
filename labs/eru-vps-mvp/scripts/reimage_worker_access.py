"""Prepare the core's exact SSH and firewall access for one replacement worker."""
from datetime import datetime, timezone
import base64
import hashlib
import ipaddress
import json
import re
import uuid

from labops import atomic_json, digest
import reimage_worker_install as install
import reimage_worker_registration as registration


INSPECT_CORE_ACCESS = r'''import base64,hashlib,json,os,pathlib,stat,subprocess
def file(path):
 p=pathlib.Path(path); st=p.lstat()
 if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode): raise RuntimeError("core access file is not regular")
 b=p.read_bytes()
 return {"content":base64.b64encode(b).decode(),"sha256":hashlib.sha256(b).hexdigest(),
         "uid":st.st_uid,"mode":stat.S_IMODE(st.st_mode)}
p=subprocess.run(["/usr/sbin/nft","list","table","inet","eru_mvp"],capture_output=True,text=True,timeout=15)
if p.returncode: raise RuntimeError("live core firewall table is unavailable")
n=p.stdout.encode()
print(json.dumps({"known_hosts":file("/etc/eru/known_hosts"),
 "firewall":file("/etc/eru/mvp-firewall.nft"),
 "nft_table":p.stdout,"nft_sha256":hashlib.sha256(n).hexdigest()},sort_keys=True))
'''


APPLY_CORE_ACCESS = r'''import base64,hashlib,json,os,pathlib,re,stat,subprocess,sys,tempfile
P=json.load(sys.stdin)
def read(path):
 p=pathlib.Path(path); st=p.lstat()
 if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode): raise RuntimeError("core access file is not regular")
 if st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o600: raise RuntimeError("core access file owner or mode changed")
 b=p.read_bytes(); return b,hashlib.sha256(b).hexdigest()
def write(path,data):
 p=pathlib.Path(path); parent=p.parent
 if parent.is_symlink() or not parent.is_dir(): raise RuntimeError("core access directory is unsafe")
 fd,name=tempfile.mkstemp(prefix="."+p.name+".",dir=str(parent))
 try:
  os.fchown(fd,0,0); os.fchmod(fd,0o600)
  with os.fdopen(fd,"wb",closefd=True) as f: f.write(data); f.flush(); os.fsync(f.fileno())
  os.replace(name,p)
  d=os.open(str(parent),os.O_RDONLY|os.O_DIRECTORY)
  try: os.fsync(d)
  finally: os.close(d)
 finally:
  if os.path.exists(name): os.unlink(name)
def table():
 p=subprocess.run(["/usr/sbin/nft","list","table","inet","eru_mvp"],capture_output=True,text=True,timeout=15)
 if p.returncode: raise RuntimeError("live core firewall table is unavailable")
 return p.stdout
def ips(text,core):
 lines=[x.split(" # handle",1)[0].strip() for x in text.splitlines() if x.strip()]
 source=[]; drop=[]; other=[]
 for line in lines:
  if re.fullmatch(r"table\s+inet\s+eru_mvp\s*\{",line) or line in ("chain input {","}"):
   continue
  if re.fullmatch(r"type filter hook input priority (?:-10|filter\s*-\s*10); policy accept;",line):
   continue
  m=re.fullmatch(r"ip daddr ([0-9.]+) tcp dport 5001 ip saddr \{ ([0-9., -]+) \} accept",line)
  if m:
   source.append((m.group(1),[x.strip() for x in m.group(2).split(",")]))
   continue
  if re.fullmatch(r"ip daddr [0-9.]+ tcp dport 5001 drop",line):
   drop.append(line.split()[2]); continue
  other.append(line)
 if other or len(source)!=1 or len(drop)!=1 or source[0][0]!=core or drop[0]!=core:
  raise RuntimeError("live core firewall table differs from the reviewed ERU rules")
 try:
  values=[]
  for item in source[0][1]:
   if "-" not in item:
    values.append(str(__import__("ipaddress").IPv4Address(item))); continue
   first,last=(__import__("ipaddress").IPv4Address(x.strip()) for x in item.split("-",1))
   if int(last)<int(first) or int(last)-int(first)>16: raise ValueError("firewall range is invalid")
   values.extend(str(__import__("ipaddress").IPv4Address(n)) for n in range(int(first),int(last)+1))
 except ValueError as e: raise RuntimeError("live core firewall address is malformed") from e
 if len(values)!=len(set(values)): raise RuntimeError("live core firewall has duplicate worker addresses")
 return sorted(values,key=__import__("ipaddress").IPv4Address)
known,known_hash=read("/etc/eru/known_hosts")
firewall,firewall_hash=read("/etc/eru/mvp-firewall.nft")
live=table(); live_hash=hashlib.sha256(live.encode()).hexdigest()
if live_hash!=P["nft_before_sha256"]: raise RuntimeError("live core firewall changed after access plan")
allowed=lambda current,old,wanted: current in (old,wanted)
if not allowed(known_hash,P["known_hosts_before_sha256"],P["known_hosts_after_sha256"]):
 raise RuntimeError("core known_hosts changed after access plan")
if not allowed(firewall_hash,P["firewall_before_sha256"],P["firewall_after_sha256"]):
 raise RuntimeError("core firewall file changed after access plan")
if known_hash!=P["known_hosts_after_sha256"]: write("/etc/eru/known_hosts",base64.b64decode(P["known_hosts_after_base64"],validate=True))
if firewall_hash!=P["firewall_after_sha256"]: write("/etc/eru/mvp-firewall.nft",base64.b64decode(P["firewall_after_base64"],validate=True))
live=table(); live_hash=hashlib.sha256(live.encode()).hexdigest()
if live_hash!=P["nft_before_sha256"]: raise RuntimeError("live core firewall changed during access update")
live_ips=ips(live,P["core_ip"])
if set(live_ips) not in (set(P["old_worker_ips"]),set(P["new_worker_ips"])):
 raise RuntimeError("live core firewall changed after access plan")
if set(live_ips)!=set(P["new_worker_ips"]):
 p=subprocess.run(["/usr/sbin/nft","-f","/etc/eru/mvp-firewall.nft"],capture_output=True,text=True,timeout=30)
 if p.returncode: raise RuntimeError("core firewall apply failed: "+(p.stderr or "nft returned nonzero"))
live=table(); live_ips=ips(live,P["core_ip"])
if set(live_ips)!=set(P["new_worker_ips"]): raise RuntimeError("live core firewall did not reach the planned worker allowlist")
known,known_hash=read("/etc/eru/known_hosts"); firewall,firewall_hash=read("/etc/eru/mvp-firewall.nft")
if known_hash!=P["known_hosts_after_sha256"] or firewall_hash!=P["firewall_after_sha256"]:
 raise RuntimeError("core access file post-write verification failed")
print(json.dumps({"known_hosts_sha256":known_hash,"firewall_sha256":firewall_hash,
 "nft_sha256":hashlib.sha256(live.encode()).hexdigest(),"allowed_workers":live_ips},sort_keys=True))
'''


def _now():
    return datetime.now(timezone.utc).isoformat()


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _ipv4(value, label):
    try:
        parsed = ipaddress.ip_address(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(label + " is not an IP address") from exc
    if not isinstance(parsed, ipaddress.IPv4Address):
        raise ValueError(label + " must be IPv4")
    return str(parsed)


def _firewall_text(core_ip, worker_ips):
    return ("add table inet eru_mvp\n"
            "flush table inet eru_mvp\n"
            "table inet eru_mvp {\n"
            "  chain input {\n"
            "    type filter hook input priority -10; policy accept;\n"
            "    ip daddr " + core_ip + " tcp dport 5001 ip saddr { " +
            ", ".join(worker_ips) + " } accept\n"
            "    ip daddr " + core_ip + " tcp dport 5001 drop\n"
            "  }\n"
            "}\n")


def _nft_worker_ips(text, core_ip):
    lines = [line.split(" # handle", 1)[0].strip() for line in text.splitlines() if line.strip()]
    source, drop, other = [], [], []
    for line in lines:
        if (re.fullmatch(r"table\s+inet\s+eru_mvp\s*\{", line)
                or line == "chain input {" or line == "}"):
            continue
        if re.fullmatch(r"type filter hook input priority (?:-10|filter\s*-\s*10); policy accept;", line):
            continue
        match = re.fullmatch(r"ip daddr ([0-9.]+) tcp dport 5001 ip saddr \{ ([0-9., -]+) \} accept", line)
        if match:
            source.append((match.group(1), [part.strip() for part in match.group(2).split(",")]))
            continue
        match = re.fullmatch(r"ip daddr ([0-9.]+) tcp dport 5001 drop", line)
        if match:
            drop.append(match.group(1))
            continue
        other.append(line)
    if other or len(source) != 1 or drop != [core_ip] or source[0][0] != core_ip:
        raise ValueError("live core firewall table differs from the reviewed ERU rules")
    try:
        values = []
        for item in source[0][1]:
            if "-" not in item:
                values.append(_ipv4(item, "live firewall worker address"))
                continue
            first, last = (_ipv4(value.strip(), "live firewall worker address")
                           for value in item.split("-", 1))
            first_num, last_num = int(ipaddress.IPv4Address(first)), int(ipaddress.IPv4Address(last))
            if last_num < first_num or last_num - first_num > 16:
                raise ValueError("live firewall address range is invalid")
            values.extend(str(ipaddress.IPv4Address(value))
                          for value in range(first_num, last_num + 1))
    except ValueError as exc:
        raise ValueError("live core firewall worker address is malformed") from exc
    if len(values) != len(set(values)):
        raise ValueError("live core firewall has duplicate worker addresses")
    return sorted(values, key=ipaddress.IPv4Address)


def _remote_file(observation, name):
    value = observation.get(name)
    if not isinstance(value, dict) or set(value) != {"content", "sha256", "uid", "mode"}:
        raise ValueError("core " + name.replace("_", " ") + " observation has an invalid schema")
    try:
        raw = base64.b64decode(value["content"], validate=True)
    except (TypeError, ValueError) as exc:
        raise ValueError("core " + name.replace("_", " ") + " content is malformed") from exc
    if (_sha(raw) != value.get("sha256") or type(value.get("uid")) is not int
            or value.get("uid") != 0 or type(value.get("mode")) is not int
            or value.get("mode") != 0o600):
        raise ValueError("core " + name.replace("_", " ") + " owner, mode or checksum is unsafe")
    return raw


def _inspect_core(operator):
    raw = operator.command(operator.core["alias"],
                           ["sudo", "-n", "python3", "-c", INSPECT_CORE_ACCESS],
                           timeout=45, record_output=False)
    try:
        observation = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ValueError("core access observation is invalid JSON") from exc
    if (not isinstance(observation, dict)
            or set(observation) != {"known_hosts", "firewall", "nft_table", "nft_sha256"}
            or not isinstance(observation.get("nft_table"), str)
            or _sha(observation["nft_table"].encode()) != observation.get("nft_sha256")):
        raise ValueError("core access observation has an incomplete schema")
    _remote_file(observation, "known_hosts")
    _remote_file(observation, "firewall")
    return observation


def _trusted_keys(operator, bootstrap, owner_receipt, trusted):
    from reimage_receipt import verify_local_hostkeys

    fingerprints = owner_receipt["receipt"]["host_key_fingerprints"]
    current_check = verify_local_hostkeys(bootstrap["target"]["alias"], fingerprints,
                                         operator.trusted_hostkeys_dir)
    if current_check != trusted:
        raise ValueError("trusted replacement host-key file changed")
    path = operator.trusted_hostkeys_dir / current_check["path"]
    try:
        trusted_raw = path.read_bytes()
        trusted_text = trusted_raw.decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ValueError("trusted replacement host-key file is unreadable") from exc
    if _sha(trusted_raw) != current_check["file_sha256"]:
        raise ValueError("trusted replacement host-key file changed during access planning")
    material = {}
    for raw_line in trusted_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split()
        key_type, encoded = fields[1], fields[2]
        try:
            blob = base64.b64decode(encoded, validate=True)
        except ValueError as exc:
            raise ValueError("trusted replacement host key is malformed") from exc
        if len(blob) < 4:
            raise ValueError("trusted replacement host key blob is truncated")
        algorithm_len = int.from_bytes(blob[:4], "big")
        if blob[4:4 + algorithm_len].decode("ascii", "strict") != key_type:
            raise ValueError("trusted replacement host key algorithm does not match its blob")
        actual_fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(blob).digest()).decode().rstrip("=")
        if actual_fingerprint != fingerprints.get(key_type) or key_type in material:
            raise ValueError("trusted replacement host key differs from the owner receipt")
        material[key_type] = encoded
    if set(material) != set(fingerprints):
        raise ValueError("trusted replacement host-key algorithms differ from the owner receipt")
    return material, fingerprints, current_check


def _known_hosts_after(raw, old_ip, new_ip, worker_ips, key_material):
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("core known_hosts is not UTF-8") from exc
    target_addresses = {old_ip, new_ip}
    expected_addresses = set(worker_ips)
    if new_ip not in expected_addresses:
        expected_addresses.add(new_ip)
    target_rows = []
    lines = text.splitlines(keepends=True)
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        fields = stripped.split()
        if len(fields) != 3:
            raise ValueError("core known_hosts has an unexpected entry format")
        address = _ipv4(fields[0], "known_hosts hostname")
        if address not in expected_addresses:
            raise ValueError("core known_hosts contains an unreviewed host address")
        try:
            blob = base64.b64decode(fields[2], validate=True)
        except ValueError as exc:
            raise ValueError("core known_hosts contains malformed public-key data") from exc
        if len(blob) < 4:
            raise ValueError("core known_hosts contains a truncated public key")
        algorithm_len = int.from_bytes(blob[:4], "big")
        if blob[4:4 + algorithm_len].decode("ascii", "strict") != fields[1]:
            raise ValueError("core known_hosts key algorithm does not match its blob")
        if address in target_addresses:
            target_rows.append((index, address, fields[1], fields[2]))
    if not target_rows:
        raise ValueError("core known_hosts lacks the prior worker address")
    desired_rows = [(new_ip, key_type, encoded) for key_type, encoded in sorted(key_material.items())]
    desired_key_rows = [(key_type, encoded) for _address, key_type, encoded in desired_rows]
    current_new_rows = [(key_type, encoded) for _index, address, key_type, encoded in target_rows if address == new_ip]
    if new_ip != old_ip and current_new_rows and current_new_rows != desired_key_rows:
        raise ValueError("replacement address already has a conflicting core host key")
    # The only permitted current states are the previous inventory key(s), or the exact
    # out-of-band verified replacement key set. This also makes a fresh plan adopt a
    # known_hosts write whose SSH reply was lost.
    old_rows = [(key_type, encoded) for _index, address, key_type, encoded in target_rows if address == old_ip]
    if new_ip == old_ip:
        if not old_rows:
            raise ValueError("core known_hosts lacks the worker address")
    elif not old_rows and current_new_rows != desired_key_rows:
        raise ValueError("core known_hosts has neither the prior nor verified replacement address")
    if new_ip in worker_ips and new_ip != old_ip:
        raise ValueError("replacement Tailscale address collides with another inventory worker")
    output, inserted = [], False
    for index, line in enumerate(lines):
        fields = line.strip().split()
        is_target = bool(fields and fields[0] in target_addresses)
        if is_target:
            if not inserted:
                output.extend(address + " " + key_type + " " + encoded + "\n"
                              for address, key_type, encoded in desired_rows)
                inserted = True
            continue
        output.append(line)
    if not inserted:
        output.extend(address + " " + key_type + " " + encoded + "\n"
                      for address, key_type, encoded in desired_rows)
    result = "".join(output).encode()
    final_addresses = set()
    for line in result.decode().splitlines():
        if line and not line.startswith("#"):
            final_addresses.add(line.split()[0])
    if final_addresses != (set(worker_ips) - {old_ip}) | {new_ip}:
        raise ValueError("core known_hosts worker address set differs from the reviewed replacement")
    return result


def _access_material(operator, bootstrap, owner_receipt, trusted, observation):
    old_inventory = bootstrap["bindings"]["inventory"]
    worker_ips = [_ipv4(row["ip"], "inventory worker address")
                  for row in old_inventory if row.get("role") == "worker"]
    if len(worker_ips) != 3 or len(worker_ips) != len(set(worker_ips)):
        raise ValueError("bound inventory does not contain three unique worker addresses")
    target = bootstrap["target"]
    old_ip = next((_ipv4(row["ip"], "prior worker address") for row in old_inventory
                   if row.get("alias") == target["alias"] and row.get("role") == "worker"), None)
    if old_ip is None:
        raise ValueError("bound inventory lacks the target worker address")
    new_ip = _ipv4(target["tailscale_ipv4"], "replacement worker address")
    core_ip = _ipv4(next(row["ip"] for row in old_inventory if row.get("role") == "core"),
                    "core address")
    if new_ip in set(worker_ips) - {old_ip}:
        raise ValueError("replacement worker address collides with another inventory worker")
    keys, fingerprints, key_check = _trusted_keys(operator, bootstrap, owner_receipt, trusted)
    known_before = _remote_file(observation, "known_hosts")
    firewall_before = _remote_file(observation, "firewall")
    known_after = _known_hosts_after(known_before, old_ip, new_ip, worker_ips, keys)
    old_firewall = _firewall_text(core_ip, worker_ips).encode()
    new_worker_ips = [new_ip if address == old_ip else address for address in worker_ips]
    new_firewall = _firewall_text(core_ip, new_worker_ips).encode()
    if firewall_before not in (old_firewall, new_firewall):
        raise ValueError("core firewall source differs from the exact reviewed ERU rule")
    live_ips = _nft_worker_ips(observation["nft_table"], core_ip)
    if set(live_ips) not in (set(worker_ips), set(new_worker_ips)):
        raise ValueError("live core firewall allowlist differs from the old or planned worker set")
    # A loaded desired table with a reverted source file is ambiguous and must be reviewed.
    if firewall_before == old_firewall and set(live_ips) == set(new_worker_ips) and worker_ips != new_worker_ips:
        raise ValueError("core firewall source and live table disagree outside an adoptable partial apply")
    return {
        "old_ip": old_ip, "new_ip": new_ip, "core_ip": core_ip,
        "old_worker_ips": worker_ips, "new_worker_ips": new_worker_ips,
        "known_hosts_before_sha256": _sha(known_before),
        "known_hosts_after_sha256": _sha(known_after),
        "firewall_before_sha256": _sha(firewall_before),
        "firewall_after_sha256": _sha(new_firewall),
        "nft_before_sha256": observation["nft_sha256"],
        "nft_workers_before": live_ips,
        "trusted_host_key_file_check": key_check,
        "host_key_fingerprints": fingerprints,
        "known_hosts_after": known_after,
        "firewall_after": new_firewall,
    }


def _bootstrap_and_install(operator, bootstrap_id, bootstrap_hash):
    bootstrap, source_plan, receipt, observation, trusted, preparation = install._validated_context(
        operator, bootstrap_id, bootstrap_hash)
    release = registration._validate_stage(operator, bootstrap)
    install_journal = registration._install_journal(operator, bootstrap, bootstrap_hash)
    return bootstrap, source_plan, receipt, observation, trusted, preparation, release, install_journal


def _observe_stage(operator, context):
    bootstrap, source_plan, receipt, replacement, trusted, _preparation, release, _install_journal = context
    target = bootstrap["target"]
    install._check_health(operator)
    install._cluster_unchanged(operator, source_plan)
    install._other_hosts_unchanged(operator, source_plan, target["alias"])
    current_host = install._read_replacement(operator, target["alias"], receipt, replacement, trusted)
    audit = install._worker_audit(operator, bootstrap, trusted)
    facts = install._post_facts(operator, bootstrap, trusted)
    if (current_host["machine_id"] != target["machine_id"]
            or current_host["boot_id"] != target["boot_id"]
            or audit.get("scope_verified") is not True
            or facts["machine_id"] != target["machine_id"]
            or facts["boot_id"] != target["boot_id"]
            or facts["tailscale_ipv4"] != target["tailscale_ipv4"]
            or facts["agent_active_state"] != "inactive"
            or facts["agent_unit_state"] != "disabled"):
        raise ValueError("installed replacement worker is not the verified stopped target")
    runtime = registration._core_runtime(operator)
    if runtime["sha256"] != release["artifact_sha256"]:
        raise ValueError("running core binary is not the verified safe AddNode release")
    core = _inspect_core(operator)
    material = _access_material(operator, bootstrap, receipt, trusted, core)
    return {"core_runtime": runtime, "core_access": core, "material": material,
            "worker_audit_sha256": audit.get("manifest_sha256"),
            "worker_facts": {"machine_id": facts["machine_id"], "boot_id": facts["boot_id"],
                             "tailscale_ipv4": facts["tailscale_ipv4"]},
            "core_health": "healthy"}


def plan_reimage_worker_access(operator, bootstrap_plan_id, bootstrap_hash):
    """Build a hash-bound, read-only plan for the core's exact worker trust and allowlist."""
    from labctl import code_inputs, identifier

    operator.events = []
    operator.journal_path = None
    operator.journal = None
    context = _bootstrap_and_install(operator, bootstrap_plan_id, bootstrap_hash)
    bootstrap, source_plan, _receipt, _observation, _trusted, _preparation, release, install_journal = context
    observed = _observe_stage(operator, context)
    material = observed["material"]
    install_journal_path = operator.root / "runs" / (install_journal["id"] + ".json")
    install_journal_sha = _sha(install_journal_path.read_bytes())
    plan_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    from labctl import identifier
    identifier(plan_id)
    plan = {
        "schema": 1,
        "id": plan_id,
        "created_at": _now(),
        "operation": "provider-reimage-worker-access",
        "bootstrap_plan": {"id": bootstrap["id"], "sha256": bootstrap_hash},
        "install_journal": {"id": install_journal["id"], "sha256": install_journal_sha},
        "source_reimage_plan": bootstrap["source_reimage_plan"],
        "target": {key: bootstrap["target"][key] for key in
                   ("alias", "node", "machine_id", "boot_id", "tailscale_ipv4")},
        "core_release": release,
        "core_runtime": observed["core_runtime"],
        "cluster_binding": operator.cluster(),
        "code_inputs_sha256": digest(code_inputs(operator.project)),
        "worker_audit_sha256": observed["worker_audit_sha256"],
        "worker_facts": observed["worker_facts"],
        "trusted_host_key_file_check": material["trusted_host_key_file_check"],
        "host_key_fingerprints": material["host_key_fingerprints"],
        "core_ip": material["core_ip"],
        "old_worker_ips": material["old_worker_ips"],
        "new_worker_ips": material["new_worker_ips"],
        "old_worker_ip": material["old_ip"],
        "new_worker_ip": material["new_ip"],
        "core_access_before": {
            "known_hosts_sha256": material["known_hosts_before_sha256"],
            "firewall_sha256": material["firewall_before_sha256"],
            "nft_sha256": material["nft_before_sha256"],
            "live_worker_ips": material["nft_workers_before"],
        },
        "core_access_after": {
            "known_hosts_sha256": material["known_hosts_after_sha256"],
            "firewall_sha256": material["firewall_after_sha256"],
            "worker_ips": material["new_worker_ips"],
        },
        "mutation_hosts": [operator.core["alias"]],
        "executable": True,
        "blockers": [],
        "steps": [
            "Revalidate the stopped installed worker, owner-verified replacement host key and unchanged cluster",
            "Atomically replace only the target worker's core known_hosts entries and firewall source allowlist",
            "Apply the existing nft source file without restarting core, then verify the live allowlist",
            "Stop at access-ready-awaiting-registration; do not register, start the agent or commit generation",
        ],
    }
    path = operator.root / "reimage-worker-access-plans" / (plan_id + ".json")
    if path.exists() or path.is_symlink():
        raise ValueError("worker access plan already exists; do not overwrite it")
    envelope = {"plan": plan, "sha256": digest(plan)}
    atomic_json(path, envelope)
    atomic_json(operator.root / "observations" / (plan_id + "-worker-access-plan.json"), operator.events)
    return envelope


def _load_plan(operator, plan_id, expected_hash):
    from labctl import identifier
    plan_id = identifier(plan_id)
    path = operator.root / "reimage-worker-access-plans" / (plan_id + ".json")
    if path.is_symlink() or not path.is_file():
        raise ValueError("worker access plan is missing or unsafe")
    try:
        envelope = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("worker access plan is invalid") from exc
    plan = envelope.get("plan") if isinstance(envelope, dict) else None
    if (not isinstance(plan, dict) or digest(plan) != envelope.get("sha256")
            or expected_hash != envelope.get("sha256") or plan.get("id") != plan_id
            or plan.get("operation") != "provider-reimage-worker-access"
            or plan.get("executable") is not True or plan.get("blockers") != []
            or plan.get("mutation_hosts") != [operator.core["alias"]]):
        raise ValueError("worker access plan hash or stage contract is invalid")
    return plan


def _validate_plan_context(operator, plan):
    from labctl import code_inputs
    if digest(code_inputs(operator.project)) != plan.get("code_inputs_sha256"):
        raise ValueError("worker access code inputs changed after planning")
    bootstrap_ref = plan.get("bootstrap_plan")
    if not isinstance(bootstrap_ref, dict):
        raise ValueError("worker access plan lacks its bootstrap binding")
    context = _bootstrap_and_install(operator, bootstrap_ref.get("id"), bootstrap_ref.get("sha256"))
    bootstrap, _source, _receipt, _observation, _trusted, _prep, release, install_journal = context
    install_path = operator.root / "runs" / (install_journal["id"] + ".json")
    install_hash = _sha(install_path.read_bytes())
    observed = _observe_stage(operator, context)
    material = observed["material"]
    expected = {
        "bootstrap_plan": {"id": bootstrap["id"], "sha256": bootstrap_ref["sha256"]},
        "install_journal": {"id": install_journal["id"], "sha256": install_hash},
        "source_reimage_plan": bootstrap["source_reimage_plan"],
        "target": {key: bootstrap["target"][key] for key in
                   ("alias", "node", "machine_id", "boot_id", "tailscale_ipv4")},
        "core_release": release,
        "core_runtime": observed["core_runtime"],
        "cluster_binding": operator.cluster(),
        "worker_audit_sha256": observed["worker_audit_sha256"],
        "worker_facts": observed["worker_facts"],
        "trusted_host_key_file_check": material["trusted_host_key_file_check"],
        "host_key_fingerprints": material["host_key_fingerprints"],
        "core_ip": material["core_ip"],
        "old_worker_ips": material["old_worker_ips"],
        "new_worker_ips": material["new_worker_ips"],
        "old_worker_ip": material["old_ip"],
        "new_worker_ip": material["new_ip"],
        "core_access_before": {
            "known_hosts_sha256": material["known_hosts_before_sha256"],
            "firewall_sha256": material["firewall_before_sha256"],
            "nft_sha256": material["nft_before_sha256"],
            "live_worker_ips": material["nft_workers_before"],
        },
        "core_access_after": {
            "known_hosts_sha256": material["known_hosts_after_sha256"],
            "firewall_sha256": material["firewall_after_sha256"],
            "worker_ips": material["new_worker_ips"],
        },
    }
    for key, value in expected.items():
        if plan.get(key) != value:
            raise ValueError("worker access binding changed after planning: " + key)
    return context, observed


def _proof(plan, plan_hash):
    after = plan["core_access_after"]
    return {
        "plan": {"id": plan["id"], "sha256": plan_hash},
        "known_hosts_sha256": after["known_hosts_sha256"],
        "firewall_sha256": after["firewall_sha256"],
        "worker_ips": after["worker_ips"],
        "target_ip": plan["new_worker_ip"],
        "host_key_fingerprints": plan["host_key_fingerprints"],
    }


def _last_access_journal(operator, bootstrap, *, expected_proof=None):
    plans_dir = operator.root / "reimage-worker-access-plans"
    candidates = []
    if plans_dir.is_symlink():
        raise ValueError("worker access plan directory is unsafe")
    if not plans_dir.exists():
        raise ValueError("successful core worker access preparation is required before registration")
    if not plans_dir.is_dir():
        raise ValueError("worker access plan directory is unsafe")
    for path in plans_dir.glob("*.json"):
        if path.is_symlink() or not path.is_file():
            continue
        try:
            envelope = json.loads(path.read_text())
            plan = envelope.get("plan")
        except (OSError, json.JSONDecodeError):
            continue
        if (not isinstance(plan, dict)
                or plan.get("operation") != "provider-reimage-worker-access"
                or plan.get("bootstrap_plan") != {"id": bootstrap["id"],
                                                     "sha256": bootstrap["sha256"]}):
            continue
        if (digest(plan) != envelope.get("sha256")
                or path.name != str(plan.get("id", "")) + ".json"):
            raise ValueError("matching worker access plan is corrupt or renamed")
        run_id = plan.get("id", "") + "-access"
        run_path = operator.root / "runs" / (run_id + ".json")
        journal = None
        if run_path.is_file() and not run_path.is_symlink():
            try:
                journal = json.loads(run_path.read_text())
            except (OSError, json.JSONDecodeError):
                pass
        candidates.append((plan.get("created_at", ""), plan, envelope.get("sha256"), journal))
    if not candidates:
        raise ValueError("successful core worker access preparation is required before registration")
    _created, plan, plan_hash, journal = max(candidates, key=lambda row: row[0])
    if (not isinstance(journal, dict) or journal.get("id") != plan.get("id") + "-access"
            or journal.get("operation") != "provider-reimage-worker-access"
            or journal.get("status") != "access-ready-awaiting-registration"
            or journal.get("target") != plan.get("target", {}).get("node")
            or journal.get("target_alias") != plan.get("target", {}).get("alias")
            or journal.get("access_plan_id") != plan.get("id")
            or journal.get("plan_hash") != plan_hash
            or journal.get("bootstrap_plan_id") != bootstrap["id"]
            or journal.get("bootstrap_plan_hash") != bootstrap["sha256"]):
        raise ValueError("latest worker access preparation is not complete; reconcile and create a fresh plan")
    if expected_proof is not None and journal.get("access_proof") != expected_proof:
        raise ValueError("worker registration access proof differs from the latest access stage")
    return plan, plan_hash, journal


def require_access_ready(operator, bootstrap, bootstrap_hash, *, expected_proof=None):
    """Require the latest completed access stage and verify its exact live core state."""
    from labctl import code_inputs

    plan, plan_hash, journal = _last_access_journal(
        operator, {"id": bootstrap["id"], "sha256": bootstrap_hash},
        expected_proof=expected_proof)
    target = bootstrap.get("target", {})
    expected_target = {key: target.get(key) for key in
                       ("alias", "node", "machine_id", "boot_id", "tailscale_ipv4")}
    if (plan.get("target") != expected_target
            or plan.get("source_reimage_plan") != bootstrap.get("source_reimage_plan")):
        raise ValueError("worker access stage targets another worker incarnation")
    if digest(code_inputs(operator.project)) != plan.get("code_inputs_sha256"):
        raise ValueError("worker access code inputs changed after its successful preparation")
    observation = _inspect_core(operator)
    known = _remote_file(observation, "known_hosts")
    firewall = _remote_file(observation, "firewall")
    target_ip = plan["new_worker_ip"]
    if (_sha(known) != plan["core_access_after"]["known_hosts_sha256"]
            or _sha(firewall) != plan["core_access_after"]["firewall_sha256"]
            or set(_nft_worker_ips(observation["nft_table"], plan["core_ip"]))
            != set(plan["new_worker_ips"])
            or target_ip not in plan["new_worker_ips"]):
        raise ValueError("live core worker SSH or firewall access differs from the successful access proof")
    proof = _proof(plan, plan_hash)
    if journal.get("access_proof") != proof:
        raise ValueError("worker access journal proof is malformed")
    return proof


def apply_reimage_worker_access(operator, plan_id, expected_hash):
    """Apply the two planned core access-file changes exactly once and verify them."""
    from labctl import identifier
    plan_id = identifier(plan_id)
    plan = _load_plan(operator, plan_id, expected_hash)
    run_id = identifier(plan_id + "-access")
    run_path = operator.root / "runs" / (run_id + ".json")
    if run_path.exists() or run_path.is_symlink():
        raise ValueError("worker access plan already has a journal; reconcile and create a fresh plan")
    operator.events = []
    operator.journal_path = run_path
    operator.journal = {
        "id": run_id, "access_plan_id": plan_id,
        "operation": "provider-reimage-worker-access", "plan_hash": expected_hash,
        "bootstrap_plan_id": plan["bootstrap_plan"]["id"],
        "bootstrap_plan_hash": plan["bootstrap_plan"]["sha256"],
        "source_reimage_plan": plan["source_reimage_plan"],
        "status": "running", "started_at": _now(),
        "target": plan["target"]["node"], "target_alias": plan["target"]["alias"], "events": [],
    }
    operator.stage("preflight")
    try:
        context, observed = _validate_plan_context(operator, plan)
        material = observed["material"]
        trusted = context[4]
        keys, fingerprints, key_check = _trusted_keys(operator, context[0], context[2], trusted)
        if (key_check != plan["trusted_host_key_file_check"]
                or fingerprints != plan["host_key_fingerprints"]):
            raise ValueError("owner-verified replacement host key changed after access planning")
        core = observed["core_access"]
        known_after = material["known_hosts_after"]
        firewall_after = material["firewall_after"]
        payload = {
            "core_ip": plan["core_ip"],
            "known_hosts_before_sha256": plan["core_access_before"]["known_hosts_sha256"],
            "known_hosts_after_sha256": plan["core_access_after"]["known_hosts_sha256"],
            "firewall_before_sha256": plan["core_access_before"]["firewall_sha256"],
            "firewall_after_sha256": plan["core_access_after"]["firewall_sha256"],
            "known_hosts_after_base64": base64.b64encode(known_after).decode(),
            "firewall_after_base64": base64.b64encode(firewall_after).decode(),
            "nft_before_sha256": plan["core_access_before"]["nft_sha256"],
            "old_worker_ips": plan["old_worker_ips"],
            "new_worker_ips": plan["new_worker_ips"],
        }
        needs_mutation = (
            material["known_hosts_before_sha256"] != plan["core_access_after"]["known_hosts_sha256"]
            or material["firewall_before_sha256"] != plan["core_access_after"]["firewall_sha256"]
            or set(material["nft_workers_before"]) != set(plan["new_worker_ips"]))
        operator.journal.update(
            remote_mutation_attempted=needs_mutation,
            remote_mutation_performed=None if needs_mutation else False,
            core_access_before={
                "known_hosts_sha256": material["known_hosts_before_sha256"],
                "firewall_sha256": material["firewall_before_sha256"],
                "nft_sha256": material["nft_before_sha256"],
            },
            core_access_after=plan["core_access_after"],
        )
        operator.save_journal()
        if needs_mutation:
            operator.stage("writing-core-worker-access")
            output = operator.command(operator.core["alias"],
                                      ["sudo", "-n", "python3", "-c", APPLY_CORE_ACCESS],
                                      json.dumps(payload, sort_keys=True), timeout=90,
                                      record_output=False)
            try:
                applied = json.loads(output)
            except (TypeError, json.JSONDecodeError) as exc:
                raise ValueError("core access writer returned invalid verification JSON") from exc
            if (not isinstance(applied, dict)
                    or applied.get("known_hosts_sha256") != plan["core_access_after"]["known_hosts_sha256"]
                    or applied.get("firewall_sha256") != plan["core_access_after"]["firewall_sha256"]
                    or set(applied.get("allowed_workers", [])) != set(plan["new_worker_ips"])):
                raise ValueError("core access writer postcondition differs from the plan")
        after = _inspect_core(operator)
        if (_sha(_remote_file(after, "known_hosts")) != plan["core_access_after"]["known_hosts_sha256"]
                or _sha(_remote_file(after, "firewall")) != plan["core_access_after"]["firewall_sha256"]
                or set(_nft_worker_ips(after["nft_table"], plan["core_ip"])) != set(plan["new_worker_ips"])):
            raise ValueError("core access files or live nft table failed post-write verification")
        proof = _proof(plan, expected_hash)
        operator.journal.update(
            status="access-ready-awaiting-registration", finished_at=_now(),
            remote_mutation_performed=needs_mutation, access_proof=proof,
            trusted_host_key_file_check=plan["trusted_host_key_file_check"],
        )
        operator.stage("awaiting-registration")
        return operator.journal
    except BaseException as exc:
        operator.journal.update(status="failed", failed_at=operator.journal.get("stage"),
                                error=str(exc), finished_at=_now())
        operator.save_journal()
        raise


def reconcile_reimage_worker_access(operator, run_id, journal=None):
    """Read back only the two access files and nft table; never write or reload them."""
    from labctl import identifier
    run_id = identifier(run_id)
    path = operator.root / "runs" / (run_id + ".json")
    if path.is_symlink() or not path.is_file():
        raise ValueError("worker access journal is missing or unsafe")
    journal = journal if journal is not None else json.loads(path.read_text())
    if journal.get("operation") != "provider-reimage-worker-access":
        raise ValueError("journal is not a worker access preparation stage")
    plan = _load_plan(operator, journal.get("access_plan_id"), journal.get("plan_hash"))
    operator.journal_path = path
    operator.journal = journal
    operator.events = list(journal.get("events", []))
    result = {"at": _now(),
              "policy": "Read-only access reconciliation; no files are rewritten and nft is not reloaded.",
              "remote_mutation_performed": False}
    try:
        observation = _inspect_core(operator)
        known = _remote_file(observation, "known_hosts")
        firewall = _remote_file(observation, "firewall")
        live_ips = _nft_worker_ips(observation["nft_table"], plan["core_ip"])
        result.update(
            known_hosts_sha256=_sha(known),
            known_hosts_matches_plan=_sha(known) == plan["core_access_after"]["known_hosts_sha256"],
            firewall_sha256=_sha(firewall),
            firewall_matches_plan=_sha(firewall) == plan["core_access_after"]["firewall_sha256"],
            live_worker_ips=live_ips,
            live_firewall_matches_plan=set(live_ips) == set(plan["new_worker_ips"]),
        )
    except BaseException as exc:
        result["error"] = type(exc).__name__ + ": " + str(exc)
    if journal.get("status") == "running":
        journal.update(status="interrupted", failed_at=journal.get("stage"), reconciled_at=_now())
    else:
        journal["reconciled_at"] = _now()
    journal["reconciliation"] = {key: value for key, value in result.items()
                                  if key not in {"at", "policy"}}
    atomic_json(path, journal)
    return journal
