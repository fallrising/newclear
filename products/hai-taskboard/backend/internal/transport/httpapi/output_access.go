package httpapi

import (
	"context"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"errors"
	"mime"
	"net/http"
	"reflect"
	"strconv"
	"strings"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type RunOutputDescriptionService interface {
	DescribeRunOutputs(context.Context, domain.ActorID, domain.ProjectID, domain.WorkItemID, domain.RunID) ([]byte, error)
}
type OutputArtifactReadService interface {
	ReadOutputArtifact(context.Context, domain.ActorID, domain.ProjectID, domain.Digest) ([]byte, error)
}
type outputAccessWire struct {
	ProjectID  string            `json:"project_id"`
	WorkItemID string            `json:"work_item_id"`
	RunID      string            `json:"run_id"`
	Outputs    []outputEntryWire `json:"outputs"`
}
type outputEntryWire struct {
	InputDigest       string             `json:"input_digest"`
	LeaseEpoch        uint64             `json:"lease_epoch"`
	RestoreGeneration uint64             `json:"restore_generation"`
	Artifact          outputArtifactWire `json:"artifact"`
}
type outputArtifactWire struct {
	SHA256       string `json:"sha256"`
	MediaType    string `json:"media_type"`
	ByteLength   uint64 `json:"byte_length"`
	Availability string `json:"availability"`
	Href         string `json:"href"`
	Disposition  string `json:"disposition"`
}

func validOutputList(data []byte, project domain.ProjectID, item domain.WorkItemID, run domain.RunID) bool {
	if len(data) == 0 || len(data) > 1<<20 {
		return false
	}
	var fields map[string]jsontext.Value
	if json.Unmarshal(data, &fields) != nil || len(fields) != 4 {
		return false
	}
	var w outputAccessWire
	if json.Unmarshal(data, &w, json.RejectUnknownMembers(true)) != nil || w.ProjectID != string(project) || w.WorkItemID != string(item) || w.RunID != string(run) || w.Outputs == nil || len(w.Outputs) > port.RunOutputLimit {
		return false
	}
	var entries []jsontext.Value
	if json.Unmarshal(fields["outputs"], &entries) != nil {
		return false
	}
	previous, input := "", ""
	for i, e := range w.Outputs {
		if strictCommandWire(entries[i], reflect.TypeFor[outputEntryWire]()) != nil {
			return false
		}
		a := e.Artifact
		media, params, err := mime.ParseMediaType(a.MediaType)
		if err != nil || strings.Count(media, "/") != 1 || len(a.MediaType) > 160 || strings.ContainsRune(a.MediaType, 0) || mime.FormatMediaType(media, params) != a.MediaType || a.ByteLength > 10<<20 || a.Availability != "Present" || a.Disposition != "attachment" || a.Href != "/api/v1/projects/"+string(project)+"/artifacts/"+a.SHA256 || a.SHA256 <= previous || i > 0 && e.InputDigest != input {
			return false
		}
		previous, input = a.SHA256, e.InputDigest
	}
	return true
}
func writeOutputAccessError(w http.ResponseWriter, err error) {
	status, code, message := 503, command.CodeProjectionUnavailable, "output access is unavailable"
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		// Cancellation wins over an I/O error returned by the canceled reader.
	} else if errors.Is(err, domain.ErrStorageCorruption) {
		code, message = command.CodeStorageCorruption, "output material is invalid"
	} else if e, ok := errors.AsType[*command.Error](err); ok {
		if e.Code == command.CodeStorageCorruption {
			code, message = command.CodeStorageCorruption, "output material is invalid"
		}
	} else if errors.Is(err, port.ErrNotFound) {
		status, code, message = 404, command.CodeNotFound, "resource is unavailable"
	} else if errors.Is(err, port.ErrRunLifecycle) {
		status, code, message = 422, command.CodeLifecycleRejected, "output media type is unavailable"
	}
	writeAPIError(w, status, code, message)
}
func (server *Server) outputReadReady(w http.ResponseWriter, r *http.Request, session Session) bool {
	if err := r.Context().Err(); err != nil {
		writeOutputAccessError(w, err)
		return false
	}
	if revokedNow(server.authority.Revoked(session)) {
		writeAPIError(w, 401, command.CodeUnauthenticated, "authentication is required")
		return false
	}
	return true
}
func outputReadMethod(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodGet {
		return true
	}
	w.Header().Set("Allow", "GET")
	writeAPIError(w, 405, command.CodeInvalidRequest, "method is unavailable")
	return false
}
func (server *Server) getRunOutputs(w http.ResponseWriter, r *http.Request) {
	session, ok := server.authenticate(w, r)
	if !ok {
		return
	}
	project, ok := pathProject(w, r)
	if !ok || !server.authorizeProject(w, r, session, project) {
		return
	}
	item, run := r.PathValue("work_item_id"), r.PathValue("run_id")
	if !workPattern.MatchString(item) || !runPattern.MatchString(run) {
		writeAPIError(w, 404, command.CodeNotFound, "resource is unavailable")
		return
	}
	if !outputReadMethod(w, r) || !server.outputReadReady(w, r, session) {
		return
	}
	reader, ok := server.commands.(RunOutputDescriptionService)
	if !ok {
		writeOutputAccessError(w, errors.New("capability unavailable"))
		return
	}
	data, err := reader.DescribeRunOutputs(r.Context(), session.Principal, project, domain.WorkItemID(item), domain.RunID(run))
	if err != nil {
		writeOutputAccessError(w, err)
		return
	}
	if !validOutputList(data, project, domain.WorkItemID(item), domain.RunID(run)) {
		writeOutputAccessError(w, domain.ErrStorageCorruption)
		return
	}
	if !server.outputReadReady(w, r, session) {
		return
	}
	writeJSONBytes(w, 200, data)
}
func (server *Server) getOutputArtifact(w http.ResponseWriter, r *http.Request) {
	session, ok := server.authenticate(w, r)
	if !ok {
		return
	}
	project, ok := pathProject(w, r)
	if !ok || !server.authorizeProject(w, r, session, project) {
		return
	}
	digest, err := DecodeSHA256(r.PathValue("sha256"))
	if err != nil {
		writeAPIError(w, 404, command.CodeNotFound, "resource is unavailable")
		return
	}
	if !outputReadMethod(w, r) || !server.outputReadReady(w, r, session) {
		return
	}
	reader, ok := server.commands.(OutputArtifactReadService)
	if !ok {
		writeOutputAccessError(w, errors.New("capability unavailable"))
		return
	}
	content, err := reader.ReadOutputArtifact(r.Context(), session.Principal, project, digest)
	if err != nil {
		writeOutputAccessError(w, err)
		return
	}
	if len(content) > 10<<20 || domain.HashBytes(content) != digest {
		writeOutputAccessError(w, domain.ErrStorageCorruption)
		return
	}
	if !server.outputReadReady(w, r, session) {
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/octet-stream")
	h.Set("Content-Disposition", `attachment; filename="`+digest.String()+`.bin"`)
	h.Set("Content-Length", strconv.Itoa(len(content)))
	h.Set("ETag", `"sha256:`+digest.String()+`"`)
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
	h.Set("Accept-Ranges", "none")
	w.WriteHeader(200)
	_, _ = w.Write(content)
}

// Dot resource segments must reach authentication/ID validation before ServeMux
// can normalize them into a different resource. HEAD follows the same checks.
func (server *Server) interceptOutputRead(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	p := strings.Split(r.URL.Path, "/")
	dot := func(s string) bool { return s == "." || s == ".." }
	if len(p) == 10 && p[1] == "api" && p[2] == "v1" && p[3] == "projects" && p[5] == "work-items" && p[7] == "runs" && p[9] == "outputs" && (dot(p[4]) || dot(p[6]) || dot(p[8])) {
		r.SetPathValue("project_id", p[4])
		r.SetPathValue("work_item_id", p[6])
		r.SetPathValue("run_id", p[8])
		server.getRunOutputs(w, r)
		return true
	}
	if len(p) == 7 && p[1] == "api" && p[2] == "v1" && p[3] == "projects" && p[5] == "artifacts" && (dot(p[4]) || dot(p[6])) {
		r.SetPathValue("project_id", p[4])
		r.SetPathValue("sha256", p[6])
		server.getOutputArtifact(w, r)
		return true
	}
	return false
}
