package specification

import (
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func nilValue(value any) bool {
	if value == nil {
		return true
	}
	v := reflect.ValueOf(value)
	switch v.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return v.IsNil()
	}
	return false
}
func validateRequest(r Request) error {
	b := r.Binding
	if !validID(string(b.ProjectID)) || !validID(b.ID) || b.Version == 0 || b.Version > 1<<63-1 || b.Digest.IsZero() || (b.ObjectFormat != SHA1 && b.ObjectFormat != SHA256) {
		return fail(Invalid, "repository_binding", nil)
	}
	if !validPath(r.ManifestPath) {
		return fail(Invalid, "manifest_path", nil)
	}
	if !validRef(r.Ref) {
		return fail(Invalid, "ref", nil)
	}
	return nil
}
func validRef(ref string) bool {
	if len(ref) > 200 || !(strings.HasPrefix(ref, "refs/heads/") || strings.HasPrefix(ref, "refs/tags/")) || strings.Contains(ref, "..") || strings.Contains(ref, "@{") {
		return false
	}
	for _, b := range []byte(ref) {
		if b < 33 || b > 126 || strings.ContainsRune("~^:?*[\\", rune(b)) {
			return false
		}
	}
	for c := range strings.SplitSeq(ref, "/") {
		if c == "" || strings.HasPrefix(c, ".") || strings.HasSuffix(c, ".") || strings.HasSuffix(c, ".lock") {
			return false
		}
	}
	return true
}
func Import(ctx context.Context, reader Reader, request Request) (result Proposal, err error) {
	if nilValue(ctx) || nilValue(reader) {
		return Proposal{}, fail(Invalid, "reader_context", nil)
	}
	if err := validateRequest(request); err != nil {
		return Proposal{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if e := ctx.Err(); e != nil {
		return Proposal{}, fail(Unavailable, "context", e)
	}
	snapshot, e := reader.Open(ctx, request.Ref)
	if !nilValue(snapshot) {
		defer func() {
			if closeErr := snapshot.Close(); closeErr != nil {
				result = Proposal{}
				err = fail(Unavailable, "close", errors.Join(err, readerError("close", closeErr)))
			}
			if contextErr := ctx.Err(); contextErr != nil {
				result = Proposal{}
				err = fail(Unavailable, "context", errors.Join(err, contextErr))
			}
		}()
	}
	if e != nil {
		return Proposal{}, readerError("open", e)
	}
	if nilValue(snapshot) {
		return Proposal{}, fail(Invalid, "snapshot", nil)
	}
	commit := snapshot.Commit()
	if !commit.valid() || commit.Format() != request.Binding.ObjectFormat {
		return Proposal{}, fail(Invalid, "commit_oid", nil)
	}
	budget := newBudget(ctx)
	object, e := budget.read(snapshot, commit, CommitObject, commitLimit)
	if e != nil {
		return Proposal{}, e
	}
	root, e := commitTree(commit, object.Data)
	if e != nil {
		return Proposal{}, e
	}
	budget.blobLimit = manifestLimit
	manifestOID, raw, e := resolveBlob(ctx, snapshot, root, request.ManifestPath, budget)
	if e != nil {
		return Proposal{}, e
	}
	manifest, e := parseManifest(ctx, raw)
	if e != nil {
		return Proposal{}, e
	}
	nodes := cloneNodes(manifest.nodes)
	budget.blobLimit = sourceLimit
	for i := range nodes {
		if nodes[i].Path == request.ManifestPath {
			return Proposal{}, fail(Invalid, "manifest_source_overlap", nil)
		}
		oid, data, e := resolveBlob(ctx, snapshot, root, nodes[i].Path, budget)
		if e != nil {
			return Proposal{}, e
		}
		nodes[i].BlobOID = oid
		nodes[i].ContentDigest = domain.HashBytes(data)
	}
	if e := ctx.Err(); e != nil {
		return Proposal{}, fail(Unavailable, "context", e)
	}
	result, e = assembleProposalContext(ctx, request, commit, manifestOID, domain.HashBytes(raw), manifest, nodes)
	if e != nil {
		return Proposal{}, e
	}
	if e := ctx.Err(); e != nil {
		return Proposal{}, fail(Unavailable, "context", e)
	}
	return result, nil
}
func verifyObject(id ObjectID, object Object, maximum int64) error {
	if !id.valid() {
		return fail(Integrity, "object_oid", nil)
	}
	if maximum < 1 || int64(len(object.Data)) > maximum {
		return fail(Capacity, "object_bytes", nil)
	}
	if object.Kind != CommitObject && object.Kind != TreeObject && object.Kind != BlobObject {
		return fail(Integrity, "object_kind", nil)
	}
	prefix := []byte(fmt.Sprintf("%s %d\x00", object.Kind, len(object.Data)))
	var digest string
	if id.Format() == SHA1 {
		h := sha1.New()
		h.Write(prefix)
		h.Write(object.Data)
		digest = hex.EncodeToString(h.Sum(nil))
	} else {
		h := sha256.New()
		h.Write(prefix)
		h.Write(object.Data)
		digest = hex.EncodeToString(h.Sum(nil))
	}
	if digest != id.String() {
		return fail(Integrity, "object_hash", nil)
	}
	return nil
}
func commitTree(id ObjectID, data []byte) (ObjectID, error) {
	headers, _, ok := bytes.Cut(data, []byte("\n\n"))
	if len(headers)+2 > headerLimit {
		return ObjectID{}, fail(Capacity, "commit_headers", nil)
	}
	if !ok {
		return ObjectID{}, fail(Invalid, "commit_headers", nil)
	}
	first, _, _ := bytes.Cut(headers, []byte("\n"))
	value, ok := strings.CutPrefix(string(first), "tree ")
	if !ok {
		return ObjectID{}, fail(Invalid, "commit_tree", nil)
	}
	root, err := ParseObjectID(id.Format(), value)
	if err != nil {
		return ObjectID{}, fail(Invalid, "commit_tree", nil)
	}
	count := 0
	for line := range bytes.SplitSeq(headers, []byte("\n")) {
		if bytes.ContainsRune(line, '\r') || len(line) == 0 {
			return ObjectID{}, fail(Invalid, "commit_headers", nil)
		}
		if bytes.HasPrefix(line, []byte("tree ")) {
			count++
		}
	}
	if count != 1 {
		return ObjectID{}, fail(Invalid, "commit_tree", nil)
	}
	return root, nil
}

type treeEntry struct {
	mode, name string
	id         ObjectID
}

func decodeTree(format ObjectFormat, data []byte) ([]treeEntry, error) {
	return decodeTreeContext(context.Background(), format, data)
}
func decodeTreeContext(ctx context.Context, format ObjectFormat, data []byte) ([]treeEntry, error) {
	if len(data) > treeLimit {
		return nil, fail(Capacity, "tree_bytes", nil)
	}
	size := 20
	if format == SHA256 {
		size = 32
	} else if format != SHA1 {
		return nil, fail(Invalid, "object_format", nil)
	}
	entries := make([]treeEntry, 0)
	names := map[string]bool{}
	for len(data) > 0 {
		if e := ctx.Err(); e != nil {
			return nil, fail(Unavailable, "context", e)
		}
		if len(entries) >= 20000 {
			return nil, fail(Capacity, "tree_records", nil)
		}
		mode, rest, ok := bytes.Cut(data, []byte(" "))
		if !ok {
			return nil, fail(Invalid, "tree_record", nil)
		}
		name, rest, ok := bytes.Cut(rest, []byte{0})
		if !ok || len(rest) < size {
			return nil, fail(Invalid, "tree_record", nil)
		}
		m, n := string(mode), string(name)
		if m != "40000" && m != "100644" && m != "100755" && m != "120000" && m != "160000" {
			return nil, fail(Invalid, "tree_mode", nil)
		}
		if n == "" || len(n) > 255 || !utf8.ValidString(n) || n == "." || n == ".." || strings.Contains(n, "/") || names[n] {
			return nil, fail(Invalid, "tree_name", nil)
		}
		names[n] = true
		oid, e := ParseObjectID(format, hex.EncodeToString(rest[:size]))
		if e != nil {
			return nil, fail(Invalid, "tree_oid", nil)
		}
		entries = append(entries, treeEntry{m, n, oid})
		data = rest[size:]
	}
	return entries, nil
}

type readBudget struct {
	ctx                                  context.Context
	cache                                map[ObjectID]Object
	objects, bytes, maxObjects, maxBytes int64
	blobLimit                            int64
}

func newBudget(ctx context.Context) *readBudget {
	return &readBudget{ctx: ctx, cache: map[ObjectID]Object{}, maxObjects: objectCountLimit, maxBytes: totalLimit}
}
func (b *readBudget) read(snapshot Snapshot, id ObjectID, kind ObjectKind, maximum int64) (Object, error) {
	if e := b.ctx.Err(); e != nil {
		return Object{}, fail(Unavailable, "context", e)
	}
	if object, ok := b.cache[id]; ok {
		if object.Kind != kind {
			return Object{}, fail(Integrity, "object_kind", nil)
		}
		if int64(len(object.Data)) > maximum {
			return Object{}, fail(Capacity, "object_bytes", nil)
		}
		return object, nil
	}
	if b.objects >= b.maxObjects {
		return Object{}, fail(Capacity, "unique_objects", nil)
	}
	object, e := snapshot.ReadObject(b.ctx, id, maximum)
	if e != nil {
		return Object{}, readerError("object_read", e)
	}
	if e := b.ctx.Err(); e != nil {
		return Object{}, fail(Unavailable, "context", e)
	}
	if object.Kind != kind {
		return Object{}, fail(Integrity, "object_kind", nil)
	}
	if e := verifyObject(id, object, maximum); e != nil {
		return Object{}, e
	}
	size := int64(len(object.Data))
	if b.bytes < 0 || b.bytes > b.maxBytes || size > b.maxBytes-b.bytes {
		return Object{}, fail(Capacity, "total_object_bytes", nil)
	}
	object.Data = bytes.Clone(object.Data)
	b.objects++
	b.bytes += size
	b.cache[id] = object
	return object, nil
}
func resolveBlob(ctx context.Context, snapshot Snapshot, root ObjectID, path string, budget *readBudget) (ObjectID, []byte, error) {
	if !validPath(path) {
		return ObjectID{}, nil, fail(Invalid, "path", nil)
	}
	parts := strings.Split(path, "/")
	current := root
	for i, part := range parts {
		if e := ctx.Err(); e != nil {
			return ObjectID{}, nil, fail(Unavailable, "context", e)
		}
		o, e := budget.read(snapshot, current, TreeObject, treeLimit)
		if e != nil {
			return ObjectID{}, nil, e
		}
		entries, e := decodeTreeContext(ctx, current.Format(), o.Data)
		if e != nil {
			return ObjectID{}, nil, e
		}
		var found *treeEntry
		for j := range entries {
			if entries[j].name == part {
				found = &entries[j]
				break
			}
		}
		if found == nil {
			return ObjectID{}, nil, fail(Unavailable, "path_component", nil)
		}
		if i < len(parts)-1 {
			if found.mode != "40000" {
				return ObjectID{}, nil, fail(Invalid, "path_mode", nil)
			}
			current = found.id
			continue
		}
		if found.mode != "100644" {
			return ObjectID{}, nil, fail(Invalid, "path_mode", nil)
		}
		blob, e := budget.read(snapshot, found.id, BlobObject, budget.blobLimit)
		if e != nil {
			return ObjectID{}, nil, e
		}
		return found.id, blob.Data, nil
	}
	return ObjectID{}, nil, fail(Invalid, "path", nil)
}
