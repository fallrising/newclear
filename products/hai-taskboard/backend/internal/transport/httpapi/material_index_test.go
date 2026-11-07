package httpapi

import (
	"context"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const materialIndexPath = "/api/v1/projects/prj_01ARZ3NDEK/work-items/wi_01ARZ3NDEK/material-index"

type materialIndexStub struct {
	ProjectionSource
	data  []byte
	err   error
	reads int
	after func()
}

func (s *materialIndexStub) DescribeWorkItemMaterialIndex(context.Context, domain.ProjectID, domain.WorkItemID) ([]byte, error) {
	s.reads++
	if s.after != nil {
		s.after()
	}
	return s.data, s.err
}
func materialIndexFixture() []byte {
	return []byte(`{"api_version":"v1","kind":"work_item_material_index/v1","observation_only":true,"project_id":"prj_01ARZ3NDEK","work_item_id":"wi_01ARZ3NDEK","title":"Index","goal":"Discover material","human_owner_id":"actor","phase":"Draft","work_item_version":1,"accepted_specification":null,"required_ac_revisions":[],"runs":[],"candidates":[],"cursor":{"stream_epoch":1,"event_sequence":0},"restore_generation":1}`)
}
func TestWorkItemMaterialIndexHTTP_AuthScopeAndClosedWire(t *testing.T) {
	for _, tc := range []struct {
		name, path, method string
		session, denied    bool
		want, reads        int
	}{
		{"success", materialIndexPath, "GET", true, false, 200, 1},
		{"anonymous", materialIndexPath, "GET", false, false, 401, 0},
		{"anonymous_query", materialIndexPath + "?x=1", "GET", false, false, 401, 0},
		{"denied_query", materialIndexPath + "?x=1", "GET", true, true, 404, 0},
		{"query", materialIndexPath + "?x=1", "GET", true, false, 400, 0},
		{"force_query", materialIndexPath + "?", "GET", true, false, 400, 0},
		{"head", materialIndexPath, "HEAD", true, false, 405, 0},
		{"anonymous_post", materialIndexPath, "POST", false, false, 405, 0},
		{"options", materialIndexPath, "OPTIONS", true, false, 405, 0},
		{"dot_project", strings.Replace(materialIndexPath, string(testProjectID), ".", 1), "GET", true, false, 404, 0},
		{"dotdot_item", strings.Replace(materialIndexPath, "wi_01ARZ3NDEK", "..", 1), "GET", true, false, 404, 0},
		{"anonymous_dot", strings.Replace(materialIndexPath, "wi_01ARZ3NDEK", ".", 1), "GET", false, false, 401, 0},
		{"head_dot", strings.Replace(materialIndexPath, "wi_01ARZ3NDEK", ".", 1), "HEAD", false, false, 405, 0},
		{"encoded_head", strings.Replace(materialIndexPath, "wi_", "wi%5F", 1), "HEAD", false, false, 400, 0},
		{"double_slash", strings.Replace(materialIndexPath, "/work-items/", "//work-items/", 1), "GET", true, false, 400, 0},
		{"invalid_item_query", strings.Replace(materialIndexPath, "wi_01ARZ3NDEK", "other", 1) + "?x=1", "GET", true, false, 404, 0},
		{"invalid_item", strings.Replace(materialIndexPath, "wi_01ARZ3NDEK", "other", 1), "GET", true, false, 404, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := &authorityStub{}
			if tc.denied {
				a.projectErr = ErrPermissionDenied
			}
			source := &materialIndexStub{data: materialIndexFixture()}
			s := preparationServer(t, &commandStub{}, a)
			s.projections = source
			r := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.session {
				addSession(r)
			}
			w := httptest.NewRecorder()
			s.ServeHTTP(w, r)
			if w.Code != tc.want || source.reads != tc.reads || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("Location") != "" {
				t.Fatalf("status%d reads%d headers%v body%s", w.Code, source.reads, w.Header(), w.Body)
			}
			if tc.want == 405 && w.Header().Get("Allow") != "GET" {
				t.Fatal(w.Header())
			}
		})
	}
	t.Run("dotdot_item_body", func(t *testing.T) {
		source := &materialIndexStub{data: materialIndexFixture()}
		server := preparationServer(t, &commandStub{}, nil)
		server.projections = source
		request := httptest.NewRequest("GET", strings.Replace(materialIndexPath, "wi_01ARZ3NDEK", "..", 1), strings.NewReader("{}"))
		addSession(request)
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		if response.Code != 404 || source.reads != 0 {
			t.Fatalf("status%d reads%d", response.Code, source.reads)
		}
	})
	for _, framing := range []string{"body", "unknown_length", "transfer_encoding"} {
		t.Run(framing, func(t *testing.T) {
			source := &materialIndexStub{data: materialIndexFixture()}
			s := preparationServer(t, &commandStub{}, nil)
			s.projections = source
			r := httptest.NewRequest("GET", materialIndexPath, strings.NewReader("{}"))
			addSession(r)
			if framing == "unknown_length" {
				r.ContentLength = -1
			}
			if framing == "transfer_encoding" {
				r.ContentLength = 0
				r.TransferEncoding = []string{"chunked"}
			}
			w := httptest.NewRecorder()
			s.ServeHTTP(w, r)
			if w.Code != 400 || source.reads != 0 {
				t.Fatalf("%d %d", w.Code, source.reads)
			}
		})
	}
	for _, failure := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"missing", port.ErrNotFound, 404, "not_found"},
		{"corrupt", domain.StorageCorruptionError{Reason: "private SQL path"}, 503, "storage_corruption"},
		{"unavailable", errors.New("private SQL path"), 503, "projection_unavailable"},
		{"capacity", port.ErrMaterialIndexCapacity, 503, "projection_unavailable"},
	} {
		t.Run(failure.name, func(t *testing.T) {
			s := preparationServer(t, &commandStub{}, nil)
			s.projections = &materialIndexStub{err: failure.err}
			w := preparationRequest(t, s, materialIndexPath, true)
			if w.Code != failure.status || !strings.Contains(w.Body.String(), failure.code) || strings.Contains(w.Body.String(), "private") {
				t.Fatal(w.Code, w.Body)
			}
			if failure.name == "capacity" {
				if materialIndexShape(w.Body.Bytes(), reflect.TypeFor[materialIndexCapacityEnvelope]()) != nil {
					t.Fatal(w.Body)
				}
				bad := mutateMaterialIndex(t, w.Body.Bytes(), func(m map[string]any) { m["error"].(map[string]any)["details"].(map[string]any)["extra"] = true })
				if materialIndexShape(bad, reflect.TypeFor[materialIndexCapacityEnvelope]()) == nil {
					t.Fatal("unknown error detail admitted")
				}
			}
		})
	}
	t.Run("capability_absent", func(t *testing.T) {
		w := preparationRequest(t, preparationServer(t, &commandStub{}, nil), materialIndexPath, true)
		if w.Code != 503 {
			t.Fatal(w.Code)
		}
	})
	for _, kind := range []string{"revoked_before", "revoked_after", "canceled_after"} {
		t.Run(kind, func(t *testing.T) {
			revoked := make(chan struct{})
			a := &authorityStub{revoked: revoked}
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			source := &materialIndexStub{data: materialIndexFixture()}
			want, reads := 401, 1
			switch kind {
			case "revoked_before":
				close(revoked)
				reads = 0
			case "revoked_after":
				source.after = func() { close(revoked) }
			case "canceled_after":
				source.after = cancel
				want = 503
			}
			s := preparationServer(t, &commandStub{}, a)
			s.projections = source
			r := httptest.NewRequest("GET", materialIndexPath, nil).WithContext(ctx)
			addSession(r)
			w := httptest.NewRecorder()
			s.ServeHTTP(w, r)
			if w.Code != want || source.reads != reads {
				t.Fatal(w.Code, source.reads, w.Body)
			}
		})
	}
}

func mutateMaterialIndex(t *testing.T, data []byte, change func(map[string]any)) []byte {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	change(m)
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func fullMaterialIndexFixture(t *testing.T) materialIndexWire {
	t.Helper()
	var w materialIndexWire
	if err := json.Unmarshal(materialIndexFixture(), &w); err != nil {
		t.Fatal(err)
	}
	d := "sha256:" + domain.HashString("material").String()
	w.Accepted = &materialIndexSpecificationWire{AcceptedRevision: d, Binding: d, Graph: d, Policy: d, ProjectVersion: 1, ItemVersion: 1, Kind: "Initial"}
	w.ACs = []acRevisionWire{{ACID: "AC-A", RevisionDigest: d}}
	w.Runs = []materialIndexRunWire{{RunID: "run_01ARZ3NDEK", Input: d, CreatedAt: time.Unix(0, 1).UTC().Format(time.RFC3339Nano), Desired: "None", Dispatch: "Pending", Observed: "Unknown", Reconciliation: "None", SideEffect: "NotApplicable"}}
	w.Candidates = []materialIndexCandidateWire{{CandidateID: "candidate /界", RunID: w.Runs[0].RunID, Digest: d, Input: d, CreatedAt: w.Runs[0].CreatedAt}}
	return w
}
func marshalMaterialIndex(t *testing.T, w materialIndexWire) []byte {
	t.Helper()
	b, e := json.Marshal(w)
	if e != nil {
		t.Fatal(e)
	}
	return b
}

func TestWorkItemMaterialIndexHTTP_RequiredFieldsAndCorruption(t *testing.T) {
	good := marshalMaterialIndex(t, fullMaterialIndexFixture(t))
	validate := func(b []byte) error { return validateMaterialIndexWire(b, testProjectID, "wi_01ARZ3NDEK") }
	if err := validate(good); err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(good, &m); err != nil {
		t.Fatal(err)
	}
	for field := range m {
		t.Run("missing_"+field, func(t *testing.T) {
			b := mutateMaterialIndex(t, good, func(m map[string]any) { delete(m, field) })
			if validate(b) == nil {
				t.Fatal("missing field accepted")
			}
		})
	}
	for _, field := range []string{"accepted_specification", "cursor", "runs", "candidates", "required_ac_revisions"} {
		var obj map[string]any
		if items, ok := m[field].([]any); ok {
			obj = items[0].(map[string]any)
		} else {
			obj = m[field].(map[string]any)
		}
		for nested := range obj {
			t.Run(field+"/missing_"+nested, func(t *testing.T) {
				b := mutateMaterialIndex(t, good, func(m map[string]any) {
					if items, ok := m[field].([]any); ok {
						delete(items[0].(map[string]any), nested)
					} else {
						delete(m[field].(map[string]any), nested)
					}
				})
				if validate(b) == nil {
					t.Fatal("missing nested field accepted")
				}
			})
		}
	}
	for _, tc := range []struct {
		name   string
		change func(map[string]any)
	}{
		{"unknown", func(m map[string]any) { m["effective_satisfied"] = true }},
		{"unknown_nested", func(m map[string]any) { m["accepted_specification"].(map[string]any)["current"] = true }},
		{"null_array", func(m map[string]any) { m["runs"] = nil }},
		{"false_observation", func(m map[string]any) { m["observation_only"] = false }},
		{"foreign_project", func(m map[string]any) { m["project_id"] = "prj_01ARZ3NDEM" }},
		{"foreign_item", func(m map[string]any) { m["work_item_id"] = "wi_01ARZ3NDEM" }},
		{"zero_version", func(m map[string]any) { m["work_item_version"] = 0 }},
		{"fractional", func(m map[string]any) { m["work_item_version"] = 1.5 }},
		{"zero_epoch", func(m map[string]any) { m["cursor"].(map[string]any)["stream_epoch"] = 0 }},
		{"negative_sequence", func(m map[string]any) { m["cursor"].(map[string]any)["event_sequence"] = -1 }},
		{"bad_phase", func(m map[string]any) { m["phase"] = "Blocked" }},
		{"title_bytes", func(m map[string]any) { m["title"] = strings.Repeat("界", 81) }},
		{"goal_bytes", func(m map[string]any) { m["goal"] = strings.Repeat("a", 8001) }},
		{"owner_bytes", func(m map[string]any) { m["human_owner_id"] = strings.Repeat("a", 121) }},
		{"control", func(m map[string]any) { m["title"] = "bad\n" }},
		{"bad_kind", func(m map[string]any) { m["accepted_specification"].(map[string]any)["acceptance_kind"] = "Current" }},
		{"zero_digest", func(m map[string]any) {
			m["accepted_specification"].(map[string]any)["binding_digest"] = "sha256:" + strings.Repeat("0", 64)
		}},
		{"accepted_space", func(m map[string]any) {
			m["required_ac_revisions"].([]any)[0].(map[string]any)["ac_id"] = "space allowed only legacy"
		}},
		{"duplicate_ac", func(m map[string]any) {
			m["required_ac_revisions"] = append(m["required_ac_revisions"].([]any), m["required_ac_revisions"].([]any)[0])
		}},
		{"duplicate_run", func(m map[string]any) { m["runs"] = append(m["runs"].([]any), m["runs"].([]any)[0]) }},
		{"duplicate_candidate", func(m map[string]any) { m["candidates"] = append(m["candidates"].([]any), m["candidates"].([]any)[0]) }},
		{"foreign_run", func(m map[string]any) { m["candidates"].([]any)[0].(map[string]any)["run_id"] = "run_01ARZ3NDEM" }},
		{"bad_enum", func(m map[string]any) { m["runs"].([]any)[0].(map[string]any)["observed_state"] = "TimedOut" }},
		{"epoch_time", func(m map[string]any) { m["runs"].([]any)[0].(map[string]any)["created_at"] = "1970-01-01T00:00:00Z" }},
		{"time_overflow", func(m map[string]any) {
			m["runs"].([]any)[0].(map[string]any)["created_at"] = "2262-04-11T23:47:16.854775808Z"
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data := mutateMaterialIndex(t, good, tc.change)
			if validate(data) == nil {
				t.Fatal("invalid wire accepted")
			}
			s := preparationServer(t, &commandStub{}, nil)
			s.projections = &materialIndexStub{data: data}
			w := preparationRequest(t, s, materialIndexPath, true)
			if w.Code != 503 || !strings.Contains(w.Body.String(), "storage_corruption") {
				t.Fatal(w.Code, w.Body)
			}
		})
	}
	for _, data := range [][]byte{[]byte("null"), []byte(`{"api_version":"v1","api_version":"v1"}`), append([]byte{0xff}, good...)} {
		if validate(data) == nil {
			t.Fatal("invalid JSON accepted")
		}
	}
}

func TestWorkItemMaterialIndexHTTP_BoundsAndCompatibility(t *testing.T) {
	validate := func(w materialIndexWire) error {
		return validateMaterialIndexWire(marshalMaterialIndex(t, w), testProjectID, "wi_01ARZ3NDEK")
	}
	for _, phase := range []string{"Draft", "Ready", "Developing", "Review", "QA", "Done", "Canceled"} {
		w := fullMaterialIndexFixture(t)
		w.Phase = phase
		if err := validate(w); err != nil {
			t.Fatal(phase, err)
		}
	}
	for _, kind := range []string{"Initial", "Impact"} {
		w := fullMaterialIndexFixture(t)
		w.Accepted.Kind = kind
		w.ACs[0].ACID = strings.Repeat("界", 40)
		if err := validate(w); err != nil {
			t.Fatal(err)
		}
	}
	w := fullMaterialIndexFixture(t)
	w.Accepted = nil
	w.ACs[0].ACID = "legacy /界"
	w.Candidates[0].Input = "sha256:" + domain.HashString("different historic input").String()
	if err := validate(w); err != nil {
		t.Fatal(err)
	}
	w.ACs[0].ACID = strings.Repeat("a", 81)
	if validate(w) == nil {
		t.Fatal("legacy81 accepted")
	}
	w = fullMaterialIndexFixture(t)
	w.Version = 1<<63 - 1
	w.RestoreGeneration = 1<<63 - 1
	w.Cursor = coverageCursorWire{Epoch: 1<<63 - 1, Sequence: 1<<63 - 1}
	w.Accepted.ItemVersion = 1<<63 - 1
	w.Accepted.ProjectVersion = 1<<63 - 1
	w.Runs[0].CreatedAt = time.Unix(0, 1<<63-1).UTC().Format(time.RFC3339Nano)
	w.Candidates[0].CreatedAt = w.Runs[0].CreatedAt
	if err := validate(w); err != nil {
		t.Fatal("valid int64 max", err)
	}
	w.Version++
	if validate(w) == nil {
		t.Fatal("int64 overflow accepted")
	}
	for _, collection := range []string{"ac", "run", "candidate"} {
		t.Run(collection, func(t *testing.T) {
			w := fullMaterialIndexFixture(t)
			switch collection {
			case "ac":
				w.ACs = nil
				for i := range 1024 {
					w.ACs = append(w.ACs, acRevisionWire{ACID: fmt.Sprintf("AC-%04d", i), RevisionDigest: w.Accepted.Binding})
				}
			case "run":
				base := w.Runs[0]
				w.Runs = nil
				w.Candidates = nil
				for i := range 1024 {
					r := base
					r.RunID = fmt.Sprintf("run_%010d", i)
					w.Runs = append(w.Runs, r)
				}
				w.Candidates = []materialIndexCandidateWire{}
			case "candidate":
				base := w.Candidates[0]
				w.Candidates = nil
				for i := range 1024 {
					c := base
					c.CandidateID = fmt.Sprintf("candidate-%04d", i)
					w.Candidates = append(w.Candidates, c)
				}
			}
			if err := validate(w); err != nil {
				t.Fatal("1024", err)
			}
			switch collection {
			case "ac":
				w.ACs = append(w.ACs, w.ACs[0])
			case "run":
				w.Runs = append(w.Runs, w.Runs[0])
			case "candidate":
				w.Candidates = append(w.Candidates, w.Candidates[0])
			}
			if err := validate(w); !errors.Is(err, port.ErrMaterialIndexCapacity) {
				t.Fatal("1025", err)
			}
		})
	}
	// Synthetic source bytes exercise the actual wire bound; whitespace does not
	// pretend real bounded metadata can naturally fill the entire4MiB response.
	b := materialIndexFixture()
	exact := append(b, []byte(strings.Repeat(" ", port.MaterialIndexWireLimit-len(b)))...)
	if err := validateMaterialIndexWire(exact, testProjectID, "wi_01ARZ3NDEK"); err != nil {
		t.Fatal("4MiB", err)
	}
	for _, tc := range []struct {
		data []byte
		want int
	}{{exact, 200}, {append(exact, ' '), 503}} {
		s := preparationServer(t, &commandStub{}, nil)
		s.projections = &materialIndexStub{data: tc.data}
		out := preparationRequest(t, s, materialIndexPath, true)
		if out.Code != tc.want {
			t.Fatal(out.Code, out.Body)
		}
		if tc.want == 503 && !strings.Contains(out.Body.String(), "material_index_capacity_exceeded") {
			t.Fatal(out.Body)
		}
	}
}

type materialIndexPortStub struct {
	port.PersistedProjectionReader
	value port.WorkItemMaterialIndex
	err   error
}

func (s materialIndexPortStub) ReadWorkItemMaterialIndex(context.Context, domain.ProjectID, domain.WorkItemID) (port.WorkItemMaterialIndex, error) {
	return s.value, s.err
}

func TestWorkItemMaterialIndexHTTP_PersistedAdapter(t *testing.T) {
	d := domain.HashString("material")
	v := port.WorkItemMaterialIndex{ProjectID: testProjectID, WorkItemID: "wi_01ARZ3NDEK", Title: "Title", Goal: "Goal", OwnerID: "actor", Phase: domain.PhaseReview, Version: 3, RestoreGeneration: 1, Cursor: port.Cursor{Epoch: 1}, Runs: []port.MaterialIndexRun{{RunID: "run_01ARZ3NDEK", InputDigest: d, CreatedAtNS: 1, DesiredAction: "None", DispatchState: "Acknowledged", ObservedState: "Succeeded", ReconciliationState: "Reconciled", SideEffectOutcome: "Confirmed"}}}
	b, e := (PersistedProjections{Store: materialIndexPortStub{value: v}}).DescribeWorkItemMaterialIndex(t.Context(), testProjectID, "wi_01ARZ3NDEK")
	if e != nil {
		t.Fatal(e)
	}
	var w materialIndexWire
	if e = json.Unmarshal(b, &w); e != nil {
		t.Fatal(e)
	}
	if w.Runs[0].Reconciliation != "Resolved" || w.ACs == nil || w.Candidates == nil || w.Accepted != nil {
		t.Fatalf("adapter result %+v", w)
	}
	for _, tc := range []struct {
		name   string
		change func(*port.WorkItemMaterialIndex)
	}{
		{"foreign_scope", func(v *port.WorkItemMaterialIndex) { v.ProjectID = "prj_01ARZ3NDEM" }},
		{"zero_time", func(v *port.WorkItemMaterialIndex) { v.Runs[0].CreatedAtNS = 0 }},
		{"negative_time", func(v *port.WorkItemMaterialIndex) { v.Runs[0].CreatedAtNS = -1 }},
		{"cursor_overflow", func(v *port.WorkItemMaterialIndex) { v.Cursor.Sequence = 1 << 63 }},
		{"zero_digest", func(v *port.WorkItemMaterialIndex) { v.Runs[0].InputDigest = domain.Digest{} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			copy := v
			copy.Runs = append([]port.MaterialIndexRun{}, v.Runs...)
			tc.change(&copy)
			if data, err := (PersistedProjections{Store: materialIndexPortStub{value: copy}}).DescribeWorkItemMaterialIndex(t.Context(), testProjectID, "wi_01ARZ3NDEK"); data != nil || !errors.Is(err, ErrProjectionCorrupt) {
				t.Fatal(string(data), err)
			}
		})
	}
	if b, e := (PersistedProjections{}).DescribeWorkItemMaterialIndex(t.Context(), testProjectID, "wi_01ARZ3NDEK"); b != nil || e == nil {
		t.Fatal("missing store capability succeeded")
	}
}
