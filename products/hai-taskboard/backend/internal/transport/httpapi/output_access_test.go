package httpapi

import (
	"context"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const outputListPath = "/api/v1/projects/prj_01ARZ3NDEK/work-items/wi_01ARZ3NDEK/runs/run_01ARZ3NDEK/outputs"

func TestOutputAccessHTTP_RoutesRequireAuthenticationAndCapability(t *testing.T) {
	for _, path := range []string{outputListPath, "/api/v1/projects/prj_01ARZ3NDEK/artifacts/sha256:" + strings.Repeat("a", 64)} {
		for _, session := range []bool{false, true} {
			w := preparationRequest(t, preparationServer(t, &commandStub{}, nil), path, session)
			want := 401
			if session {
				want = 503
			}
			if w.Code != want || w.Header().Get("Cache-Control") != "no-store" {
				t.Errorf("path %s session %v: got %d %s want %d", path, session, w.Code, w.Body, want)
			}
		}
	}
}

type outputAccessReader struct {
	commandStub
	data         []byte
	content      []byte
	err          error
	lists, opens int
	after        func()
}

func (s *outputAccessReader) DescribeRunOutputs(_ context.Context, a domain.ActorID, p domain.ProjectID, w domain.WorkItemID, r domain.RunID) ([]byte, error) {
	s.lists++
	if s.after != nil {
		s.after()
	}
	if a != "actor" || p != testProjectID || w != "wi_01ARZ3NDEK" || r != "run_01ARZ3NDEK" {
		return nil, port.ErrNotFound
	}
	return s.data, s.err
}
func (s *outputAccessReader) ReadOutputArtifact(_ context.Context, a domain.ActorID, p domain.ProjectID, d domain.Digest) ([]byte, error) {
	s.opens++
	if s.after != nil {
		s.after()
	}
	if a != "actor" || p != testProjectID || d != domain.HashString("safe output") {
		return nil, port.ErrNotFound
	}
	return s.content, s.err
}
func outputAccessFixture() []byte {
	d := "sha256:" + domain.HashString("safe output").String()
	return []byte(`{"project_id":"prj_01ARZ3NDEK","work_item_id":"wi_01ARZ3NDEK","run_id":"run_01ARZ3NDEK","outputs":[{"input_digest":"` + d + `","lease_epoch":1,"restore_generation":1,"artifact":{"sha256":"` + d + `","media_type":"text/plain","byte_length":11,"availability":"Present","href":"/api/v1/projects/prj_01ARZ3NDEK/artifacts/` + d + `","disposition":"attachment"}}]}`)
}
func TestOutputAccessHTTP_AuthScopePaths(t *testing.T) {
	for _, tc := range []struct {
		name, path         string
		session, forbidden bool
		status, reads      int
	}{
		{"anonymous", outputListPath, false, false, 401, 0}, {"denied", outputListPath, true, true, 404, 0}, {"valid", outputListPath, true, false, 200, 1},
		{"wrong_item", strings.Replace(outputListPath, "wi_01ARZ3NDEK", "wi_01ARZ3NDEM", 1), true, false, 404, 1},
		{"wrong_run", strings.Replace(outputListPath, "run_01ARZ3NDEK", "run_01ARZ3NDEM", 1), true, false, 404, 1},
		{"bad_run", strings.Replace(outputListPath, "run_01ARZ3NDEK", "invalid", 1), true, false, 404, 0},
		{"project_dot", strings.Replace(outputListPath, "prj_01ARZ3NDEK", ".", 1), true, false, 404, 0},
		{"item_dot", strings.Replace(outputListPath, "wi_01ARZ3NDEK", "..", 1), true, false, 404, 0},
		{"run_dot", strings.Replace(outputListPath, "run_01ARZ3NDEK", ".", 1), true, false, 404, 0},
		{"encoded", strings.Replace(outputListPath, "run_", "run%5F", 1), true, false, 400, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := &outputAccessReader{data: outputAccessFixture()}
			a := &authorityStub{}
			if tc.forbidden {
				a.projectErr = ErrPermissionDenied
			}
			w := preparationRequest(t, preparationServer(t, c, a), tc.path, tc.session)
			if w.Code != tc.status || c.lists != tc.reads || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("status=%d reads=%d %s", w.Code, c.lists, w.Body)
			}
		})
	}
}
func TestOutputAccessHTTP_StrictAndSanitized(t *testing.T) {
	good := string(outputAccessFixture())
	for name, data := range map[string]string{
		"valid": good, "null": "null", "empty": "", "unknown": strings.Replace(good, `"lease_epoch":1`, `"other":1,"lease_epoch":1`, 1),
		"missing": strings.Replace(good, `"lease_epoch":1,`, "", 1), "zero": strings.Replace(good, `"lease_epoch":1`, `"lease_epoch":0`, 1),
		"overflow":  strings.Replace(good, `"lease_epoch":1`, `"lease_epoch":9223372036854775808`, 1),
		"duplicate": strings.Replace(good, `"lease_epoch":1`, `"lease_epoch":1,"lease_epoch":1`, 1),
		"scope":     strings.Replace(good, `"project_id":"prj_01ARZ3NDEK"`, `"project_id":"prj_01ARZ3NDEM"`, 1),
		"href":      strings.Replace(good, `/api/v1/projects/prj_01ARZ3NDEK/artifacts/`, `https://evil/`, 1),
		"oversized": strings.Repeat(" ", 1<<20) + good,
	} {
		t.Run(name, func(t *testing.T) {
			w := preparationRequest(t, preparationServer(t, &outputAccessReader{data: []byte(data)}, nil), outputListPath, true)
			want := 503
			if name == "valid" {
				want = 200
			}
			if w.Code != want {
				t.Fatalf("got %d %s", w.Code, w.Body)
			}
		})
	}
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{port.ErrNotFound, 404, "not_found"}, {domain.StorageCorruptionError{Reason: "/private/leak"}, 503, "storage_corruption"}, {errors.New("/private/leak"), 503, "projection_unavailable"}, {context.Canceled, 503, "projection_unavailable"},
	} {
		w := preparationRequest(t, preparationServer(t, &outputAccessReader{err: tc.err}, nil), outputListPath, true)
		if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.code) || strings.Contains(w.Body.String(), "private") {
			t.Fatal(w.Code, w.Body)
		}
	}
}
func TestOutputAccessHTTP_VerifiedAttachment(t *testing.T) {
	d := domain.HashString("safe output")
	path := "/api/v1/projects/prj_01ARZ3NDEK/artifacts/sha256:" + d.String()
	c := &outputAccessReader{content: []byte("safe output")}
	server := preparationServer(t, c, nil)
	r := httptest.NewRequest(http.MethodGet, path, nil)
	addSession(r)
	r.Header.Set("Range", "bytes=0-1")
	r.Header.Set("If-None-Match", `"sha256:`+d.String()+`"`)
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	if w.Code != 200 || w.Body.String() != "safe output" || w.Header().Get("Content-Type") != "application/octet-stream" || w.Header().Get("Content-Disposition") != `attachment; filename="`+d.String()+`.bin"` || w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("ETag") != `"sha256:`+d.String()+`"` {
		t.Fatal(w.Code, w.Header(), w.Body)
	}
	for name, want := range map[string]string{
		"Content-Security-Policy":      "sandbox; default-src 'none'",
		"Cross-Origin-Resource-Policy": "same-origin",
		"Accept-Ranges":                "none",
		"Content-Length":               "11",
	} {
		if got := w.Header().Get(name); got != want {
			t.Fatalf("%s = %q, want %q", name, got, want)
		}
	}
	c.content = []byte("tampered")
	w = preparationRequest(t, server, path, true)
	if w.Code != 503 || strings.Contains(w.Body.String(), "tampered") {
		t.Fatal(w.Code, w.Body)
	}
}

func TestOutputAccessHTTP_RequiredFieldsAndCollectionBounds(t *testing.T) {
	var raw map[string]any
	if err := json.Unmarshal(outputAccessFixture(), &raw); err != nil {
		t.Fatal(err)
	}
	check := func(want int) {
		t.Helper()
		data, err := json.Marshal(raw)
		if err != nil {
			t.Fatal(err)
		}
		w := preparationRequest(t, preparationServer(t, &outputAccessReader{data: data}, nil), outputListPath, true)
		if w.Code != want {
			t.Fatalf("want %d got %d %s", want, w.Code, w.Body)
		}
	}
	var visit func(map[string]any)
	visit = func(obj map[string]any) {
		for key, value := range obj {
			delete(obj, key)
			check(503)
			obj[key] = nil
			check(503)
			obj[key] = value
			switch child := value.(type) {
			case map[string]any:
				visit(child)
			case []any:
				for _, v := range child {
					if m, ok := v.(map[string]any); ok {
						visit(m)
					}
				}
			}
		}
	}
	visit(raw)
	original := raw["outputs"].([]any)[0]
	raw["outputs"] = []any{}
	check(200)
	entries := make([]any, 1024)
	for i := range entries {
		var entry map[string]any
		data, _ := json.Marshal(original)
		if err := json.Unmarshal(data, &entry); err != nil {
			t.Fatal(err)
		}
		artifact := entry["artifact"].(map[string]any)
		digest := fmt.Sprintf("sha256:%064x", i+1)
		artifact["sha256"] = digest
		artifact["href"] = "/api/v1/projects/prj_01ARZ3NDEK/artifacts/" + digest
		entries[i] = entry
	}
	raw["outputs"] = entries
	check(200)
	raw["outputs"] = append(entries, original)
	check(503)
	raw["outputs"] = []any{entries[1], entries[0]}
	check(503)
	raw["outputs"] = []any{entries[0], entries[0]}
	check(503)
}
func TestOutputAccessHTTP_HEADAndArtifactPaths(t *testing.T) {
	path := "/api/v1/projects/prj_01ARZ3NDEK/artifacts/sha256:" + domain.HashString("safe output").String()
	for _, p := range []string{outputListPath, path} {
		for _, session := range []bool{false, true} {
			c := &outputAccessReader{data: outputAccessFixture(), content: []byte("safe output")}
			r := httptest.NewRequest(http.MethodHead, p, nil)
			if session {
				addSession(r)
			}
			w := httptest.NewRecorder()
			preparationServer(t, c, nil).ServeHTTP(w, r)
			want := 401
			if session {
				want = 405
			}
			if w.Code != want || c.lists+c.opens != 0 || session && w.Header().Get("Allow") != "GET" || w.Header().Get("ETag") != "" {
				t.Fatal(w.Code, w.Header(), c.lists, c.opens)
			}
		}
	}
	for _, tc := range []struct {
		path   string
		status int
	}{
		{strings.Replace(path, "prj_01ARZ3NDEK", ".", 1), 404}, {"/api/v1/projects/prj_01ARZ3NDEK/artifacts/..", 404},
		{strings.Replace(path, "sha256:", "sha256%3A", 1), 400}, {strings.Replace(path, "sha256:", "", 1), 404}, {strings.Replace(path, "/artifacts/", "//artifacts/", 1), 400}, {path + "/", 404},
	} {
		c := &outputAccessReader{}
		w := preparationRequest(t, preparationServer(t, c, nil), tc.path, true)
		if w.Code != tc.status || c.opens != 0 {
			t.Fatal(w.Code, w.Body, c.opens)
		}
	}
}

func TestOutputAccessHTTP_PublicationChecksRevocationAndCancellation(t *testing.T) {
	for _, path := range []string{outputListPath, "/api/v1/projects/prj_01ARZ3NDEK/artifacts/sha256:" + domain.HashString("safe output").String()} {
		for _, kind := range []string{"revoked", "canceled"} {
			t.Run(kind+path, func(t *testing.T) {
				revoked := make(chan struct{})
				ctx, cancel := context.WithCancel(t.Context())
				defer cancel()
				c := &outputAccessReader{data: outputAccessFixture(), content: []byte("safe output"), after: func() {
					if kind == "revoked" {
						close(revoked)
					} else {
						cancel()
					}
				}}
				a := &authorityStub{revoked: revoked}
				r := httptest.NewRequest(http.MethodGet, path, nil).WithContext(ctx)
				addSession(r)
				w := httptest.NewRecorder()
				preparationServer(t, c, a).ServeHTTP(w, r)
				want := 401
				if kind == "canceled" {
					want = 503
				}
				if w.Code != want || strings.Contains(w.Body.String(), "safe output") || w.Header().Get("Content-Disposition") != "" || w.Header().Get("ETag") != "" || w.Header().Get("Cache-Control") != "no-store" {
					t.Fatal(w.Code, w.Header(), w.Body)
				}
			})
		}
	}
}
