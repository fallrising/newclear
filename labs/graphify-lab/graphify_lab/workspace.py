"""Use a local mutable source directory with the shared Graphify cache.

Each operation validates a fresh content/configuration identity. The stdio MCP
server uses a frozen startup snapshot: restart it after editing the source.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys

from .__main__ import DEFAULT_CACHE, environment, graph_command
from .cache import CacheError, context_fingerprint, ensure_index, source_fingerprint
from .source import node_at, source_excerpt


def open_workspace(source: Path, cache: Path = DEFAULT_CACHE) -> dict:
    """Open a canonical local directory without fetching or changing its files."""
    source = Path(source).expanduser().resolve(strict=True)
    if not source.is_dir():
        raise ValueError('source must be a directory')
    source_id = 'workspace:' + hashlib.sha256(os.fsencode(source)).hexdigest()
    return ensure_index(source, cache, source_id)


def _validate_options(args: argparse.Namespace) -> None:
    # Reject invalid requests before extraction or any cache directory creation.
    if args.command == 'query' and not 1 <= args.budget <= 32000:
        raise ValueError('budget must be between 1 and 32000')
    if args.command == 'source':
        if not 1 <= args.lines <= 100:
            raise ValueError('lines must be between 1 and 100')
        if args.filename is not None:
            path = PurePosixPath(args.filename)
            if (not args.filename or path.is_absolute() or '..' in path.parts
                    or '\\' in args.filename):
                raise ValueError('file must be a relative source path without traversal')


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True,
                        help='explicit local directory; no fetch or source mutation')
    parser.add_argument('--cache', type=Path, default=DEFAULT_CACHE,
                        help='shared POSIX cache; must be outside source')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('locate', help='validate and print source/index provenance')
    query = commands.add_parser('query', help='query the real Graphify index')
    query.add_argument('symbol')
    query.add_argument('--budget', type=int, default=1000,
                       help='upstream soft token budget, 1 to 32000')
    query.add_argument('--context', help='upstream context filter, for example call')
    explain = commands.add_parser('explain', help='explain a graph node ID')
    explain.add_argument('symbol')
    show = commands.add_parser('source', help='read source for an exact graph label')
    show.add_argument('label')
    show.add_argument('--file', dest='filename')
    show.add_argument('--lines', type=int, default=20)
    commands.add_parser(
        'serve', help='serve a frozen startup snapshot over stdio MCP',
        description='Serve a frozen startup snapshot over stdio MCP; restart after source edits. '
                    'This process does not watch files or refresh its graph.')
    commands.add_parser('serve-live', help='serve with freshness checks and explicit refresh over stdio MCP')
    args = parser.parse_args(argv)
    try:
        _validate_options(args)
        if args.command == 'serve-live':
            from .live_mcp import serve
            serve(args.source, args.cache)
            return 0
        index = open_workspace(args.source, args.cache)
        if args.command == 'locate':
            print(json.dumps(index, ensure_ascii=False, indent=2))
        elif args.command in ('query', 'explain'):
            command = [args.command, args.symbol, '--graph', index['graph']]
            if args.command == 'query':
                command.extend(['--budget', str(args.budget)])
                if args.context:
                    command.extend(['--context', args.context])
            result = graph_command(command)
            sys.stdout.write(result.stdout)
            sys.stderr.write(result.stderr)
            return result.returncode
        elif args.command == 'source':
            source = Path(index['source'])
            node = node_at(Path(index['graph']), args.label, args.filename)
            excerpt = source_excerpt(source, node, args.lines)
            if source_fingerprint(source) != index['source_fingerprint']:
                raise CacheError('source changed while reading the excerpt')
            if context_fingerprint(source)['sha256'] != index['context_sha256']:
                raise CacheError('configuration or Git state changed while reading the excerpt')
            print(json.dumps({**index, **excerpt}, ensure_ascii=False, indent=2))
        elif args.command == 'serve':
            os.execve(sys.executable,
                      [sys.executable, '-I', '-m', 'graphify.serve', '--graph', index['graph']],
                      environment())
        return 0
    except (CacheError, OSError, ValueError, KeyError, subprocess.TimeoutExpired) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
