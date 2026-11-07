package httpapi

import (
	"context"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"errors"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// WorkItemDetailSource is an optional projection capability. Absence is unavailable,
// never a successful empty history. It grants no command or completion authority.
type WorkItemDetailSource interface {
	DescribeWorkItemDetail(context.Context, domain.ProjectID, domain.WorkItemID) ([]byte, error)
}

type workItemDetailWire struct {
	APIVersion        string                 `json:"api_version"`
	Kind              string                 `json:"kind"`
	ObservationOnly   bool                   `json:"observation_only"`
	Summary           persistedItem          `json:"summary"`
	Material          materialIndexWire      `json:"material"`
	Blockers          []detailBlockerWire    `json:"blockers"`
	Reviews           []detailReviewWire     `json:"reviews"`
	Evidence          []detailEvidenceWire   `json:"evidence"`
	Approvals         []detailApprovalWire   `json:"approvals"`
	CompletionRecords []detailCompletionWire `json:"completion_records"`
	Audit             []detailAuditEntryWire `json:"audit"`
}
type detailBlockerWire struct {
	ID         string  `json:"blocker_id"`
	Reason     string  `json:"reason"`
	ResolvedAt *string `json:"resolved_at"`
}
type detailReviewWire struct {
	ID            string  `json:"review_id"`
	Subject       string  `json:"completion_subject_digest"`
	ReviewerID    string  `json:"reviewer_id"`
	Independent   bool    `json:"independent"`
	Verdict       string  `json:"verdict"`
	CreatedAt     string  `json:"created_at"`
	HumanReportID *string `json:"human_report_id"`
}
type detailEvidenceWire struct {
	ID            string  `json:"evidence_id"`
	Subject       string  `json:"completion_subject_digest"`
	ACID          string  `json:"ac_id"`
	ACRevision    string  `json:"ac_revision_digest"`
	Verdict       string  `json:"verdict"`
	Applicability string  `json:"applicability"`
	Availability  string  `json:"availability"`
	VerifierClass string  `json:"verifier_class"`
	VerifierActor string  `json:"verifier_actor"`
	VerifierRole  string  `json:"verifier_role"`
	Recipe        string  `json:"recipe_digest"`
	Environment   string  `json:"environment_digest"`
	Report        *string `json:"report_artifact_digest"`
	HumanReportID *string `json:"human_report_id"`
}
type detailApprovalWire struct {
	ID                 string  `json:"approval_id"`
	Subject            string  `json:"subject_digest"`
	Decision           string  `json:"decision"`
	ActorID            string  `json:"actor_id"`
	ExpiresAt          string  `json:"expires_at"`
	ConsumedAt         *string `json:"consumed_at"`
	CompletionRecordID *string `json:"completion_record_id"`
}
type detailCompletionWire struct {
	ID            string   `json:"completion_record_id"`
	Subject       string   `json:"completion_subject_digest"`
	ResultVersion uint64   `json:"result_work_item_version"`
	CompletedBy   string   `json:"completed_by"`
	CompletedAt   string   `json:"completed_at"`
	EvidenceIDs   []string `json:"evidence_ids"`
	ReviewIDs     []string `json:"review_ids"`
	ApprovalIDs   []string `json:"approval_ids"`
}
type detailAuditEntryWire struct {
	Sequence   uint64  `json:"sequence"`
	GroupID    string  `json:"group_id"`
	CommandID  string  `json:"command_id"`
	ActorID    string  `json:"actor_id"`
	Operation  string  `json:"operation"`
	Subject    string  `json:"subject_digest"`
	Before     *string `json:"before_digest"`
	After      *string `json:"after_digest"`
	OccurredAt string  `json:"occurred_at"`
	RunID      *string `json:"run_id"`
}

func (server *Server) interceptWorkItemDetailRead(w http.ResponseWriter, r *http.Request) bool {
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) != 7 || parts[1] != "api" || parts[2] != "v1" || parts[3] != "projects" || parts[5] != "work-items" {
		return false
	}
	r.SetPathValue("project_id", parts[4])
	r.SetPathValue("work_item_id", parts[6])
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeAPIError(w, 405, command.CodeInvalidRequest, "work item detail accepts only GET")
		return true
	}
	server.serveWorkItemObservation(w, r, "work item detail", writeWorkItemDetailError, func(ctx context.Context, project domain.ProjectID, item domain.WorkItemID) ([]byte, error) {
		source, ok := server.projections.(WorkItemDetailSource)
		if !ok {
			return nil, errors.New("missing work item detail capability")
		}
		data, err := source.DescribeWorkItemDetail(ctx, project, item)
		if err == nil {
			err = validateWorkItemDetailWire(data, project, item)
		}
		return data, err
	})
	return true
}

func writeWorkItemDetailError(w http.ResponseWriter, err error) {
	if errors.Is(err, port.ErrWorkItemDetailCapacity) || errors.Is(err, port.ErrMaterialIndexCapacity) {
		value := materialIndexCapacityEnvelope{APIVersion: "v1", CorrelationID: "request"}
		value.Error.Code = command.CodeProjectionUnavailable
		value.Error.Message = "work item detail capacity exceeded"
		value.Error.Details.Reason = "work_item_detail_capacity_exceeded"
		data, _ := json.Marshal(value)
		writeJSONBytes(w, 503, data)
		return
	}
	if errors.Is(err, port.ErrNotFound) || errors.Is(err, ErrProjectionNotFound) {
		writeAPIError(w, 404, command.CodeNotFound, "resource is unavailable")
		return
	}
	if errors.Is(err, domain.ErrStorageCorruption) || errors.Is(err, ErrProjectionCorrupt) {
		writeAPIError(w, 503, command.CodeStorageCorruption, "work item detail is invalid")
		return
	}
	writeAPIError(w, 503, command.CodeProjectionUnavailable, "work item detail is unavailable")
}

func detailTime(ns int64) string { return time.Unix(0, ns).UTC().Format(time.RFC3339Nano) }
func detailDigestWire(d domain.Digest) string {
	return "sha256:" + d.String()
}
func detailOptionalTime(ns *int64) *string {
	if ns == nil {
		return nil
	}
	v := detailTime(*ns)
	return &v
}
func detailOptionalDigest(d *domain.Digest) *string {
	if d == nil {
		return nil
	}
	v := detailDigestWire(*d)
	return &v
}
func detailOptionalText(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// DescribeWorkItemDetail adapts the optional read port. The canonical result
// decoder is application-owned and passed to storage for audit attribution.
func (source PersistedProjections) DescribeWorkItemDetail(ctx context.Context, project domain.ProjectID, item domain.WorkItemID) ([]byte, error) {
	reader, ok := source.Store.(port.WorkItemDetailReader)
	if !ok {
		return nil, errors.New("missing work item detail reader")
	}
	value, err := reader.ReadWorkItemDetail(ctx, project, item, command.DecodeResultOwner)
	if err != nil {
		return nil, err
	}
	wire := workItemDetailWire{APIVersion: "v1", Kind: "work_item_detail/v1", ObservationOnly: true, Blockers: []detailBlockerWire{}, Reviews: []detailReviewWire{}, Evidence: []detailEvidenceWire{}, Approvals: []detailApprovalWire{}, CompletionRecords: []detailCompletionWire{}, Audit: []detailAuditEntryWire{}}
	if wire.Summary, _, err = persistedSummary(value.Summary, project); err != nil {
		return nil, err
	}
	if wire.Material, err = materialIndexWireOf(value.Material); err != nil {
		return nil, err
	}
	for _, b := range value.Blockers {
		wire.Blockers = append(wire.Blockers, detailBlockerWire{ID: b.ID, Reason: b.Reason, ResolvedAt: detailOptionalTime(b.ResolvedAtNS)})
	}
	for _, r := range value.Reviews {
		wire.Reviews = append(wire.Reviews, detailReviewWire{ID: r.ID, Subject: detailDigestWire(r.SubjectDigest), ReviewerID: r.ReviewerID, Independent: r.Independent, Verdict: r.Verdict, CreatedAt: detailTime(r.CreatedAtNS), HumanReportID: detailOptionalText(r.HumanReportID)})
	}
	for _, e := range value.Evidence {
		wire.Evidence = append(wire.Evidence, detailEvidenceWire{ID: e.ID, Subject: detailDigestWire(e.SubjectDigest), ACID: e.ACID, ACRevision: detailDigestWire(e.ACRevisionDigest), Verdict: e.Verdict, Applicability: e.Applicability, Availability: e.Availability, VerifierClass: e.VerifierClass, VerifierActor: e.VerifierActor, VerifierRole: e.VerifierRole, Recipe: detailDigestWire(e.RecipeDigest), Environment: detailDigestWire(e.EnvironmentDigest), Report: detailOptionalDigest(e.ReportArtifactDigest), HumanReportID: detailOptionalText(e.HumanReportID)})
	}
	for _, a := range value.Approvals {
		wire.Approvals = append(wire.Approvals, detailApprovalWire{ID: a.ID, Subject: detailDigestWire(a.SubjectDigest), Decision: "Approved", ActorID: a.ActorID, ExpiresAt: detailTime(a.ExpiresAtNS), ConsumedAt: detailOptionalTime(a.ConsumedAtNS), CompletionRecordID: detailOptionalText(a.CompletionRecordID)})
	}
	for _, c := range value.CompletionRecords {
		wire.CompletionRecords = append(wire.CompletionRecords, detailCompletionWire{ID: c.ID, Subject: detailDigestWire(c.SubjectDigest), ResultVersion: c.ResultVersion, CompletedBy: c.CompletedBy, CompletedAt: detailTime(c.CompletedAtNS), EvidenceIDs: c.EvidenceIDs, ReviewIDs: c.ReviewIDs, ApprovalIDs: c.ApprovalIDs})
	}
	for _, a := range value.Audit {
		wire.Audit = append(wire.Audit, detailAuditEntryWire{Sequence: a.Sequence, GroupID: a.GroupID, CommandID: a.CommandID, ActorID: a.ActorID, Operation: a.Operation, Subject: detailDigestWire(a.SubjectDigest), Before: detailOptionalDigest(a.BeforeDigest), After: detailOptionalDigest(a.AfterDigest), OccurredAt: detailTime(a.OccurredAtNS), RunID: detailOptionalText(string(a.RunID))})
	}
	data, err := json.Marshal(wire)
	if err != nil {
		return nil, ErrProjectionCorrupt
	}
	if err = validateWorkItemDetailWire(data, project, item); err != nil {
		return nil, err
	}
	return data, nil
}

func detailOptionalValid(value *string, valid func(string) bool) bool {
	return value == nil || valid(*value)
}
func detailTimeValid(s string) bool { _, ok := materialIndexTime(s); return ok }
func detailID(max int) func(string) bool {
	return func(s string) bool { return materialIndexText(s, max) }
}
func detailIDs(ids []string, minimum int) bool {
	if ids == nil || len(ids) < minimum || len(ids) > port.MaterialIndexRowLimit {
		return false
	}
	for i, id := range ids {
		if !materialIndexText(id, 80) || i > 0 && ids[i-1] >= id {
			return false
		}
	}
	return true
}

// validateWorkItemDetailWire enforces the closed work_item_detail/v1 shape on
// both encode and serve, mirroring the material-index wire validation.
func validateWorkItemDetailWire(data []byte, project domain.ProjectID, item domain.WorkItemID) error {
	if len(data) > port.MaterialIndexWireLimit {
		return port.ErrWorkItemDetailCapacity
	}
	var fields map[string]jsontext.Value
	if json.Unmarshal(data, &fields) != nil || len(fields) != reflect.TypeFor[workItemDetailWire]().NumField() {
		return ErrProjectionCorrupt
	}
	if err := validateMaterialIndexWire(fields["material"], project, item); err != nil {
		return err
	}
	for name, typ := range map[string]reflect.Type{"blockers": reflect.TypeFor[[]detailBlockerWire](), "reviews": reflect.TypeFor[[]detailReviewWire](), "evidence": reflect.TypeFor[[]detailEvidenceWire](), "approvals": reflect.TypeFor[[]detailApprovalWire](), "completion_records": reflect.TypeFor[[]detailCompletionWire](), "audit": reflect.TypeFor[[]detailAuditEntryWire]()} {
		if err := materialIndexShape(fields[name], typ); errors.Is(err, port.ErrMaterialIndexCapacity) {
			return port.ErrWorkItemDetailCapacity
		} else if err != nil {
			return err
		}
	}
	var w workItemDetailWire
	if json.Unmarshal(data, &w, json.RejectUnknownMembers(true)) != nil || w.APIVersion != "v1" || w.Kind != "work_item_detail/v1" || !w.ObservationOnly {
		return ErrProjectionCorrupt
	}
	s := w.Summary
	if s.ID != item || !workPattern.MatchString(string(s.ID)) || s.Phase != domain.Phase(w.Material.Phase) || s.Version != w.Material.Version || s.Title != w.Material.Title || s.Conditions == nil || s.EffectiveSatisfied || s.CoveredACCount != 0 {
		return ErrProjectionCorrupt
	}
	for i, b := range w.Blockers {
		if !materialIndexText(b.ID, 80) || !materialIndexText(b.Reason, 2000) || !detailOptionalValid(b.ResolvedAt, detailTimeValid) || i > 0 && w.Blockers[i-1].ID >= b.ID {
			return ErrProjectionCorrupt
		}
	}
	for i, r := range w.Reviews {
		if !materialIndexText(r.ID, 80) || !materialIndexDigest(r.Subject) || !materialIndexText(r.ReviewerID, 120) || !slices.Contains([]string{"Approved", "Rejected"}, r.Verdict) || !detailTimeValid(r.CreatedAt) || !detailOptionalValid(r.HumanReportID, port.ValidHumanReportID) {
			return ErrProjectionCorrupt
		}
		if i > 0 {
			previous, _ := materialIndexTime(w.Reviews[i-1].CreatedAt)
			current, _ := materialIndexTime(r.CreatedAt)
			if previous > current || previous == current && w.Reviews[i-1].ID >= r.ID {
				return ErrProjectionCorrupt
			}
		}
	}
	for i, e := range w.Evidence {
		if !materialIndexText(e.ID, 80) || !materialIndexDigest(e.Subject) || !materialIndexText(e.ACID, 120) || !materialIndexDigest(e.ACRevision) || !materialIndexDigest(e.Recipe) || !materialIndexDigest(e.Environment) || !detailOptionalValid(e.Report, materialIndexDigest) || !detailOptionalValid(e.HumanReportID, port.ValidHumanReportID) ||
			!materialIndexText(e.VerifierClass, 120) || !materialIndexText(e.VerifierActor, 120) || !materialIndexText(e.VerifierRole, 120) ||
			!slices.Contains([]string{"Passed", "Failed", "Skipped", "NotRun", "Unknown", "Error", "Inconclusive"}, e.Verdict) || !slices.Contains([]string{"Current", "Stale", "Superseded"}, e.Applicability) || !slices.Contains([]string{"Present", "Unavailable"}, e.Availability) || i > 0 && w.Evidence[i-1].ID >= e.ID {
			return ErrProjectionCorrupt
		}
	}
	for i, a := range w.Approvals {
		if !materialIndexText(a.ID, 80) || !materialIndexDigest(a.Subject) || a.Decision != "Approved" || !materialIndexText(a.ActorID, 120) || !detailTimeValid(a.ExpiresAt) || (a.ConsumedAt == nil) != (a.CompletionRecordID == nil) || !detailOptionalValid(a.ConsumedAt, detailTimeValid) || !detailOptionalValid(a.CompletionRecordID, detailID(80)) || i > 0 && w.Approvals[i-1].ID >= a.ID {
			return ErrProjectionCorrupt
		}
	}
	for i, c := range w.CompletionRecords {
		if i > 0 {
			previous, _ := materialIndexTime(w.CompletionRecords[i-1].CompletedAt)
			current, _ := materialIndexTime(c.CompletedAt)
			if previous > current || previous == current && w.CompletionRecords[i-1].ID >= c.ID {
				return ErrProjectionCorrupt
			}
		}
		if !materialIndexText(c.ID, 80) || !materialIndexDigest(c.Subject) || !materialIndexVersion(c.ResultVersion) || !materialIndexText(c.CompletedBy, 120) || !detailTimeValid(c.CompletedAt) || !detailIDs(c.EvidenceIDs, 1) || !detailIDs(c.ReviewIDs, 1) || !detailIDs(c.ApprovalIDs, 0) {
			return ErrProjectionCorrupt
		}
	}
	for i, a := range w.Audit {
		if !materialIndexVersion(a.Sequence) || !materialIndexText(a.GroupID, 80) || !materialIndexText(a.CommandID, 80) || !materialIndexText(a.ActorID, 120) || !materialIndexText(a.Operation, 120) || !materialIndexDigest(a.Subject) || !detailOptionalValid(a.Before, materialIndexDigest) || !detailOptionalValid(a.After, materialIndexDigest) || !detailTimeValid(a.OccurredAt) || !detailOptionalValid(a.RunID, runPattern.MatchString) || i > 0 && w.Audit[i-1].Sequence >= a.Sequence {
			return ErrProjectionCorrupt
		}
	}
	return nil
}
