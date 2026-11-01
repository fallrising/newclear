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

// MaterialIndexSource is an optional projection capability. Absence is unavailable,
// never a successful empty history. It grants no command or completion authority.
type MaterialIndexSource interface {
	DescribeWorkItemMaterialIndex(context.Context, domain.ProjectID, domain.WorkItemID) ([]byte, error)
}

type materialIndexWire struct {
	APIVersion        string                          `json:"api_version"`
	Kind              string                          `json:"kind"`
	ObservationOnly   bool                            `json:"observation_only"`
	ProjectID         string                          `json:"project_id"`
	WorkItemID        string                          `json:"work_item_id"`
	Title             string                          `json:"title"`
	Goal              string                          `json:"goal"`
	OwnerID           string                          `json:"human_owner_id"`
	Phase             string                          `json:"phase"`
	Version           uint64                          `json:"work_item_version"`
	Accepted          *materialIndexSpecificationWire `json:"accepted_specification"`
	ACs               []acRevisionWire                `json:"required_ac_revisions"`
	Runs              []materialIndexRunWire          `json:"runs"`
	Candidates        []materialIndexCandidateWire    `json:"candidates"`
	Cursor            coverageCursorWire              `json:"cursor"`
	RestoreGeneration uint64                          `json:"restore_generation"`
}
type materialIndexSpecificationWire struct {
	AcceptedRevision string `json:"accepted_revision_digest"`
	Binding          string `json:"binding_digest"`
	Graph            string `json:"graph_revision_digest"`
	Policy           string `json:"policy_revision_digest"`
	ProjectVersion   uint64 `json:"project_head_version"`
	ItemVersion      uint64 `json:"work_item_head_version"`
	Kind             string `json:"acceptance_kind"`
}
type materialIndexRunWire struct {
	RunID          string `json:"run_id"`
	Input          string `json:"input_digest"`
	CreatedAt      string `json:"created_at"`
	Desired        string `json:"desired_action"`
	Dispatch       string `json:"dispatch_state"`
	Observed       string `json:"observed_state"`
	Reconciliation string `json:"reconciliation_state"`
	SideEffect     string `json:"side_effect_outcome"`
}
type materialIndexCandidateWire struct {
	CandidateID string `json:"candidate_id"`
	RunID       string `json:"run_id"`
	Digest      string `json:"candidate_digest"`
	Input       string `json:"input_subject_digest"`
	CreatedAt   string `json:"created_at"`
}

func (server *Server) interceptMaterialIndexRead(w http.ResponseWriter, r *http.Request) bool {
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) != 8 || parts[1] != "api" || parts[2] != "v1" || parts[3] != "projects" || parts[5] != "work-items" || parts[7] != "material-index" {
		return false
	}
	r.SetPathValue("project_id", parts[4])
	r.SetPathValue("work_item_id", parts[6])
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeAPIError(w, 405, command.CodeInvalidRequest, "material index accepts only GET")
		return true
	}
	server.getWorkItemMaterialIndex(w, r)
	return true
}
func (server *Server) getWorkItemMaterialIndex(w http.ResponseWriter, r *http.Request) {
	session, ok := server.authenticate(w, r)
	if !ok {
		return
	}
	if sessionRevoked(server.authority, session) {
		writeAPIError(w, 401, command.CodeUnauthenticated, "session is unavailable")
		return
	}
	project, ok := pathProject(w, r)
	if !ok || !server.authorizeProject(w, r, session, project) {
		return
	}
	item := domain.WorkItemID(r.PathValue("work_item_id"))
	if !workPattern.MatchString(string(item)) {
		writeAPIError(w, 404, command.CodeNotFound, "resource is unavailable")
		return
	}
	if r.URL.RawQuery != "" || r.URL.ForceQuery || r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
		writeAPIError(w, 400, command.CodeInvalidRequest, "material index accepts no query or body")
		return
	}
	source, ok := server.projections.(MaterialIndexSource)
	if !ok {
		writeMaterialIndexError(w, errors.New("missing material index capability"))
		return
	}
	data, err := source.DescribeWorkItemMaterialIndex(r.Context(), project, item)
	if err == nil {
		err = validateMaterialIndexWire(data, project, item)
	}
	if err != nil {
		writeMaterialIndexError(w, err)
		return
	}
	if r.Context().Err() != nil {
		writeMaterialIndexError(w, r.Context().Err())
		return
	}
	if sessionRevoked(server.authority, session) {
		writeAPIError(w, 401, command.CodeUnauthenticated, "session is unavailable")
		return
	}
	writeJSONBytes(w, 200, data)
}
func sessionRevoked(authority SessionAuthority, session Session) bool {
	select {
	case <-authority.Revoked(session):
		return true
	default:
		return false
	}
}

type materialIndexCapacityEnvelope struct {
	APIVersion string `json:"api_version"`
	OK         bool   `json:"ok"`
	Error      struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		Retryable bool   `json:"retryable"`
		Details   struct {
			Reason string `json:"reason"`
		} `json:"details"`
	} `json:"error"`
	CorrelationID string `json:"correlation_id"`
}

func writeMaterialIndexError(w http.ResponseWriter, err error) {
	if errors.Is(err, port.ErrMaterialIndexCapacity) {
		value := materialIndexCapacityEnvelope{APIVersion: "v1", CorrelationID: "request"}
		value.Error.Code = command.CodeProjectionUnavailable
		value.Error.Message = "material index capacity exceeded"
		value.Error.Details.Reason = "material_index_capacity_exceeded"
		data, _ := json.Marshal(value)
		writeJSONBytes(w, 503, data)
		return
	}
	if errors.Is(err, port.ErrNotFound) || errors.Is(err, ErrProjectionNotFound) {
		writeAPIError(w, 404, command.CodeNotFound, "resource is unavailable")
		return
	}
	if errors.Is(err, domain.ErrStorageCorruption) || errors.Is(err, ErrProjectionCorrupt) {
		writeAPIError(w, 503, command.CodeStorageCorruption, "material index is invalid")
		return
	}
	writeAPIError(w, 503, command.CodeProjectionUnavailable, "material index is unavailable")
}

// DescribeWorkItemMaterialIndex adapts an optional read port; the command UnitOfWork,
// artifacts, executor and ID allocator are deliberately absent from this path.
func (source PersistedProjections) DescribeWorkItemMaterialIndex(ctx context.Context, project domain.ProjectID, item domain.WorkItemID) ([]byte, error) {
	reader, ok := source.Store.(port.MaterialIndexReader)
	if !ok {
		return nil, errors.New("missing material index reader")
	}
	value, err := reader.ReadWorkItemMaterialIndex(ctx, project, item)
	if err != nil {
		return nil, err
	}
	if len(value.RequiredACRevisions) > port.MaterialIndexRowLimit || len(value.Runs) > port.MaterialIndexRowLimit || len(value.Candidates) > port.MaterialIndexRowLimit {
		return nil, port.ErrMaterialIndexCapacity
	}
	if value.Cursor.Epoch > 1<<63-1 || value.Cursor.Sequence > 1<<63-1 {
		return nil, ErrProjectionCorrupt
	}
	wire := materialIndexWire{APIVersion: "v1", Kind: "work_item_material_index/v1", ObservationOnly: true, ProjectID: string(value.ProjectID), WorkItemID: string(value.WorkItemID), Title: value.Title, Goal: value.Goal, OwnerID: string(value.OwnerID), Phase: string(value.Phase), Version: value.Version, RestoreGeneration: value.RestoreGeneration, Cursor: coverageCursorWire{Epoch: int64(value.Cursor.Epoch), Sequence: int64(value.Cursor.Sequence)}, ACs: []acRevisionWire{}, Runs: []materialIndexRunWire{}, Candidates: []materialIndexCandidateWire{}}
	if a := value.Accepted; a != nil {
		wire.Accepted = &materialIndexSpecificationWire{AcceptedRevision: "sha256:" + a.AcceptedRevisionDigest.String(), Binding: "sha256:" + a.BindingDigest.String(), Graph: "sha256:" + a.GraphRevisionDigest.String(), Policy: "sha256:" + a.PolicyRevisionDigest.String(), ProjectVersion: a.ProjectHeadVersion, ItemVersion: a.WorkItemHeadVersion, Kind: a.AcceptanceKind}
	}
	for _, a := range value.RequiredACRevisions {
		wire.ACs = append(wire.ACs, acRevisionWire{ACID: a.ACID, RevisionDigest: "sha256:" + a.RevisionDigest.String()})
	}
	for _, r := range value.Runs {
		if r.CreatedAtNS <= 0 {
			return nil, ErrProjectionCorrupt
		}
		state := r.ReconciliationState
		if state == "Reconciled" {
			state = "Resolved"
		}
		wire.Runs = append(wire.Runs, materialIndexRunWire{RunID: string(r.RunID), Input: "sha256:" + r.InputDigest.String(), CreatedAt: time.Unix(0, r.CreatedAtNS).UTC().Format(time.RFC3339Nano), Desired: r.DesiredAction, Dispatch: r.DispatchState, Observed: r.ObservedState, Reconciliation: state, SideEffect: r.SideEffectOutcome})
	}
	for _, c := range value.Candidates {
		if c.CreatedAtNS <= 0 {
			return nil, ErrProjectionCorrupt
		}
		wire.Candidates = append(wire.Candidates, materialIndexCandidateWire{CandidateID: string(c.CandidateID), RunID: string(c.RunID), Digest: "sha256:" + c.CandidateDigest.String(), Input: "sha256:" + c.InputSubjectDigest.String(), CreatedAt: time.Unix(0, c.CreatedAtNS).UTC().Format(time.RFC3339Nano)})
	}
	data, err := json.Marshal(wire)
	if err != nil {
		return nil, ErrProjectionCorrupt
	}
	if err = validateMaterialIndexWire(data, project, item); err != nil {
		return nil, err
	}
	return data, nil
}

func materialIndexShape(data []byte, typ reflect.Type) error {
	if typ.Kind() == reflect.Pointer {
		if string(data) == "null" {
			return nil
		}
		return materialIndexShape(data, typ.Elem())
	}
	if len(data) == 0 || string(data) == "null" {
		return ErrProjectionCorrupt
	}
	switch typ.Kind() {
	case reflect.Struct:
		var fields map[string]jsontext.Value
		if json.Unmarshal(data, &fields) != nil || len(fields) != typ.NumField() {
			return ErrProjectionCorrupt
		}
		for f := range typ.NumField() {
			field := typ.Field(f)
			if err := materialIndexShape(fields[field.Tag.Get("json")], field.Type); err != nil {
				return err
			}
		}
	case reflect.Slice:
		var values []jsontext.Value
		if json.Unmarshal(data, &values) != nil || values == nil {
			return ErrProjectionCorrupt
		}
		if len(values) > port.MaterialIndexRowLimit {
			return port.ErrMaterialIndexCapacity
		}
		for _, v := range values {
			if err := materialIndexShape(v, typ.Elem()); err != nil {
				return err
			}
		}
	}
	return nil
}
func materialIndexText(s string, max int) bool { return len(s) <= max && validWireText(s, 1, max) }
func materialIndexVersion(v uint64) bool       { return v > 0 && v <= 1<<63-1 }
func materialIndexDigest(s string) bool        { d, err := DecodeSHA256(s); return err == nil && !d.IsZero() }
func materialIndexTime(s string) (int64, bool) {
	t, ok := parseTime(s)
	if !ok {
		return 0, false
	}
	n := t.UnixNano()
	return n, n > 0 && t.Equal(time.Unix(0, n))
}
func validateMaterialIndexWire(data []byte, project domain.ProjectID, item domain.WorkItemID) error {
	if len(data) > port.MaterialIndexWireLimit {
		return port.ErrMaterialIndexCapacity
	}
	if err := materialIndexShape(data, reflect.TypeFor[materialIndexWire]()); err != nil {
		return err
	}
	var w materialIndexWire
	if json.Unmarshal(data, &w, json.RejectUnknownMembers(true)) != nil {
		return ErrProjectionCorrupt
	}
	if w.APIVersion != "v1" || w.Kind != "work_item_material_index/v1" || !w.ObservationOnly || w.ProjectID != string(project) || w.WorkItemID != string(item) || !projectPattern.MatchString(w.ProjectID) || !workPattern.MatchString(w.WorkItemID) || !materialIndexText(w.Title, 240) || !materialIndexText(w.Goal, 8000) || !materialIndexText(w.OwnerID, 120) || !materialIndexVersion(w.Version) || !materialIndexVersion(w.RestoreGeneration) || w.Cursor.Epoch < 1 || w.Cursor.Sequence < 0 || !slices.Contains([]string{"Draft", "Ready", "Developing", "Review", "QA", "Done", "Canceled"}, w.Phase) {
		return ErrProjectionCorrupt
	}
	if a := w.Accepted; a != nil {
		if !materialIndexDigest(a.AcceptedRevision) || !materialIndexDigest(a.Binding) || !materialIndexDigest(a.Graph) || !materialIndexDigest(a.Policy) || !materialIndexVersion(a.ProjectVersion) || !materialIndexVersion(a.ItemVersion) || !slices.Contains([]string{"Initial", "Impact"}, a.Kind) {
			return ErrProjectionCorrupt
		}
	}
	for i, a := range w.ACs {
		valid := materialIndexText(a.ACID, 80)
		if w.Accepted != nil {
			valid = domain.ValidACID(a.ACID)
		}
		if !valid || !materialIndexDigest(a.RevisionDigest) || (i > 0 && w.ACs[i-1].ACID >= a.ACID) {
			return ErrProjectionCorrupt
		}
	}
	runs := map[string]bool{}
	var previousTime int64
	var previousID string
	for _, r := range w.Runs {
		ns, ok := materialIndexTime(r.CreatedAt)
		if !ok || !runPattern.MatchString(r.RunID) || runs[r.RunID] || !materialIndexDigest(r.Input) || ns < previousTime || (ns == previousTime && r.RunID <= previousID) || !slices.Contains([]string{"None", "Dispatch", "CancelRequested"}, r.Desired) || !slices.Contains([]string{"Pending", "Claimed", "Sent", "Acknowledged", "FailedToDispatch"}, r.Dispatch) || !slices.Contains([]string{"Unknown", "Starting", "Running", "Succeeded", "Failed", "Canceled"}, r.Observed) || !slices.Contains([]string{"None", "NeedsReconcile", "Resolved"}, r.Reconciliation) || !slices.Contains([]string{"NotApplicable", "Confirmed", "OutcomeUnknown"}, r.SideEffect) {
			return ErrProjectionCorrupt
		}
		runs[r.RunID] = true
		previousTime, previousID = ns, r.RunID
	}
	candidates := map[string]bool{}
	previousTime, previousID = 0, ""
	for _, c := range w.Candidates {
		ns, ok := materialIndexTime(c.CreatedAt)
		if !ok || !materialIndexText(c.CandidateID, 80) || candidates[c.CandidateID] || !runs[c.RunID] || !materialIndexDigest(c.Digest) || !materialIndexDigest(c.Input) || ns < previousTime || (ns == previousTime && c.CandidateID <= previousID) {
			return ErrProjectionCorrupt
		}
		candidates[c.CandidateID] = true
		previousTime, previousID = ns, c.CandidateID
	}
	return nil
}
