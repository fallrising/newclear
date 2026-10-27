"""Local qualification child only. Fault hooks never enter the product runner."""
import argparse
import importlib.util
import ipaddress
import json
from contextlib import closing
import os
from pathlib import Path
import signal
import sqlite3
import sys
from urllib.parse import urlsplit

MODULE = Path(__file__).resolve().parents[2] / 'adapters/node-health/runner.py'
spec = importlib.util.spec_from_file_location('recovery_product_runner', MODULE)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


def snapshot(path):
    with closing(sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True)) as db:
        return [[value.decode('utf-8') if isinstance(value,bytes) else value for value in row]
                for row in db.execute('SELECT * FROM executions ORDER BY command_id')]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot')
    parser.add_argument('--config')
    parser.add_argument('--collector-log')
    parser.add_argument('--block-collector',action='store_true')
    args = parser.parse_args()
    if args.snapshot:
        print(json.dumps(snapshot(args.snapshot)))
        return 0
    if not args.config or not args.collector_log:
        parser.error('config and collector-log required')
    config = json.loads(Path(args.config).read_text())
    url = urlsplit(config['base_url'])
    if url.scheme != 'http' or not ipaddress.ip_address(url.hostname).is_loopback:
        raise ValueError('qualification requires explicit numeric loopback HTTP')
    original = r.fixed_collector
    def collector():
        # Runner has already durably committed started before calling this boundary.
        fd = os.open(args.collector_log,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
        with os.fdopen(fd,'w') as file:
            file.write('collect\n')
            file.flush()
            os.fsync(file.fileno())
        if args.block_collector:
            while True:
                signal.pause()  # Parent owns this child and supplies SIGKILL at the marker.
        return original()
    r.fixed_collector = collector
    return r.main(['--config',args.config,'--allow-loopback-http','--once'])


if __name__ == '__main__':
    sys.exit(main())
