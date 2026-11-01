#!/usr/bin/env python3
"""Sample macOS resources; stop only the supplied test PID at agreed limits."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time

p = argparse.ArgumentParser()
p.add_argument('--pid', type=int, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--interval', type=float, default=5)
p.add_argument('--process-group', action='store_true')
a = p.parse_args()
a.output.parent.mkdir(parents=True, exist_ok=True)
base = None
warnings = 0
while True:
    try:
        os.kill(a.pid, 0)
    except ProcessLookupError:
        break
    row = {'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'pid': a.pid}
    try:
        raw = subprocess.check_output(['/usr/sbin/sysctl', 'vm.swapusage', 'kern.memorystatus_vm_pressure_level'], text=True)
        swap = re.search(r'used = ([\d.]+)([MG])', raw)
        row['swap_mib'] = float(swap[1]) * (1024 if swap[2] == 'G' else 1)
        row['pressure_level'] = int(re.search(r'pressure_level: (\d+)', raw)[1])
        row['free_gib'] = shutil.disk_usage(a.output.parent).free / 2**30
        processes = subprocess.check_output(['/bin/ps', '-axo', 'pid=,pgid=,rss='], text=True)
        own = [list(map(int, line.split())) for line in processes.splitlines() if len(line.split()) == 3]
        own = [x for x in own if x[1] == a.pid] if a.process_group else [x for x in own if x[0] == a.pid]
        row['process_rss_kib'] = {str(x[0]): x[2] for x in own}
        row['group_rss_kib'] = sum(x[2] for x in own)
        row['memory_pressure'] = subprocess.check_output(['/usr/bin/memory_pressure', '-Q'], text=True).strip()
        if base is None:
            base = row['swap_mib']
        row['swap_delta_mib'] = row['swap_mib'] - base
        warnings = warnings + 1 if row['pressure_level'] != 1 else 0
        if row['pressure_level'] >= 4 or warnings >= 6 or row['swap_delta_mib'] > 1024 or row['free_gib'] < 50:
            row['stop_reason'] = 'resource threshold exceeded'
    except Exception as e:
        row['stop_reason'] = 'monitoring unavailable: ' + repr(e)
    with a.output.open('a') as f:
        f.write(json.dumps(row) + '\n')
    if 'stop_reason' in row:
        try:
            (os.killpg if a.process_group else os.kill)(a.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        print(json.dumps(row), flush=True)
        raise SystemExit(2)
    time.sleep(a.interval)
