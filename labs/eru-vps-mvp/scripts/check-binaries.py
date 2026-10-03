#!/usr/bin/env python3
"""Verify locked release bytes and run version-only commands on the test VPSs.

Each host downloads into its own TemporaryDirectory, verifies SHA256 before
extracting explicitly named regular files, runs as the SSH user, and removes
its temporary files. No sudo, services, containers, or network listeners.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

HOSTS = tuple(f"disposable-{i:02d}" for i in range(1, 5))
BINARIES = {
    "projecteru2/core": {"eru-core": ["--version"]},
    "projecteru2/cli": {"eru-cli": ["--version"]},
    "projecteru2/agent": {"eru-agent": ["--version"]},
    "etcd-io/etcd": {"etcd": ["--version"], "etcdctl": ["version"], "etcdutl": ["version"]},
}
REMOTE = r'''
import hashlib,json,os,subprocess,tarfile,tempfile,urllib.request
from pathlib import Path
results=[]
with tempfile.TemporaryDirectory(prefix="eru-version-check-") as directory:
    root=Path(directory)
    for item in artifacts:
        archive=root/item["file"]
        digest=hashlib.sha256()
        request=urllib.request.Request(item["url"],headers={"User-Agent":"eru-vps-mvp-version-check"})
        with urllib.request.urlopen(request,timeout=30) as response, archive.open("wb") as target:
            while block:=response.read(1024*1024):
                target.write(block)
                digest.update(block)
        if digest.hexdigest()!=item["sha256"]:
            raise RuntimeError("SHA256 mismatch: "+item["file"])
        with tarfile.open(archive) as tar:
            for binary,flags in item["binaries"].items():
                members=[m for m in tar.getmembers() if m.isfile() and Path(m.name).name==binary]
                if len(members)!=1:raise RuntimeError("ambiguous/missing archive member: "+binary)
                path=root/binary
                with tar.extractfile(members[0]) as source, path.open("wb") as target:
                    while block:=source.read(1024*1024):target.write(block)
                path.chmod(0o700)
                command=[str(path),*flags]
                p=subprocess.run(command,capture_output=True,text=True,timeout=15)
                results.append({"binary":binary,"args":flags,"archive_sha256":item["sha256"],
                    "exit_code":p.returncode,"stdout":p.stdout.strip(),"stderr":p.stderr.strip()})
print(json.dumps({"results":results,"temporary_directory_removed":not root.exists()}))
'''


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--output-dir",required=True,type=Path)
    ap.add_argument("--host",action="append",choices=HOSTS)
    args=ap.parse_args()
    project=Path(__file__).resolve().parent.parent
    lock=json.loads((project/"artifacts.amd64.lock.json").read_text())
    artifacts=[]
    for a in lock["artifacts"]:
        repo=a["repository"]
        if repo not in BINARIES:continue
        if not re.fullmatch(r"[0-9a-f]{64}",a["sha256"]):raise ValueError("invalid checksum")
        if Path(a["file"]).name!=a["file"]:raise ValueError("invalid archive name")
        if not a["url"].startswith(f"https://github.com/{repo}/releases/download/"):
            raise ValueError("unexpected download source")
        artifacts.append({**a,"binaries":BINARIES[repo]})
    if {a["repository"] for a in artifacts}!=set(BINARIES):raise ValueError("incomplete artifact lock")
    remote="artifacts="+repr(artifacts)+"\n"+REMOTE
    os.umask(0o077)
    args.output_dir.mkdir(mode=0o700,parents=True,exist_ok=True)
    failed=False
    for host in args.host or HOSTS:
        print(f"[{host}] SSH python3 -: SHA256 verification; eru-core/cli/agent --version; etcd --version; etcdctl/etcdutl version; temporary cleanup",flush=True)
        result={"host":host,"collected_at":datetime.now(timezone.utc).isoformat()}
        try:
            p=subprocess.run(["ssh","-T","-o","BatchMode=yes","-o","StrictHostKeyChecking=yes",
                "-o","ConnectTimeout=10","-o","PermitLocalCommand=no",host,"python3 -"],
                input=remote,capture_output=True,text=True,timeout=240)
            result.update(exit_code=p.returncode,stderr=p.stderr.strip())
            if p.returncode==0:result.update(json.loads(p.stdout))
            else:result["stdout"]=p.stdout.strip()
        except (OSError,ValueError,subprocess.TimeoutExpired) as e:result["error"]=str(e)
        result["pass"]=result.get("exit_code")==0 and result.get("temporary_directory_removed") is True and len(result.get("results",[]))==6 and all(x["exit_code"]==0 for x in result.get("results",[]))
        failed |= not result["pass"]
        with tempfile.NamedTemporaryFile(mode="w",prefix=f"{host}-",suffix=".json",dir=args.output_dir,delete=False) as f:
            json.dump(result,f,ensure_ascii=False,indent=2);f.write("\n")
        print(json.dumps(result,ensure_ascii=False),flush=True)
    return int(failed)

if __name__=="__main__":
    raise SystemExit(main())
