package httpapi

import (
	"context"
	json "encoding/json/v2"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type CompletionPreparationService interface {
	DescribeCompletion(context.Context, domain.ActorID, domain.ProjectID, domain.WorkItemID, domain.CandidateID) ([]byte, error)
}
type completionPreparationWire struct {
	ExpectedVersion   uint64                      `json:"expected_version"`
	Phase             string                      `json:"phase"`
	Subject           completionSubjectWire       `json:"completion_subject"`
	Digest            string                      `json:"completion_subject_digest"`
	LeaseEpoch        uint64                      `json:"lease_epoch"`
	RestoreGeneration uint64                      `json:"restore_generation"`
	ApprovalRequired  bool                        `json:"approval_required"`
	Rules             []completionPreparationRule `json:"verification_rules"`
}
type completionPreparationRule struct {
	ACID            string `json:"ac_id"`
	VerifierClass   string `json:"verifier_class"`
	Independent     bool   `json:"independent"`
	ProhibitedActor string `json:"prohibited_verifier_actor"`
	ProhibitedRole  string `json:"prohibited_verifier_run_role"`
	Environment     string `json:"environment_digest"`
}

func validPreparationCandidate(id string) bool {
	if len(id) == 0 || len(id) > 80 || id == "." || id == ".." {
		return false
	}
	for _, r := range id {
		if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || strings.ContainsRune("._-", r)) {
			return false
		}
	}
	return true
}
func (server *Server) getCompletionPreparation(w http.ResponseWriter, r *http.Request) {
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
	reader, ok := server.commands.(CompletionPreparationService)
	if !ok {
		writeAPIError(w, 503, command.CodeProjectionUnavailable, "completion preparation is unavailable")
		return
	}
	data, err := reader.DescribeCompletion(r.Context(), session.Principal, project, domain.WorkItemID(item), domain.CandidateID(candidate))
	if err != nil {
		writePreparationError(w, err)
		return
	}
	if !validCompletionPreparation(data, project, domain.WorkItemID(item), domain.CandidateID(candidate)) {
		writeAPIError(w, 503, command.CodeStorageCorruption, "completion preparation is invalid")
		return
	}
	writeJSONBytes(w, 200, data)
}

type preparationPolicyDetails struct {
	Reason string `json:"reason"`
}
type preparationPolicyError struct {
	Code      string                   `json:"code"`
	Message   string                   `json:"message"`
	Retryable bool                     `json:"retryable"`
	Details   preparationPolicyDetails `json:"details"`
}
type preparationPolicyEnvelope struct {
	APIVersion    string                 `json:"api_version"`
	OK            bool                   `json:"ok"`
	Error         preparationPolicyError `json:"error"`
	CorrelationID string                 `json:"correlation_id"`
}

func writePreparationError(w http.ResponseWriter, err error) {
	code, message, status := command.CodeProjectionUnavailable, "completion preparation is unavailable", http.StatusServiceUnavailable
	if errors.Is(err, domain.ErrStorageCorruption) {
		code, message = command.CodeStorageCorruption, "completion preparation is invalid"
	} else if e, ok := errors.AsType[*command.Error](err); ok {
		// A known application classification wins over its internal dependency cause.
		switch e.Code {
		case command.CodeStaleSubject:
			code, message, status = e.Code, "completion subject is stale", http.StatusConflict
		case command.CodeLifecycleRejected:
			code, message, status = e.Code, "completion preparation is not available in this lifecycle", http.StatusUnprocessableEntity
		case command.CodeNotFound:
			code, message, status = e.Code, "resource is unavailable", http.StatusNotFound
		case command.CodeStorageCorruption:
			code, message = e.Code, "completion preparation is invalid"
		case command.CodePolicyRejected:
			data, _ := json.Marshal(preparationPolicyEnvelope{APIVersion: "v1", Error: preparationPolicyError{Code: e.Code, Message: "verification policy is incomplete", Details: preparationPolicyDetails{Reason: "verification_policy_incomplete"}}, CorrelationID: "request"})
			writeJSONBytes(w, http.StatusConflict, data)
			return
		}
	} else if errors.Is(err, port.ErrNotFound) {
		code, message, status = command.CodeNotFound, "resource is unavailable", http.StatusNotFound
	} else if errors.Is(err, port.ErrRunLifecycle) {
		code, message, status = command.CodeLifecycleRejected, "completion preparation is not available in this lifecycle", http.StatusUnprocessableEntity
	}
	writeAPIError(w, status, code, message)
}
func validCompletionPreparation(data []byte, project domain.ProjectID, item domain.WorkItemID, candidate domain.CandidateID) bool {
	if len(data) == 0 || len(data) > 1<<20 || strictCommandWire(data, reflect.TypeFor[completionPreparationWire]()) != nil {
		return false
	}
	var w completionPreparationWire
	if json.Unmarshal(data, &w, json.RejectUnknownMembers(true)) != nil {
		return false
	}
	s := w.Subject
	if s.ProjectID != string(project) || s.WorkItemID != string(item) || s.CandidateID != string(candidate) || !runPattern.MatchString(s.RunID) || !validPreparationCandidate(s.CandidateID) {
		return false
	}
	if w.ExpectedVersion >= 1<<63-1 || s.WorkItemVersion >= 1<<63-1 {
		return false
	}
	version := w.ExpectedVersion
	if w.Phase == "Review" {
		if version >= 1<<63-2 {
			return false
		}
		version++
	} else if w.Phase != "QA" {
		return false
	}
	if s.WorkItemVersion != version || len(w.Rules) != len(s.RequiredACRevisions) {
		return false
	}
	bindings := make([]domain.ACRevisionBinding, len(s.RequiredACRevisions))
	for i, ac := range s.RequiredACRevisions {
		if !validInitialACID(ac.ACID) || i > 0 && s.RequiredACRevisions[i-1].ACID >= ac.ACID {
			return false
		}
		rule := w.Rules[i]
		if rule.ACID != ac.ACID || !preparationRuleText(rule.VerifierClass, true) || !preparationRuleText(rule.ProhibitedRole, false) || rule.ProhibitedActor != "" && !validInitialACID(rule.ProhibitedActor) {
			return false
		}
		bindings[i] = domain.ACRevisionBinding{ACID: domain.ACID(ac.ACID), RevisionDigest: completionDigest(ac.RevisionDigest)}
	}
	subject, err := domain.NewCompletionSubject(domain.CompletionSubjectConfig{ProjectID: project, WorkItemID: item, WorkItemVersion: s.WorkItemVersion, CandidateID: candidate, CandidateDigest: completionDigest(s.CandidateDigest), RunID: domain.RunID(s.RunID), RunInputDigest: completionDigest(s.RunInputDigest), RequiredACRevisions: bindings, AcceptedGraphRevisionDigest: completionDigest(s.AcceptedGraphRevisionDigest), PolicyRevisionDigest: completionDigest(s.PolicyRevisionDigest), CompletionRecipeDigest: completionDigest(s.CompletionRecipeDigest), IntegrationBaseDigest: completionDigest(s.IntegrationBaseDigest)})
	return err == nil && "sha256:"+subject.Digest().String() == w.Digest
}
func preparationRuleText(s string, required bool) bool {
	return (!required || s != "") && len(s) <= 128 && utf8.ValidString(s) && !strings.ContainsFunc(s, unicode.IsControl)
}
