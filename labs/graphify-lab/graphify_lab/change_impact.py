"""Calls-only impact candidates, with explicit bounds and heuristic test hints."""
from __future__ import annotations

from collections import deque
from copy import deepcopy
from pathlib import PurePosixPath

from .call_graph import calls_graph, resolve_node

LIMITATIONS = ('Static calls evidence only; not a complete test selector. '
               'Python test hints use naming conventions, not test discovery or execution.')


def _test_reasons(node: dict) -> list[str]:
    label, filename = node.get('label'), node.get('source_file')
    if not isinstance(label, str) or not isinstance(filename, str):
        return []
    symbol = label.removesuffix('()').rsplit('.', 1)[-1]
    path = PurePosixPath(filename)
    test_path = (set(path.parts[:-1]) & {'test', 'tests'}
                 or path.name.startswith('test_') or path.name.endswith('_test.py'))
    if symbol.startswith('test_') and path.suffix == '.py' and test_path:
        return ['python_test_name', 'python_test_path']
    return []


def change_impact(graph: dict, target: str, max_hops: int = 32,
                  max_visited: int = 10000, max_results: int = 100) -> dict:
    """Find callers by reverse BFS, retaining forward evidence back to target.

    ``visited`` includes the target; results exclude it even in cycles. Bounds
    limit traversal/output, not the initial graph load/validation. A complete
    traversal is only complete relative to the supplied static calls graph.
    """
    for name, value, maximum in (('max_hops', max_hops, 100),
                                  ('max_visited', max_visited, 100000),
                                  ('max_results', max_results, 1000)):
        if type(value) is not int or not 1 <= value <= maximum:
            raise ValueError(f'{name} must be an integer between 1 and {maximum}')
    nodes, forward = calls_graph(graph)
    target_id = resolve_node(nodes, target)
    reverse: dict[str, dict[str, dict]] = {}
    for caller, callees in forward.items():
        for callee, edge in callees.items():
            reverse.setdefault(callee, {})[caller] = edge

    parents: dict[str, tuple[str, dict] | None] = {target_id: None}
    pending = deque([(target_id, 0)])
    callers, hints = [], []
    reasons = set()
    while pending:
        current, depth = pending.popleft()
        for caller, edge in sorted(reverse.get(current, {}).items()):
            if caller in parents:
                continue
            blocked = []
            if depth >= max_hops:
                blocked.append('max_hops')
            if len(parents) >= max_visited:
                blocked.append('max_visited')
            if len(callers) >= max_results:
                blocked.append('max_results')
            if blocked:
                reasons.update(blocked)
                continue
            parents[caller] = (current, edge)
            pending.append((caller, depth + 1))
            path_ids, path_edges, cursor = [caller], [], caller
            while parents[cursor] is not None:
                cursor, path_edge = parents[cursor]
                path_ids.append(cursor)
                path_edges.append(path_edge)
            callers.append({'node': nodes[caller], 'hops': depth + 1,
                            'direct': depth == 0, 'path': [nodes[n] for n in path_ids],
                            'edges': path_edges})
            test_reasons = _test_reasons(nodes[caller])
            if test_reasons:
                hints.append({'id': caller, 'reasons': test_reasons})
    # Returned metadata is independent of the input and other consumers.
    return deepcopy({'status': 'limit_reached' if reasons else 'complete',
                     'reasons': sorted(reasons), 'relation': 'calls', 'direction': 'reverse',
                     'target': target_id, 'callers': callers, 'test_hints': hints,
                     'visited': len(parents), 'max_hops': max_hops,
                     'max_visited': max_visited, 'max_results': max_results,
                     'limitations': LIMITATIONS})
