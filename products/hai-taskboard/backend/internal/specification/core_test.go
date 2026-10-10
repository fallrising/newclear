package specification

import (
	"bytes"
	"context"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/reconcile"
)

func assertCode(t *testing.T, err error, code ErrorCode) {
	t.Helper()
	typed, ok := errors.AsType[*Error](err)
	if !ok || typed.Code != code {
		t.Fatalf("want %s typed error, got %v", code, err)
	}
}

type readerFunc func(context.Context, string) (Snapshot, error)

func (f readerFunc) Open(ctx context.Context, ref string) (Snapshot, error) { return f(ctx, ref) }

type snapshotWrapper struct {
	base     *fakeSnapshot
	read     func(context.Context, ObjectID, int64) (Object, error)
	closeErr error
	onClose  func()
}

func (s *snapshotWrapper) Commit() ObjectID { return s.base.Commit() }
func (s *snapshotWrapper) ReadObject(ctx context.Context, id ObjectID, max int64) (Object, error) {
	if s.read != nil {
		return s.read(ctx, id, max)
	}
	return s.base.ReadObject(ctx, id, max)
}
func (s *snapshotWrapper) Close() error {
	s.base.closes++
	if s.onClose != nil {
		s.onClose()
	}
	return s.closeErr
}

type nilContext struct{}

func (*nilContext) Deadline() (time.Time, bool) { panic("typed nil context must not be called") }
func (*nilContext) Done() <-chan struct{}       { panic("typed nil context must not be called") }
func (*nilContext) Err() error                  { panic("typed nil context must not be called") }
func (*nilContext) Value(any) any               { panic("typed nil context must not be called") }
func objectID(t *testing.T, format ObjectFormat, kind ObjectKind, data []byte) ObjectID {
	return fixtureID(t, format, independentHash(format, kind, data))
}
func dynamicFixture(t *testing.T, format ObjectFormat, manifest string, source map[string][]byte) (*fakeReader, Request) {
	t.Helper()
	objects := map[ObjectID]Object{}
	add := func(kind ObjectKind, data []byte) ObjectID {
		id := objectID(t, format, kind, data)
		objects[id] = Object{kind, bytes.Clone(data)}
		return id
	}
	type directory struct {
		children map[string]*directory
		blobs    map[string]ObjectID
	}
	root := &directory{children: map[string]*directory{}, blobs: map[string]ObjectID{}}
	sourceCopy := map[string][]byte{}
	for path, data := range source {
		sourceCopy[path] = data
	}
	sourceCopy["manifest.json"] = []byte(manifest)
	for path, data := range sourceCopy {
		dir := root
		parts := strings.Split(path, "/")
		for _, part := range parts[:len(parts)-1] {
			if dir.children[part] == nil {
				dir.children[part] = &directory{children: map[string]*directory{}, blobs: map[string]ObjectID{}}
			}
			dir = dir.children[part]
		}
		dir.blobs[parts[len(parts)-1]] = add(BlobObject, data)
	}
	var tree func(*directory) ObjectID
	tree = func(dir *directory) ObjectID {
		names := make([]string, 0, len(dir.children)+len(dir.blobs))
		for name := range dir.children {
			names = append(names, name)
		}
		for name := range dir.blobs {
			names = append(names, name)
		}
		slices.Sort(names)
		var raw []byte
		for _, name := range names {
			mode := "100644"
			id := dir.blobs[name]
			if child := dir.children[name]; child != nil {
				mode = "40000"
				id = tree(child)
			}
			raw = append(raw, []byte(mode+" "+name+"\x00")...)
			raw = append(raw, id.raw()...)
		}
		return add(TreeObject, raw)
	}
	tr := tree(root)
	commit := add(CommitObject, []byte("tree "+tr.String()+"\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nfixture\n"))
	return &fakeReader{snapshot: &fakeSnapshot{commit: commit, objects: objects}}, Request{Binding: RepositoryBinding{ProjectID: "project", ID: "binding", Version: 1, Digest: domain.HashString("approved"), ObjectFormat: format}, Ref: "refs/heads/main", ManifestPath: "manifest.json"}
}
func fixtureImport(t *testing.T, format ObjectFormat, raw string, sources map[string][]byte) Proposal {
	t.Helper()
	r, q := dynamicFixture(t, format, raw, sources)
	p, e := Import(t.Context(), r, q)
	if e != nil {
		t.Fatal(e)
	}
	return p
}
func immutableControls(t *testing.T) {
	t.Run("snapshot_open_once_moving_ref_ignored", func(t *testing.T) {
		r, q := literalFixture(t, SHA1)
		captured := r.snapshot
		r2, _ := dynamicFixture(t, SHA1, literalManifest, map[string][]byte{"a.md": []byte("new source")})
		p, e := Import(t.Context(), readerFunc(func(ctx context.Context, ref string) (Snapshot, error) {
			r.opens++
			r.snapshot = r2.snapshot
			return captured, nil
		}), q)
		if e != nil || p.Commit() != captured.commit || p.Nodes()[0].ContentDigest != domain.HashString(literalSource) || r.opens != 1 || captured.closes != 1 {
			t.Fatalf("moving ref changed capture: %v", e)
		}
		p2 := fixtureImport(t, SHA1, literalManifest, map[string][]byte{"a.md": []byte("new source")})
		if p2.Commit() == p.Commit() || p2.Digest() == p.Digest() {
			t.Fatal("new committed source preserved capture identity")
		}
	})
	for _, format := range []ObjectFormat{SHA1, SHA256} {
		for _, kind := range []ObjectKind{CommitObject, TreeObject, BlobObject} {
			for _, attack := range []string{"bytes", "type"} {
				t.Run(fmt.Sprintf("%s/forged_%s_%s", format, kind, attack), func(t *testing.T) {
					r, q := literalFixture(t, format)
					for id, o := range r.snapshot.objects {
						if o.Kind == kind {
							if attack == "bytes" {
								o.Data = append(bytes.Clone(o.Data), 'x')
							} else {
								o.Kind = ObjectKind("tag")
							}
							r.snapshot.objects[id] = o
							break
						}
					}
					_, e := Import(t.Context(), r, q)
					assertCode(t, e, Integrity)
					if r.snapshot.closes != 1 {
						t.Fatal("snapshot not closed")
					}
				})
			}
		}
	}
	for _, mode := range []string{"120000", "160000", "100755", "100640"} {
		t.Run("referenced_forbidden_mode_"+mode, func(t *testing.T) {
			r, q := literalFixture(t, SHA1)
			var rootID ObjectID
			for id, o := range r.snapshot.objects {
				if o.Kind == TreeObject {
					rootID = id
					raw := bytes.Replace(o.Data, []byte("100644 a.md"), []byte(mode+" a.md"), 1)
					newID := objectID(t, SHA1, TreeObject, raw)
					r.snapshot.objects[newID] = Object{TreeObject, raw}
					for cid, c := range r.snapshot.objects {
						if c.Kind == CommitObject {
							rawc := bytes.Replace(c.Data, []byte(rootID.String()), []byte(newID.String()), 1)
							r.snapshot.commit = objectID(t, SHA1, CommitObject, rawc)
							r.snapshot.objects[r.snapshot.commit] = Object{CommitObject, rawc}
							delete(r.snapshot.objects, cid)
							break
						}
					}
					break
				}
			}
			_, e := Import(t.Context(), r, q)
			assertCode(t, e, Invalid)
		})
	}
	t.Run("absent_source", func(t *testing.T) {
		r, q := literalFixture(t, SHA1)
		for id, o := range r.snapshot.objects {
			if o.Kind == BlobObject && string(o.Data) == literalSource {
				delete(r.snapshot.objects, id)
			}
		}
		_, e := Import(t.Context(), r, q)
		assertCode(t, e, Unavailable)
		if r.snapshot.closes != 1 {
			t.Fatal("close missing")
		}
	})
	t.Run("nested_paths", func(t *testing.T) {
		raw := strings.Replace(literalManifest, "a.md", "docs/deep/a.md", 1)
		p := fixtureImport(t, SHA256, raw, map[string][]byte{"docs/deep/a.md": []byte(literalSource)})
		if p.Nodes()[0].Path != "docs/deep/a.md" {
			t.Fatal("nested traversal lost path")
		}
	})
	t.Run("request_nil_and_validation_before_open", func(t *testing.T) {
		r, q := literalFixture(t, SHA1)
		var nr *fakeReader
		var nc *nilContext
		for _, c := range []struct {
			ctx context.Context
			r   Reader
		}{{nil, r}, {nc, r}, {t.Context(), nil}, {t.Context(), nr}} {
			_, e := Import(c.ctx, c.r, q)
			assertCode(t, e, Invalid)
		}
		cases := []Request{q, q, q, q, q, q, q}
		cases[0].Binding.ProjectID = ""
		cases[1].Binding.ID = "../bad"
		cases[2].Binding.Version = 1 << 63
		cases[3].Binding.Digest = domain.Digest{}
		cases[4].Binding.ObjectFormat = "md5"
		cases[5].Ref = "HEAD"
		cases[6].ManifestPath = "../manifest.json"
		for _, bad := range cases {
			_, e := Import(t.Context(), r, bad)
			assertCode(t, e, Invalid)
		}
		if r.opens != 0 {
			t.Fatal("invalid input reached Open")
		}
		var ns *fakeSnapshot
		_, e := Import(t.Context(), readerFunc(func(context.Context, string) (Snapshot, error) { return ns, nil }), q)
		assertCode(t, e, Invalid)
	})
	t.Run("pre_cancel_and_context_honoring_reader", func(t *testing.T) {
		r, q := literalFixture(t, SHA1)
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		_, e := Import(ctx, r, q)
		if !errors.Is(e, context.Canceled) || r.opens != 0 {
			t.Fatalf("pre-cancel %v", e)
		}
		ctx2, cancel2 := context.WithTimeout(t.Context(), 10*time.Millisecond)
		defer cancel2()
		s := &snapshotWrapper{base: r.snapshot, read: func(ctx context.Context, id ObjectID, max int64) (Object, error) {
			<-ctx.Done()
			return Object{}, ctx.Err()
		}}
		_, e = Import(ctx2, readerFunc(func(context.Context, string) (Snapshot, error) { return s, nil }), q)
		if !errors.Is(e, context.DeadlineExceeded) || s.base.closes != 1 {
			t.Fatalf("context/lifetime %v", e)
		}
	})
	t.Run("close_failure_and_open_error_close", func(t *testing.T) {
		r, q := literalFixture(t, SHA1)
		s := &snapshotWrapper{base: r.snapshot, closeErr: errors.New("sensitive /path and stderr")}
		p, e := Import(t.Context(), readerFunc(func(context.Context, string) (Snapshot, error) { return s, nil }), q)
		assertCode(t, e, Unavailable)
		if !p.Digest().IsZero() || strings.Contains(e.Error(), "sensitive") || s.base.closes != 1 {
			t.Fatal("close failure retained result or leaked")
		}
		r, q = literalFixture(t, SHA1)
		_, e = Import(t.Context(), readerFunc(func(context.Context, string) (Snapshot, error) { return r.snapshot, context.Canceled }), q)
		if !errors.Is(e, context.Canceled) || r.snapshot.closes != 1 {
			t.Fatal("Open failure lost context or close")
		}
	})
	t.Run("commit_headers_exact_plus_one", func(t *testing.T) {
		r, _ := literalFixture(t, SHA1)
		root := strings.Split(string(r.snapshot.objects[r.snapshot.commit].Data), "\n")[0]
		raw := []byte(root + "\nauthor " + strings.Repeat("a", headerLimit-len(root)-len("\nauthor ")-2) + "\n\n")
		if len(raw) != headerLimit {
			t.Fatal("bad header control")
		}
		if _, e := commitTree(r.snapshot.commit, raw); e != nil {
			t.Fatal(e)
		}
		raw = bytes.Replace(raw, []byte("author "), []byte("author a"), 1)
		_, e := commitTree(r.snapshot.commit, raw)
		assertCode(t, e, Capacity)
		for _, bad := range []string{"tree bad\n\n", "author x\n\n", root + "\n" + root + "\n\n", root + "\r\n\n", root + "\nmissing separator"} {
			_, e := commitTree(r.snapshot.commit, []byte(bad))
			if e == nil {
				t.Fatalf("malformed commit accepted %q", bad)
			}
		}
	})
	t.Run("object_bytes_actual_exact_plus_one", func(t *testing.T) {
		for _, c := range []struct {
			kind    ObjectKind
			maximum int
		}{{CommitObject, commitLimit}, {TreeObject, treeLimit}, {BlobObject, sourceLimit}} {
			for _, delta := range []int{0, 1} {
				data := bytes.Repeat([]byte{'x'}, c.maximum+delta)
				id := objectID(t, SHA256, c.kind, data)
				e := verifyObject(id, Object{c.kind, data}, int64(c.maximum))
				if delta == 0 && e != nil {
					t.Fatal(e)
				}
				if delta == 1 {
					assertCode(t, e, Capacity)
				}
			}
		}
	})
	t.Run("tree_record_and_name_limits", func(t *testing.T) {
		id := fixtureID(t, SHA1, strings.Repeat("1", 40))
		record := func(name string) []byte { return append([]byte("100644 "+name+"\x00"), id.raw()...) }
		for _, n := range []int{20000, 20001} {
			var raw []byte
			for i := range n {
				raw = append(raw, record(strconv.Itoa(i))...)
			}
			_, e := decodeTree(SHA1, raw)
			if n == 20000 && e != nil {
				t.Fatal(e)
			}
			if n == 20001 {
				assertCode(t, e, Capacity)
			}
		}
		if _, e := decodeTree(SHA1, record(strings.Repeat("a", 255))); e != nil {
			t.Fatal(e)
		}
		for _, raw := range [][]byte{record(strings.Repeat("a", 256)), record(string([]byte{255})), append(record("same"), record("same")...), record("../x"), []byte("100644 a\x00short")} {
			if _, e := decodeTree(SHA1, raw); e == nil {
				t.Fatal("malformed tree accepted")
			}
		}
	})
	t.Run("unique_object_exact_plus_one_cache_smaller_cap", func(t *testing.T) {
		b := newBudget(t.Context())
		s := &fakeSnapshot{objects: map[ObjectID]Object{}}
		for i := range objectCountLimit + 1 {
			data := []byte(strconv.Itoa(i))
			id := objectID(t, SHA1, BlobObject, data)
			s.objects[id] = Object{BlobObject, data}
			_, e := b.read(s, id, BlobObject, 100)
			if i < objectCountLimit && e != nil {
				t.Fatal(e)
			}
			if i == objectCountLimit {
				assertCode(t, e, Capacity)
			}
		}
		b = newBudget(t.Context())
		data := []byte("1234")
		id := objectID(t, SHA1, BlobObject, data)
		s.objects[id] = Object{BlobObject, data}
		if _, e := b.read(s, id, BlobObject, 4); e != nil {
			t.Fatal(e)
		}
		_, e := b.read(s, id, BlobObject, 3)
		assertCode(t, e, Capacity)
		if b.objects != 1 || b.bytes != 4 {
			t.Fatal("cache recounted bytes")
		}
	})
	t.Run("total_actual_exact_plus_one_and_overflow", func(t *testing.T) {
		b := newBudget(t.Context())
		s := &fakeSnapshot{objects: map[ObjectID]Object{}}
		for i := range 5 {
			data := bytes.Repeat([]byte{byte('a' + i)}, sourceLimit)
			id := objectID(t, SHA256, BlobObject, data)
			s.objects[id] = Object{BlobObject, data}
			if _, e := b.read(s, id, BlobObject, sourceLimit); e != nil {
				t.Fatal(e)
			}
		}
		if b.bytes != totalLimit {
			t.Fatal("wrong raw byte accounting")
		}
		id := objectID(t, SHA256, BlobObject, []byte("x"))
		s.objects[id] = Object{BlobObject, []byte("x")}
		_, e := b.read(s, id, BlobObject, 1)
		assertCode(t, e, Capacity)
		b = newBudget(t.Context())
		b.bytes = math.MaxInt64
		b.maxBytes = math.MaxInt64
		_, e = b.read(s, id, BlobObject, 1)
		assertCode(t, e, Capacity)
	})
	t.Run("shared_manifest_source_oid_counts_once", func(t *testing.T) {
		r, q := dynamicFixture(t, SHA1, literalManifest, map[string][]byte{"a.md": []byte(literalManifest)})
		p, e := Import(t.Context(), r, q)
		if e != nil {
			t.Fatal(e)
		}
		if p.ManifestBlobOID() != p.Nodes()[0].BlobOID {
			t.Fatal("shared OID fixture did not coincide")
		}
	})
}
func manifestDecode(t *testing.T, raw string) manifestDTO {
	t.Helper()
	var dto manifestDTO
	if e := json.Unmarshal([]byte(raw), &dto); e != nil {
		t.Fatal(e)
	}
	return dto
}
func manifestBytes(t *testing.T, dto manifestDTO) []byte {
	t.Helper()
	data, e := json.Marshal(dto)
	if e != nil {
		t.Fatal(e)
	}
	return data
}
func TestProposalCore_StrictManifest(t *testing.T) {
	base := manifestDecode(t, literalManifest)
	t.Run("presence_type_unknown_duplicate_case_null_every_level", func(t *testing.T) {
		var value map[string]any
		if e := json.Unmarshal([]byte(literalManifest), &value); e != nil {
			t.Fatal(e)
		}
		levels := []struct {
			name   string
			object map[string]any
		}{{"root", value}, {"node", value["nodes"].([]any)[0].(map[string]any)}, {"ac", value["nodes"].([]any)[0].(map[string]any)["required_ac_revisions"].([]any)[0].(map[string]any)}}
		// Add a second optional node and valid edge so the edge schema has controls.
		node2 := map[string]any{"id": "B", "path": "b.md", "required": false, "work_item_ids": []any{}, "required_ac_revisions": []any{}, "recipe_digest": strings.Repeat("2", 64)}
		value["nodes"] = append(value["nodes"].([]any), node2)
		edge := map[string]any{"from": "SPEC-A", "to": "B", "kind": "depends_on"}
		value["edges"] = []any{edge}
		levels = append(levels, struct {
			name   string
			object map[string]any
		}{"edge", edge})
		for _, level := range levels {
			keys := make([]string, 0, len(level.object))
			for key := range level.object {
				keys = append(keys, key)
			}
			for _, key := range keys {
				original := level.object[key]
				for _, attack := range []string{"missing", "null", "wrong_type", "case"} {
					t.Run(level.name+"/"+key+"/"+attack, func(t *testing.T) {
						switch attack {
						case "missing":
							delete(level.object, key)
						case "null":
							level.object[key] = nil
						case "wrong_type":
							if _, ok := original.(string); ok {
								level.object[key] = true
							} else {
								level.object[key] = "wrong"
							}
						case "case":
							delete(level.object, key)
							level.object[strings.ToUpper(key)] = original
						}
						raw, e := json.Marshal(value)
						if e != nil {
							t.Fatal(e)
						}
						_, e = ParseManifest(raw)
						assertCode(t, e, Invalid)
						delete(level.object, strings.ToUpper(key))
						level.object[key] = original
					})
				}
			}
			level.object["unexpected"] = true
			raw, _ := json.Marshal(value)
			_, e := ParseManifest(raw)
			assertCode(t, e, Invalid)
			delete(level.object, "unexpected")
		}
		for _, needle := range []string{`"schema_version":1`, `"id":"SPEC-A"`, `"ac_id":"AC-A"`} {
			bad := strings.Replace(literalManifest, needle, needle+","+needle, 1)
			_, e := ParseManifest([]byte(bad))
			assertCode(t, e, Invalid)
		}
		edgeRaw, _ := json.Marshal(value)
		bad := bytes.Replace(edgeRaw, []byte(`"kind":"depends_on"`), []byte(`"kind":"depends_on","kind":"depends_on"`), 1)
		_, e := ParseManifest(bad)
		assertCode(t, e, Invalid)
	})
	t.Run("json_utf8_surrogate_version_and_coercion", func(t *testing.T) {
		bad := []string{"\ufeff" + literalManifest, literalManifest + " {}", strings.Replace(literalManifest, "SPEC-A", string([]byte{255}), 1), strings.Replace(literalManifest, "SPEC-A", `\ud800`, 1), strings.Replace(literalManifest, "SPEC-A", `\udc00`, 1), strings.Replace(literalManifest, "SPEC-A", `\q`, 1)}
		for _, version := range []string{"0", "2", "1.0", "1e0", "-1", `"1"`, "true", "null"} {
			bad = append(bad, strings.Replace(literalManifest, `"schema_version":1`, `"schema_version":`+version, 1))
		}
		for _, raw := range bad {
			_, e := ParseManifest([]byte(raw))
			assertCode(t, e, Invalid)
		}
	})
	t.Run("path_id_digest_tables", func(t *testing.T) {
		for _, path := range []string{"", "/a", "a/", "a//b", ".", "..", "a/../b", "a\\b", "a:b", "a b", "a\n", "a\x00", strings.Repeat("a", 256), strings.Repeat("a/", 32) + "a", strings.Repeat("a", 255) + "/" + strings.Repeat("b", 255) + "/cc", "a\u0085b"} {
			dto := manifestDecode(t, literalManifest)
			dto.Nodes[0].Path = path
			_, e := ParseManifest(manifestBytes(t, dto))
			assertCode(t, e, Invalid)
		}
		for _, id := range []string{"", "a b", "a/b", "a\\b", "a\x00", "a\n", strings.Repeat("x", 121), "a\u0085b"} {
			for _, field := range []string{"node", "work", "ac"} {
				dto := manifestDecode(t, literalManifest)
				switch field {
				case "node":
					dto.Nodes[0].ID = id
				case "work":
					dto.Nodes[0].WorkItems[0] = id
				case "ac":
					dto.Nodes[0].ACs[0].ID = id
				}
				_, e := ParseManifest(manifestBytes(t, dto))
				assertCode(t, e, Invalid)
			}
		}
		for _, d := range []string{"", strings.Repeat("0", 64), strings.Repeat("a", 63), strings.Repeat("a", 65), strings.Repeat("A", 64), strings.Repeat("g", 64)} {
			for _, field := range []string{"recipe", "ac"} {
				dto := manifestDecode(t, literalManifest)
				if field == "recipe" {
					dto.Nodes[0].Recipe = d
				} else {
					dto.Nodes[0].ACs[0].Digest = d
				}
				_, e := ParseManifest(manifestBytes(t, dto))
				assertCode(t, e, Invalid)
			}
		}
		dto := manifestDecode(t, literalManifest)
		dto.Nodes[0].ID = strings.Repeat("x", 120)
		dto.Nodes[0].Path = strings.Repeat("a", 255) + "/" + strings.Repeat("b", 255)
		if _, e := ParseManifest(manifestBytes(t, dto)); e != nil {
			t.Fatal(e)
		}
	})
	t.Run("mapping_required_shared_ac_graph_rejections", func(t *testing.T) {
		for _, attack := range []string{"duplicate_node", "duplicate_path", "duplicate_work", "duplicate_ac", "shared_ac_conflict", "required_unmapped", "required_without_ac", "dangling", "cycle", "duplicate_edge", "unknown_edge"} {
			dto := manifestDecode(t, literalManifest)
			n := dto.Nodes[0]
			n.WorkItems = slices.Clone(n.WorkItems)
			n.ACs = slices.Clone(n.ACs)
			n.ID = "B"
			n.Path = "b.md"
			dto.Nodes = append(dto.Nodes, n)
			switch attack {
			case "duplicate_node":
				dto.Nodes[1].ID = "SPEC-A"
			case "duplicate_path":
				dto.Nodes[1].Path = "a.md"
			case "duplicate_work":
				dto.Nodes[0].WorkItems = append(dto.Nodes[0].WorkItems, "wi_A")
			case "duplicate_ac":
				dto.Nodes[0].ACs = append(dto.Nodes[0].ACs, dto.Nodes[0].ACs[0])
			case "shared_ac_conflict":
				dto.Nodes[1].ACs[0].Digest = strings.Repeat("3", 64)
			case "required_unmapped":
				dto.Nodes[0].WorkItems = []string{}
			case "required_without_ac":
				dto.Nodes[0].ACs = []acDTO{}
			case "dangling":
				dto.Edges = []edgeDTO{{"SPEC-A", "absent", "depends_on"}}
			case "cycle":
				dto.Edges = []edgeDTO{{"SPEC-A", "B", "depends_on"}, {"B", "SPEC-A", "produces"}}
			case "duplicate_edge":
				dto.Edges = []edgeDTO{{"SPEC-A", "B", "depends_on"}, {"SPEC-A", "B", "depends_on"}}
			case "unknown_edge":
				dto.Edges = []edgeDTO{{"SPEC-A", "B", "AI"}}
			}
			_, e := ParseManifest(manifestBytes(t, dto))
			assertCode(t, e, Invalid)
			if attack == "cycle" {
				if _, ok := errors.AsType[reconcile.ValidationError](e); !ok {
					t.Fatal("graph error not inspectable")
				}
			}
		}
		_, e := ParseManifest([]byte(strings.Replace(literalManifest, `"required":true`, `"required":true,"tombstone":true`, 1)))
		assertCode(t, e, Invalid)
		optional := manifestDecode(t, literalManifest)
		optional.Nodes[0].Required = false
		optional.Nodes[0].WorkItems = []string{}
		optional.Nodes[0].ACs = []acDTO{}
		if _, e := ParseManifest(manifestBytes(t, optional)); e != nil {
			t.Fatal(e)
		}
	})
	t.Run("ordering_and_exact_manifest_bytes", func(t *testing.T) {
		raw := ` { "edges":[],"nodes":[{"recipe_digest":"` + strings.Repeat("2", 64) + `","required_ac_revisions":[{"ac_revision_digest":"` + strings.Repeat("1", 64) + `","ac_id":"AC-A"}],"work_item_ids":["wi_A"],"required":true,"path":"a.md","id":"SPEC-A"}],"schema_version":1} `
		m, e := ParseManifest([]byte(raw))
		if e != nil || string(m.CanonicalJSON()) != literalManifest {
			t.Fatalf("reordering %v", e)
		}
		exact := append([]byte(literalManifest), bytes.Repeat([]byte{' '}, manifestLimit-len(literalManifest))...)
		if _, e := ParseManifest(exact); e != nil {
			t.Fatal(e)
		}
		r, q := dynamicFixture(t, SHA1, string(exact), map[string][]byte{"a.md": []byte(literalSource)})
		if _, e := Import(t.Context(), r, q); e != nil {
			t.Fatal(e)
		}
		_, e = ParseManifest(append(exact, ' '))
		assertCode(t, e, Capacity)
		r, q = dynamicFixture(t, SHA1, string(exact)+" ", map[string][]byte{"a.md": []byte(literalSource)})
		_, e = Import(t.Context(), r, q)
		assertCode(t, e, Capacity)
	})
	t.Run("private_structural_node_edge_cardinality", func(t *testing.T) {
		nodes := make([]ImportedNode, nodeLimit)
		for i := range nodes {
			nodes[i] = ImportedNode{ID: reconcile.NodeID(fmt.Sprintf("N%05d", i)), Path: fmt.Sprintf("n%05d", i), Binding: NodeBinding{RecipeDigest: domain.HashString("recipe")}}
		}
		m, e := validateManifest(t.Context(), nodes, nil)
		if e != nil || len(m.nodes) != nodeLimit {
			t.Fatal(e)
		}
		_, e = validateManifest(t.Context(), append(nodes, ImportedNode{}), nil)
		assertCode(t, e, Capacity)
		edges := make([]reconcile.Edge, 0, edgeLimit+1)
		kinds := []reconcile.EdgeKind{reconcile.EdgeSpecifies, reconcile.EdgeDependsOn, reconcile.EdgeVerifies, reconcile.EdgeProduces}
		for i := range edgeLimit + 1 {
			from := i / 4
			edges = append(edges, reconcile.Edge{From: nodes[from].ID, To: nodes[from+1].ID, Kind: kinds[i%4]})
		}
		if _, e := validateManifest(t.Context(), nodes, edges[:edgeLimit]); e != nil {
			t.Fatal(e)
		}
		_, e = validateManifest(t.Context(), nodes, edges)
		assertCode(t, e, Capacity)
	})
	t.Run("private_structural_binding_list_and_aggregate", func(t *testing.T) {
		for _, kind := range []string{"work", "ac"} {
			makeNodes := func(count int) []ImportedNode {
				nodes := []ImportedNode{}
				for count > 0 {
					n := ImportedNode{ID: reconcile.NodeID(fmt.Sprintf("N%d", len(nodes))), Path: fmt.Sprintf("n%d", len(nodes)), Binding: NodeBinding{RecipeDigest: domain.HashString("recipe")}}
					length := min(count, bindingListLimit)
					for i := range length {
						if kind == "work" {
							n.Binding.WorkItemIDs = append(n.Binding.WorkItemIDs, domain.WorkItemID(fmt.Sprintf("w%d", i)))
						} else {
							n.Binding.RequiredACRevisions = append(n.Binding.RequiredACRevisions, domain.ACRevisionBinding{ACID: domain.ACID(fmt.Sprintf("ac%d", i)), RevisionDigest: domain.HashString("same")})
						}
					}
					nodes = append(nodes, n)
					count -= length
				}
				return nodes
			}
			if _, e := validateManifest(t.Context(), makeNodes(bindingListLimit), nil); e != nil {
				t.Fatal(e)
			}
			nodes := makeNodes(bindingListLimit)
			if kind == "work" {
				nodes[0].Binding.WorkItemIDs = append(nodes[0].Binding.WorkItemIDs, "extra")
			} else {
				nodes[0].Binding.RequiredACRevisions = append(nodes[0].Binding.RequiredACRevisions, domain.ACRevisionBinding{ACID: "extra", RevisionDigest: domain.HashString("same")})
			}
			_, e := validateManifest(t.Context(), nodes, nil)
			assertCode(t, e, Capacity)
			if _, e := validateManifest(t.Context(), makeNodes(bindingTotalLimit), nil); e != nil {
				t.Fatal(e)
			}
			_, e = validateManifest(t.Context(), makeNodes(bindingTotalLimit+1), nil)
			assertCode(t, e, Capacity)
		}
	})
	_ = base
}
