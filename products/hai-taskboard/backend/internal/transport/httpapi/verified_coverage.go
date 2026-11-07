package httpapi

import (
	"context"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// VerifiedCoverageService is optional; absence cannot be mistaken for empty coverage.
type VerifiedCoverageService interface {
	DescribeVerifiedCoverage(context.Context, domain.ActorID, domain.ProjectID, domain.WorkItemID, domain.CandidateID) ([]byte, error)
}
type verifiedCoverageWire struct {
	SchemaVersion     int                         `json:"schema_version"`
	ObservationOnly   bool                        `json:"observation_only"`
	ObservedAt        string                      `json:"observed_at"`
	ExpectedVersion   uint64                      `json:"expected_version"`
	Phase             string                      `json:"phase"`
	SubjectMode       string                      `json:"subject_mode"`
	Subject           completionSubjectWire       `json:"completion_subject"`
	Digest            string                      `json:"completion_subject_digest"`
	LeaseEpoch        uint64                      `json:"lease_epoch"`
	RestoreGeneration uint64                      `json:"restore_generation"`
	Cursor            coverageCursorWire          `json:"cursor"`
	ApprovalRequired  bool                        `json:"approval_required"`
	Rules             []completionPreparationRule `json:"verification_rules"`
	Coverage          []verifiedACWire            `json:"coverage"`
	Eligibility       coverageEligibilityWire     `json:"completion_eligibility"`
}
type coverageCursorWire struct {
	Epoch    int64 `json:"stream_epoch"`
	Sequence int64 `json:"event_sequence"`
}
type verifiedACWire struct {
	ACID     string   `json:"ac_id"`
	Revision string   `json:"ac_revision_digest"`
	Covered  bool     `json:"covered"`
	IDs      []string `json:"matching_evidence_ids"`
	Reasons  []string `json:"reasons"`
}
type coverageEligibilityWire struct {
	Evaluated bool     `json:"evaluated"`
	Satisfied bool     `json:"satisfied"`
	Reasons   []string `json:"reasons"`
}

func (server *Server) getVerifiedCoverage(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" || r.URL.ForceQuery || r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
		writeAPIError(w, 400, command.CodeInvalidRequest, "coverage read accepts no query or body")
		return
	}
	session, ok := server.authenticate(w, r)
	if !ok {
		return
	}
	project, ok := pathProject(w, r)
	if !ok || !server.authorizeProject(w, r, session, project) {
		return
	}
	item, candidate := r.PathValue("work_item_id"), r.PathValue("candidate_id")
	if !workPattern.MatchString(item) || !validPreparationCandidate(candidate) {
		writeAPIError(w, 404, command.CodeNotFound, "resource is unavailable")
		return
	}
	reader, ok := server.commands.(VerifiedCoverageService)
	if !ok {
		writeAPIError(w, 503, command.CodeProjectionUnavailable, "verified coverage is unavailable")
		return
	}
	data, err := reader.DescribeVerifiedCoverage(r.Context(), session.Principal, project, domain.WorkItemID(item), domain.CandidateID(candidate))
	if err != nil {
		writeCompletionReadError(w, err, "verified coverage")
		return
	}
	if !validVerifiedCoverage(data, project, domain.WorkItemID(item), domain.CandidateID(candidate)) {
		writeAPIError(w, 503, command.CodeStorageCorruption, "verified coverage is invalid")
		return
	}
	writeJSONBytes(w, 200, data)
}

// Closed coverage shapes require presence even for false booleans and empty
// arrays. Preparation/command arrays remain nonempty under their own validator.
func coverageWireShape(data []byte, typ reflect.Type) bool {
	if len(data) == 0 || string(data) == "null" {
		return false
	}
	switch typ.Kind() {
	case reflect.Struct:
		var fields map[string]jsontext.Value
		if json.Unmarshal(data, &fields) != nil || fields == nil {
			return false
		}
		for i := range typ.NumField() {
			field := typ.Field(i)
			name, options, _ := strings.Cut(field.Tag.Get("json"), ",")
			raw, exists := fields[name]
			if !exists {
				if options == "omitempty" {
					continue
				}
				return false
			}
			if !coverageWireShape(raw, field.Type) {
				return false
			}
			delete(fields, name)
		}
		return len(fields) == 0
	case reflect.Slice:
		var values []jsontext.Value
		if json.Unmarshal(data, &values) != nil || values == nil || len(values) > 1024 {
			return false
		}
		for _, v := range values {
			if !coverageWireShape(v, typ.Elem()) {
				return false
			}
		}
	}
	return true
}

var coverageReasonOrder = []string{"evidence_missing", "evidence_unavailable", "evidence_stale", "evidence_nonpassing", "verifier_not_independent"}
var eligibilityReasonCodes = []string{"phase_not_qa", "active_blocker", "active_or_unknown_run", "candidate_unavailable", "review_missing", "review_rejected", "evidence_missing", "evidence_unavailable", "evidence_stale", "evidence_nonpassing", "verifier_not_independent", "approval_missing", "approval_expired"}

func validVerifiedCoverage(data []byte, project domain.ProjectID, item domain.WorkItemID, candidate domain.CandidateID) bool {
	if len(data) == 0 || len(data) > 1<<20 || !coverageWireShape(data, reflect.TypeFor[verifiedCoverageWire]()) {
		return false
	}
	var w verifiedCoverageWire
	if json.Unmarshal(data, &w, json.RejectUnknownMembers(true)) != nil {
		return false
	}
	if w.SchemaVersion != 1 || !w.ObservationOnly || w.Cursor.Epoch < 1 || w.Cursor.Sequence < 0 {
		return false
	}
	if _, ok := parseTime(w.ObservedAt); !ok {
		return false
	}
	if len(w.Coverage) == 0 || len(w.Coverage) > 256 || len(w.Coverage) != len(w.Rules) || len(w.Coverage) != len(w.Subject.RequiredACRevisions) {
		return false
	}
	preparation := completionPreparationWire{ExpectedVersion: w.ExpectedVersion, Phase: w.Phase, Subject: w.Subject, Digest: w.Digest, LeaseEpoch: w.LeaseEpoch, RestoreGeneration: w.RestoreGeneration, ApprovalRequired: w.ApprovalRequired, Rules: w.Rules}
	raw, err := json.Marshal(preparation)
	if err != nil || !validCompletionPreparationMode(raw, project, item, candidate, true) {
		return false
	}
	e := w.Eligibility
	if w.Phase == "Review" {
		if w.SubjectMode != "prospective_qa" || e.Evaluated || e.Satisfied || !slices.Equal(e.Reasons, []string{"phase_not_qa"}) {
			return false
		}
	} else if w.SubjectMode != "current_qa" || !e.Evaluated || e.Satisfied != (len(e.Reasons) == 0) || slices.Contains(e.Reasons, "phase_not_qa") {
		return false
	}
	eligibility := map[string]bool{}
	for _, reason := range e.Reasons {
		if eligibility[reason] || !slices.Contains(eligibilityReasonCodes, reason) {
			return false
		}
		eligibility[reason] = true
	}
	ids := map[string]bool{}
	acReasons := map[string]bool{}
	for i, ac := range w.Coverage {
		requirement := w.Subject.RequiredACRevisions[i]
		if ac.ACID != requirement.ACID || ac.Revision != requirement.RevisionDigest || ac.Covered != (len(ac.Reasons) == 0) {
			return false
		}
		if len(ac.IDs) == 0 {
			if !slices.Equal(ac.Reasons, []string{"evidence_missing"}) {
				return false
			}
		} else if slices.Contains(ac.Reasons, "evidence_missing") {
			return false
		}
		for j, id := range ac.IDs {
			if id == "" || len(id) > 120 || !utf8.ValidString(id) || strings.ContainsFunc(id, unicode.IsControl) || j > 0 && ac.IDs[j-1] >= id || ids[id] {
				return false
			}
			ids[id] = true
		}
		previous := -1
		for _, reason := range ac.Reasons {
			index := slices.Index(coverageReasonOrder, reason)
			if index < 0 || index <= previous {
				return false
			}
			previous = index
			acReasons[reason] = true
			if w.Phase == "QA" && !eligibility[reason] {
				return false
			}
		}
		if w.Phase == "QA" && e.Satisfied && !ac.Covered {
			return false
		}
	}
	if len(ids) > 1024 {
		return false
	}
	if w.Phase == "QA" {
		for _, reason := range coverageReasonOrder[:4] {
			if eligibility[reason] && !acReasons[reason] {
				return false
			}
		}
		if !w.ApprovalRequired && (eligibility["approval_missing"] || eligibility["approval_expired"]) {
			return false
		}
	}
	return true
}
