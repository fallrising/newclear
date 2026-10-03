package reconcile

import (
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type NodeID string
type EdgeKind string

const (
	EdgeSpecifies EdgeKind = "specifies"
	EdgeDependsOn EdgeKind = "depends_on"
	EdgeVerifies  EdgeKind = "verifies"
	EdgeProduces  EdgeKind = "produces"
)

type Node struct {
	ID               NodeID
	Path             string
	ContentDigest    domain.Digest
	BindingDigest    domain.Digest
	RequiredACDigest domain.Digest
	RecipeDigest     domain.Digest
	Required         bool
	Mapped           bool
}

// Edge points from a consumer to the node it depends on. Reverse traversal
// therefore moves from a changed dependency to all affected consumers.
type Edge struct {
	From NodeID
	To   NodeID
	Kind EdgeKind
}

type ValidationCode string

const (
	ValidationDuplicateNode    ValidationCode = "duplicate_node_id"
	ValidationDanglingNode     ValidationCode = "dangling_node"
	ValidationInvalidEdgeKind  ValidationCode = "invalid_edge_kind"
	ValidationDuplicateEdge    ValidationCode = "duplicate_edge"
	ValidationCycle            ValidationCode = "cycle"
	ValidationUnmappedRequired ValidationCode = "unmapped_required"
)

type ValidationError struct {
	Code ValidationCode
	Path []NodeID
}

func (validationError ValidationError) Error() string {
	path := make([]string, len(validationError.Path))
	for index, nodeID := range validationError.Path {
		path[index] = string(nodeID)
	}
	return fmt.Sprintf("graph validation %s: %s", validationError.Code, strings.Join(path, " -> "))
}

type Graph struct {
	revision domain.Digest
	nodes    map[NodeID]Node
	edges    []Edge
}

func NewGraph(revision domain.Digest, nodes []Node, edges []Edge) (Graph, error) {
	if revision.IsZero() {
		return Graph{}, errors.New("graph revision is required")
	}

	sortedNodes := slices.Clone(nodes)
	slices.SortFunc(sortedNodes, compareNode)
	for index, node := range sortedNodes {
		if node.ID == "" || node.ContentDigest.IsZero() {
			return Graph{}, errors.New("node ID and content digest are required")
		}
		if index > 0 && sortedNodes[index-1].ID == node.ID {
			return Graph{}, ValidationError{Code: ValidationDuplicateNode, Path: []NodeID{node.ID}}
		}
		if node.Required && !node.Mapped {
			return Graph{}, ValidationError{Code: ValidationUnmappedRequired, Path: []NodeID{node.ID}}
		}
	}

	nodeMap := make(map[NodeID]Node, len(sortedNodes))
	for _, node := range sortedNodes {
		nodeMap[node.ID] = node
	}

	sortedEdges := slices.Clone(edges)
	slices.SortFunc(sortedEdges, compareEdge)
	for index, edge := range sortedEdges {
		if !edge.Kind.valid() {
			return Graph{}, ValidationError{Code: ValidationInvalidEdgeKind, Path: []NodeID{edge.From, edge.To}}
		}
		if _, exists := nodeMap[edge.From]; !exists {
			return Graph{}, ValidationError{Code: ValidationDanglingNode, Path: []NodeID{edge.From}}
		}
		if _, exists := nodeMap[edge.To]; !exists {
			return Graph{}, ValidationError{Code: ValidationDanglingNode, Path: []NodeID{edge.To}}
		}
		if index > 0 && sortedEdges[index-1] == edge {
			return Graph{}, ValidationError{Code: ValidationDuplicateEdge, Path: []NodeID{edge.From, edge.To}}
		}
	}

	graph := Graph{revision: revision, nodes: nodeMap, edges: sortedEdges}
	if cycle := graph.cycle(); len(cycle) > 0 {
		return Graph{}, ValidationError{Code: ValidationCycle, Path: cycle}
	}
	return graph, nil
}

func (kind EdgeKind) valid() bool {
	return kind == EdgeSpecifies || kind == EdgeDependsOn || kind == EdgeVerifies || kind == EdgeProduces
}

func (graph Graph) Revision() domain.Digest { return graph.revision }

func (graph Graph) Nodes() []Node {
	ids := slices.Sorted(maps.Keys(graph.nodes))
	nodes := make([]Node, 0, len(ids))
	for _, id := range ids {
		nodes = append(nodes, graph.nodes[id])
	}
	return nodes
}

func (graph Graph) Edges() []Edge { return slices.Clone(graph.edges) }

func (graph Graph) HasNode(id NodeID) bool {
	_, exists := graph.nodes[id]
	return exists
}

func (graph Graph) cycle() []NodeID {
	adjacency := make(map[NodeID][]NodeID, len(graph.nodes))
	for _, edge := range graph.edges {
		adjacency[edge.From] = append(adjacency[edge.From], edge.To)
	}
	for nodeID := range adjacency {
		slices.Sort(adjacency[nodeID])
		adjacency[nodeID] = slices.Compact(adjacency[nodeID])
	}

	const (
		unvisited uint8 = iota
		visiting
		visited
	)
	state := make(map[NodeID]uint8, len(graph.nodes))
	stack := make([]NodeID, 0, len(graph.nodes))
	stackIndex := make(map[NodeID]int, len(graph.nodes))
	var visit func(NodeID) []NodeID
	visit = func(nodeID NodeID) []NodeID {
		state[nodeID] = visiting
		stackIndex[nodeID] = len(stack)
		stack = append(stack, nodeID)
		for _, dependency := range adjacency[nodeID] {
			switch state[dependency] {
			case unvisited:
				if path := visit(dependency); len(path) > 0 {
					return path
				}
			case visiting:
				path := slices.Clone(stack[stackIndex[dependency]:])
				return append(path, dependency)
			}
		}
		stack = stack[:len(stack)-1]
		delete(stackIndex, nodeID)
		state[nodeID] = visited
		return nil
	}

	for _, nodeID := range slices.Sorted(maps.Keys(graph.nodes)) {
		if state[nodeID] == unvisited {
			if path := visit(nodeID); len(path) > 0 {
				return path
			}
		}
	}
	return nil
}

func (graph Graph) reverseAdjacency() map[NodeID][]NodeID {
	reverse := make(map[NodeID][]NodeID, len(graph.nodes))
	for _, edge := range graph.edges {
		reverse[edge.To] = append(reverse[edge.To], edge.From)
	}
	for nodeID := range reverse {
		slices.Sort(reverse[nodeID])
		reverse[nodeID] = slices.Compact(reverse[nodeID])
	}
	return reverse
}

type NodeChange struct {
	ID        NodeID
	OldDigest domain.Digest
	NewDigest domain.Digest
}

// DiffGraphs compares normative stable-ID content and topology. Path is
// presentation metadata and intentionally does not invalidate a stable rename.
func DiffGraphs(oldGraph, newGraph Graph) []NodeChange {
	allIDs := maps.Clone(oldGraph.nodes)
	maps.Copy(allIDs, newGraph.nodes)
	changed := make(map[NodeID]bool, len(allIDs))
	for nodeID := range allIDs {
		oldNode, inOld := oldGraph.nodes[nodeID]
		newNode, inNew := newGraph.nodes[nodeID]
		if !inOld || !inNew || normativeNodeChanged(oldNode, newNode) {
			changed[nodeID] = true
		}
	}

	oldEdges := make(map[Edge]bool, len(oldGraph.edges))
	newEdges := make(map[Edge]bool, len(newGraph.edges))
	for _, edge := range oldGraph.edges {
		oldEdges[edge] = true
	}
	for _, edge := range newGraph.edges {
		newEdges[edge] = true
	}
	for edge := range oldEdges {
		if !newEdges[edge] {
			changed[edge.From], changed[edge.To] = true, true
		}
	}
	for edge := range newEdges {
		if !oldEdges[edge] {
			changed[edge.From], changed[edge.To] = true, true
		}
	}

	ids := slices.Sorted(maps.Keys(changed))
	result := make([]NodeChange, 0, len(ids))
	for _, nodeID := range ids {
		result = append(result, NodeChange{
			ID: nodeID, OldDigest: oldGraph.nodes[nodeID].ContentDigest,
			NewDigest: newGraph.nodes[nodeID].ContentDigest,
		})
	}
	return result
}

func normativeNodeChanged(left, right Node) bool {
	return left.ID != right.ID || left.ContentDigest != right.ContentDigest ||
		left.BindingDigest != right.BindingDigest || left.RequiredACDigest != right.RequiredACDigest ||
		left.RecipeDigest != right.RecipeDigest || left.Required != right.Required || left.Mapped != right.Mapped
}

func compareNode(left, right Node) int {
	return strings.Compare(string(left.ID), string(right.ID))
}

func compareEdge(left, right Edge) int {
	if comparison := strings.Compare(string(left.From), string(right.From)); comparison != 0 {
		return comparison
	}
	if comparison := strings.Compare(string(left.To), string(right.To)); comparison != 0 {
		return comparison
	}
	return strings.Compare(string(left.Kind), string(right.Kind))
}
