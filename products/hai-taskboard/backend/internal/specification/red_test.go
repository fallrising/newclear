package specification

import (
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const literalManifest = `{"schema_version":1,"nodes":[{"id":"SPEC-A","path":"a.md","required":true,"work_item_ids":["wi_A"],"required_ac_revisions":[{"ac_id":"AC-A","ac_revision_digest":"1111111111111111111111111111111111111111111111111111111111111111"}],"recipe_digest":"2222222222222222222222222222222222222222222222222222222222222222"}],"edges":[]}`
const literalSource = "Committed source\n"

type fakeReader struct {
	snapshot *fakeSnapshot
	opens    int
}
type fakeSnapshot struct {
	commit  ObjectID
	objects map[ObjectID]Object
	closes  int
}

func (f *fakeReader) Open(context.Context, string) (Snapshot, error) {
	f.opens++
	return f.snapshot, nil
}
func (f *fakeSnapshot) Commit() ObjectID { return f.commit }
func (f *fakeSnapshot) ReadObject(ctx context.Context, id ObjectID, maximum int64) (Object, error) {
	if err := ctx.Err(); err != nil {
		return Object{}, err
	}
	o, ok := f.objects[id]
	if !ok {
		return Object{}, &Error{Code: Unavailable, Field: "object"}
	}
	return o, nil
}
func (f *fakeSnapshot) Close() error { f.closes++; return nil }
func fixtureID(t *testing.T, format ObjectFormat, value string) ObjectID {
	t.Helper()
	id, err := ParseObjectID(format, value)
	if err != nil {
		t.Fatal(err)
	}
	return id
}
func independentHash(format ObjectFormat, kind ObjectKind, data []byte) string {
	raw := append([]byte(fmt.Sprintf("%s %d\x00", kind, len(data))), data...)
	if format == SHA1 {
		s := sha1.Sum(raw)
		return hex.EncodeToString(s[:])
	}
	s := sha256.Sum256(raw)
	return hex.EncodeToString(s[:])
}
func literalFixture(t *testing.T, format ObjectFormat) (*fakeReader, Request) {
	t.Helper()
	var manifest, source, tree, commit, treeRaw, commitRaw string
	switch format {
	case SHA1:
		manifest = "ce49519650f3e54f3a5de7f43b40a39af228a53f"
		source = "5205b123b53e3ea2ebb654b4a7789516cfa07109"
		tree = "cee8c103c86dc28864cb43dd71029592dc732260"
		commit = "6d7d41dd90d02573581137f9663bc274872fb041"
		treeRaw = "31303036343420612e6d64005205b123b53e3ea2ebb654b4a7789516cfa07109313030363434206d616e69666573742e6a736f6e00ce49519650f3e54f3a5de7f43b40a39af228a53f"
		commitRaw = "tree cee8c103c86dc28864cb43dd71029592dc732260\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nfixture\n"
	case SHA256:
		manifest = "496d85419354e65ba77a840d08124da1488ee9ce2a957d5bd66fda4c3fc2a6e0"
		source = "5355b3eb54c4133d1edfd50d255781d51cbdad38b30f2b66d048fcd11fc6c1a3"
		tree = "dd4603c42f4fd1ca34a0fad7932892c15e0fe5313cd42bea483aefede9f22c32"
		commit = "af03dec2f925a4936d7b53162e97a6403e6ae97893b78a8b92504335fd7e94c7"
		treeRaw = "31303036343420612e6d64005355b3eb54c4133d1edfd50d255781d51cbdad38b30f2b66d048fcd11fc6c1a3313030363434206d616e69666573742e6a736f6e00496d85419354e65ba77a840d08124da1488ee9ce2a957d5bd66fda4c3fc2a6e0"
		commitRaw = "tree dd4603c42f4fd1ca34a0fad7932892c15e0fe5313cd42bea483aefede9f22c32\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nfixture\n"
	}
	rawTree, err := hex.DecodeString(treeRaw)
	if err != nil {
		t.Fatal(err)
	}
	objects := map[ObjectID]Object{fixtureID(t, format, manifest): {Kind: BlobObject, Data: []byte(literalManifest)}, fixtureID(t, format, source): {Kind: BlobObject, Data: []byte(literalSource)}, fixtureID(t, format, tree): {Kind: TreeObject, Data: rawTree}, fixtureID(t, format, commit): {Kind: CommitObject, Data: []byte(commitRaw)}}
	for id, o := range objects {
		if got := independentHash(format, o.Kind, o.Data); got != id.String() {
			t.Fatalf("independent fixture mismatch: %s != %s", got, id.String())
		}
	}
	return &fakeReader{snapshot: &fakeSnapshot{commit: fixtureID(t, format, commit), objects: objects}}, Request{Binding: RepositoryBinding{ProjectID: "project", ID: "binding", Version: 1, Digest: domain.HashString("approved"), ObjectFormat: format}, Ref: "refs/heads/main", ManifestPath: "manifest.json"}
}
func TestProposalCore_ImmutableCapture(t *testing.T) {
	for _, format := range []ObjectFormat{SHA1, SHA256} {
		t.Run(string(format)+"/valid_immutable_import", func(t *testing.T) {
			reader, request := literalFixture(t, format)
			p, err := Import(t.Context(), reader, request)
			if err != nil {
				t.Fatalf("valid immutable import failed: %v", err)
			}
			if p.Commit() != reader.snapshot.commit || p.Binding() != request.Binding || p.ManifestDigest() != domain.HashString(literalManifest) || len(p.Nodes()) != 1 || p.Nodes()[0].ContentDigest != domain.HashString(literalSource) || reader.opens != 1 || reader.snapshot.closes != 1 {
				t.Fatal("captured provenance or lifetime mismatch")
			}
		})
	}
	immutableControls(t)
	immutableAdditional(t)
}
