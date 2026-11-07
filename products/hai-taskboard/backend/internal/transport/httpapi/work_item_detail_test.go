package httpapi

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const workItemDetailPath = "/api/v1/projects/prj_01ARZ3NDEK/work-items/wi_01ARZ3NDEK"

type workItemDetailStub struct {
	ProjectionSource
	data  []byte
	err   error
	reads int
}

func (s *workItemDetailStub) DescribeWorkItemDetail(context.Context, domain.ProjectID, domain.WorkItemID) ([]byte, error) {
	s.reads++
	return s.data, s.err
}

func workItemDetailFixture() []byte {
	return []byte(`{"api_version":"v1","kind":"work_item_detail/v1","observation_only":true,` +
		`"summary":{"work_item_id":"wi_01ARZ3NDEK","title":"Index","phase":"Draft","version":1,"human_owner_id":"actor","effective_satisfied":false,"required_ac_count":0,"covered_ac_count":0,"active_blocker_count":0,"conditions":[]},` +
		`"material":` + string(materialIndexFixture()) + `,` +
		`"blockers":[],"reviews":[],"evidence":[],"approvals":[],"completion_records":[],"audit":[]}`)
}

// TestWorkItemDetailHTTP_ScopeAndPrecedence is DTL-AC-01: IDX-01 precedence on the detail route.
func TestWorkItemDetailHTTP_ScopeAndPrecedence(t *testing.T) {
	for _, tc := range []struct {
		name, path, method string
		session, denied    bool
		want, reads        int
	}{
		{"success", workItemDetailPath, "GET", true, false, 200, 1},
		{"anonymous", workItemDetailPath, "GET", false, false, 401, 0},
		{"anonymous_query", workItemDetailPath + "?x=1", "GET", false, false, 401, 0},
		{"denied_query", workItemDetailPath + "?x=1", "GET", true, true, 404, 0},
		{"query", workItemDetailPath + "?x=1", "GET", true, false, 400, 0},
		{"force_query", workItemDetailPath + "?", "GET", true, false, 400, 0},
		{"head", workItemDetailPath, "HEAD", true, false, 405, 0},
		{"anonymous_post", workItemDetailPath, "POST", false, false, 405, 0},
		{"dotdot_item", strings.Replace(workItemDetailPath, "wi_01ARZ3NDEK", "..", 1), "GET", true, false, 404, 0},
		{"head_dot", strings.Replace(workItemDetailPath, "wi_01ARZ3NDEK", ".", 1), "HEAD", false, false, 405, 0},
		{"encoded_head", strings.Replace(workItemDetailPath, "wi_", "wi%5F", 1), "HEAD", false, false, 400, 0},
		{"double_slash", strings.Replace(workItemDetailPath, "/work-items/", "//work-items/", 1), "GET", true, false, 400, 0},
		{"invalid_item", strings.Replace(workItemDetailPath, "wi_01ARZ3NDEK", "other", 1), "GET", true, false, 404, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := &authorityStub{}
			if tc.denied {
				a.projectErr = ErrPermissionDenied
			}
			source := &workItemDetailStub{data: workItemDetailFixture()}
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
	t.Run("body", func(t *testing.T) {
		source := &workItemDetailStub{data: workItemDetailFixture()}
		s := preparationServer(t, &commandStub{}, nil)
		s.projections = source
		r := httptest.NewRequest("GET", workItemDetailPath, strings.NewReader("{}"))
		addSession(r)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 400 || source.reads != 0 {
			t.Fatalf("%d %d", w.Code, source.reads)
		}
	})
	for _, failure := range []struct {
		name, reason string
		data         []byte
		err          error
		status       int
	}{
		{"missing", "", nil, port.ErrNotFound, 404},
		{"corrupt", "", nil, domain.StorageCorruptionError{Reason: "x"}, 503},
		{"capacity", "work_item_detail_capacity_exceeded", nil, port.ErrWorkItemDetailCapacity, 503},
		{"material_capacity", "work_item_detail_capacity_exceeded", nil, port.ErrMaterialIndexCapacity, 503},
		{"unavailable", "", nil, errors.New("down"), 503},
		{"open_wire", "", []byte(strings.Replace(string(workItemDetailFixture()), `"audit":[]`, `"audit":[],"extra":1`, 1)), nil, 503},
		{"other_item", "", []byte(strings.Replace(string(workItemDetailFixture()), `"summary":{"work_item_id":"wi_01ARZ3NDEK"`, `"summary":{"work_item_id":"wi_01ARZ3NDEX"`, 1)), nil, 503},
	} {
		t.Run(failure.name, func(t *testing.T) {
			source := &workItemDetailStub{data: failure.data, err: failure.err}
			s := preparationServer(t, &commandStub{}, nil)
			s.projections = source
			r := httptest.NewRequest("GET", workItemDetailPath, nil)
			addSession(r)
			w := httptest.NewRecorder()
			s.ServeHTTP(w, r)
			if w.Code != failure.status || !strings.Contains(w.Body.String(), failure.reason) || strings.Contains(w.Body.String(), "down") {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
		})
	}
}
