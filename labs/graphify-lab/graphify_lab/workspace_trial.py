"""Replay real local-workspace CLI and stdio MCP acceptance without executing source."""
from __future__ import annotations

import argparse
import ast
import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

from .__main__ import DEFAULT_CACHE, LAB, REPO, environment
from .cache import PINNED_GRAPHIFY_VERSION, source_fingerprint
from .pilot import _error_text, sanitize
from .source import node_at

SOURCE = REPO / 'tools/codex-usage'
HELPERS = ('normalize_rates', 'norm_window', 'remaining_percent')


def validate_output(output: Path, *, lab: Path = LAB, source: Path = SOURCE,
                    environment_root: Path = Path(sys.prefix), cache: Path = DEFAULT_CACHE) -> Path:
    original = output.expanduser()
    output = original.resolve()
    protected = [lab / name for name in ('graphify_lab', 'tests', 'fixtures', '.venv')]
    protected.extend((source, environment_root, cache))
    for path in protected:
        path = path.expanduser().resolve()
        if output == path or output in path.parents or path in output.parents:
            raise ValueError('output must not overlap code, tests, fixtures, environment, cache, or source')
    if original.is_symlink() or output.exists():
        raise FileExistsError('output already exists; choose a new run directory')
    return output


def _cli(source: Path, cache: Path, args: list[str], commands: list[dict]) -> str:
    command = [sys.executable, '-m', 'graphify_lab.workspace', '--source', str(source),
               '--cache', str(cache), *args]
    started = time.perf_counter()
    record = {'command': command}
    commands.append(record)
    try:
        result = subprocess.run(command, cwd=LAB, env=environment(), capture_output=True,
                                text=True, timeout=150)
        record.update(exit_code=result.returncode, stdout=result.stdout, stderr=result.stderr,
                      stdout_bytes=len(result.stdout.encode()), stderr_bytes=len(result.stderr.encode()))
        if result.returncode:
            raise RuntimeError(f'workspace {args[0]} exited {result.returncode}: {result.stderr[-1500:]}')
        return result.stdout
    except Exception as exc:
        record['error'] = _error_text(exc)
        raise
    finally:
        record['seconds'] = round(time.perf_counter() - started, 6)


async def _mcp(source: Path, cache: Path, nodes: list[dict], output: Path, evidence: dict) -> None:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    args = ['-m', 'graphify_lab.workspace', '--source', str(source), '--cache', str(cache), 'serve']
    params = StdioServerParameters(command=sys.executable, args=args, cwd=str(LAB), env=environment())
    evidence.update(command=[sys.executable, *args], transport='stdio', requests=[])
    async def record(operation, arguments, call):
        row = {'operation': operation, 'arguments': arguments}
        evidence['requests'].append(row)
        started = time.perf_counter()
        try:
            result = await call()
            row['response'] = result.model_dump(by_alias=True, mode='json')
            row['response_bytes'] = len(json.dumps(row['response']).encode())
            if getattr(result, 'isError', getattr(result, 'is_error', False)):
                raise ValueError(f'MCP {operation} returned an error')
            return result
        except Exception as exc:
            row['error'] = _error_text(exc)
            raise
        finally:
            row['seconds'] = round(time.perf_counter() - started, 6)

    with (output / 'mcp.stderr.log').open('w') as log:
        async with stdio_client(params, errlog=log) as (read, write):
            timeout = timedelta(seconds=20) if importlib.metadata.version('mcp').startswith('1.') else 20.0
            async with ClientSession(read, write, read_timeout_seconds=timeout) as session:
                await record('initialize', {}, session.initialize)
                listed = await record('list_tools', {}, session.list_tools)
                if not {'query_graph', 'shortest_path'} <= {tool.name for tool in listed.tools}:
                    raise ValueError('real wrapper MCP server lacks required tools')
                args = {'question': 'norm_window', 'depth': 2, 'token_budget': 3000,
                        'context_filter': ['call']}
                result = await record('query_graph', args, lambda: session.call_tool('query_graph', args))
                answer = '\n'.join(block.text for block in result.content if hasattr(block, 'text'))
                if not all(node['label'] in answer for node in nodes):
                    raise ValueError('MCP query did not recover all three helpers')
                # An equally short file-containment route can win end-to-end.
                # Retain that observation, then prove each directed call segment.
                args = {'source': nodes[0]['id'], 'target': nodes[-1]['id']}
                await record('shortest_path', args, lambda: session.call_tool('shortest_path', args))
                for caller, callee in zip(nodes, nodes[1:]):
                    args = {'source': caller['id'], 'target': callee['id']}
                    result = await record('shortest_path', args, lambda: session.call_tool('shortest_path', args))
                    answer = '\n'.join(block.text for block in result.content if hasattr(block, 'text'))
                    if (caller['label'] not in answer or callee['label'] not in answer
                            or '1 hops' not in answer or '--calls' not in answer or '-->' not in answer):
                        raise ValueError('MCP shortest_path did not recover a directed call segment')
    evidence['chain_verified'] = True


def run_trial(output: Path) -> dict:
    output = validate_output(output)
    version = importlib.metadata.version('graphifyy')
    if version != PINNED_GRAPHIFY_VERSION:
        raise ValueError(f'Graphify must be {PINNED_GRAPHIFY_VERSION}, got {version}')
    output.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    report = {'schema': 1, 'status': 'failed', 'recorded_at': datetime.now(timezone.utc).isoformat(),
              'graphify_version': version, 'python_version': sys.version.split()[0], 'commands': [],
              'limitations': [
                  'One known public component and helper chain; not a blind or comprehensive evaluation.',
                  'Serve validates a snapshot at startup; source edits require restarting the MCP session.',
                  'Calls edges and AST source checks do not establish complete runtime semantics.',
                  'Shortest path considers containment too; the end-to-end route may use the file node. '
                  'Each adjacent helper call is separately checked through real MCP shortest_path.',
                  'Source is read and parsed, never imported, built, or executed.',
                  'Per-operation elapsed time and bytes are observations, not speed or token-saving claims.',
                  'No global client configuration or model API is used. Provider/tokens/cost are unmeasured.']}
    commands = report['commands']
    cache = output / 'cache'
    before = None
    try:
        before = source_fingerprint(SOURCE)
        report['corpus'] = {'path': 'tools/codex-usage', 'before': before}
        first = json.loads(_cli(SOURCE, cache, ['locate'], commands))
        second = json.loads(_cli(SOURCE, cache, ['locate'], commands))
        report['consumers'] = [first, second]
        first_path, second_path = Path(first['graph']), Path(second['graph'])
        if (first['index_id'] != second['index_id'] or not first_path.samefile(second_path)
                or not second['cache_hit'] or first['source_fingerprint'] != before):
            raise ValueError('consumers did not share one validated physical index')
        report['shared_index_verified'] = True
        report['corpus']['git_commit'] = first['source_commit']
        graph_bytes = first_path.read_bytes()
        graph = json.loads(graph_bytes)
        report['graph'] = {'nodes': len(graph['nodes']),
                           'edges': len(graph.get('links', graph.get('edges', []))),
                           'sha256': hashlib.sha256(graph_bytes).hexdigest(), 'bytes': len(graph_bytes)}
        nodes = [node_at(first_path, name + '()', 'codex_usage.py') for name in HELPERS]
        tree = ast.parse((SOURCE / 'codex_usage.py').read_text())
        report['definitions'] = []
        for name, node in zip(HELPERS, nodes):
            excerpt = json.loads(_cli(SOURCE, cache, ['source', node['label'], '--file', 'codex_usage.py', '--lines', '12'], commands))
            definitions = [part for part in ast.walk(tree) if isinstance(part, ast.FunctionDef)
                           and part.name == name and part.lineno == excerpt['line']]
            if (len(definitions) != 1 or excerpt['path'] != 'codex_usage.py'
                    or excerpt['content'].splitlines()[0] != (SOURCE / 'codex_usage.py').read_text().splitlines()[excerpt['line'] - 1]
                    or excerpt['index_id'] != first['index_id']):
                raise ValueError('CLI source pointer does not match exact AST declaration')
            query = _cli(SOURCE, cache, ['query', name, '--budget', '3000', '--context', 'call'], commands)
            explain = _cli(SOURCE, cache, ['explain', node['id']], commands)
            if node['label'] not in query or f"codex_usage.py {node['source_location']}" not in explain:
                raise ValueError('CLI query/explain omitted verified source context')
            if name == 'norm_window' and not all(item['label'] in query for item in nodes):
                raise ValueError('CLI query omitted expected caller/callee context')
            report['definitions'].append({'node': node, 'source': excerpt, 'ast_verified': True})
        report['directed_calls'] = []
        for caller, callee in zip(nodes, nodes[1:]):
            edges = [edge for edge in graph.get('links', graph.get('edges', []))
                     if edge.get('relation') == 'calls'
                     and edge.get('source', edge.get('_src')) == caller['id']
                     and edge.get('target', edge.get('_tgt')) == callee['id']]
            declaration = next(part for part in ast.walk(tree) if isinstance(part, ast.FunctionDef)
                               and part.name == caller['label'].removesuffix('()'))
            callsites = [part.lineno for part in ast.walk(declaration) if isinstance(part, ast.Call)
                         and isinstance(part.func, ast.Name) and part.func.id == callee['label'].removesuffix('()')]
            if not edges or not callsites:
                raise ValueError('expected directed calls edge lacks graph or AST evidence')
            report['directed_calls'].append({'caller': caller['id'], 'callee': callee['id'],
                                             'edges': edges, 'ast_call_lines': callsites})
        report['mcp'] = {}
        asyncio.run(asyncio.wait_for(_mcp(SOURCE, cache, nodes, output, report['mcp']), timeout=90))
        mutable = output / 'mutable'
        mutable.mkdir()
        target = mutable / 'codex_usage.py'
        shutil.copyfile(SOURCE / 'codex_usage.py', target)
        old = json.loads(_cli(mutable, cache, ['locate'], commands))
        old_graph = Path(old['graph'])
        old_hash = hashlib.sha256(old_graph.read_bytes()).hexdigest()
        target.write_text(target.read_text().replace('remaining_percent', 'remaining_quota'))
        new = json.loads(_cli(mutable, cache, ['locate'], commands))
        new_graph = Path(new['graph'])
        renamed = node_at(new_graph, 'remaining_quota()', 'codex_usage.py')
        if (old['index_id'] == new['index_id'] or old['source_fingerprint'] == new['source_fingerprint']
                or any(node.get('label') == 'remaining_percent()' for node in json.loads(new_graph.read_text())['nodes'])
                or hashlib.sha256(old_graph.read_bytes()).hexdigest() != old_hash):
            raise ValueError('mutable copy did not invalidate cleanly and retain old graph')
        report['mutation'] = {'before': old, 'after': new, 'renamed': renamed,
                              'old_graph_retained': True, 'old_symbol_absent': True}
        if hashlib.sha256(first_path.read_bytes()).hexdigest() != report['graph']['sha256']:
            raise ValueError('read-only trial modified original graph')
        report['status'] = 'passed'
    except Exception as exc:
        report['error'] = _error_text(exc)
    finally:
        if before is not None:
            try:
                after = source_fingerprint(SOURCE)
                report['corpus']['after'] = after
                report['corpus']['unchanged'] = after == before
                if after != before:
                    raise ValueError('trial changed real component source')
            except Exception as exc:
                report['status'] = 'failed'
                report['source_check_error'] = _error_text(exc)
    report['measurements'] = {
        'snapshot_at': datetime.now(timezone.utc).isoformat(),
        'coverage': 'This trial process and explicit CLI/MCP operations only; excludes orchestrator and providers.',
        'cli_commands_observed': len(commands),
        'mcp_requests_observed': len(report.get('mcp', {}).get('requests', [])),
        'mcp_notifications_included': False, 'command_retries': 0,
        'outer_tool_calls': None, 'agent_starts': None, 'provider_requests': None,
        'tokens': None, 'cost': None, 'elapsed_seconds': round(time.perf_counter() - started, 6)}
    report = sanitize(report, {str(output): '<run>', str(LAB): '<lab>', str(REPO): '<repo>',
                               str(Path(sys.prefix)): '<python-env>', str(Path.home()): '<home>'})
    (output / 'report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    try:
        report = run_trial(args.out)
    except (ValueError, OSError) as exc:
        parser.exit(2, f'workspace trial: {exc}\n')
    print(json.dumps({'status': report['status'], 'error': report.get('error')}))
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
