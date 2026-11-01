package httpapi

import (
	"context"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"errors"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type HumanReportSubmissionService interface {
	SubmitHumanReport(context.Context, domain.ActorID, command.SubmitHumanReport) (command.Outcome, error)
}
type HumanReportDescriptionService interface {
	DescribeHumanReport(context.Context, domain.ActorID, domain.ProjectID, string) ([]byte, error)
}
type HumanReportReadService interface {
	ReadHumanReport(context.Context, domain.ActorID, domain.ProjectID, string) (port.HumanReport, []byte, error)
}
type humanEvidenceWire struct {
	ACID              string `json:"ac_id"`
	ACRevisionDigest  string `json:"ac_revision_digest"`
	RecipeDigest      string `json:"recipe_digest"`
	EnvironmentDigest string `json:"environment_digest"`
	Verdict           string `json:"verdict"`
}
type humanReportCommandWire struct {
	WorkItemID        string                     `json:"work_item_id"`
	RunID             string                     `json:"run_id"`
	ReportID          string                     `json:"report_id"`
	SubjectDigest     string                     `json:"completion_subject_digest"`
	LeaseEpoch        uint64                     `json:"lease_epoch"`
	RestoreGeneration uint64                     `json:"restore_generation"`
	Kind              string                     `json:"kind"`
	MediaType         string                     `json:"media_type"`
	Content           string                     `json:"content"`
	Review            *command.HumanReviewIntent `json:"review,omitempty"`
	Evidence          *humanEvidenceWire         `json:"evidence,omitempty"`
}

func (server *Server) submitHumanReport(w http.ResponseWriter, r *http.Request, session Session, p domain.ProjectID, m command.Metadata, payload []byte) (command.Outcome, error, bool) {
	bad := func() (command.Outcome, error, bool) {
		writeAPIError(w, 400, command.CodeInvalidRequest, "human report is invalid")
		return command.Outcome{}, nil, false
	}
	var wire humanReportCommandWire
	if strictCommandWire(payload, reflect.TypeFor[humanReportCommandWire]()) != nil || json.Unmarshal(payload, &wire, json.RejectUnknownMembers(true)) != nil {
		return bad()
	}
	// Presence validation also covers nested optional arms; null is never absence.
	var fields map[string]jsontext.Value
	if json.Unmarshal(payload, &fields) != nil {
		return bad()
	}
	if raw, ok := fields["review"]; ok && strictCommandWire(raw, reflect.TypeFor[command.HumanReviewIntent]()) != nil {
		return bad()
	}
	if raw, ok := fields["evidence"]; ok && strictCommandWire(raw, reflect.TypeFor[humanEvidenceWire]()) != nil {
		return bad()
	}
	v := command.SubmitHumanReport{Metadata: m, ProjectID: p, WorkItemID: domain.WorkItemID(wire.WorkItemID), RunID: domain.RunID(wire.RunID), ReportID: wire.ReportID, SubjectDigest: completionDigest(wire.SubjectDigest), LeaseEpoch: wire.LeaseEpoch, RestoreGeneration: wire.RestoreGeneration, Kind: wire.Kind, MediaType: wire.MediaType, Content: wire.Content, Review: wire.Review}
	if wire.Evidence != nil {
		e := wire.Evidence
		v.Evidence = &command.HumanEvidenceIntent{ACID: domain.ACID(e.ACID), ACRevisionDigest: completionDigest(e.ACRevisionDigest), RecipeDigest: completionDigest(e.RecipeDigest), EnvironmentDigest: completionDigest(e.EnvironmentDigest), Verdict: e.Verdict}
	}
	if _, _, err := command.CanonicalSubmitHumanReport(v); err != nil {
		return bad()
	}
	svc, ok := server.commands.(HumanReportSubmissionService)
	if !ok {
		writeAPIError(w, http.StatusServiceUnavailable, command.CodeCapabilityUnsupported, "human report command capability is unavailable")
		return command.Outcome{}, nil, false
	}
	out, err := svc.SubmitHumanReport(r.Context(), session.Principal, v)
	if failure, ok := errors.AsType[*command.Error](err); ok && failure.Code == command.CodeCapabilityUnsupported {
		if len(out.Payload) == 0 {
			writeAPIError(w, http.StatusServiceUnavailable, command.CodeCapabilityUnsupported, "human report command capability is unavailable")
		} else {
			writeJSONBytes(w, http.StatusServiceUnavailable, out.Payload)
		}
		return command.Outcome{}, nil, false
	}
	return out, err, true
}

type humanReportWire struct {
	ProjectID         string             `json:"project_id"`
	WorkItemID        string             `json:"work_item_id"`
	RunID             string             `json:"run_id"`
	ReportID          string             `json:"report_id"`
	Kind              string             `json:"kind"`
	SubjectDigest     string             `json:"completion_subject_digest"`
	ActorID           string             `json:"actor_id"`
	CreatedAt         string             `json:"created_at"`
	LeaseEpoch        uint64             `json:"lease_epoch"`
	RestoreGeneration uint64             `json:"restore_generation"`
	Artifact          outputArtifactWire `json:"artifact"`
}

func validHumanReportWire(data []byte, p domain.ProjectID, id string) bool {
	if len(data) == 0 || len(data) > 8192 || strictCommandWire(data, reflect.TypeFor[humanReportWire]()) != nil {
		return false
	}
	var r humanReportWire
	if json.Unmarshal(data, &r, json.RejectUnknownMembers(true)) != nil {
		return false
	}
	a := r.Artifact
	created, ok := parseTime(r.CreatedAt)
	if !ok || created.UnixNano() <= 0 || time.Unix(0, created.UnixNano()).UTC().Format(time.RFC3339Nano) != r.CreatedAt {
		return false
	}
	return r.ProjectID == string(p) && r.ReportID == id && workPattern.MatchString(r.WorkItemID) && runPattern.MatchString(r.RunID) && (r.Kind == "review" || r.Kind == "evidence") && validWireText(r.ActorID, 1, 120) && a.ByteLength > 0 && a.ByteLength <= port.HumanReportByteLimit && (a.MediaType == "text/plain" || a.MediaType == "text/markdown") && a.Availability == "Present" && a.Disposition == "attachment" && a.Href == "/api/v1/projects/"+string(p)+"/human-reports/"+id+"/content"
}
func (server *Server) getHumanReport(w http.ResponseWriter, r *http.Request) {
	server.humanReportRead(w, r, false)
}
func (server *Server) getHumanReportContent(w http.ResponseWriter, r *http.Request) {
	server.humanReportRead(w, r, true)
}
func (server *Server) humanReportRead(w http.ResponseWriter, r *http.Request, content bool) {
	session, ok := server.authenticate(w, r)
	if !ok {
		return
	}
	p, ok := pathProject(w, r)
	if !ok || !server.authorizeProject(w, r, session, p) {
		return
	}
	id := r.PathValue("report_id")
	if !port.ValidHumanReportID(id) {
		writeAPIError(w, 404, command.CodeNotFound, "resource is unavailable")
		return
	}
	if !outputReadMethod(w, r) || !server.outputReadReady(w, r, session) {
		return
	}
	if !content {
		svc, ok := server.commands.(HumanReportDescriptionService)
		if !ok {
			writeOutputAccessError(w, errors.New("capability unavailable"))
			return
		}
		data, err := svc.DescribeHumanReport(r.Context(), session.Principal, p, id)
		if err != nil {
			writeOutputAccessError(w, err)
			return
		}
		if !validHumanReportWire(data, p, id) {
			writeOutputAccessError(w, domain.ErrStorageCorruption)
			return
		}
		if !server.outputReadReady(w, r, session) {
			return
		}
		writeJSONBytes(w, 200, data)
		return
	}
	svc, ok := server.commands.(HumanReportReadService)
	if !ok {
		writeOutputAccessError(w, errors.New("capability unavailable"))
		return
	}
	report, data, err := svc.ReadHumanReport(r.Context(), session.Principal, p, id)
	if err != nil {
		writeOutputAccessError(w, err)
		return
	}
	if !port.ValidHumanReport(report) || !validWireText(string(report.Actor), 1, 120) || report.ProjectID != p || report.ID != id || !workPattern.MatchString(string(report.WorkItemID)) || !runPattern.MatchString(string(report.RunID)) || len(data) > port.HumanReportByteLimit || uint64(len(data)) != report.Artifact.ByteLength || domain.HashBytes(data) != report.Artifact.Digest {
		writeOutputAccessError(w, domain.ErrStorageCorruption)
		return
	}
	if !server.outputReadReady(w, r, session) {
		return
	}
	digest := report.Artifact.Digest.String()
	h := w.Header()
	h.Set("Content-Type", "application/octet-stream")
	h.Set("Content-Disposition", `attachment; filename="`+digest+`.bin"`)
	h.Set("Content-Length", strconv.Itoa(len(data)))
	h.Set("ETag", `"sha256:`+digest+`"`)
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
	h.Set("Accept-Ranges", "none")
	w.WriteHeader(200)
	_, _ = w.Write(data)
}
func (server *Server) interceptHumanReportRead(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	p := strings.Split(r.URL.Path, "/")
	if (len(p) != 7 && len(p) != 8) || p[1] != "api" || p[2] != "v1" || p[3] != "projects" || p[5] != "human-reports" || len(p) == 8 && p[7] != "content" {
		return false
	}
	r.SetPathValue("project_id", p[4])
	r.SetPathValue("report_id", p[6])
	server.humanReportRead(w, r, len(p) == 8)
	return true
}
