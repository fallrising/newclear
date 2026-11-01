// Package specification imports immutable Git objects through a trusted reader.
// It grants no repository approval, persistence, or accepted-head authority.
package specification

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"slices"
	"strings"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/reconcile"
)

type ObjectFormat string

const (
	SHA1   ObjectFormat = "sha1"
	SHA256 ObjectFormat = "sha256"
)

type ObjectID struct {
	format ObjectFormat
	hex    string
}

func ParseObjectID(format ObjectFormat, value string) (ObjectID, error) {
	size := 40
	if format == SHA256 {
		size = 64
	} else if format != SHA1 {
		return ObjectID{}, fail(Invalid, "object_format", nil)
	}
	if len(value) != size || !lowerHex(value) || strings.Trim(value, "0") == "" {
		return ObjectID{}, fail(Invalid, "object_oid", nil)
	}
	return ObjectID{format, value}, nil
}
func lowerHex(s string) bool {
	for _, c := range []byte(s) {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
func strictDigest(s string) (domain.Digest, error) {
	if len(s) != 64 || !lowerHex(s) || strings.Trim(s, "0") == "" {
		return domain.Digest{}, fail(Invalid, "digest", nil)
	}
	d, e := domain.ParseDigest(s)
	return d, e
}
func (id ObjectID) Format() ObjectFormat { return id.format }
func (id ObjectID) String() string       { return id.hex }
func (id ObjectID) IsZero() bool         { return id.hex == "" }
func (id ObjectID) valid() bool          { _, err := ParseObjectID(id.format, id.hex); return err == nil }
func (id ObjectID) raw() []byte          { b, _ := hex.DecodeString(id.hex); return b }

type ObjectKind string

const (
	CommitObject ObjectKind = "commit"
	TreeObject   ObjectKind = "tree"
	BlobObject   ObjectKind = "blob"
)

type Object struct {
	Kind ObjectKind
	Data []byte
}
type Reader interface {
	Open(context.Context, string) (Snapshot, error)
}
type Snapshot interface {
	Commit() ObjectID
	ReadObject(context.Context, ObjectID, int64) (Object, error)
	Close() error
}
type RepositoryBinding struct {
	ProjectID    domain.ProjectID
	ID           string
	Version      uint64
	Digest       domain.Digest
	ObjectFormat ObjectFormat
}
type Request struct {
	Binding      RepositoryBinding
	Ref          string
	ManifestPath string
}
type NodeBinding struct {
	WorkItemIDs         []domain.WorkItemID
	RequiredACRevisions []domain.ACRevisionBinding
	RecipeDigest        domain.Digest
}
type ImportedNode struct {
	ID            reconcile.NodeID
	Path          string
	BlobOID       ObjectID
	ContentDigest domain.Digest
	Required      bool
	Binding       NodeBinding
}
type Manifest struct {
	nodes     []ImportedNode
	edges     []reconcile.Edge
	canonical []byte
}

func (m Manifest) CanonicalJSON() []byte { return bytes.Clone(m.canonical) }

type Proposal struct {
	binding              RepositoryBinding
	commit               ObjectID
	manifestPath         string
	manifestOID          ObjectID
	manifestDigest       domain.Digest
	nodes                []ImportedNode
	graph                reconcile.Graph
	canonical, normative []byte
	digest               domain.Digest
}

func (p Proposal) Digest() domain.Digest         { return p.digest }
func (p Proposal) Binding() RepositoryBinding    { return p.binding }
func (p Proposal) Commit() ObjectID              { return p.commit }
func (p Proposal) ManifestPath() string          { return p.manifestPath }
func (p Proposal) ManifestBlobOID() ObjectID     { return p.manifestOID }
func (p Proposal) ManifestDigest() domain.Digest { return p.manifestDigest }
func cloneNodes(nodes []ImportedNode) []ImportedNode {
	result := slices.Clone(nodes)
	for i := range result {
		result[i].Binding.WorkItemIDs = slices.Clone(result[i].Binding.WorkItemIDs)
		result[i].Binding.RequiredACRevisions = slices.Clone(result[i].Binding.RequiredACRevisions)
	}
	return result
}
func (p Proposal) Nodes() []ImportedNode  { return cloneNodes(p.nodes) }
func (p Proposal) Graph() reconcile.Graph { return p.graph }
func (p Proposal) CanonicalJSON() []byte  { return bytes.Clone(p.canonical) }
func (p Proposal) NormativeJSON() []byte  { return bytes.Clone(p.normative) }

type ErrorCode string

const (
	Invalid     ErrorCode = "invalid"
	Capacity    ErrorCode = "capacity"
	Integrity   ErrorCode = "integrity"
	Unavailable ErrorCode = "unavailable"
)

type Error struct {
	Code  ErrorCode
	Field string
	cause error
}

func (e *Error) Error() string {
	if e == nil {
		return "unavailable: nil_error"
	}
	return string(e.Code) + ": " + e.Field
}
func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}
func fail(code ErrorCode, field string, cause error) error {
	return &Error{Code: code, Field: field, cause: cause}
}

const (
	manifestLimit     = 1 << 20
	sourceLimit       = 10 << 20
	commitLimit       = 1 << 20
	headerLimit       = 64 << 10
	treeLimit         = 4 << 20
	objectCountLimit  = 50000
	totalLimit        = 50 << 20
	canonicalLimit    = 16 << 20
	normativeLimit    = 8 << 20
	nodeLimit         = 10000
	edgeLimit         = 20000
	bindingListLimit  = 1024
	bindingTotalLimit = 20000
)

// Reader and Close errors may contain untrusted paths or output. Retain only
// typed classification and standard cancellation causes at this boundary.
func readerError(field string, err error) error {
	code := Unavailable
	if nilValue(err) {
		return fail(code, field, nil)
	}
	if typed, ok := errors.AsType[*Error](err); ok && typed != nil {
		switch typed.Code {
		case Invalid, Capacity, Integrity, Unavailable:
			code = typed.Code
		}
	}
	var cause error
	if errors.Is(err, context.Canceled) {
		cause = context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		cause = errors.Join(cause, context.DeadlineExceeded)
	}
	return fail(code, field, cause)
}
