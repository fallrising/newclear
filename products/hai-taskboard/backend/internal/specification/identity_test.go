package specification

import (
	"bytes"
	json "encoding/json/v2"
	"slices"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/reconcile"
)

func TestProposalCore_NormativeIdentity(t *testing.T) {
	for _, format := range []ObjectFormat{SHA1, SHA256} {
		t.Run(string(format)+"/independent_literal_goldens", func(t *testing.T) {
			r, q := literalFixture(t, format)
			p, e := Import(t.Context(), r, q)
			if e != nil {
				t.Fatal(e)
			}
			canonical, digest := literalProposalSHA1, literalProposalDigestSHA1
			if format == SHA256 {
				canonical, digest = literalProposalSHA256, literalProposalDigestSHA256
			}
			if string(p.CanonicalJSON()) != canonical || p.Digest().String() != digest || string(p.NormativeJSON()) != literalNormative || p.Graph().Revision().String() != literalNormativeDigest {
				t.Fatal("independent canonical/golden identity mismatch")
			}
		})
	}
	t.Run("canonical_scalar_escaping", func(t *testing.T) {
		raw, e := encode(`quote"<&>`, 100)
		if e != nil || string(raw) != `"quote\"<&>"` {
			t.Fatalf("scalar vector %s %v", raw, e)
		}
	})
	baseline := fixtureImport(t, SHA1, literalManifest, map[string][]byte{"a.md": []byte(literalSource)})
	for _, attack := range []string{"mapping", "ac", "recipe", "required", "content"} {
		t.Run("normative_dimension_"+attack, func(t *testing.T) {
			dto := manifestDecode(t, literalManifest)
			source := literalSource
			switch attack {
			case "mapping":
				dto.Nodes[0].WorkItems = append(dto.Nodes[0].WorkItems, "wi_B")
			case "ac":
				dto.Nodes[0].ACs[0].Digest = strings.Repeat("3", 64)
			case "recipe":
				dto.Nodes[0].Recipe = strings.Repeat("3", 64)
			case "required":
				dto.Nodes[0].Required = false
			case "content":
				source += "x"
			}
			changed := fixtureImport(t, SHA1, string(manifestBytes(t, dto)), map[string][]byte{"a.md": []byte(source)})
			diff := reconcile.DiffGraphs(baseline.Graph(), changed.Graph())
			if changed.Graph().Revision() == baseline.Graph().Revision() || changed.Digest() == baseline.Digest() || len(diff) != 1 || diff[0].ID != "SPEC-A" {
				t.Fatal("normative dimension missed")
			}
		})
	}
	t.Run("mapped_and_empty_set_nonzero_digests", func(t *testing.T) {
		dto := manifestDecode(t, literalManifest)
		dto.Nodes[0].Required = false
		dto.Nodes[0].ACs = []acDTO{}
		p := fixtureImport(t, SHA1, string(manifestBytes(t, dto)), map[string][]byte{"a.md": []byte(literalSource)})
		dto.Nodes[0].WorkItems = []string{}
		p2 := fixtureImport(t, SHA1, string(manifestBytes(t, dto)), map[string][]byte{"a.md": []byte(literalSource)})
		if p.Graph().Revision() == p2.Graph().Revision() || len(reconcile.DiffGraphs(p.Graph(), p2.Graph())) != 1 {
			t.Fatal("mapped dimension missed")
		}
		n := p2.Graph().Nodes()[0]
		if n.BindingDigest != domain.HashString(`{"schema_version":1,"work_item_ids":[]}`) || n.RequiredACDigest != domain.HashString(`{"schema_version":1,"required_ac_revisions":[]}`) {
			t.Fatal("explicit empty envelope wrong")
		}
	})
	for _, change := range []string{"rename", "formatting", "object_format", "commit_only", "repository_project", "repository_id", "repository_version", "repository_digest"} {
		t.Run("provenance_only_"+change, func(t *testing.T) {
			raw := literalManifest
			path := "a.md"
			format := SHA1
			if change == "rename" {
				path = "renamed.md"
				raw = strings.Replace(raw, "a.md", path, 1)
			}
			if change == "formatting" {
				raw = "\n " + raw + " \n"
			}
			if change == "object_format" {
				format = SHA256
			}
			r, q := dynamicFixture(t, format, raw, map[string][]byte{path: []byte(literalSource)})
			switch change {
			case "commit_only":
				old := r.snapshot.objects[r.snapshot.commit]
				old.Data = append(bytes.Clone(old.Data), []byte("new message\n")...)
				r.snapshot.commit = objectID(t, format, CommitObject, old.Data)
				r.snapshot.objects[r.snapshot.commit] = old
			case "repository_project":
				q.Binding.ProjectID = "another"
			case "repository_id":
				q.Binding.ID = "another"
			case "repository_version":
				q.Binding.Version = 2
			case "repository_digest":
				q.Binding.Digest = domain.HashString("different approval")
			}
			p, e := Import(t.Context(), r, q)
			if e != nil {
				t.Fatal(e)
			}
			if p.Digest() == baseline.Digest() || p.Graph().Revision() != baseline.Graph().Revision() || len(reconcile.DiffGraphs(baseline.Graph(), p.Graph())) != 0 {
				t.Fatal("provenance changed normative identity")
			}
		})
	}
	t.Run("ordering_full_binding_lists_and_edges", func(t *testing.T) {
		dto := manifestDecode(t, literalManifest)
		dto.Nodes[0].WorkItems = []string{"wi_Z", "wi_A"}
		dto.Nodes[0].ACs = append(dto.Nodes[0].ACs, acDTO{"AC-Z", strings.Repeat("4", 64)})
		n := dto.Nodes[0]
		n.WorkItems = slices.Clone(n.WorkItems)
		n.ACs = slices.Clone(n.ACs)
		n.ID = "B"
		n.Path = "b.md"
		dto.Nodes = append(dto.Nodes, n)
		dto.Edges = []edgeDTO{{"SPEC-A", "B", "produces"}, {"SPEC-A", "B", "depends_on"}}
		p := fixtureImport(t, SHA1, string(manifestBytes(t, dto)), map[string][]byte{"a.md": []byte(literalSource), "b.md": []byte("B")})
		dto.Nodes[0], dto.Nodes[1] = dto.Nodes[1], dto.Nodes[0]
		dto.Edges[0], dto.Edges[1] = dto.Edges[1], dto.Edges[0]
		for i := range dto.Nodes {
			dto.Nodes[i].WorkItems[0], dto.Nodes[i].WorkItems[1] = dto.Nodes[i].WorkItems[1], dto.Nodes[i].WorkItems[0]
			dto.Nodes[i].ACs[0], dto.Nodes[i].ACs[1] = dto.Nodes[i].ACs[1], dto.Nodes[i].ACs[0]
		}
		p2 := fixtureImport(t, SHA1, string(manifestBytes(t, dto)), map[string][]byte{"a.md": []byte(literalSource), "b.md": []byte("B")})
		if p.Graph().Revision() != p2.Graph().Revision() || string(p.NormativeJSON()) != string(p2.NormativeJSON()) {
			t.Fatal("ordering altered normative identity")
		}
	})
	t.Run("typed_edge_dimensions_actual_diff", func(t *testing.T) {
		dto := manifestDecode(t, literalManifest)
		n := dto.Nodes[0]
		n.WorkItems = slices.Clone(n.WorkItems)
		n.ACs = slices.Clone(n.ACs)
		n.ID = "B"
		n.Path = "b.md"
		dto.Nodes = append(dto.Nodes, n)
		sources := map[string][]byte{"a.md": []byte(literalSource), "b.md": []byte("B")}
		p := fixtureImport(t, SHA1, string(manifestBytes(t, dto)), sources)
		seen := map[domain.Digest]bool{p.Graph().Revision(): true}
		for _, kind := range []string{"specifies", "depends_on", "verifies", "produces"} {
			dto.Edges = []edgeDTO{{"SPEC-A", "B", kind}}
			p2 := fixtureImport(t, SHA1, string(manifestBytes(t, dto)), sources)
			if seen[p2.Graph().Revision()] || len(reconcile.DiffGraphs(p.Graph(), p2.Graph())) != 2 {
				t.Fatal("typed topology missed")
			}
			seen[p2.Graph().Revision()] = true
		}
	})
}
func TestProposalCore_CanonicalReadAndCopies(t *testing.T) {
	canonicalAdditional(t)
	r, q := literalFixture(t, SHA1)
	p, e := Import(t.Context(), r, q)
	if e != nil {
		t.Fatal(e)
	}
	t.Run("roundtrip_and_expected_digest", func(t *testing.T) {
		decoded, e := DecodeCanonicalProposal(p.CanonicalJSON(), p.Digest())
		if e != nil || decoded.Digest() != p.Digest() || decoded.Commit() != p.Commit() || decoded.Binding() != p.Binding() || !bytes.Equal(decoded.NormativeJSON(), p.NormativeJSON()) {
			t.Fatalf("roundtrip %v", e)
		}
		for _, d := range []domain.Digest{{}, domain.HashString("wrong")} {
			_, e := DecodeCanonicalProposal(p.CanonicalJSON(), d)
			assertCode(t, e, Integrity)
		}
	})
	attacks := map[string]func(*proposalDTO){"graph_mismatch": func(d *proposalDTO) { d.GraphDigest = strings.Repeat("3", 64) }, "node_id": func(d *proposalDTO) { d.Nodes[0].ID = "B" }, "node_path": func(d *proposalDTO) { d.Nodes[0].Path = "b.md" }, "node_required": func(d *proposalDTO) { d.Nodes[0].Required = false }, "node_mapping": func(d *proposalDTO) { d.Nodes[0].WorkItems = []string{"wi_B"} }, "node_ac": func(d *proposalDTO) { d.Nodes[0].ACs = []acDTO{{"AC-A", strings.Repeat("3", 64)}} }, "node_recipe": func(d *proposalDTO) { d.Nodes[0].Recipe = strings.Repeat("3", 64) }, "manifest_path": func(d *proposalDTO) { d.Manifest.Nodes[0].Path = "b.md" }, "manifest_required": func(d *proposalDTO) { d.Manifest.Nodes[0].Required = false }, "manifest_edges": func(d *proposalDTO) { d.Manifest.Edges = []edgeDTO{{"SPEC-A", "B", "produces"}} }, "edges": func(d *proposalDTO) { d.Edges = []edgeDTO{{"SPEC-A", "B", "produces"}} }, "upper_oid": func(d *proposalDTO) { d.Commit = strings.ToUpper(d.Commit) }, "zero_oid": func(d *proposalDTO) { d.ManifestOID = strings.Repeat("0", 40) }, "upper_digest": func(d *proposalDTO) { d.Binding.Digest = strings.ToUpper(d.Binding.Digest) }, "zero_digest": func(d *proposalDTO) { d.Nodes[0].Content = strings.Repeat("0", 64) }, "wrong_format": func(d *proposalDTO) { d.Format = "sha256" }, "binding_version_zero": func(d *proposalDTO) { d.Binding.Version = 0 }, "node_cardinality": func(d *proposalDTO) { d.Nodes = []capturedNodeDTO{} }}
	for name, mutate := range attacks {
		t.Run("rehashed_attack_"+name, func(t *testing.T) {
			var dto proposalDTO
			if e := json.Unmarshal(p.CanonicalJSON(), &dto); e != nil {
				t.Fatal(e)
			}
			mutate(&dto)
			raw, e := json.Marshal(dto)
			if e != nil {
				t.Fatal(e)
			}
			if _, e := DecodeCanonicalProposal(raw, domain.HashBytes(raw)); e == nil {
				t.Fatal("rehashed inconsistent canonical accepted")
			}
		})
	}
	t.Run("missing_nested_duplicate_unknown_case_null_type_version", func(t *testing.T) {
		raw := p.CanonicalJSON()
		tokens := []string{`"repository_binding":`, `"project_id":"project",`, `"id":"binding",`, `"version":1,`, `"manifest":`, `"blob_oid":"` + p.Nodes()[0].BlobOID.String() + `",`, `"content_digest":"` + p.Nodes()[0].ContentDigest.String() + `",`, `"recipe_digest":"` + strings.Repeat("2", 64) + `"`}
		for _, token := range tokens {
			if strings.HasSuffix(token, ":") {
				continue
			}
			bad := bytes.Replace(raw, []byte(token), nil, 1)
			if _, e := DecodeCanonicalProposal(bad, domain.HashBytes(bad)); e == nil {
				t.Fatalf("missing token accepted %s", token)
			}
		}
		badInputs := [][]byte{append([]byte{' '}, raw...), bytes.Replace(raw, []byte(`"version":1`), []byte(`"version":1e0`), 1), bytes.Replace(raw, []byte(`"version":1`), []byte(`"version":-1`), 1), bytes.Replace(raw, []byte(`"version":1`), []byte(`"version":9223372036854775808`), 1), bytes.Replace(raw, []byte(`"project_id":"project"`), []byte(`"Project_ID":"project"`), 1), bytes.Replace(raw, []byte(`"project_id":"project"`), []byte(`"project_id":null`), 1), bytes.Replace(raw, []byte(`"project_id":"project"`), []byte(`"project_id":1`), 1), bytes.Replace(raw, []byte(`"project_id":"project"`), []byte(`"project_id":"project","extra":true`), 1), bytes.Replace(raw, []byte(`"project_id":"project"`), []byte(`"project_id":"project","project_id":"project"`), 1)}
		for _, bad := range badInputs {
			if _, e := DecodeCanonicalProposal(bad, domain.HashBytes(bad)); e == nil {
				t.Fatal("noncanonical/strict attack accepted")
			}
		}
	})
	t.Run("canonical_and_normative_encoder_exact_plus_one", func(t *testing.T) {
		for _, maximum := range []int{canonicalLimit, normativeLimit} {
			value := strings.Repeat("x", maximum-2)
			raw, e := encode(value, maximum)
			if e != nil || len(raw) != maximum {
				t.Fatal(e)
			}
			_, e = encode(value+"x", maximum)
			assertCode(t, e, Capacity)
		}
		raw := bytes.Repeat([]byte{'x'}, canonicalLimit+1)
		_, e := DecodeCanonicalProposal(raw, domain.HashBytes(raw))
		assertCode(t, e, Capacity)
	})
	t.Run("copy_safe_bytes_nodes_nested_graph", func(t *testing.T) {
		before := p.CanonicalJSON()
		b := p.CanonicalJSON()
		b[0] = 'x'
		n := p.NormativeJSON()
		n[0] = 'x'
		nodes := p.Nodes()
		nodes[0].Path = "other"
		nodes[0].Binding.WorkItemIDs[0] = "changed"
		nodes[0].Binding.RequiredACRevisions[0].ACID = "changed"
		gn := p.Graph().Nodes()
		gn[0].Path = "changed"
		gn[0].ContentDigest = domain.Digest{}
		if !bytes.Equal(before, p.CanonicalJSON()) || p.Nodes()[0].Path != "a.md" || p.Graph().Nodes()[0].ContentDigest != domain.HashString(literalSource) {
			t.Fatal("accessor mutated capture")
		}
		input := p.CanonicalJSON()
		decoded, e := DecodeCanonicalProposal(input, p.Digest())
		if e != nil {
			t.Fatal(e)
		}
		input[0] = 'x'
		if !bytes.Equal(decoded.CanonicalJSON(), before) {
			t.Fatal("decoder retained input alias")
		}
		m, e := ParseManifest([]byte(literalManifest))
		if e != nil {
			t.Fatal(e)
		}
		mc := m.CanonicalJSON()
		mc[0] = 'x'
		if string(m.CanonicalJSON()) != literalManifest {
			t.Fatal("manifest accessor alias")
		}
	})
	t.Run("decoder_does_not_claim_raw_object_verification", func(t *testing.T) {
		var dto proposalDTO
		if e := json.Unmarshal(p.CanonicalJSON(), &dto); e != nil {
			t.Fatal(e)
		}
		dto.Commit = strings.Repeat("a", 40)
		dto.ManifestOID = strings.Repeat("b", 40)
		dto.ManifestDigest = strings.Repeat("c", 64)
		dto.Nodes[0].OID = strings.Repeat("d", 40)
		raw, e := json.Marshal(dto)
		if e != nil {
			t.Fatal(e)
		}
		decoded, e := DecodeCanonicalProposal(raw, domain.HashBytes(raw))
		if e != nil {
			t.Fatal(e)
		}
		if decoded.Commit().String() != dto.Commit || decoded.ManifestDigest().String() != dto.ManifestDigest {
			t.Fatal("decoder silently reimported/rewrote opaque provenance")
		}
	})
}
