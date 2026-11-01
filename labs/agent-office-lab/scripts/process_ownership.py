"""Observe descendants by PID and ps start time, including later reparenting."""
import subprocess
import os


def parse_processes(text):
    rows = {}
    for line in text.splitlines():
        fields = line.split()
        if len(fields) == 7 and fields[0].isdigit() and fields[1].isdigit():
            rows[int(fields[0])] = {'parent': int(fields[1]), 'started': ' '.join(fields[2:])}
    return rows


def process_table():
    rows = parse_processes(subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,lstart='], text=True, timeout=5))
    if os.getpid() not in rows:
        raise RuntimeError('process_snapshot_invalid')
    return rows


def collect_owned(rows, known, root):
    owned = dict(known)
    if root in rows and (root not in owned or owned[root] == rows[root]['started']):
        owned[root] = rows[root]['started']
    active = set(alive_owned(rows, owned))
    changed = True
    while changed:
        changed = False
        for pid, row in rows.items():
            if row['parent'] in active and pid not in active:
                # A reused PID cannot inherit the ownership of a vanished process.
                if pid in owned and owned[pid] != row['started']:
                    continue
                owned[pid] = row['started']; active.add(pid); changed = True
    return owned


def alive_owned(rows, owned):
    return [pid for pid, started in owned.items() if pid in rows and rows[pid]['started'] == started]
