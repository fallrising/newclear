"""Opt-in local MCP tools with explicit freshness and refresh boundaries."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path, PurePosixPath

from mcp import types
from mcp.server import Server
from mcp.server.stdio import stdio_server

from .__main__ import graph_command
from .call_paths import calls_path
from .live_state import LiveWorkspace, LiveWorkspaceError
from .source import node_at, source_excerpt


def _schema(properties=None, required=()):
    return {'type': 'object', 'properties': properties or {}, 'required': list(required),
            'additionalProperties': False}


STRING = {'type': 'string', 'minLength': 1}
TOOLS = [
    types.Tool(name='workspace_status', description='Check the active snapshot without rebuilding it.', input_schema=_schema()),
    types.Tool(name='refresh_workspace', description='Explicitly validate/build and atomically select a current snapshot.', input_schema=_schema()),
    types.Tool(name='query_graph', description='Query real Graphify; fail if the active snapshot is not current.',
               input_schema=_schema({'question': STRING, 'budget': {'type':'integer','minimum':1,'maximum':32000}, 'context':STRING}, ['question'])),
    types.Tool(name='source_excerpt', description='Read bounded source for one exact label; fail if stale.',
               input_schema=_schema({'label':STRING, 'file':STRING, 'lines':{'type':'integer','minimum':1,'maximum':100}}, ['label'])),
    types.Tool(name='calls_path', description='Find a bounded directed calls-only path using exact ID or unique exact label.',
               input_schema=_schema({'source':STRING,'target':STRING,'max_hops':{'type':'integer','minimum':1,'maximum':100},
                                     'max_visited':{'type':'integer','minimum':1,'maximum':100000}}, ['source','target'])),
]


def _validate(name: str, args: dict) -> None:
    schema = next((t.input_schema for t in TOOLS if t.name == name), None)
    if schema is None:
        raise ValueError('unknown tool')
    if set(args) - set(schema['properties']) or set(schema['required']) - set(args):
        raise ValueError('unexpected or missing tool arguments')
    for key, value in args.items():
        rule = schema['properties'][key]
        if rule['type'] == 'string':
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f'{key} must be a nonempty string')
        elif type(value) is not int or not rule['minimum'] <= value <= rule['maximum']:
            raise ValueError(f'{key} is outside its integer bounds')
    if 'file' in args:
        path = PurePosixPath(args['file'])
        if path.is_absolute() or '..' in path.parts or '\\' in args['file']:
            raise ValueError('file must be a relative source path without traversal')


def dispatch(state: LiveWorkspace, name: str, args: dict) -> dict:
    _validate(name, args)
    if name == 'workspace_status':
        return state.status()
    if name == 'refresh_workspace':
        return state.refresh()

    def read(index):
        graph = Path(index['graph'])
        if name == 'query_graph':
            command = ['query', args['question'], '--graph', str(graph), '--budget', str(args.get('budget', 1000))]
            if 'context' in args:
                command += ['--context', args['context']]
            result = graph_command(command)
            if result.returncode:
                raise ValueError(f'Graphify query exited {result.returncode}: {result.stderr.strip() or result.stdout.strip()}')
            value = result.stdout
        elif name == 'source_excerpt':
            node = node_at(graph, args['label'], args.get('file'))
            value = source_excerpt(Path(index['source']), node, args.get('lines', 20))
        else:
            value = calls_path(json.loads(graph.read_text()), args['source'], args['target'],
                               max_hops=args.get('max_hops', 32), max_visited=args.get('max_visited', 10000))
        provenance = {key:index[key] for key in ('index_id','source_commit','source_fingerprint','context_sha256','graph_sha256')}
        return {'status':'ok', 'index':provenance, 'result':value}
    return state.execute(read)


def build_server(state: LiveWorkspace) -> Server:
    async def list_tools(ctx, params):
        return types.ListToolsResult(tools=TOOLS)

    async def call_tool(ctx, params):
        try:
            result = await asyncio.to_thread(dispatch, state, params.name, dict(params.arguments or {}))
            return types.CallToolResult(content=[types.TextContent(type='text', text=json.dumps(result, ensure_ascii=False))])
        except Exception as exc:
            # No query body is returned on stale/read/build/validation errors.
            error = {'status':'error', 'error':type(exc).__name__, 'message':str(exc)}
            if isinstance(exc, LiveWorkspaceError) and exc.state:
                error.update(snapshot_status=exc.state['status'], index_id=exc.state['index_id'])
            return types.CallToolResult(content=[types.TextContent(type='text', text=json.dumps(error, ensure_ascii=False))], is_error=True)

    return Server('graphify-live-workspace', version='1', on_list_tools=list_tools, on_call_tool=call_tool)


def serve(source: Path, cache: Path) -> None:
    state = LiveWorkspace(source, cache)
    server = build_server(state)
    async def run():
        async with stdio_server() as (read, write):
            await server.run(read, write, server.create_initialization_options())
    asyncio.run(run())
