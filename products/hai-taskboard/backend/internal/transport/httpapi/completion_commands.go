package httpapi

import (
	"context"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"net/http"
	"reflect"
	"strings"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type CandidateSubmissionService interface {
	SubmitCandidate(context.Context, domain.ActorID, command.SubmitCandidate) (command.Outcome, error)
}
type FixtureReviewService interface {
	PublishFixtureReview(context.Context, domain.ActorID, command.PublishFixtureReview) (command.Outcome, error)
}
type FixtureEvidenceService interface {
	PublishFixtureEvidence(context.Context, domain.ActorID, command.PublishFixtureEvidence) (command.Outcome, error)
}
type SubjectApprovalService interface {
	ApproveSubject(context.Context, domain.ActorID, command.ApproveSubject) (command.Outcome, error)
}
type QARequestService interface {
	RequestQA(context.Context, domain.ActorID, command.RequestQA) (command.Outcome, error)
}
type CancellationRequestService interface {
	RequestCancellation(context.Context, domain.ActorID, command.RequestCancellation) (command.Outcome, error)
}

type artifactCommandWire struct {
	SHA256       string `json:"sha256"`
	MediaType    string `json:"media_type"`
	ByteLength   uint64 `json:"byte_length"`
	Availability string `json:"availability"`
	Href         string `json:"href,omitempty"`
	Disposition  string `json:"disposition,omitempty"`
}

type candidateCommandWire struct {
	ID                 string                `json:"candidate_id"`
	RunID              string                `json:"run_id"`
	Digest             string                `json:"candidate_digest"`
	InputSubjectDigest string                `json:"input_subject_digest"`
	CreatedAt          string                `json:"created_at"`
	Artifacts          []artifactCommandWire `json:"artifact_manifest"`
}

type submitCandidateWire struct {
	WorkItemID string               `json:"work_item_id"`
	RunID      string               `json:"run_id"`
	Candidate  candidateCommandWire `json:"candidate"`
}

type reviewCommandWire struct {
	ID            string `json:"review_id"`
	SubjectDigest string `json:"completion_subject_digest"`
	ReviewerID    string `json:"reviewer_id"`
	ReviewerClass string `json:"reviewer_class"`
	Verdict       string `json:"verdict"`
	CreatedAt     string `json:"created_at"`
}

type publishReviewWire struct {
	RunID             string            `json:"run_id"`
	LeaseEpoch        uint64            `json:"lease_epoch"`
	RestoreGeneration uint64            `json:"restore_generation"`
	Review            reviewCommandWire `json:"review"`
}

type evidenceCommandWire struct {
	ID                   string              `json:"evidence_id"`
	SubjectDigest        string              `json:"completion_subject_digest"`
	ACID                 string              `json:"ac_id"`
	ACRevisionDigest     string              `json:"ac_revision_digest"`
	ObservationVerdict   string              `json:"observation_verdict"`
	ReviewDisposition    string              `json:"review_disposition"`
	Applicability        string              `json:"applicability"`
	MaterialAvailability string              `json:"material_availability"`
	VerifierID           string              `json:"verifier_id"`
	VerifierClass        string              `json:"verifier_class"`
	RecipeDigest         string              `json:"recipe_digest"`
	EnvironmentDigest    string              `json:"environment_digest"`
	ObservedAt           string              `json:"observed_at"`
	Report               artifactCommandWire `json:"report"`
}

type publishEvidenceWire struct {
	RunID             string              `json:"run_id"`
	LeaseEpoch        uint64              `json:"lease_epoch"`
	RestoreGeneration uint64              `json:"restore_generation"`
	Evidence          evidenceCommandWire `json:"evidence"`
}

type approveSubjectWire struct {
	WorkItemID    string `json:"work_item_id"`
	CandidateID   string `json:"candidate_id"`
	RequestID     string `json:"approval_request_id"`
	SubjectDigest string `json:"subject_digest"`
	Decision      string `json:"decision"`
}

type requestQAWire struct {
	WorkItemID    string `json:"work_item_id"`
	CandidateID   string `json:"candidate_id"`
	SubjectDigest string `json:"completion_subject_digest"`
}

type requestCancelWire struct {
	WorkItemID string `json:"work_item_id"`
	RunID      string `json:"run_id"`
	Reason     string `json:"reason"`
}

// Validate required presence independently of zero values. JSON v2 supplies exact
// member matching and rejects duplicates; this adds recursive non-null and bounds.
func strictCommandWire(data []byte, typ reflect.Type) error {
	if len(data) == 0 || string(data) == "null" {
		return command.ErrInvalidCommand
	}
	switch typ.Kind() {
	case reflect.Struct:
		var fields map[string]jsontext.Value
		if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
			return command.ErrInvalidCommand
		}
		allowed := make(map[string]bool, typ.NumField())
		for i := range typ.NumField() {
			f := typ.Field(i)
			name, options, _ := strings.Cut(f.Tag.Get("json"), ",")
			allowed[name] = true
			raw, ok := fields[name]
			if !ok {
				if options == "omitempty" {
					continue
				}
				return command.ErrInvalidCommand
			}
			if err := strictCommandWire(raw, f.Type); err != nil {
				return err
			}
			if f.Type.Kind() == reflect.String {
				var value string
				if json.Unmarshal(raw, &value) != nil {
					return command.ErrInvalidCommand
				}
				if (name == "href" || name == "disposition") && value == "" {
					return command.ErrInvalidCommand
				}
				if strings.HasSuffix(name, "_digest") || name == "sha256" {
					if _, err := DecodeSHA256(value); err != nil {
						return err
					}
				}
				if strings.HasSuffix(name, "_at") {
					if _, ok := parseTime(value); !ok {
						return command.ErrInvalidCommand
					}
				}
				if name == "ac_id" && !validInitialACID(value) {
					return command.ErrInvalidCommand
				}
			}
			if f.Type.Kind() == reflect.Uint64 {
				var value uint64
				if json.Unmarshal(raw, &value) != nil || value > 1<<63-1 || name != "byte_length" && value == 0 {
					return command.ErrInvalidCommand
				}
			}
		}
		for name := range fields {
			if !allowed[name] {
				return command.ErrInvalidCommand
			}
		}
	case reflect.Slice:
		var values []jsontext.Value
		if json.Unmarshal(data, &values) != nil || len(values) == 0 || len(values) > 1024 {
			return command.ErrInvalidCommand
		}
		for _, value := range values {
			if err := strictCommandWire(value, typ.Elem()); err != nil {
				return err
			}
		}
	}
	return nil
}
func decodeCompletionPayload(response http.ResponseWriter, data jsontext.Value, value any) bool {
	if strictCommandWire(data, reflect.TypeOf(value).Elem()) != nil {
		writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "command payload is invalid")
		return false
	}
	return decodePayload(response, data, value)
}
func (wire *completionSubjectWire) UnmarshalJSON(data []byte) error {
	type plain completionSubjectWire
	if err := strictCommandWire(data, reflect.TypeFor[plain]()); err != nil {
		return err
	}
	var value plain
	if err := json.Unmarshal(data, &value, json.RejectUnknownMembers(true)); err != nil {
		return err
	}
	*wire = completionSubjectWire(value)
	return nil
}

// These conversions are only called after strictCommandWire validated the wire.
func completionDigest(value string) domain.Digest { d, _ := DecodeSHA256(value); return d }
func completionTime(value string) time.Time       { t, _ := parseTime(value); return t }
func (w artifactCommandWire) commandValue() command.ArtifactLocator {
	return command.ArtifactLocator{Digest: completionDigest(w.SHA256), MediaType: w.MediaType, ByteLength: w.ByteLength, Availability: w.Availability, Href: w.Href, Disposition: w.Disposition}
}
func (server *Server) completionCommand(response http.ResponseWriter, request *http.Request, session Session, project domain.ProjectID, metadata command.Metadata, operation command.Operation, payload jsontext.Value) (command.Outcome, error, bool) {
	bad := func() (command.Outcome, error, bool) {
		writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "command payload is invalid")
		return command.Outcome{}, nil, false
	}
	unavailable := func() (command.Outcome, error, bool) {
		writeAPIError(response, http.StatusServiceUnavailable, command.CodeCapabilityUnsupported, "command capability is unavailable")
		return command.Outcome{}, nil, false
	}
	if metadata.ExpectedVersion == 0 || metadata.ExpectedVersion >= 1<<63-1 {
		return bad()
	}
	switch operation {
	case command.SubmitCandidateOperation:
		var w submitCandidateWire
		if !decodeCompletionPayload(response, payload, &w) {
			return command.Outcome{}, nil, false
		}
		c := w.Candidate
		v := command.SubmitCandidate{Metadata: metadata, ProjectID: project, WorkItemID: domain.WorkItemID(w.WorkItemID), RunID: domain.RunID(w.RunID), Candidate: command.Candidate{ID: domain.CandidateID(c.ID), RunID: domain.RunID(c.RunID), Digest: completionDigest(c.Digest), InputSubjectDigest: completionDigest(c.InputSubjectDigest), CreatedAt: completionTime(c.CreatedAt), Artifacts: make([]command.ArtifactLocator, len(c.Artifacts))}}
		for i, a := range c.Artifacts {
			v.Candidate.Artifacts[i] = a.commandValue()
		}
		if _, _, err := command.CanonicalSubmitCandidate(v); err != nil {
			return bad()
		}
		capability, ok := server.commands.(CandidateSubmissionService)
		if !ok {
			return unavailable()
		}
		out, err := capability.SubmitCandidate(request.Context(), session.Principal, v)
		return out, err, true
	case command.PublishReviewOperation:
		var w publishReviewWire
		if !decodeCompletionPayload(response, payload, &w) {
			return command.Outcome{}, nil, false
		}
		r := w.Review
		v := command.PublishFixtureReview{Metadata: metadata, ProjectID: project, RunID: domain.RunID(w.RunID), LeaseEpoch: w.LeaseEpoch, RestoreGeneration: w.RestoreGeneration, Review: command.Review{ID: domain.ReviewID(r.ID), SubjectDigest: completionDigest(r.SubjectDigest), ReviewerID: domain.ActorID(r.ReviewerID), ReviewerClass: r.ReviewerClass, Verdict: r.Verdict, CreatedAt: completionTime(r.CreatedAt)}}
		if _, _, err := command.CanonicalPublishFixtureReview(v); err != nil {
			return bad()
		}
		capability, ok := server.commands.(FixtureReviewService)
		if !ok {
			return unavailable()
		}
		out, err := capability.PublishFixtureReview(request.Context(), session.Principal, v)
		return out, err, true
	case command.PublishEvidenceOperation:
		var w publishEvidenceWire
		if !decodeCompletionPayload(response, payload, &w) {
			return command.Outcome{}, nil, false
		}
		e := w.Evidence
		v := command.PublishFixtureEvidence{Metadata: metadata, ProjectID: project, RunID: domain.RunID(w.RunID), LeaseEpoch: w.LeaseEpoch, RestoreGeneration: w.RestoreGeneration, Evidence: command.Evidence{ID: domain.EvidenceID(e.ID), SubjectDigest: completionDigest(e.SubjectDigest), ACID: domain.ACID(e.ACID), ACRevisionDigest: completionDigest(e.ACRevisionDigest), ObservationVerdict: e.ObservationVerdict, ReviewDisposition: e.ReviewDisposition, Applicability: e.Applicability, MaterialAvailability: e.MaterialAvailability, VerifierID: domain.ActorID(e.VerifierID), VerifierClass: e.VerifierClass, RecipeDigest: completionDigest(e.RecipeDigest), EnvironmentDigest: completionDigest(e.EnvironmentDigest), ObservedAt: completionTime(e.ObservedAt), Report: e.Report.commandValue()}}
		if _, _, err := command.CanonicalPublishFixtureEvidence(v); err != nil {
			return bad()
		}
		capability, ok := server.commands.(FixtureEvidenceService)
		if !ok {
			return unavailable()
		}
		out, err := capability.PublishFixtureEvidence(request.Context(), session.Principal, v)
		return out, err, true
	case command.ApproveSubjectOperation:
		var w approveSubjectWire
		if !decodeCompletionPayload(response, payload, &w) {
			return command.Outcome{}, nil, false
		}
		v := command.ApproveSubject{Metadata: metadata, ProjectID: project, WorkItemID: domain.WorkItemID(w.WorkItemID), CandidateID: domain.CandidateID(w.CandidateID), RequestID: w.RequestID, SubjectDigest: completionDigest(w.SubjectDigest), Decision: w.Decision}
		if _, _, err := command.CanonicalApproveSubject(v); err != nil {
			return bad()
		}
		capability, ok := server.commands.(SubjectApprovalService)
		if !ok {
			return unavailable()
		}
		out, err := capability.ApproveSubject(request.Context(), session.Principal, v)
		return out, err, true
	case command.RequestQAOperation:
		var w requestQAWire
		if !decodeCompletionPayload(response, payload, &w) {
			return command.Outcome{}, nil, false
		}
		v := command.RequestQA{Metadata: metadata, ProjectID: project, WorkItemID: domain.WorkItemID(w.WorkItemID), CandidateID: domain.CandidateID(w.CandidateID), SubjectDigest: completionDigest(w.SubjectDigest)}
		if _, _, err := command.CanonicalRequestQA(v); err != nil {
			return bad()
		}
		capability, ok := server.commands.(QARequestService)
		if !ok {
			return unavailable()
		}
		out, err := capability.RequestQA(request.Context(), session.Principal, v)
		return out, err, true
	case command.RequestCancelOperation:
		var w requestCancelWire
		if !decodeCompletionPayload(response, payload, &w) {
			return command.Outcome{}, nil, false
		}
		v := command.RequestCancellation{Metadata: metadata, ProjectID: project, WorkItemID: domain.WorkItemID(w.WorkItemID), RunID: domain.RunID(w.RunID), Reason: w.Reason}
		if _, _, err := command.CanonicalRequestCancellation(v); err != nil {
			return bad()
		}
		capability, ok := server.commands.(CancellationRequestService)
		if !ok {
			return unavailable()
		}
		out, err := capability.RequestCancellation(request.Context(), session.Principal, v)
		return out, err, true
	}
	return bad()
}
