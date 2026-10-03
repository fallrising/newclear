package reconcile

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

var (
	ErrCausePathCapacity  = errors.New("impact cause-path capacity exceeded")
	ErrUnknownChangedNode = errors.New("changed node is absent from old and proposed graphs")
)

type ReadVersion struct {
	Key     string
	Version uint64
}

type CausePath struct {
	Changed  NodeID
	Affected NodeID
	Nodes    []NodeID
}

type ImpactPlan struct {
	baseRevision     domain.Digest
	proposedRevision domain.Digest
	changes          []NodeChange
	impacted         []NodeID
	causePaths       []CausePath
	algorithmVersion string
	policyRevision   domain.Digest
	readVersions     []ReadVersion
	relevantRuns     []domain.Digest
	digest           domain.Digest
}

func BuildImpactPlan(
	oldGraph, newGraph Graph,
	changes []NodeChange,
	algorithmVersion string,
	policyRevision domain.Digest,
	readVersions []ReadVersion,
	relevantRuns []domain.Digest,
	maxCausePaths int,
) (ImpactPlan, error) {
	if algorithmVersion == "" || policyRevision.IsZero() || maxCausePaths <= 0 {
		return ImpactPlan{}, errors.New("algorithm, policy and positive cause-path capacity are required")
	}

	sortedChanges := slices.Clone(changes)
	slices.SortFunc(sortedChanges, func(left, right NodeChange) int {
		return strings.Compare(string(left.ID), string(right.ID))
	})
	for index, change := range sortedChanges {
		if change.ID == "" || (!oldGraph.HasNode(change.ID) && !newGraph.HasNode(change.ID)) {
			return ImpactPlan{}, fmt.Errorf("%w: %s", ErrUnknownChangedNode, change.ID)
		}
		if index > 0 && sortedChanges[index-1].ID == change.ID {
			return ImpactPlan{}, errors.New("duplicate changed node")
		}
	}
	if expected := DiffGraphs(oldGraph, newGraph); !slices.Equal(sortedChanges, expected) {
		return ImpactPlan{}, errors.New("changed nodes do not match the old and proposed graph diff")
	}

	allPaths := make([]CausePath, 0)
	for _, change := range sortedChanges {
		for _, graph := range []Graph{oldGraph, newGraph} {
			if !graph.HasNode(change.ID) {
				continue
			}
			paths, exceeded := graph.shortestCausePaths(change.ID, maxCausePaths+1)
			if exceeded {
				return ImpactPlan{}, ErrCausePathCapacity
			}
			allPaths = append(allPaths, paths...)
		}
	}

	paths := reduceCausePaths(allPaths)
	if len(paths) > maxCausePaths {
		return ImpactPlan{}, ErrCausePathCapacity
	}
	impactedSet := make(map[NodeID]bool)
	for _, change := range sortedChanges {
		impactedSet[change.ID] = true
	}
	for _, path := range paths {
		impactedSet[path.Affected] = true
	}
	impacted := slices.Sorted(maps.Keys(impactedSet))

	sortedReadVersions := slices.Clone(readVersions)
	slices.SortFunc(sortedReadVersions, func(left, right ReadVersion) int {
		return strings.Compare(left.Key, right.Key)
	})
	for index, version := range sortedReadVersions {
		if version.Key == "" || (index > 0 && sortedReadVersions[index-1].Key == version.Key) {
			return ImpactPlan{}, errors.New("read-version keys must be non-empty and unique")
		}
	}
	sortedRuns := slices.Clone(relevantRuns)
	slices.SortFunc(sortedRuns, func(left, right domain.Digest) int {
		return strings.Compare(left.String(), right.String())
	})

	plan := ImpactPlan{
		baseRevision: oldGraph.Revision(), proposedRevision: newGraph.Revision(),
		changes: sortedChanges, impacted: impacted, causePaths: paths,
		algorithmVersion: algorithmVersion, policyRevision: policyRevision,
		readVersions: sortedReadVersions, relevantRuns: sortedRuns,
	}
	plan.digest = domain.HashBytes(plan.canonicalIdentity())
	return plan, nil
}

func (plan ImpactPlan) BaseRevision() domain.Digest     { return plan.baseRevision }
func (plan ImpactPlan) ProposedRevision() domain.Digest { return plan.proposedRevision }
func (plan ImpactPlan) AlgorithmVersion() string        { return plan.algorithmVersion }
func (plan ImpactPlan) PolicyRevision() domain.Digest   { return plan.policyRevision }
func (plan ImpactPlan) Digest() domain.Digest           { return plan.digest }
func (plan ImpactPlan) Changes() []NodeChange           { return slices.Clone(plan.changes) }
func (plan ImpactPlan) Impacted() []NodeID              { return slices.Clone(plan.impacted) }
func (plan ImpactPlan) ReadVersions() []ReadVersion     { return slices.Clone(plan.readVersions) }
func (plan ImpactPlan) RelevantRuns() []domain.Digest   { return slices.Clone(plan.relevantRuns) }
func (plan ImpactPlan) CausePaths() []CausePath {
	result := make([]CausePath, len(plan.causePaths))
	for index, path := range plan.causePaths {
		result[index] = CausePath{Changed: path.Changed, Affected: path.Affected, Nodes: slices.Clone(path.Nodes)}
	}
	return result
}

func (plan ImpactPlan) canonicalIdentity() []byte {
	var buffer bytes.Buffer
	writeDigest(&buffer, plan.baseRevision)
	writeDigest(&buffer, plan.proposedRevision)
	writeString(&buffer, plan.algorithmVersion)
	writeDigest(&buffer, plan.policyRevision)
	writeUint64(&buffer, uint64(len(plan.changes)))
	for _, change := range plan.changes {
		writeString(&buffer, string(change.ID))
		writeDigest(&buffer, change.OldDigest)
		writeDigest(&buffer, change.NewDigest)
	}
	writeUint64(&buffer, uint64(len(plan.impacted)))
	for _, nodeID := range plan.impacted {
		writeString(&buffer, string(nodeID))
	}
	writeUint64(&buffer, uint64(len(plan.causePaths)))
	for _, path := range plan.causePaths {
		writeString(&buffer, string(path.Changed))
		writeString(&buffer, string(path.Affected))
		writeUint64(&buffer, uint64(len(path.Nodes)))
		for _, nodeID := range path.Nodes {
			writeString(&buffer, string(nodeID))
		}
	}
	writeUint64(&buffer, uint64(len(plan.readVersions)))
	for _, version := range plan.readVersions {
		writeString(&buffer, version.Key)
		writeUint64(&buffer, version.Version)
	}
	writeUint64(&buffer, uint64(len(plan.relevantRuns)))
	for _, run := range plan.relevantRuns {
		writeDigest(&buffer, run)
	}
	return buffer.Bytes()
}

func writeString(buffer *bytes.Buffer, value string) {
	writeUint64(buffer, uint64(len(value)))
	buffer.WriteString(value)
}

func writeDigest(buffer *bytes.Buffer, digest domain.Digest) {
	writeString(buffer, digest.String())
}

func writeUint64(buffer *bytes.Buffer, value uint64) {
	var encoded [8]byte
	binary.BigEndian.PutUint64(encoded[:], value)
	buffer.Write(encoded[:])
}

func (graph Graph) shortestCausePaths(start NodeID, limit int) ([]CausePath, bool) {
	reverse := graph.reverseAdjacency()
	distance := map[NodeID]int{start: 0}
	predecessors := make(map[NodeID][]NodeID)
	queue := []NodeID{start}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, next := range reverse[current] {
			nextDistance := distance[current] + 1
			knownDistance, seen := distance[next]
			switch {
			case !seen:
				distance[next] = nextDistance
				predecessors[next] = []NodeID{current}
				queue = append(queue, next)
			case knownDistance == nextDistance:
				predecessors[next] = append(predecessors[next], current)
			}
		}
	}
	for nodeID := range predecessors {
		slices.Sort(predecessors[nodeID])
		predecessors[nodeID] = slices.Compact(predecessors[nodeID])
	}

	result := make([]CausePath, 0)
	for _, affected := range slices.Sorted(maps.Keys(distance)) {
		var enumerate func(NodeID, []NodeID) bool
		enumerate = func(current NodeID, reversed []NodeID) bool {
			reversed = append(reversed, current)
			if current == start {
				nodes := slices.Clone(reversed)
				slices.Reverse(nodes)
				result = append(result, CausePath{Changed: start, Affected: affected, Nodes: nodes})
				return len(result) > limit
			}
			for _, predecessor := range predecessors[current] {
				if enumerate(predecessor, slices.Clone(reversed)) {
					return true
				}
			}
			return false
		}
		if enumerate(affected, nil) {
			return nil, true
		}
	}
	return result, false
}

func reduceCausePaths(paths []CausePath) []CausePath {
	type pair struct {
		changed  NodeID
		affected NodeID
	}
	minimum := make(map[pair]int)
	for _, path := range paths {
		key := pair{changed: path.Changed, affected: path.Affected}
		length, exists := minimum[key]
		if !exists || len(path.Nodes) < length {
			minimum[key] = len(path.Nodes)
		}
	}
	result := make([]CausePath, 0)
	for _, path := range paths {
		if len(path.Nodes) != minimum[pair{changed: path.Changed, affected: path.Affected}] {
			continue
		}
		duplicate := false
		for _, existing := range result {
			if existing.Changed == path.Changed && existing.Affected == path.Affected && slices.Equal(existing.Nodes, path.Nodes) {
				duplicate = true
				break
			}
		}
		if !duplicate {
			result = append(result, path)
		}
	}
	slices.SortFunc(result, compareCausePath)
	return result
}

func compareCausePath(left, right CausePath) int {
	if comparison := strings.Compare(string(left.Changed), string(right.Changed)); comparison != 0 {
		return comparison
	}
	if comparison := strings.Compare(string(left.Affected), string(right.Affected)); comparison != 0 {
		return comparison
	}
	for index := range min(len(left.Nodes), len(right.Nodes)) {
		if comparison := strings.Compare(string(left.Nodes[index]), string(right.Nodes[index])); comparison != 0 {
			return comparison
		}
	}
	return len(left.Nodes) - len(right.Nodes)
}

type ActivationCode string

const (
	ActivationStalePlan          ActivationCode = "stale_plan"
	ActivationPlanDigestMismatch ActivationCode = "plan_digest_mismatch"
)

type ActivationError struct{ Code ActivationCode }

func (activationError ActivationError) Error() string { return string(activationError.Code) }

func ValidateActivation(
	plan ImpactPlan,
	currentBase, currentPolicy domain.Digest,
	currentReadVersions []ReadVersion,
	currentRelevantRuns []domain.Digest,
	suppliedPlanDigest domain.Digest,
) error {
	if suppliedPlanDigest != plan.digest {
		return ActivationError{Code: ActivationPlanDigestMismatch}
	}
	readVersions := slices.Clone(currentReadVersions)
	slices.SortFunc(readVersions, func(left, right ReadVersion) int { return strings.Compare(left.Key, right.Key) })
	runs := slices.Clone(currentRelevantRuns)
	slices.SortFunc(runs, func(left, right domain.Digest) int { return strings.Compare(left.String(), right.String()) })
	if currentBase != plan.baseRevision || currentPolicy != plan.policyRevision ||
		!slices.Equal(readVersions, plan.readVersions) || !slices.Equal(runs, plan.relevantRuns) {
		return ActivationError{Code: ActivationStalePlan}
	}
	return nil
}
