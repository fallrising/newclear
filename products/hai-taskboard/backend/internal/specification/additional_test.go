package specification

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/reconcile"
)

func rewriteRoot(t *testing.T, r *fakeReader, change func([]byte) []byte) {
	t.Helper()
	commit := r.snapshot.objects[r.snapshot.commit]
	treeValue := strings.TrimPrefix(strings.Split(string(commit.Data), "\n")[0], "tree ")
	root := fixtureID(t, r.snapshot.commit.Format(), treeValue)
	raw := change(bytes.Clone(r.snapshot.objects[root].Data))
	newRoot := objectID(t, root.Format(), TreeObject, raw)
	r.snapshot.objects[newRoot] = Object{TreeObject, raw}
	newCommit := bytes.Replace(commit.Data, []byte(root.String()), []byte(newRoot.String()), 1)
	r.snapshot.commit = objectID(t, root.Format(), CommitObject, newCommit)
	r.snapshot.objects[r.snapshot.commit] = Object{CommitObject, newCommit}
}
func immutableAdditional(t *testing.T) {
	t.Run("typed_nil_and_untrusted_errors_do_not_panic_or_leak", func(t *testing.T) {
		r, q := literalFixture(t, SHA1)
		var nilError *Error
		for _, cause := range []error{nilError, errors.Join(errors.New("sensitive /path"), nilError), &Error{Code: "unrecognized", Field: "sensitive /path", cause: errors.New("secret stderr")}} {
			_, e := Import(t.Context(), readerFunc(func(context.Context, string) (Snapshot, error) { return nil, cause }), q)
			assertCode(t, e, Unavailable)
			if strings.Contains(e.Error(), "sensitive") {
				t.Fatal("untrusted reader error leaked")
			}
		}
		s := &snapshotWrapper{base: r.snapshot, closeErr: nilError}
		p, e := Import(t.Context(), readerFunc(func(context.Context, string) (Snapshot, error) { return s, nil }), q)
		assertCode(t, e, Unavailable)
		if !p.Digest().IsZero() {
			t.Fatal("typed nil close error left result")
		}
	})
	t.Run("cancellation_during_close_discards_success", func(t *testing.T) {
		r, q := literalFixture(t, SHA1)
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		s := &snapshotWrapper{base: r.snapshot, onClose: cancel}
		p, e := Import(ctx, readerFunc(func(context.Context, string) (Snapshot, error) { return s, nil }), q)
		if !errors.Is(e, context.Canceled) || !p.Digest().IsZero() || s.base.closes != 1 {
			t.Fatalf("close context/lifetime %v", e)
		}
	})
	t.Run("cancellation_and_close_error_preserves_both", func(t *testing.T) {
		r, q := literalFixture(t, SHA1)
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		s := &snapshotWrapper{base: r.snapshot, onClose: cancel, closeErr: errors.New("sensitive cleanup path")}
		p, e := Import(ctx, readerFunc(func(context.Context, string) (Snapshot, error) { return s, nil }), q)
		if !errors.Is(e, context.Canceled) || !p.Digest().IsZero() || s.base.closes != 1 {
			t.Fatalf("combined close cancellation %v", e)
		}
		assertCode(t, e, Unavailable)
		if strings.Contains(e.Error(), "sensitive") {
			t.Fatal("close error leaked")
		}
	})
	t.Run("whole_import_private_deadline_to_reader", func(t *testing.T) {
		r, q := literalFixture(t, SHA1)
		_, e := Import(t.Context(), readerFunc(func(ctx context.Context, ref string) (Snapshot, error) {
			deadline, ok := ctx.Deadline()
			if !ok || time.Until(deadline) > 30*time.Second || time.Until(deadline) < 28*time.Second {
				t.Fatal("whole Import deadline absent")
			}
			return nil, context.Canceled
		}), q)
		if !errors.Is(e, context.Canceled) || r.opens != 0 {
			t.Fatal(e)
		}
	})
	t.Run("manifest_source_overlap_and_absent_manifest", func(t *testing.T) {
		r, q := dynamicFixture(t, SHA1, strings.Replace(literalManifest, "a.md", "manifest.json", 1), map[string][]byte{})
		_, e := Import(t.Context(), r, q)
		assertCode(t, e, Invalid)
		r, q = literalFixture(t, SHA1)
		q.ManifestPath = "missing.json"
		_, e = Import(t.Context(), r, q)
		assertCode(t, e, Unavailable)
	})
	t.Run("malformed_source_tree_and_type_mismatch", func(t *testing.T) {
		for _, attack := range []string{"truncated", "duplicate_name", "zero_oid", "invalid_name", "type_mismatch"} {
			r, q := literalFixture(t, SHA1)
			rewriteRoot(t, r, func(raw []byte) []byte {
				switch attack {
				case "truncated":
					return raw[:len(raw)-1]
				case "duplicate_name":
					return append(raw, raw...)
				case "zero_oid":
					clear(raw[len("100644 a.md\x00") : len("100644 a.md\x00")+20])
					return raw
				case "invalid_name":
					return bytes.Replace(raw, []byte("a.md"), []byte("a/.."), 1)
				case "type_mismatch":
					root := r.snapshot.objects[r.snapshot.commit]
					id := r.snapshot.commit
					_ = root
					copy(raw[len("100644 a.md\x00"):], id.raw())
					return raw
				}
				return raw
			})
			_, e := Import(t.Context(), r, q)
			if e == nil {
				t.Fatalf("malformed %s accepted", attack)
			}
			if r.snapshot.closes != 1 {
				t.Fatal("malformed import leaked snapshot")
			}
		}
	})
	t.Run("unreferenced_forbidden_leaf_is_not_imported", func(t *testing.T) {
		r, q := literalFixture(t, SHA1)
		var blob ObjectID
		for id, o := range r.snapshot.objects {
			if o.Kind == BlobObject {
				blob = id
				break
			}
		}
		rewriteRoot(t, r, func(raw []byte) []byte {
			raw = append(raw, []byte("120000 unreferenced-link\x00")...)
			return append(raw, blob.raw()...)
		})
		if _, e := Import(t.Context(), r, q); e != nil {
			t.Fatal(e)
		}
	})
	t.Run("traversed_intermediate_wrong_mode", func(t *testing.T) {
		raw := strings.Replace(literalManifest, "a.md", "docs/a.md", 1)
		r, q := dynamicFixture(t, SHA1, raw, map[string][]byte{"docs/a.md": []byte(literalSource)})
		rewriteRoot(t, r, func(raw []byte) []byte { return bytes.Replace(raw, []byte("40000 docs"), []byte("120000 docs"), 1) })
		_, e := Import(t.Context(), r, q)
		assertCode(t, e, Invalid)
	})
	t.Run("assembly_and_encoding_context", func(t *testing.T) {
		r, q := literalFixture(t, SHA1)
		p, e := Import(t.Context(), r, q)
		if e != nil {
			t.Fatal(e)
		}
		m, e := ParseManifest([]byte(literalManifest))
		if e != nil {
			t.Fatal(e)
		}
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		_, e = assembleProposalContext(ctx, q, p.Commit(), p.ManifestBlobOID(), p.ManifestDigest(), m, p.Nodes())
		if !errors.Is(e, context.Canceled) {
			t.Fatal(e)
		}
		_, e = encodeContext(ctx, "data", 100)
		if !errors.Is(e, context.Canceled) {
			t.Fatal(e)
		}
	})
}
func canonicalAdditional(t *testing.T) {
	t.Run("graph_edge_accessor_and_builder_inputs_are_copies", func(t *testing.T) {
		dto := manifestDecode(t, literalManifest)
		n := dto.Nodes[0]
		n.ID = "B"
		n.Path = "b.md"
		dto.Nodes = append(dto.Nodes, n)
		dto.Edges = []edgeDTO{{"SPEC-A", "B", "depends_on"}}
		p := fixtureImport(t, SHA1, string(manifestBytes(t, dto)), map[string][]byte{"a.md": []byte(literalSource), "b.md": []byte("B")})
		edges := p.Graph().Edges()
		edges[0].Kind = reconcile.EdgeProduces
		if p.Graph().Edges()[0].Kind != reconcile.EdgeDependsOn {
			t.Fatal("Graph edges retained accessor alias")
		}
		m, e := ParseManifest(manifestBytes(t, dto))
		if e != nil {
			t.Fatal(e)
		}
		nodes := p.Nodes()
		q := Request{Binding: p.Binding(), Ref: "refs/heads/main", ManifestPath: p.ManifestPath()}
		copyProposal, e := assembleProposal(q, p.Commit(), p.ManifestBlobOID(), p.ManifestDigest(), m, nodes)
		if e != nil {
			t.Fatal(e)
		}
		nodes[0].Binding.WorkItemIDs[0] = "mutated"
		if copyProposal.Digest() != p.Digest() || copyProposal.Nodes()[0].Binding.WorkItemIDs[0] != "wi_A" {
			t.Fatal("builder retained node alias")
		}
	})
	t.Run("all_oid_and_digest_parse_controls", func(t *testing.T) {
		for _, format := range []ObjectFormat{SHA1, SHA256} {
			length := 40
			if format == SHA256 {
				length = 64
			}
			for _, bad := range []string{"", strings.Repeat("0", length), strings.Repeat("A", length), strings.Repeat("a", length-1), strings.Repeat("a", length+1), strings.Repeat("g", length)} {
				_, e := ParseObjectID(format, bad)
				assertCode(t, e, Invalid)
			}
			if _, e := ParseObjectID(format, strings.Repeat("a", length)); e != nil {
				t.Fatal(e)
			}
		}
		_, e := ParseObjectID("md5", strings.Repeat("1", 40))
		assertCode(t, e, Invalid)
		if !(ObjectID{}).IsZero() || !(Proposal{}).Digest().IsZero() {
			t.Fatal("zero identity representation")
		}
		_, e = DecodeCanonicalProposal(nil, domain.HashBytes(nil))
		assertCode(t, e, Invalid)
	})
}
