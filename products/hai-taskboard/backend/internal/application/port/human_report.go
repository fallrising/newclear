package port

import (
	"context"
	"math"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const HumanReportByteLimit = 65536

var humanReportIDPattern = regexp.MustCompile(`^report_[0-9A-HJKMNP-TV-Z]{10,26}$`)

func ValidHumanReportID(id string) bool { return humanReportIDPattern.MatchString(id) }

// HumanReport is immutable provenance, separate from its Review or Evidence.
type HumanReport struct {
	ProjectID         domain.ProjectID
	WorkItemID        domain.WorkItemID
	RunID             domain.RunID
	ID                string
	Kind              string
	SubjectDigest     domain.Digest
	Actor             domain.ActorID
	CreatedAtNS       int64
	LeaseEpoch        uint64
	RestoreGeneration uint64
	Artifact          Artifact
}

type HumanReportTransaction interface {
	Transaction
	StoreHumanReport(context.Context, HumanReport) error
	LoadHumanReport(context.Context, domain.ProjectID, string) (HumanReport, error)
	HumanReportIDExists(context.Context, domain.ProjectID, string) (bool, error)
	CountHumanReports(context.Context, domain.ProjectID, domain.Digest) (int, error)
}

func ValidHumanReport(r HumanReport) bool {
	a := r.Artifact
	return r.ProjectID != "" && len(r.ProjectID) <= 80 && r.WorkItemID != "" && len(r.WorkItemID) <= 80 && r.RunID != "" && len(r.RunID) <= 80 && ValidHumanReportID(r.ID) && (r.Kind == "review" || r.Kind == "evidence") && !r.SubjectDigest.IsZero() && r.Actor != "" && len(r.Actor) <= 120 && utf8.ValidString(string(r.Actor)) && !strings.ContainsRune(string(r.Actor), 0) && r.CreatedAtNS > 0 && r.LeaseEpoch > 0 && r.LeaseEpoch <= math.MaxInt64 && r.RestoreGeneration > 0 && r.RestoreGeneration <= math.MaxInt64 && !a.Digest.IsZero() && a.ByteLength > 0 && a.ByteLength <= HumanReportByteLimit && (a.MediaType == "text/plain" || a.MediaType == "text/markdown") && a.Availability == "Present" && a.StorageKey == "sha256:"+a.Digest.String()
}
