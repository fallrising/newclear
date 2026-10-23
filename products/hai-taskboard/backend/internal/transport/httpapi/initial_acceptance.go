package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"net/http"
	"unicode"
	"unicode/utf8"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type InitialAcceptanceService interface {
	AcceptInitialSpecification(context.Context, domain.ActorID, command.AcceptInitialSpecification) (command.Outcome, error)
}
type InitialAcceptanceDescriptionService interface {
	DescribeInitialAcceptance(context.Context, domain.ActorID, domain.ProjectID, domain.Digest) ([]byte, error)
}

type initialAcceptancePayload struct {
	ProposalDigest          *string                `json:"proposal_digest"`
	PolicyRevisionDigest    *string                `json:"policy_revision_digest"`
	AcceptanceSubjectDigest *string                `json:"acceptance_subject_digest"`
	WorkItems               []initialWorkItemWire  `json:"work_items"`
	ACContents              []initialACContentWire `json:"ac_contents"`
}
type initialWorkItemWire struct {
	WorkItemID      *string `json:"work_item_id"`
	ExpectedVersion *uint64 `json:"expected_version"`
}
type initialACContentWire struct {
	ACID    *string `json:"ac_id"`
	Content *string `json:"content"`
}

func (server *Server) acceptInitialSpecification(response http.ResponseWriter, request *http.Request, session Session, project domain.ProjectID, metadata command.Metadata, payload jsontext.Value) (command.Outcome, error, bool) {
	bad := func() (command.Outcome, error, bool) {
		writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "command payload is invalid")
		return command.Outcome{}, nil, false
	}
	var wire initialAcceptancePayload
	if !decodePayload(response, payload, &wire) {
		return command.Outcome{}, nil, false
	}
	if wire.ProposalDigest == nil || wire.PolicyRevisionDigest == nil || wire.AcceptanceSubjectDigest == nil || len(wire.WorkItems) == 0 || len(wire.WorkItems) > 256 || len(wire.ACContents) == 0 || len(wire.ACContents) > 256 {
		return bad()
	}
	pd, e := DecodeSHA256(*wire.ProposalDigest)
	if e != nil {
		return bad()
	}
	policy, e := DecodeSHA256(*wire.PolicyRevisionDigest)
	if e != nil {
		return bad()
	}
	subject, e := DecodeSHA256(*wire.AcceptanceSubjectDigest)
	if e != nil {
		return bad()
	}
	v := command.AcceptInitialSpecification{Metadata: metadata, ProjectID: project, ProposalDigest: pd, PolicyRevisionDigest: policy, AcceptanceSubjectDigest: subject, WorkItems: make([]port.InitialWorkItemVersion, len(wire.WorkItems)), ACContents: make([]command.InitialACContent, len(wire.ACContents))}
	ids := map[string]bool{}
	for i, w := range wire.WorkItems {
		if w.WorkItemID == nil || w.ExpectedVersion == nil || !workPattern.MatchString(*w.WorkItemID) || *w.ExpectedVersion == 0 || *w.ExpectedVersion >= 1<<63-1 || ids[*w.WorkItemID] {
			return bad()
		}
		ids[*w.WorkItemID] = true
		v.WorkItems[i] = port.InitialWorkItemVersion{WorkItemID: domain.WorkItemID(*w.WorkItemID), ExpectedVersion: *w.ExpectedVersion}
	}
	ids = map[string]bool{}
	total := 0
	for i, a := range wire.ACContents {
		if a.ACID == nil || a.Content == nil || !validInitialACID(*a.ACID) || ids[*a.ACID] || len(*a.Content) > base64.StdEncoding.EncodedLen(64<<10) {
			return bad()
		}
		content, e := base64.StdEncoding.Strict().DecodeString(*a.Content)
		if e != nil || base64.StdEncoding.EncodeToString(content) != *a.Content || len(content) > 64<<10 {
			return bad()
		}
		total += len(content)
		if total > 512<<10 {
			return bad()
		}
		ids[*a.ACID] = true
		v.ACContents[i] = command.InitialACContent{ACID: domain.ACID(*a.ACID), Content: content}
	}
	if _, _, e = command.CanonicalAcceptInitialSpecification(v); e != nil {
		return bad()
	}
	capability, ok := server.commands.(InitialAcceptanceService)
	if !ok {
		writeAPIError(response, http.StatusServiceUnavailable, command.CodePermissionDenied, "initial acceptance is unavailable")
		return command.Outcome{}, nil, false
	}
	out, e := capability.AcceptInitialSpecification(request.Context(), session.Principal, v)
	return out, e, true
}
func (server *Server) getInitialAcceptance(response http.ResponseWriter, request *http.Request) {
	session, ok := server.authenticate(response, request)
	if !ok {
		return
	}
	project, ok := pathProject(response, request)
	if !ok || !server.authorizeProject(response, request, session, project) {
		return
	}
	capability, ok := server.commands.(InitialAcceptanceDescriptionService)
	digest, e := DecodeSHA256(request.PathValue("proposal_digest"))
	if !ok || e != nil {
		writeAPIError(response, http.StatusNotFound, command.CodeNotFound, "resource is unavailable")
		return
	}
	description, e := capability.DescribeInitialAcceptance(request.Context(), session.Principal, project, digest)
	if e != nil || !validInitialDescription(description, digest) {
		writeAPIError(response, http.StatusNotFound, command.CodeNotFound, "resource is unavailable")
		return
	}
	writeJSONBytes(response, http.StatusOK, description)
}

// Validate the optional application's public response before returning bytes.
func validInitialDescription(data []byte, proposal domain.Digest) bool {
	if len(data) == 0 || len(data) > int(defaultBodyLimit) {
		return false
	}
	var wire struct {
		ProposalDigest  string                `json:"proposal_digest"`
		PolicyDigest    string                `json:"policy_revision_digest"`
		SubjectDigest   string                `json:"acceptance_subject_digest"`
		ExpectedVersion uint64                `json:"expected_version"`
		WorkItems       []initialWorkItemWire `json:"work_items"`
		ACRevisions     []acRevisionWire      `json:"ac_revisions"`
	}
	if json.Unmarshal(data, &wire, json.RejectUnknownMembers(true)) != nil || wire.ProposalDigest != "sha256:"+proposal.String() || wire.ExpectedVersion == 0 || wire.ExpectedVersion >= 1<<63-1 || len(wire.WorkItems) == 0 || len(wire.WorkItems) > 256 || len(wire.ACRevisions) == 0 || len(wire.ACRevisions) > 256 {
		return false
	}
	for _, d := range []string{wire.PolicyDigest, wire.SubjectDigest} {
		if _, e := DecodeSHA256(d); e != nil {
			return false
		}
	}
	previous := ""
	for _, w := range wire.WorkItems {
		if w.WorkItemID == nil || w.ExpectedVersion == nil || !workPattern.MatchString(*w.WorkItemID) || *w.WorkItemID <= previous || *w.ExpectedVersion == 0 || *w.ExpectedVersion >= 1<<63-1 {
			return false
		}
		previous = *w.WorkItemID
	}
	previous = ""
	for _, a := range wire.ACRevisions {
		if !validInitialACID(a.ACID) || a.ACID <= previous {
			return false
		}
		if _, e := DecodeSHA256(a.RevisionDigest); e != nil {
			return false
		}
		previous = a.ACID
	}
	return true
}

// Proposal AC identity permits UTF-8 identifiers up to 120 bytes.
func validInitialACID(value string) bool {
	if len(value) == 0 || len(value) > 120 || !utf8.ValidString(value) {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) || unicode.IsSpace(r) || r == '/' || r == '\\' {
			return false
		}
	}
	return true
}
