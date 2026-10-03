package reconcile

import (
	"errors"
	"slices"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func TestManifest_RejectsCycleDanglingAndDuplicateIDs(t *testing.T) {
	tests := []struct {
		name  string
		nodes []Node
		edges []Edge
		code  ValidationCode
		path  []NodeID
	}{
		{
			name: "duplicate", nodes: []Node{node("A"), node("A")},
			code: ValidationDuplicateNode, path: []NodeID{"A"},
		},
		{
			name: "dangling", nodes: []Node{node("A")}, edges: []Edge{{From: "A", To: "missing", Kind: EdgeDependsOn}},
			code: ValidationDanglingNode, path: []NodeID{"missing"},
		},
		{
			name: "invalid-edge", nodes: []Node{node("A"), node("B")}, edges: []Edge{{From: "A", To: "B", Kind: "suggested_by_ai"}},
			code: ValidationInvalidEdgeKind, path: []NodeID{"A", "B"},
		},
		{
			name: "self-loop", nodes: []Node{node("A")}, edges: []Edge{{From: "A", To: "A", Kind: EdgeDependsOn}},
			code: ValidationCycle, path: []NodeID{"A", "A"},
		},
		{
			name: "cycle-deterministic", nodes: []Node{node("C"), node("A"), node("B")},
			edges: []Edge{{From: "C", To: "A", Kind: EdgeDependsOn}, {From: "B", To: "C", Kind: EdgeDependsOn}, {From: "A", To: "B", Kind: EdgeDependsOn}},
			code:  ValidationCycle, path: []NodeID{"A", "B", "C", "A"},
		},
		{
			name: "required-unmapped", nodes: []Node{{ID: "A", ContentDigest: digest("A"), Required: true, Mapped: false}},
			code: ValidationUnmappedRequired, path: []NodeID{"A"},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := NewGraph(digest("revision"), test.nodes, test.edges)
			validationError, ok := err.(ValidationError)
			if !ok || validationError.Code != test.code || !slices.Equal(validationError.Path, test.path) {
				t.Fatalf("error = %#v, want %s %v", err, test.code, test.path)
			}
		})
	}
}

func TestImpactPlan_UsesOldAndNewReverseClosure(t *testing.T) {
	oldGraph := mustGraph(t, "old",
		[]Node{node("D"), node("C"), node("B"), node("A"), node("X")},
		[]Edge{
			{From: "B", To: "A", Kind: EdgeDependsOn},
			{From: "C", To: "B", Kind: EdgeDependsOn},
		},
	)
	newGraph := mustGraph(t, "new",
		[]Node{changedNode("A"), node("B"), node("C"), node("D"), node("X")},
		[]Edge{
			{From: "C", To: "B", Kind: EdgeDependsOn},
		},
	)
	changes := DiffGraphs(oldGraph, newGraph)
	plan, err := BuildImpactPlan(oldGraph, newGraph, changes,
		"impact/v1", digest("policy"), nil, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	if want := []NodeID{"A", "B", "C"}; !slices.Equal(plan.Impacted(), want) {
		t.Fatalf("impacted = %v, want %v", plan.Impacted(), want)
	}
	if slices.Contains(plan.Impacted(), NodeID("D")) || slices.Contains(plan.Impacted(), NodeID("X")) {
		t.Fatalf("independent or newly redirected nodes incorrectly invalidated: %v", plan.Impacted())
	}

	oldWithoutConsumers := mustGraph(t, "old-2", []Node{node("A"), node("B"), node("C")}, nil)
	newWithConsumers := mustGraph(t, "new-2", []Node{changedNode("A"), node("B"), node("C")}, []Edge{
		{From: "B", To: "A", Kind: EdgeDependsOn}, {From: "C", To: "B", Kind: EdgeDependsOn},
	})
	plan, err = BuildImpactPlan(oldWithoutConsumers, newWithConsumers, DiffGraphs(oldWithoutConsumers, newWithConsumers),
		"impact/v1", digest("policy"), nil, nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	if want := []NodeID{"A", "B", "C"}; !slices.Equal(plan.Impacted(), want) {
		t.Fatalf("new reverse closure = %v, want %v", plan.Impacted(), want)
	}
}

func TestImpactPlan_DeterministicOrderAndCausePaths(t *testing.T) {
	nodes := []Node{node("D"), node("C"), node("A"), node("B")}
	edges := []Edge{
		{From: "D", To: "C", Kind: EdgeDependsOn},
		{From: "B", To: "A", Kind: EdgeDependsOn},
		{From: "D", To: "B", Kind: EdgeDependsOn},
		{From: "C", To: "A", Kind: EdgeDependsOn},
	}
	firstGraph := mustGraph(t, "old-graph", nodes, edges)
	newNodes := slices.Clone(nodes)
	for index := range newNodes {
		if newNodes[index].ID == "A" {
			newNodes[index] = changedNode("A")
		}
	}
	firstNewGraph := mustGraph(t, "new-graph", newNodes, edges)
	slices.Reverse(nodes)
	slices.Reverse(edges)
	slices.Reverse(newNodes)
	secondGraph := mustGraph(t, "old-graph", nodes, edges)
	secondNewGraph := mustGraph(t, "new-graph", newNodes, edges)
	change := DiffGraphs(firstGraph, firstNewGraph)
	first, err := BuildImpactPlan(firstGraph, firstNewGraph, change, "impact/v1", digest("policy"),
		[]ReadVersion{{Key: "work:D", Version: 4}, {Key: "project", Version: 2}},
		[]domain.Digest{digest("run-b"), digest("run-a")}, 20)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BuildImpactPlan(secondGraph, secondNewGraph, DiffGraphs(secondGraph, secondNewGraph), "impact/v1", digest("policy"),
		[]ReadVersion{{Key: "project", Version: 2}, {Key: "work:D", Version: 4}},
		[]domain.Digest{digest("run-a"), digest("run-b")}, 20)
	if err != nil {
		t.Fatal(err)
	}
	if first.Digest() != second.Digest() {
		t.Fatalf("input ordering changed plan identity: %s != %s", first.Digest(), second.Digest())
	}
	wantPaths := []CausePath{
		{Changed: "A", Affected: "A", Nodes: []NodeID{"A"}},
		{Changed: "A", Affected: "B", Nodes: []NodeID{"A", "B"}},
		{Changed: "A", Affected: "C", Nodes: []NodeID{"A", "C"}},
		{Changed: "A", Affected: "D", Nodes: []NodeID{"A", "B", "D"}},
		{Changed: "A", Affected: "D", Nodes: []NodeID{"A", "C", "D"}},
	}
	if actual := first.CausePaths(); !equalCausePaths(actual, wantPaths) {
		t.Fatalf("cause paths = %#v, want %#v", actual, wantPaths)
	}
	if _, err := BuildImpactPlan(firstGraph, firstNewGraph, change, "impact/v1", digest("policy"), nil, nil, 4); !errors.Is(err, ErrCausePathCapacity) {
		t.Fatalf("capacity error = %v", err)
	}
}

func TestImpactPlan_IdentityBindsContractInputs(t *testing.T) {
	makePlan := func(oldRevision, newRevision, newContent, algorithm, policy string, edges []Edge) ImpactPlan {
		oldGraph := mustGraph(t, oldRevision, []Node{node("A"), node("B")}, nil)
		newA := node("A")
		newA.ContentDigest = digest(newContent)
		newGraph := mustGraph(t, newRevision, []Node{newA, node("B")}, edges)
		plan, err := BuildImpactPlan(oldGraph, newGraph, DiffGraphs(oldGraph, newGraph), algorithm, digest(policy),
			[]ReadVersion{{Key: "project", Version: 1}}, []domain.Digest{digest("run")}, 10)
		if err != nil {
			t.Fatal(err)
		}
		return plan
	}
	base := makePlan("old", "new", "changed-A", "impact/v1", "policy", nil)
	variants := []ImpactPlan{
		makePlan("other-old", "new", "changed-A", "impact/v1", "policy", nil),
		makePlan("old", "other-new", "changed-A", "impact/v1", "policy", nil),
		makePlan("old", "new", "changed-A-again", "impact/v1", "policy", nil),
		makePlan("old", "new", "changed-A", "impact/v2", "policy", nil),
		makePlan("old", "new", "changed-A", "impact/v1", "policy-2", nil),
		makePlan("old", "new", "changed-A", "impact/v1", "policy", []Edge{{From: "B", To: "A", Kind: EdgeDependsOn}}),
	}
	for _, variant := range variants {
		if variant.Digest() == base.Digest() {
			t.Fatal("changed plan identity input retained the same digest")
		}
	}
}

func TestImpactActivation_RejectsStalePlan(t *testing.T) {
	graph := mustGraph(t, "graph", []Node{node("A")}, nil)
	changedGraph := mustGraph(t, "changed-graph", []Node{changedNode("A")}, nil)
	plan, err := BuildImpactPlan(graph, changedGraph, DiffGraphs(graph, changedGraph),
		"impact/v1", digest("policy"), []ReadVersion{{Key: "project", Version: 1}},
		[]domain.Digest{digest("run")}, 10)
	if err != nil {
		t.Fatal(err)
	}
	valid := func(base, policy domain.Digest, reads []ReadVersion, runs []domain.Digest, supplied domain.Digest) error {
		return ValidateActivation(plan, base, policy, reads, runs, supplied)
	}
	if err := valid(graph.Revision(), digest("policy"), []ReadVersion{{Key: "project", Version: 1}}, []domain.Digest{digest("run")}, plan.Digest()); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name     string
		base     domain.Digest
		policy   domain.Digest
		reads    []ReadVersion
		runs     []domain.Digest
		supplied domain.Digest
		code     ActivationCode
	}{
		{"base", digest("other-graph"), digest("policy"), []ReadVersion{{Key: "project", Version: 1}}, []domain.Digest{digest("run")}, plan.Digest(), ActivationStalePlan},
		{"policy", graph.Revision(), digest("other-policy"), []ReadVersion{{Key: "project", Version: 1}}, []domain.Digest{digest("run")}, plan.Digest(), ActivationStalePlan},
		{"aggregate", graph.Revision(), digest("policy"), []ReadVersion{{Key: "project", Version: 2}}, []domain.Digest{digest("run")}, plan.Digest(), ActivationStalePlan},
		{"run", graph.Revision(), digest("policy"), []ReadVersion{{Key: "project", Version: 1}}, []domain.Digest{digest("new-run-state")}, plan.Digest(), ActivationStalePlan},
		{"digest", graph.Revision(), digest("policy"), []ReadVersion{{Key: "project", Version: 1}}, []domain.Digest{digest("run")}, digest("forged-plan"), ActivationPlanDigestMismatch},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := valid(test.base, test.policy, test.reads, test.runs, test.supplied)
			activationError, ok := err.(ActivationError)
			if !ok || activationError.Code != test.code {
				t.Fatalf("error = %#v, want %s", err, test.code)
			}
		})
	}
}

func TestGraphDiff_StableIDRenameIsPresentationOnly(t *testing.T) {
	oldNode := node("A")
	oldNode.Path = "docs/old.md"
	newNode := oldNode
	newNode.Path = "docs/new.md"
	oldGraph := mustGraph(t, "old", []Node{oldNode}, nil)
	newGraph := mustGraph(t, "new", []Node{newNode}, nil)
	if changes := DiffGraphs(oldGraph, newGraph); len(changes) != 0 {
		t.Fatalf("presentation-only stable-ID rename invalidated: %#v", changes)
	}
	newNode.ContentDigest = digest("changed-content")
	newGraph = mustGraph(t, "changed", []Node{newNode}, nil)
	if changes := DiffGraphs(oldGraph, newGraph); len(changes) != 1 || changes[0].ID != "A" {
		t.Fatalf("content change = %#v", changes)
	}
}

func TestReuseFingerprint_RecipeEnvironmentAndBaseMatter(t *testing.T) {
	base := reuseConfig()
	baseline := NewReuseFingerprint(base)
	reordered := base
	reordered.RequiredACRevisions = slices.Clone(base.RequiredACRevisions)
	slices.Reverse(reordered.RequiredACRevisions)
	if CompareReuse(baseline, NewReuseFingerprint(reordered)) != ReuseMatch {
		t.Fatal("required AC ordering changed equivalent fingerprint")
	}

	tests := []struct {
		name   string
		mutate func(*ReuseFingerprintConfig)
	}{
		{"candidate", func(config *ReuseFingerprintConfig) { config.CandidateDigest = digest("candidate-2") }},
		{"input", func(config *ReuseFingerprintConfig) { config.RunInputDigest = digest("input-2") }},
		{"ac", func(config *ReuseFingerprintConfig) {
			config.RequiredACRevisions[0].RevisionDigest = digest("ac-1-new")
		}},
		{"graph", func(config *ReuseFingerprintConfig) { config.GraphRevisionDigest = digest("graph-2") }},
		{"policy", func(config *ReuseFingerprintConfig) { config.PolicyRevisionDigest = digest("policy-2") }},
		{"recipe", func(config *ReuseFingerprintConfig) { config.VerificationRecipeDigest = digest("recipe-2") }},
		{"environment", func(config *ReuseFingerprintConfig) { config.EnvironmentDigest = digest("environment-2") }},
		{"base", func(config *ReuseFingerprintConfig) { config.IntegrationBaseDigest = digest("base-2") }},
		{"adapter", func(config *ReuseFingerprintConfig) { config.AdapterVersion = "fake/v2" }},
		{"verifier", func(config *ReuseFingerprintConfig) { config.VerifierClass = "human" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			changed := reuseConfig()
			test.mutate(&changed)
			if CompareReuse(baseline, NewReuseFingerprint(changed)) != ReuseMismatch {
				t.Fatal("changed reuse dimension matched")
			}
		})
	}
	unknown := reuseConfig()
	unknown.EnvironmentDigest = domain.Digest{}
	if CompareReuse(baseline, NewReuseFingerprint(unknown)) != ReuseUnknown {
		t.Fatal("missing reuse dimension was treated as reusable")
	}
}

func node(id NodeID) Node {
	return Node{ID: id, Path: "docs/" + string(id), ContentDigest: digest("content-" + string(id)), Mapped: true}
}

func changedNode(id NodeID) Node {
	result := node(id)
	result.ContentDigest = digest("changed-content-" + string(id))
	return result
}

func digest(value string) domain.Digest { return domain.HashString(value) }

func mustGraph(t *testing.T, revision string, nodes []Node, edges []Edge) Graph {
	t.Helper()
	graph, err := NewGraph(digest(revision), nodes, edges)
	if err != nil {
		t.Fatal(err)
	}
	return graph
}

func equalCausePaths(left, right []CausePath) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index].Changed != right[index].Changed || left[index].Affected != right[index].Affected ||
			!slices.Equal(left[index].Nodes, right[index].Nodes) {
			return false
		}
	}
	return true
}

func reuseConfig() ReuseFingerprintConfig {
	return ReuseFingerprintConfig{
		CandidateDigest: digest("candidate"), RunInputDigest: digest("input"),
		RequiredACRevisions: []domain.ACRevisionBinding{
			{ACID: "AC-02", RevisionDigest: digest("ac-2")},
			{ACID: "AC-01", RevisionDigest: digest("ac-1")},
		},
		GraphRevisionDigest: digest("graph"), PolicyRevisionDigest: digest("policy"),
		VerificationRecipeDigest: digest("recipe"), EnvironmentDigest: digest("environment"),
		IntegrationBaseApplicable: true, IntegrationBaseDigest: digest("base"),
		AdapterID: "fake", AdapterVersion: "fake/v1", VerifierClass: "independent",
	}
}
