package port

import (
	"bytes"
	"context"
	json "encoding/json/v2"
	"errors"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

// RepositoryAuthority is trusted in-memory configuration. Lookup must not perform I/O,
// must return copies, and must expose revocation to every lookup.
type RepositoryAuthority interface {
	Lookup(domain.ProjectID, string) (ApprovedRepository, error)
}
type ApprovedRepository struct {
	Binding         specification.RepositoryBinding
	ConfigurationID string
	ApprovedBy      domain.ActorID
	Refs            []string
	ManifestPaths   []string
	Reader          specification.Reader
}
type AdmissionTransaction interface {
	Transaction
	LoadProject(context.Context, domain.ProjectID) (Project, error)
	StoreProposal(context.Context, ApprovedRepository, specification.Proposal, int64) error
	LoadProposal(context.Context, domain.ProjectID, domain.Digest) (specification.Proposal, error)
}

// CanonicalRepositoryBinding excludes the Reader and private filesystem paths.
func CanonicalRepositoryBinding(v ApprovedRepository) ([]byte, domain.Digest, error) {
	valid := func(s string) bool {
		return s != "" && len(s) <= 512 && utf8.ValidString(s) && !strings.ContainsFunc(s, unicode.IsControl)
	}
	identity := func(s string) bool {
		return valid(s) && len(s) <= 120 && !strings.ContainsFunc(s, unicode.IsSpace) && !strings.ContainsAny(s, "/\\")
	}
	b := v.Binding
	if !identity(string(b.ProjectID)) || !identity(b.ID) || b.Version == 0 || b.Version > 1<<63-1 || !identity(v.ConfigurationID) || strings.ContainsAny(v.ConfigurationID, "/\\") || !identity(string(v.ApprovedBy)) || (b.ObjectFormat != specification.SHA1 && b.ObjectFormat != specification.SHA256) {
		return nil, domain.Digest{}, errors.New("invalid repository binding")
	}
	refs, paths := slices.Clone(v.Refs), slices.Clone(v.ManifestPaths)
	for _, list := range [][]string{refs, paths} {
		if len(list) == 0 || len(list) > 256 {
			return nil, domain.Digest{}, errors.New("invalid binding allowlist")
		}
		slices.Sort(list)
		for i, s := range list {
			if !valid(s) || (i > 0 && list[i-1] == s) {
				return nil, domain.Digest{}, errors.New("invalid binding allowlist")
			}
		}
	}

	for _, s := range refs {
		if len(s) > 200 || !(strings.HasPrefix(s, "refs/heads/") || strings.HasPrefix(s, "refs/tags/")) || strings.Contains(s, "..") || strings.Contains(s, "@{") {
			return nil, domain.Digest{}, errors.New("invalid ref")
		}
		for _, b := range []byte(s) {
			if b < 33 || b > 126 || strings.ContainsRune("~^:?*[\\", rune(b)) {
				return nil, domain.Digest{}, errors.New("invalid ref")
			}
		}
		for c := range strings.SplitSeq(s, "/") {
			if c == "" || strings.HasPrefix(c, ".") || strings.HasSuffix(c, ".") || strings.HasSuffix(c, ".lock") {
				return nil, domain.Digest{}, errors.New("invalid ref")
			}
		}
	}
	for _, s := range paths {
		if strings.ContainsAny(s, "\\:") || strings.ContainsFunc(s, unicode.IsSpace) {
			return nil, domain.Digest{}, errors.New("invalid manifest path")
		}
		count := 0
		for part := range strings.SplitSeq(s, "/") {
			count++
			if part == "" || part == "." || part == ".." || len(part) > 255 {
				return nil, domain.Digest{}, errors.New("invalid manifest path")
			}
		}
		if count > 32 {
			return nil, domain.Digest{}, errors.New("invalid manifest path")
		}
	}
	data, err := json.Marshal(struct {
		Schema        int                        `json:"schema_version"`
		Project       domain.ProjectID           `json:"project_id"`
		ID            string                     `json:"id"`
		Version       uint64                     `json:"version"`
		Format        specification.ObjectFormat `json:"object_format"`
		Configuration string                     `json:"configuration_id"`
		Refs          []string                   `json:"refs"`
		Paths         []string                   `json:"manifest_paths"`
		Approver      domain.ActorID             `json:"approved_by_actor"`
	}{1, b.ProjectID, b.ID, b.Version, b.ObjectFormat, v.ConfigurationID, refs, paths, v.ApprovedBy})
	return data, domain.HashBytes(data), err
}
func VerifyRepositoryBinding(v ApprovedRepository, canonical []byte) error {
	data, digest, err := CanonicalRepositoryBinding(v)
	if err != nil || digest != v.Binding.Digest || !bytes.Equal(data, canonical) {
		return domain.StorageCorruptionError{Reason: "repository binding canonical mismatch"}
	}
	return nil
}

func DecodeRepositoryBinding(data []byte, expected domain.Digest) (ApprovedRepository, error) {
	var dto struct {
		Schema        int                        `json:"schema_version"`
		Project       domain.ProjectID           `json:"project_id"`
		ID            string                     `json:"id"`
		Version       uint64                     `json:"version"`
		Format        specification.ObjectFormat `json:"object_format"`
		Configuration string                     `json:"configuration_id"`
		Refs          []string                   `json:"refs"`
		Paths         []string                   `json:"manifest_paths"`
		Approver      domain.ActorID             `json:"approved_by_actor"`
	}
	if len(data) > 1<<20 {
		return ApprovedRepository{}, domain.StorageCorruptionError{Reason: "binding capacity"}
	}
	if err := json.Unmarshal(data, &dto, json.RejectUnknownMembers(true)); err != nil {
		return ApprovedRepository{}, domain.StorageCorruptionError{Reason: "binding encoding"}
	}
	v := ApprovedRepository{Binding: specification.RepositoryBinding{ProjectID: dto.Project, ID: dto.ID, Version: dto.Version, ObjectFormat: dto.Format, Digest: expected}, ConfigurationID: dto.Configuration, Refs: dto.Refs, ManifestPaths: dto.Paths, ApprovedBy: dto.Approver}
	if dto.Schema != 1 {
		return ApprovedRepository{}, domain.StorageCorruptionError{Reason: "binding schema"}
	}
	return v, VerifyRepositoryBinding(v, data)
}
