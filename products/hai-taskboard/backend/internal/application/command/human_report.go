package command

import (
	"math"
	"strings"
	"unicode/utf8"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const SubmitHumanReportOperation Operation = "SubmitHumanReport"

type HumanReviewIntent struct {
	Verdict string `json:"verdict"`
}
type HumanEvidenceIntent struct {
	ACID              domain.ACID
	ACRevisionDigest  domain.Digest
	RecipeDigest      domain.Digest
	EnvironmentDigest domain.Digest
	Verdict           string
}
type SubmitHumanReport struct {
	Metadata
	ProjectID         domain.ProjectID
	WorkItemID        domain.WorkItemID
	RunID             domain.RunID
	ReportID          string
	SubjectDigest     domain.Digest
	LeaseEpoch        uint64
	RestoreGeneration uint64
	Kind              string
	MediaType         string
	Content           string
	Review            *HumanReviewIntent
	Evidence          *HumanEvidenceIntent
}
type canonicalHumanEvidence struct {
	ACID              domain.ACID `json:"ac_id"`
	ACRevisionDigest  string      `json:"ac_revision_digest"`
	RecipeDigest      string      `json:"recipe_digest"`
	EnvironmentDigest string      `json:"environment_digest"`
	Verdict           string      `json:"verdict"`
}
type canonicalHumanReport struct {
	canonicalMetadata
	WorkItemID        domain.WorkItemID       `json:"work_item_id"`
	RunID             domain.RunID            `json:"run_id"`
	ReportID          string                  `json:"report_id"`
	SubjectDigest     string                  `json:"completion_subject_digest"`
	LeaseEpoch        uint64                  `json:"lease_epoch"`
	RestoreGeneration uint64                  `json:"restore_generation"`
	Kind              string                  `json:"kind"`
	MediaType         string                  `json:"media_type"`
	Content           string                  `json:"content"`
	Review            *HumanReviewIntent      `json:"review,omitempty"`
	Evidence          *canonicalHumanEvidence `json:"evidence,omitempty"`
}

func CanonicalSubmitHumanReport(v SubmitHumanReport) ([]byte, domain.Digest, error) {
	metadata, err := canonicalizeMetadata(v.Metadata, SubmitHumanReportOperation, v.ProjectID)
	if err != nil || v.ExpectedVersion == 0 || v.ExpectedVersion >= math.MaxInt64 || !workItemIDPattern.MatchString(string(v.WorkItemID)) || !runIDPattern.MatchString(string(v.RunID)) || !port.ValidHumanReportID(v.ReportID) || v.SubjectDigest.IsZero() || v.LeaseEpoch == 0 || v.LeaseEpoch > math.MaxInt64 || v.RestoreGeneration == 0 || v.RestoreGeneration > math.MaxInt64 || !oneOf(v.MediaType, "text/plain", "text/markdown") || len(v.Content) == 0 || len(v.Content) > port.HumanReportByteLimit || !utf8.ValidString(v.Content) || strings.ContainsRune(v.Content, 0) {
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	c := canonicalHumanReport{canonicalMetadata: metadata, WorkItemID: v.WorkItemID, RunID: v.RunID, ReportID: v.ReportID, SubjectDigest: canonicalSHA256(v.SubjectDigest), LeaseEpoch: v.LeaseEpoch, RestoreGeneration: v.RestoreGeneration, Kind: v.Kind, MediaType: v.MediaType, Content: v.Content, Review: v.Review}
	switch v.Kind {
	case "review":
		if v.Review == nil || v.Evidence != nil || !oneOf(v.Review.Verdict, "Approved", "ChangesRequested") {
			return nil, domain.Digest{}, ErrInvalidCommand
		}
	case "evidence":
		e := v.Evidence
		if v.Review != nil || e == nil || !validText(string(e.ACID), 120) || strings.ContainsAny(string(e.ACID), "/\\") || e.ACRevisionDigest.IsZero() || e.RecipeDigest.IsZero() || e.EnvironmentDigest.IsZero() || e.Verdict != "Passing" {
			return nil, domain.Digest{}, ErrInvalidCommand
		}
		c.Evidence = &canonicalHumanEvidence{ACID: e.ACID, ACRevisionDigest: canonicalSHA256(e.ACRevisionDigest), RecipeDigest: canonicalSHA256(e.RecipeDigest), EnvironmentDigest: canonicalSHA256(e.EnvironmentDigest), Verdict: e.Verdict}
	default:
		return nil, domain.Digest{}, ErrInvalidCommand
	}
	return marshalCanonical(c)
}
