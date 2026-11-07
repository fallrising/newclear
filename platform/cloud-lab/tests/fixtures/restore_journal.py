"""SQLite online-backup helper for isolated qualification fixtures only."""
import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3


def backup(source, destination):
    source, destination = Path(source).resolve(strict=True), Path(destination)
    # mode=ro sees committed WAL. immutable=1 or copying only the main file would not.
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro', uri=True)) as src:
        src.execute('SELECT * FROM executions LIMIT 0')
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
        with closing(sqlite3.connect(destination)) as dst:
            src.backup(dst)
            if dst.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                raise ValueError('invalid restored journal')
    with destination.open('rb') as file:
        os.fsync(file.fileno())
    fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def snapshot(source):
    with closing(sqlite3.connect(Path(source).resolve(strict=True).as_uri()+'?mode=ro', uri=True)) as db:
        return [[v.decode('utf-8') if isinstance(v, bytes) else v for v in row]
                for row in db.execute('SELECT * FROM executions ORDER BY command_id')]


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('source')
    p.add_argument('destination')
    a = p.parse_args()
    backup(a.source, a.destination)
    print(json.dumps(snapshot(a.destination)))
