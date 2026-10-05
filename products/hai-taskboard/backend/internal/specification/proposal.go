package specification

import (
	"bytes"
	"context"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/reconcile"
)

type bindingDTO struct {
	Project string `json:"project_id"`
	ID      string `json:"id"`
	Version uint64 `json:"version"`
	Digest  string `json:"digest"`
}
type capturedNodeDTO struct {
	ID        string   `json:"id"`
	Path      string   `json:"path"`
	OID       string   `json:"blob_oid"`
	Content   string   `json:"content_digest"`
	Required  bool     `json:"required"`
	WorkItems []string `json:"work_item_ids"`
	ACs       []acDTO  `json:"required_ac_revisions"`
	Recipe    string   `json:"recipe_digest"`
}
type proposalDTO struct {
	Version        int               `json:"schema_version"`
	Binding        bindingDTO        `json:"repository_binding"`
	Format         string            `json:"object_format"`
	Commit         string            `json:"commit_oid"`
	ManifestPath   string            `json:"manifest_path"`
	ManifestOID    string            `json:"manifest_blob_oid"`
	ManifestDigest string            `json:"manifest_digest"`
	Manifest       manifestDTO       `json:"manifest"`
	Nodes          []capturedNodeDTO `json:"nodes"`
	Edges          []edgeDTO         `json:"edges"`
	GraphDigest    string            `json:"graph_revision_digest"`
}
type normativeNodeDTO struct {
	ID       string `json:"id"`
	Content  string `json:"content_digest"`
	Binding  string `json:"binding_digest"`
	AC       string `json:"required_ac_digest"`
	Recipe   string `json:"recipe_digest"`
	Required bool   `json:"required"`
	Mapped   bool   `json:"mapped"`
}
type normativeDTO struct {
	Version int                `json:"schema_version"`
	Nodes   []normativeNodeDTO `json:"nodes"`
	Edges   []edgeDTO          `json:"edges"`
}
type nodeBindingDTO struct {
	Version   int      `json:"schema_version"`
	WorkItems []string `json:"work_item_ids"`
}
type requiredACDTO struct {
	Version int     `json:"schema_version"`
	ACs     []acDTO `json:"required_ac_revisions"`
}

var proposalShape = func() *shape {
	captured := make(map[string]*shape, len(nodeMembers)+2)
	for k, v := range nodeMembers {
		captured[k] = v
	}
	captured["blob_oid"] = stringShape
	captured["content_digest"] = stringShape
	return &shape{kind: '{', members: map[string]*shape{"schema_version": versionShape, "repository_binding": {kind: '{', members: map[string]*shape{"project_id": stringShape, "id": stringShape, "version": unsignedShape, "digest": stringShape}}, "object_format": stringShape, "commit_oid": stringShape, "manifest_path": stringShape, "manifest_blob_oid": stringShape, "manifest_digest": stringShape, "manifest": manifestShape, "nodes": {kind: '[', element: &shape{kind: '{', members: captured}, maximum: nodeLimit}, "edges": {kind: '[', element: edgeShape, maximum: edgeLimit}, "graph_revision_digest": stringShape}}
}()

func buildProposal(request Request, commit, manifestOID ObjectID, rawManifest []byte, manifest Manifest, nodes []ImportedNode) (Proposal, error) {
	return assembleProposal(request, commit, manifestOID, domain.HashBytes(rawManifest), manifest, nodes)
}
func assembleProposalContext(ctx context.Context, request Request, commit, manifestOID ObjectID, manifestDigest domain.Digest, manifest Manifest, nodes []ImportedNode) (Proposal, error) {
	if err := validateRequest(request); err != nil {
		return Proposal{}, err
	}
	if len(manifest.canonical) == 0 || len(nodes) != len(manifest.nodes) || manifestDigest.IsZero() || !commit.valid() || !manifestOID.valid() || commit.Format() != request.Binding.ObjectFormat || manifestOID.Format() != commit.Format() {
		return Proposal{}, fail(Invalid, "proposal", nil)
	}
	nodes = cloneNodes(nodes)
	graphNodes := make([]reconcile.Node, len(nodes))
	norm := normativeDTO{Version: 1, Nodes: make([]normativeNodeDTO, len(nodes)), Edges: edgeWire(manifest.edges)}
	captured := make([]capturedNodeDTO, len(nodes))
	for i, n := range nodes {
		if e := ctx.Err(); e != nil {
			return Proposal{}, fail(Unavailable, "context", e)
		}
		m := manifest.nodes[i]
		if n.ID != m.ID || n.Path != m.Path || n.Required != m.Required || n.Path == request.ManifestPath || !n.BlobOID.valid() || n.BlobOID.Format() != commit.Format() || n.ContentDigest.IsZero() {
			return Proposal{}, fail(Integrity, "proposal_node", nil)
		}
		w, a := bindingWire(n.Binding)
		mw, ma := bindingWire(m.Binding)
		left, _ := encodeContext(ctx, nodeDTO{string(n.ID), n.Path, n.Required, w, a, n.Binding.RecipeDigest.String()}, canonicalLimit)
		right, _ := encodeContext(ctx, nodeDTO{string(m.ID), m.Path, m.Required, mw, ma, m.Binding.RecipeDigest.String()}, canonicalLimit)
		if !bytes.Equal(left, right) {
			return Proposal{}, fail(Integrity, "manifest_node", nil)
		}
		bdata, e := encodeContext(ctx, nodeBindingDTO{1, w}, normativeLimit)
		if e != nil {
			return Proposal{}, e
		}
		adata, e := encodeContext(ctx, requiredACDTO{1, a}, normativeLimit)
		if e != nil {
			return Proposal{}, e
		}
		bd, ad := domain.HashBytes(bdata), domain.HashBytes(adata)
		mapped := len(w) > 0
		graphNodes[i] = reconcile.Node{ID: n.ID, Path: n.Path, ContentDigest: n.ContentDigest, BindingDigest: bd, RequiredACDigest: ad, RecipeDigest: n.Binding.RecipeDigest, Required: n.Required, Mapped: mapped}
		norm.Nodes[i] = normativeNodeDTO{string(n.ID), n.ContentDigest.String(), bd.String(), ad.String(), n.Binding.RecipeDigest.String(), n.Required, mapped}
		captured[i] = capturedNodeDTO{string(n.ID), n.Path, n.BlobOID.String(), n.ContentDigest.String(), n.Required, w, a, n.Binding.RecipeDigest.String()}
	}
	normative, e := encodeContext(ctx, norm, normativeLimit)
	if e != nil {
		return Proposal{}, e
	}
	revision := domain.HashBytes(normative)
	graph, e := reconcile.NewGraph(revision, graphNodes, manifest.edges)
	if e != nil {
		return Proposal{}, fail(Invalid, "graph", e)
	}
	b := request.Binding
	dto := proposalDTO{1, bindingDTO{string(b.ProjectID), b.ID, b.Version, b.Digest.String()}, string(b.ObjectFormat), commit.String(), request.ManifestPath, manifestOID.String(), manifestDigest.String(), manifestWire(manifest), captured, edgeWire(manifest.edges), revision.String()}
	canonical, e := encodeContext(ctx, dto, canonicalLimit)
	if e != nil {
		return Proposal{}, e
	}
	return Proposal{binding: b, commit: commit, manifestPath: request.ManifestPath, manifestOID: manifestOID, manifestDigest: manifestDigest, nodes: nodes, graph: graph, canonical: canonical, normative: normative, digest: domain.HashBytes(canonical)}, nil
}

// DecodeCanonicalProposal verifies internal consistency. Without raw objects it
// cannot independently authenticate the captured Git provenance or blob digests.
func DecodeCanonicalProposal(data []byte, expected domain.Digest) (Proposal, error) {
	if len(data) > canonicalLimit {
		return Proposal{}, fail(Capacity, "canonical_bytes", nil)
	}
	if expected.IsZero() || domain.HashBytes(data) != expected {
		return Proposal{}, fail(Integrity, "proposal_digest", nil)
	}
	var dto proposalDTO
	if e := decodeStrict(context.Background(), data, proposalShape, &dto); e != nil {
		return Proposal{}, e
	}
	format := ObjectFormat(dto.Format)
	bindingDigest, e := strictDigest(dto.Binding.Digest)
	if e != nil {
		return Proposal{}, e
	}
	commit, e := ParseObjectID(format, dto.Commit)
	if e != nil {
		return Proposal{}, e
	}
	moid, e := ParseObjectID(format, dto.ManifestOID)
	if e != nil {
		return Proposal{}, e
	}
	md, e := strictDigest(dto.ManifestDigest)
	if e != nil {
		return Proposal{}, e
	}
	gd, e := strictDigest(dto.GraphDigest)
	if e != nil {
		return Proposal{}, e
	}
	request := Request{Binding: RepositoryBinding{ProjectID: domain.ProjectID(dto.Binding.Project), ID: dto.Binding.ID, Version: dto.Binding.Version, Digest: bindingDigest, ObjectFormat: format}, Ref: "refs/heads/canonical", ManifestPath: dto.ManifestPath}
	manifest, e := manifestFromDTO(context.Background(), dto.Manifest)
	if e != nil {
		return Proposal{}, e
	}
	if len(dto.Nodes) != len(manifest.nodes) {
		return Proposal{}, fail(Integrity, "node_cardinality", nil)
	}
	nodes := cloneNodes(manifest.nodes)
	for i, n := range dto.Nodes {
		oid, e := ParseObjectID(format, n.OID)
		if e != nil {
			return Proposal{}, e
		}
		digest, e := strictDigest(n.Content)
		if e != nil {
			return Proposal{}, e
		}
		nodes[i].BlobOID = oid
		nodes[i].ContentDigest = digest
	}
	proposal, e := assembleProposal(request, commit, moid, md, manifest, nodes)
	if e != nil {
		return Proposal{}, e
	}
	if proposal.graph.Revision() != gd || !bytes.Equal(proposal.canonical, data) {
		return Proposal{}, fail(Integrity, "canonical_consistency", nil)
	}
	return proposal, nil
}

func assembleProposal(request Request, commit, moid ObjectID, md domain.Digest, m Manifest, nodes []ImportedNode) (Proposal, error) {
	return assembleProposalContext(context.Background(), request, commit, moid, md, m, nodes)
}
