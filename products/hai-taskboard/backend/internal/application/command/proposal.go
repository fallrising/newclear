package command

import "github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"

const ProposeSpecificationOperation Operation = "ProposeSpecification"

type ProposeSpecification struct {
	Metadata
	ProjectID      domain.ProjectID
	BindingID      string
	BindingVersion uint64
	BindingDigest  domain.Digest
	Ref            string
	ManifestPath   string
}

func CanonicalProposeSpecification(v ProposeSpecification) ([]byte, domain.Digest, error) {
	m, err := canonicalizeMetadata(v.Metadata, ProposeSpecificationOperation, v.ProjectID)
	if err != nil || v.ExpectedVersion == 0 || v.BindingVersion == 0 || v.BindingDigest.IsZero() || !validText(v.BindingID, 120) || !validText(v.Ref, 512) || !validText(v.ManifestPath, 512) {
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	return marshalCanonical(struct {
		canonicalMetadata
		BindingID      string `json:"repository_binding_id"`
		BindingVersion uint64 `json:"binding_version"`
		BindingDigest  string `json:"binding_digest"`
		Ref            string `json:"ref"`
		ManifestPath   string `json:"manifest_path"`
	}{m, v.BindingID, v.BindingVersion, canonicalSHA256(v.BindingDigest), v.Ref, v.ManifestPath})
}
