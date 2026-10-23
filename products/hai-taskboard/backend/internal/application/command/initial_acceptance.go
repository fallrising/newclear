package command

import (
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"slices"
)

const AcceptInitialSpecificationOperation Operation = "AcceptInitialSpecification"

type InitialACContent struct {
	ACID    domain.ACID `json:"ac_id"`
	Content []byte      `json:"content"`
}
type AcceptInitialSpecification struct {
	Metadata
	ProjectID               domain.ProjectID
	ProposalDigest          domain.Digest
	PolicyRevisionDigest    domain.Digest
	AcceptanceSubjectDigest domain.Digest
	WorkItems               []port.InitialWorkItemVersion
	ACContents              []InitialACContent
}

func CanonicalAcceptInitialSpecification(v AcceptInitialSpecification) ([]byte, domain.Digest, error) {
	m, e := canonicalizeMetadata(v.Metadata, AcceptInitialSpecificationOperation, v.ProjectID)
	if e != nil || v.ExpectedVersion == 0 || v.ExpectedVersion >= 1<<63-1 || v.ProposalDigest.IsZero() || v.PolicyRevisionDigest.IsZero() || v.AcceptanceSubjectDigest.IsZero() || len(v.WorkItems) == 0 || len(v.WorkItems) > 256 || len(v.ACContents) == 0 || len(v.ACContents) > 256 {
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	items := slices.Clone(v.WorkItems)
	slices.SortFunc(items, func(a, b port.InitialWorkItemVersion) int {
		if a.WorkItemID < b.WorkItemID {
			return -1
		}
		if a.WorkItemID > b.WorkItemID {
			return 1
		}
		return 0
	})
	for i, w := range items {
		if !workItemIDPattern.MatchString(string(w.WorkItemID)) || w.ExpectedVersion == 0 || w.ExpectedVersion >= 1<<63-1 || (i > 0 && items[i-1].WorkItemID == w.WorkItemID) {
			return nil, domain.Digest{}, ErrInvalidCommand
		}
	}
	acs := slices.Clone(v.ACContents)
	slices.SortFunc(acs, func(a, b InitialACContent) int {
		if a.ACID < b.ACID {
			return -1
		}
		if a.ACID > b.ACID {
			return 1
		}
		return 0
	})
	total := 0
	for i, a := range acs {
		total += len(a.Content)
		if !validText(string(a.ACID), 120) || len(a.Content) > 64<<10 || total > 512<<10 || (i > 0 && acs[i-1].ACID == a.ACID) {
			return nil, domain.Digest{}, ErrInvalidCommand
		}
	}
	return marshalCanonical(struct {
		canonicalMetadata
		Proposal   string                        `json:"proposal_digest"`
		Policy     string                        `json:"policy_revision_digest"`
		Subject    string                        `json:"acceptance_subject_digest"`
		WorkItems  []port.InitialWorkItemVersion `json:"work_items"`
		ACContents []InitialACContent            `json:"ac_contents"`
	}{m, canonicalSHA256(v.ProposalDigest), canonicalSHA256(v.PolicyRevisionDigest), canonicalSHA256(v.AcceptanceSubjectDigest), items, acs})
}
