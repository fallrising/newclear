"""Shared validation and deterministic adjacency for calls-only graph readers."""
from __future__ import annotations

import json


def calls_graph(graph: dict) -> tuple[dict, dict]:
    if not isinstance(graph, dict) or not isinstance(graph.get('nodes'), list):
        raise ValueError('graph must contain a nodes list')
    nodes = {}
    for node in graph['nodes']:
        if (not isinstance(node, dict) or not isinstance(node.get('id'), str)
                or not node['id'] or node['id'] in nodes):
            raise ValueError('graph node IDs must be unique nonempty strings')
        nodes[node['id']] = node

    edges = graph.get('links', graph.get('edges', []))
    if not isinstance(edges, list):
        raise ValueError('graph edges must be a list')
    adjacency: dict[str, dict[str, dict]] = {}
    for edge in edges:
        if not isinstance(edge, dict):
            raise ValueError('graph edge must be an object')
        if edge.get('relation') != 'calls':
            continue
        caller, callee = edge.get('source'), edge.get('target')
        if not isinstance(caller, str) or not isinstance(callee, str) or caller not in nodes or callee not in nodes:
            raise ValueError('calls edge must reference known node IDs')
        neighbors = adjacency.setdefault(caller, {})
        # Parallel calls share reachability. Choose stable evidence independently
        # of extraction serialization order rather than a random first edge.
        previous = neighbors.get(callee)
        if previous is None or json.dumps(edge, sort_keys=True) < json.dumps(previous, sort_keys=True):
            neighbors[callee] = edge

    return nodes, adjacency


def resolve_node(nodes: dict, selector: str) -> str:
    if not isinstance(selector, str) or not selector:
        raise ValueError('node selector must be a nonempty string')
    if selector in nodes:
        return selector
    matches = [node_id for node_id, node in nodes.items() if node.get('label') == selector]
    if not matches:
        raise ValueError(f'unknown node: {selector}')
    if len(matches) != 1:
        raise ValueError(f'ambiguous node label ({len(matches)} matches); use an exact ID: {selector}')
    return matches[0]
