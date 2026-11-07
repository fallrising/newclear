"""Bounded directed calls-only navigation over an already validated Graphify graph."""
from __future__ import annotations

from collections import deque
from .call_graph import calls_graph, resolve_node


def calls_path(graph: dict, source: str, target: str, max_hops: int = 32,
               max_visited: int = 10000) -> dict:
    """Find a shortest directed calls path, reporting incomplete searches explicitly.

    Selectors match exact node IDs first, then a unique exact label. The graph's
    original node and edge metadata is retained as source evidence. This does
    not establish that a static calls edge represents every runtime execution.
    ``visited`` counts distinct discovered nodes, including the source.
    """
    for name, value, maximum in (('max_hops', max_hops, 100),
                                  ('max_visited', max_visited, 100000)):
        if type(value) is not int or not 1 <= value <= maximum:
            raise ValueError(f'{name} must be an integer between 1 and {maximum}')
    nodes, adjacency = calls_graph(graph)
    source_id, target_id = resolve_node(nodes, source), resolve_node(nodes, target)

    parents: dict[str, tuple[str, dict] | None] = {source_id: None}
    pending = deque([(source_id, 0)])
    truncated = set()

    def result(status: str, reason: str | None, path: list, path_edges: list) -> dict:
        return {'status': status, 'reason': reason, 'relation': 'calls',
                'direction': 'forward', 'source': source_id, 'target': target_id,
                'path': path, 'edges': path_edges,
                'hops': len(path_edges) if status == 'found' else None,
                'visited': len(parents), 'max_hops': max_hops, 'max_visited': max_visited}

    while pending:
        current, depth = pending.popleft()
        if current == target_id:
            path_ids, path_edges = [current], []
            while parents[current] is not None:
                current, edge = parents[current]
                path_ids.append(current)
                path_edges.append(dict(edge))
            return result('found', None, [dict(nodes[n]) for n in reversed(path_ids)],
                          list(reversed(path_edges)))
        for neighbor, edge in sorted(adjacency.get(current, {}).items()):
            if neighbor in parents:
                continue
            if depth >= max_hops:
                truncated.add('max_hops')
                continue
            if len(parents) >= max_visited:
                truncated.add('max_visited')
                continue
            parents[neighbor] = (current, edge)
            pending.append((neighbor, depth + 1))
    if truncated:
        return result('limit_reached', '+'.join(sorted(truncated)), [], [])
    return result('not_found', 'no_directed_calls_path', [], [])
