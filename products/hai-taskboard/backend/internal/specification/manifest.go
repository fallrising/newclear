package specification

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"io"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/reconcile"
)

type acDTO struct {
	ID     string `json:"ac_id"`
	Digest string `json:"ac_revision_digest"`
}
type edgeDTO struct {
	From string `json:"from"`
	To   string `json:"to"`
	Kind string `json:"kind"`
}
type nodeDTO struct {
	ID        string   `json:"id"`
	Path      string   `json:"path"`
	Required  bool     `json:"required"`
	WorkItems []string `json:"work_item_ids"`
	ACs       []acDTO  `json:"required_ac_revisions"`
	Recipe    string   `json:"recipe_digest"`
}
type manifestDTO struct {
	Version int       `json:"schema_version"`
	Nodes   []nodeDTO `json:"nodes"`
	Edges   []edgeDTO `json:"edges"`
}

// shape specifies all members, their presence and exact JSON types independently
// of zero-value DTO decoding. jsontext supplies duplicate, UTF-8 and escape checks.
type shape struct {
	kind    byte
	members map[string]*shape
	element *shape
	integer bool
	one     bool
	maximum int
}

var stringShape = &shape{kind: '"'}
var boolShape = &shape{kind: 'b'}
var versionShape = &shape{kind: '0', integer: true, one: true}
var unsignedShape = &shape{kind: '0', integer: true}
var acShape = &shape{kind: '{', members: map[string]*shape{"ac_id": stringShape, "ac_revision_digest": stringShape}}
var edgeShape = &shape{kind: '{', members: map[string]*shape{"from": stringShape, "to": stringShape, "kind": stringShape}}
var nodeMembers = map[string]*shape{"id": stringShape, "path": stringShape, "required": boolShape, "work_item_ids": {kind: '[', element: stringShape, maximum: bindingListLimit}, "required_ac_revisions": {kind: '[', element: acShape, maximum: bindingListLimit}, "recipe_digest": stringShape}
var nodeShape = &shape{kind: '{', members: nodeMembers}
var manifestShape = &shape{kind: '{', members: map[string]*shape{"schema_version": versionShape, "nodes": {kind: '[', element: nodeShape, maximum: nodeLimit}, "edges": {kind: '[', element: edgeShape, maximum: edgeLimit}}}

func checkShape(ctx context.Context, d *jsontext.Decoder, s *shape) error {
	if err := ctx.Err(); err != nil {
		return fail(Unavailable, "context", err)
	}
	token, err := d.ReadToken()
	if err != nil {
		return fail(Invalid, "json", nil)
	}
	kind := byte(token.Kind())
	if s.kind == 'b' {
		if kind != 't' && kind != 'f' {
			return fail(Invalid, "type", nil)
		}
		return nil
	}
	if kind != s.kind {
		return fail(Invalid, "type", nil)
	}
	switch kind {
	case '{':
		seen := make(map[string]bool, len(s.members))
		for d.PeekKind() != '}' {
			k, e := d.ReadToken()
			if e != nil || k.Kind() != '"' {
				return fail(Invalid, "member", nil)
			}
			name := k.String()
			child, ok := s.members[name]
			if !ok || seen[name] {
				return fail(Invalid, "member", nil)
			}
			seen[name] = true
			if e := checkShape(ctx, d, child); e != nil {
				return e
			}
		}
		if _, e := d.ReadToken(); e != nil {
			return fail(Invalid, "json", nil)
		}
		if len(seen) != len(s.members) {
			return fail(Invalid, "presence", nil)
		}
	case '[':
		count := 0
		for d.PeekKind() != ']' {
			if s.maximum > 0 && count >= s.maximum {
				return fail(Capacity, "json_cardinality", nil)
			}
			count++
			if e := checkShape(ctx, d, s.element); e != nil {
				return e
			}
		}
		if _, e := d.ReadToken(); e != nil {
			return fail(Invalid, "json", nil)
		}
	case '0':
		raw := token.String()
		if s.one && raw != "1" {
			return fail(Invalid, "schema_version", nil)
		}
		if s.integer {
			value, e := strconv.ParseUint(raw, 10, 63)
			if e != nil || strconv.FormatUint(value, 10) != raw {
				return fail(Invalid, "integer", nil)
			}
		}
	}
	return nil
}
func decodeStrict(ctx context.Context, data []byte, s *shape, target any) error {
	if !utf8.Valid(data) {
		return fail(Invalid, "utf8", nil)
	}
	decoder := jsontext.NewDecoder(bytes.NewReader(data))
	if err := checkShape(ctx, decoder, s); err != nil {
		return err
	}
	if _, err := decoder.ReadToken(); err != io.EOF {
		return fail(Invalid, "trailing_json", nil)
	}
	if err := json.Unmarshal(data, target, json.RejectUnknownMembers(true)); err != nil {
		return fail(Invalid, "json", nil)
	}
	return nil
}
func validID(s string) bool {
	if len(s) < 1 || len(s) > 120 || !utf8.ValidString(s) {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) || unicode.IsSpace(r) || r == '/' || r == '\\' {
			return false
		}
	}
	return true
}
func validPath(s string) bool {
	if len(s) < 1 || len(s) > 512 || !utf8.ValidString(s) {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) || unicode.IsSpace(r) || r == '\\' || r == ':' {
			return false
		}
	}
	count := 0
	for part := range strings.SplitSeq(s, "/") {
		count++
		if len(part) == 0 || len(part) > 255 || part == "." || part == ".." {
			return false
		}
	}
	return count <= 32
}
func ParseManifest(data []byte) (Manifest, error) { return parseManifest(context.Background(), data) }
func parseManifest(ctx context.Context, data []byte) (Manifest, error) {
	if len(data) > manifestLimit {
		return Manifest{}, fail(Capacity, "manifest_bytes", nil)
	}
	var dto manifestDTO
	if err := decodeStrict(ctx, data, manifestShape, &dto); err != nil {
		return Manifest{}, err
	}
	return manifestFromDTO(ctx, dto)
}
func manifestFromDTO(ctx context.Context, dto manifestDTO) (Manifest, error) {
	if dto.Version != 1 {
		return Manifest{}, fail(Invalid, "schema_version", nil)
	}
	if len(dto.Nodes) < 1 || len(dto.Nodes) > nodeLimit || len(dto.Edges) > edgeLimit {
		return Manifest{}, fail(Capacity, "manifest_cardinality", nil)
	}
	if err := preflightDTO(dto); err != nil {
		return Manifest{}, err
	}
	nodes := make([]ImportedNode, len(dto.Nodes))
	edges := make([]reconcile.Edge, len(dto.Edges))
	for i, n := range dto.Nodes {
		if err := ctx.Err(); err != nil {
			return Manifest{}, fail(Unavailable, "context", err)
		}
		recipe, err := strictDigest(n.Recipe)
		if err != nil {
			return Manifest{}, err
		}
		acs := make([]domain.ACRevisionBinding, len(n.ACs))
		for j, a := range n.ACs {
			d, e := strictDigest(a.Digest)
			if e != nil {
				return Manifest{}, e
			}
			acs[j] = domain.ACRevisionBinding{ACID: domain.ACID(a.ID), RevisionDigest: d}
		}
		wis := make([]domain.WorkItemID, len(n.WorkItems))
		for j, w := range n.WorkItems {
			wis[j] = domain.WorkItemID(w)
		}
		nodes[i] = ImportedNode{ID: reconcile.NodeID(n.ID), Path: n.Path, Required: n.Required, Binding: NodeBinding{WorkItemIDs: wis, RequiredACRevisions: acs, RecipeDigest: recipe}}
	}
	for i, e := range dto.Edges {
		edges[i] = reconcile.Edge{From: reconcile.NodeID(e.From), To: reconcile.NodeID(e.To), Kind: reconcile.EdgeKind(e.Kind)}
	}
	return validateManifest(ctx, nodes, edges)
}
func validateManifest(ctx context.Context, nodes []ImportedNode, edges []reconcile.Edge) (Manifest, error) {
	if len(nodes) < 1 || len(nodes) > nodeLimit || len(edges) > edgeLimit {
		return Manifest{}, fail(Capacity, "manifest_cardinality", nil)
	}
	if err := preflightNodes(nodes); err != nil {
		return Manifest{}, err
	}
	nodes = cloneNodes(nodes)
	edges = slices.Clone(edges)
	paths := map[string]bool{}
	acs := map[domain.ACID]domain.Digest{}
	workCount, acCount := 0, 0
	placeholder := domain.HashString("proposal-manifest-structural/v1")
	graphNodes := make([]reconcile.Node, len(nodes))
	for i := range nodes {
		if err := ctx.Err(); err != nil {
			return Manifest{}, fail(Unavailable, "context", err)
		}
		n := &nodes[i]
		b := &n.Binding
		if !validID(string(n.ID)) || !validPath(n.Path) || paths[n.Path] || b.RecipeDigest.IsZero() {
			return Manifest{}, fail(Invalid, "node", nil)
		}
		paths[n.Path] = true
		if len(b.WorkItemIDs) > bindingListLimit || len(b.RequiredACRevisions) > bindingListLimit {
			return Manifest{}, fail(Capacity, "binding_list", nil)
		}
		if len(b.WorkItemIDs) > bindingTotalLimit-workCount || len(b.RequiredACRevisions) > bindingTotalLimit-acCount {
			return Manifest{}, fail(Capacity, "binding_total", nil)
		}
		workCount += len(b.WorkItemIDs)
		acCount += len(b.RequiredACRevisions)
		slices.Sort(b.WorkItemIDs)
		slices.SortFunc(b.RequiredACRevisions, func(a, b domain.ACRevisionBinding) int { return cmp.Compare(a.ACID, b.ACID) })
		for j, w := range b.WorkItemIDs {
			if !validID(string(w)) || j > 0 && b.WorkItemIDs[j-1] == w {
				return Manifest{}, fail(Invalid, "work_item_ids", nil)
			}
		}
		for j, a := range b.RequiredACRevisions {
			if !validID(string(a.ACID)) || a.RevisionDigest.IsZero() || j > 0 && b.RequiredACRevisions[j-1].ACID == a.ACID {
				return Manifest{}, fail(Invalid, "ac_bindings", nil)
			}
			if old, ok := acs[a.ACID]; ok && old != a.RevisionDigest {
				return Manifest{}, fail(Invalid, "shared_ac", nil)
			}
			acs[a.ACID] = a.RevisionDigest
		}
		if n.Required && len(b.RequiredACRevisions) == 0 {
			return Manifest{}, fail(Invalid, "required_ac_revisions", nil)
		}
		graphNodes[i] = reconcile.Node{ID: n.ID, Path: n.Path, ContentDigest: placeholder, BindingDigest: placeholder, RequiredACDigest: placeholder, RecipeDigest: b.RecipeDigest, Required: n.Required, Mapped: len(b.WorkItemIDs) > 0}
	}
	if _, err := reconcile.NewGraph(placeholder, graphNodes, edges); err != nil {
		return Manifest{}, fail(Invalid, "graph", err)
	}
	slices.SortFunc(nodes, func(a, b ImportedNode) int { return cmp.Compare(a.ID, b.ID) })
	slices.SortFunc(edges, compareEdges)
	m := Manifest{nodes: nodes, edges: edges}
	data, err := encodeContext(ctx, manifestWire(m), canonicalLimit)
	if err != nil {
		return Manifest{}, err
	}
	m.canonical = data
	return m, nil
}
func compareEdges(a, b reconcile.Edge) int {
	return cmp.Or(cmp.Compare(a.From, b.From), cmp.Compare(a.To, b.To), cmp.Compare(a.Kind, b.Kind))
}
func edgeWire(edges []reconcile.Edge) []edgeDTO {
	out := make([]edgeDTO, len(edges))
	for i, e := range edges {
		out[i] = edgeDTO{string(e.From), string(e.To), string(e.Kind)}
	}
	return out
}
func bindingWire(b NodeBinding) ([]string, []acDTO) {
	w := make([]string, len(b.WorkItemIDs))
	a := make([]acDTO, len(b.RequiredACRevisions))
	for i, v := range b.WorkItemIDs {
		w[i] = string(v)
	}
	for i, v := range b.RequiredACRevisions {
		a[i] = acDTO{string(v.ACID), v.RevisionDigest.String()}
	}
	return w, a
}
func manifestWire(m Manifest) manifestDTO {
	dto := manifestDTO{Version: 1, Nodes: make([]nodeDTO, len(m.nodes)), Edges: edgeWire(m.edges)}
	for i, n := range m.nodes {
		w, a := bindingWire(n.Binding)
		dto.Nodes[i] = nodeDTO{string(n.ID), n.Path, n.Required, w, a, n.Binding.RecipeDigest.String()}
	}
	return dto
}
func encode(value any, maximum int) ([]byte, error) {
	return encodeContext(context.Background(), value, maximum)
}

type boundedJSON struct {
	ctx     context.Context
	data    []byte
	maximum int
	err     error
}

func (w *boundedJSON) Write(p []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		w.err = fail(Unavailable, "context", err)
		return 0, w.err
	}
	if len(p) > w.maximum-len(w.data) {
		w.err = fail(Capacity, "encoding_bytes", nil)
		return 0, w.err
	}
	w.data = append(w.data, p...)
	return len(p), nil
}
func encodeContext(ctx context.Context, value any, maximum int) ([]byte, error) {
	w := &boundedJSON{ctx: ctx, maximum: maximum}
	if err := json.MarshalWrite(w, value); err != nil {
		if w.err != nil {
			return nil, w.err
		}
		return nil, fail(Invalid, "encoding", nil)
	}
	return w.data, nil
}
func preflightDTO(dto manifestDTO) error {
	w, a := 0, 0
	for _, n := range dto.Nodes {
		if len(n.WorkItems) > bindingListLimit || len(n.ACs) > bindingListLimit {
			return fail(Capacity, "binding_list", nil)
		}
		if len(n.WorkItems) > bindingTotalLimit-w || len(n.ACs) > bindingTotalLimit-a {
			return fail(Capacity, "binding_total", nil)
		}
		w += len(n.WorkItems)
		a += len(n.ACs)
	}
	return nil
}
func preflightNodes(nodes []ImportedNode) error {
	w, a := 0, 0
	for _, n := range nodes {
		if len(n.Binding.WorkItemIDs) > bindingListLimit || len(n.Binding.RequiredACRevisions) > bindingListLimit {
			return fail(Capacity, "binding_list", nil)
		}
		if len(n.Binding.WorkItemIDs) > bindingTotalLimit-w || len(n.Binding.RequiredACRevisions) > bindingTotalLimit-a {
			return fail(Capacity, "binding_total", nil)
		}
		w += len(n.Binding.WorkItemIDs)
		a += len(n.Binding.RequiredACRevisions)
	}
	return nil
}
