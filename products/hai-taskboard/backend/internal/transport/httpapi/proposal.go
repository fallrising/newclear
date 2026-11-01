package httpapi

import (
	"context"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"net/http"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// Optional admission capabilities leave existing command-only adapters unchanged.
type ProposalService interface {
	ProposeSpecification(context.Context, domain.ActorID, command.ProposeSpecification) (command.Outcome, error)
}
type RepositoryDescriptionService interface {
	DescribeRepository(context.Context, domain.ActorID, domain.ProjectID, string) ([]byte, domain.Digest, error)
}
type proposeSpecificationPayload struct {
	BindingID      string `json:"repository_binding_id"`
	BindingVersion uint64 `json:"binding_version"`
	BindingDigest  string `json:"binding_digest"`
	Ref            string `json:"ref"`
	ManifestPath   string `json:"manifest_path"`
}

func (server *Server) proposeSpecification(response http.ResponseWriter, request *http.Request, session Session, projectID domain.ProjectID, metadata command.Metadata, payload jsontext.Value) (command.Outcome, error, bool) {
	var wire proposeSpecificationPayload
	if !decodePayload(response, payload, &wire) {
		return command.Outcome{}, nil, false
	}
	digest, err := DecodeSHA256(wire.BindingDigest)
	if err != nil || wire.BindingVersion == 0 || wire.BindingVersion > 1<<63-1 || !validWireText(wire.BindingID, 1, 120) || !validWireText(wire.Ref, 1, 200) || !validWireText(wire.ManifestPath, 1, 512) {
		writeAPIError(response, http.StatusBadRequest, command.CodeInvalidRequest, "command payload is invalid")
		return command.Outcome{}, nil, false
	}
	service, ok := server.commands.(ProposalService)
	if !ok {
		writeAPIError(response, http.StatusServiceUnavailable, command.CodePermissionDenied, "proposal admission is unavailable")
		return command.Outcome{}, nil, false
	}
	outcome, err := service.ProposeSpecification(request.Context(), session.Principal, command.ProposeSpecification{Metadata: metadata, ProjectID: projectID, BindingID: wire.BindingID, BindingVersion: wire.BindingVersion, BindingDigest: digest, Ref: wire.Ref, ManifestPath: wire.ManifestPath})
	return outcome, err, true
}
func (server *Server) getRepositoryBinding(response http.ResponseWriter, request *http.Request) {
	session, ok := server.authenticate(response, request)
	if !ok {
		return
	}
	projectID, ok := pathProject(response, request)
	if !ok || !server.authorizeProject(response, request, session, projectID) {
		return
	}
	service, ok := server.commands.(RepositoryDescriptionService)
	bindingID := request.PathValue("binding_id")
	if !ok || !validWireText(bindingID, 1, 120) {
		writeAPIError(response, http.StatusNotFound, command.CodeNotFound, "resource is unavailable")
		return
	}
	canonical, digest, err := service.DescribeRepository(request.Context(), session.Principal, projectID, bindingID)
	if err != nil || len(canonical) == 0 || digest.IsZero() || domain.HashBytes(canonical) != digest {
		writeAPIError(response, http.StatusNotFound, command.CodeNotFound, "resource is unavailable")
		return
	}
	body, err := json.Marshal(struct {
		Binding jsontext.Value `json:"binding"`
		Digest  string         `json:"binding_digest"`
	}{canonical, "sha256:" + digest.String()})
	if err != nil {
		writeAPIError(response, http.StatusNotFound, command.CodeNotFound, "resource is unavailable")
		return
	}
	writeJSONBytes(response, http.StatusOK, body)
}
