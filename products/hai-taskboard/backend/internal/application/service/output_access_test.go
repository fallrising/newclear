package service

import (
	"bytes"
	"context"
	json "encoding/json/v2"
	"errors"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func accessHTTP(t *testing.T, f currentFlow, path string) *httptest.ResponseRecorder {
	t.Helper()
	server, err := httpapi.NewServer(f.svc, httpapi.UnitCommandResults{Unit: f.svc.unit}, httpapi.PersistedProjections{Store: f.store}, preparationSession{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, path, nil)
	r.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: "test"})
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	return w
}
func accessListPath(f currentFlow) string {
	return "/api/v1/projects/" + string(projectID) + "/work-items/" + string(workItemID) + "/runs/" + string(f.candidate.RunID) + "/outputs"
}
func accessBytesPath(f currentFlow) string {
	return "/api/v1/projects/" + string(projectID) + "/artifacts/sha256:" + f.candidate.Candidate.Digest.String()
}
func TestOutputAccess_ActualHTTPRepeatedReopenedNoWrites(t *testing.T) {
	f := acceptedCurrentFlow(t, 0)
	before := preparationDatabaseSnapshot(t, f.db)
	first := accessHTTP(t, f, accessListPath(f))
	if first.Code != 200 {
		t.Fatal(first.Code, first.Body)
	}
	var listing struct {
		Outputs []struct {
			Input      string `json:"input_digest"`
			Epoch      uint64 `json:"lease_epoch"`
			Generation uint64 `json:"restore_generation"`
			Artifact   struct {
				Href string `json:"href"`
			} `json:"artifact"`
		} `json:"outputs"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &listing); err != nil || len(listing.Outputs) != 1 || listing.Outputs[0].Input != "sha256:"+f.candidate.Candidate.InputSubjectDigest.String() || listing.Outputs[0].Epoch != 1 || listing.Outputs[0].Generation != 1 {
		t.Fatal(first.Body, err)
	}
	if listing.Outputs[0].Artifact.Href != accessBytesPath(f) {
		t.Fatal("wrong artifact link", listing.Outputs[0].Artifact.Href)
	}
	linked := accessHTTP(t, f, listing.Outputs[0].Artifact.Href)
	if linked.Code != 200 || linked.Body.String() != "candidate" {
		t.Fatal("returned href failed", linked.Code, linked.Body)
	}
	for range 2 {
		w := accessHTTP(t, f, accessListPath(f))
		if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), first.Body.Bytes()) {
			t.Fatal(w.Code, w.Body)
		}
		w = accessHTTP(t, f, accessBytesPath(f))
		if w.Code != 200 || w.Body.String() != "candidate" {
			t.Fatal(w.Code, w.Body)
		}
	}
	if !bytes.Equal(before, preparationDatabaseSnapshot(t, f.db)) {
		t.Fatal("GET wrote persisted tables")
	}
	for _, statement := range []string{"DELETE FROM run_leases", "UPDATE work_item_spec_heads SET head_version=head_version+1", "UPDATE instance_state SET restore_generation=restore_generation+1"} {
		if _, err := f.db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	before = preparationDatabaseSnapshot(t, f.db)
	var seq int
	var name, path string
	if err := f.db.QueryRow("PRAGMA database_list").Scan(&seq, &name, &path); err != nil {
		t.Fatal(err)
	}
	if err := f.store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := sqlite.OpenAtRootWithClock(t.Context(), filepath.Dir(path), path, fixedTime)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	f.store = reopened
	f.svc.unit = reopened
	w := accessHTTP(t, f, accessListPath(f))
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), first.Body.Bytes()) {
		t.Fatal("reopened history", w.Code, w.Body)
	}
	w = accessHTTP(t, f, accessBytesPath(f))
	if w.Code != 200 || w.Body.String() != "candidate" {
		t.Fatal(w.Code, w.Body)
	}
	if !bytes.Equal(before, preparationDatabaseSnapshot(t, f.db)) {
		t.Fatal("reopened GET wrote persisted tables")
	}
}

type accessArtifactStore struct {
	port.ArtifactStore
	open func(context.Context, domain.Digest) (io.ReadCloser, error)
}

func (s accessArtifactStore) Open(ctx context.Context, d domain.Digest) (io.ReadCloser, error) {
	return s.open(ctx, d)
}

type accessBrokenReader struct {
	io.Reader
	readErr, closeErr error
}

func (r accessBrokenReader) Read(p []byte) (int, error) {
	if r.readErr != nil {
		return 0, r.readErr
	}
	return r.Reader.Read(p)
}
func (r accessBrokenReader) Close() error { return r.closeErr }
func TestOutputAccess_DenialsAndByteFailuresNoWrites(t *testing.T) {
	var notFoundBody []byte
	for _, kind := range []string{"unauthorized", "wrong_item", "wrong_run", "wrong_project", "unbound", "missing", "tamper", "truncated", "oversized", "read", "close", "reader_cancel_error", "active", "metadata"} {
		t.Run(kind, func(t *testing.T) {
			f := acceptedCurrentFlow(t, 0)
			path := accessBytesPath(f)
			want := 503
			opened := 0
			content := "candidate"
			var openErr, readErr, closeErr error
			switch kind {
			case "unauthorized":
				f.svc.config.Operator = "other"
				want = 404
			case "wrong_item":
				path = strings.Replace(accessListPath(f), string(workItemID), "wi_0000000001", 1)
				want = 404
			case "wrong_run":
				path = strings.Replace(accessListPath(f), string(f.candidate.RunID), "run_0000000001", 1)
				want = 404
			case "wrong_project":
				path = strings.Replace(path, string(projectID), "prj_0000000001", 1)
				want = 404
			case "unbound":
				path = strings.Replace(path, f.candidate.Candidate.Digest.String(), domain.HashString("unbound").String(), 1)
				want = 404
			case "missing":
				openErr = port.ErrNotFound
			case "tamper":
				content = "tampering"
			case "truncated":
				content = "short"
			case "oversized":
				content = strings.Repeat("x", (10<<20)+1)
			case "read":
				readErr = errors.New("/private/read")
			case "close":
				closeErr = errors.New("/private/close")
			case "reader_cancel_error":
				readErr = context.Canceled
			case "active", "metadata":
				media := "text/html"
				if kind == "metadata" {
					media = "invalid"
				}
				if _, err := f.db.Exec("DROP TRIGGER artifacts_immutable_update; UPDATE artifacts SET media_type=?", media); err != nil {
					t.Fatal(err)
				}
				if kind == "active" {
					want = 422
				}
			}
			f.svc.artifacts = accessArtifactStore{open: func(ctx context.Context, d domain.Digest) (io.ReadCloser, error) {
				opened++
				if openErr != nil {
					return nil, openErr
				}
				return accessBrokenReader{Reader: strings.NewReader(content), readErr: readErr, closeErr: closeErr}, nil
			}}
			before := preparationDatabaseSnapshot(t, f.db)
			w := accessHTTP(t, f, path)
			if w.Code != want || strings.Contains(w.Body.String(), "candidate") || strings.Contains(w.Body.String(), "private") || strings.Contains(w.Body.String(), "tampering") {
				t.Fatal(w.Code, w.Body)
			}
			wantCode := command.CodeStorageCorruption
			switch {
			case want == 404:
				wantCode = command.CodeNotFound
			case want == 422:
				wantCode = command.CodeLifecycleRejected
			case kind == "missing":
				wantCode = command.CodeProjectionUnavailable
			}
			var envelope struct {
				Error struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil || envelope.Error.Code != wantCode {
				t.Fatalf("%s: expected code %s, got %s (%v)", kind, wantCode, w.Body, err)
			}
			if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" || w.Header().Get("Content-Disposition") != "" || w.Header().Get("ETag") != "" {
				t.Fatal("unsafe error headers", w.Header())
			}
			if want == 404 {
				if envelope.Error.Message != "resource is unavailable" {
					t.Fatal("404 disclosed scope", w.Body)
				}
				if notFoundBody == nil {
					notFoundBody = bytes.Clone(w.Body.Bytes())
				} else if !bytes.Equal(notFoundBody, w.Body.Bytes()) {
					t.Fatal("404 response differs by scope", w.Body)
				}
			}
			if (want == 404 || kind == "active" || kind == "metadata") && opened != 0 {
				t.Fatal("denied read opened bytes", opened)
			}
			if !bytes.Equal(before, preparationDatabaseSnapshot(t, f.db)) {
				t.Fatal("failure changed persisted tables")
			}
		})
	}
}

type accessFinalUnit struct {
	base   port.UnitOfWork
	mutate func([]port.RunOutput) ([]port.RunOutput, error)
	calls  int
	inside bool
}

func (u *accessFinalUnit) Within(ctx context.Context, f func(port.Transaction) error) error {
	u.calls++
	return u.base.Within(ctx, func(tx port.Transaction) error {
		u.inside = true
		defer func() { u.inside = false }()
		return f(accessFinalTx{RunOutputReadTransaction: tx.(port.RunOutputReadTransaction), mutate: u.mutate, final: u.calls == 2})
	})
}

type accessFinalTx struct {
	port.RunOutputReadTransaction
	mutate func([]port.RunOutput) ([]port.RunOutput, error)
	final  bool
}

func (tx accessFinalTx) LoadRunOutputs(ctx context.Context, p domain.ProjectID, r domain.RunID) ([]port.RunOutput, error) {
	rows, err := tx.RunOutputReadTransaction.LoadRunOutputs(ctx, p, r)
	if err != nil || !tx.final {
		return rows, err
	}
	return tx.mutate(rows)
}
func TestOutputAccess_RechecksBindingOutsideTransaction(t *testing.T) {
	for _, kind := range []string{"binding", "metadata", "deleted"} {
		t.Run(kind, func(t *testing.T) {
			f := acceptedCurrentFlow(t, 0)
			unit := &accessFinalUnit{base: f.store, mutate: func(rows []port.RunOutput) ([]port.RunOutput, error) {
				switch kind {
				case "binding":
					rows[0].LeaseEpoch++
				case "metadata":
					rows[0].Artifact.MediaType = "application/octet-stream"
				case "deleted":
					return nil, port.ErrNotFound
				}
				return rows, nil
			}}
			f.svc.unit = unit
			opened := false
			f.svc.artifacts = accessArtifactStore{open: func(ctx context.Context, d domain.Digest) (io.ReadCloser, error) {
				if unit.inside {
					t.Fatal("Open inside writer transaction")
				}
				opened = true
				return io.NopCloser(strings.NewReader("candidate")), nil
			}}
			before := preparationDatabaseSnapshot(t, f.db)
			w := accessHTTP(t, f, accessBytesPath(f))
			if !opened || unit.calls != 2 || w.Code != 503 || !strings.Contains(w.Body.String(), "storage_corruption") {
				t.Fatal(opened, unit.calls, w.Code, w.Body)
			}
			if !bytes.Equal(before, preparationDatabaseSnapshot(t, f.db)) {
				t.Fatal("changed-binding rejection wrote database")
			}
		})
	}
}
func TestOutputAccess_NewEarlierBindingDoesNotReplaceSelectedRun(t *testing.T) {
	f := acceptedCurrentFlow(t, 0)
	changed := false
	f.svc.artifacts = changingCurrentArtifacts{base: f.svc.artifacts, after: func() {
		if changed {
			return
		}
		changed = true
		for _, statement := range []string{
			"INSERT INTO runs SELECT project_id,'run_0000000001',work_item_id,input_digest,adapter_id,adapter_version,scenario_id,attempt,desired_action,dispatch_state,observed_state,reconciliation_state,side_effect_outcome,created_at_ns FROM runs LIMIT 1",
			"INSERT INTO run_output_artifacts SELECT project_id,'run_0000000001',artifact_digest,input_digest,lease_epoch+1,restore_generation FROM run_output_artifacts LIMIT 1",
		} {
			if _, err := f.db.Exec(statement); err != nil {
				t.Fatal(err)
			}
		}
	}}
	w := accessHTTP(t, f, accessBytesPath(f))
	if !changed || w.Code != 200 || w.Body.String() != "candidate" {
		t.Fatal(changed, w.Code, w.Body)
	}
}

type accessNilReader struct{}

func (*accessNilReader) Read([]byte) (int, error) { panic("typed-nil reader used") }
func (*accessNilReader) Close() error             { panic("typed-nil reader closed") }
func TestOutputAccess_TypedNilAndCanceledContext(t *testing.T) {
	for _, kind := range []string{"typed_nil", "typed_nil_error", "canceled_open", "canceled_read"} {
		t.Run(kind, func(t *testing.T) {
			f := acceptedCurrentFlow(t, 0)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			f.svc.artifacts = accessArtifactStore{open: func(context.Context, domain.Digest) (io.ReadCloser, error) {
				if kind == "typed_nil" {
					return (*accessNilReader)(nil), nil
				}
				if kind == "typed_nil_error" {
					return (*accessNilReader)(nil), errors.New("/private")
				}
				cancel()
				if kind == "canceled_open" {
					return nil, errors.New("/private")
				}
				return accessBrokenReader{readErr: errors.New("/private"), closeErr: errors.New("/private")}, nil
			}}
			before := preparationDatabaseSnapshot(t, f.db)
			data, err := f.svc.ReadOutputArtifact(ctx, operator, projectID, f.candidate.Candidate.Digest)
			if data != nil || err == nil {
				t.Fatal(data, err)
			}
			if strings.HasPrefix(kind, "canceled") && !errors.Is(err, context.Canceled) {
				t.Fatal("context cancellation lost", err)
			}
			if !strings.HasPrefix(kind, "canceled") {
				e, ok := errors.AsType[*command.Error](err)
				if !ok || e.Code != command.CodeProjectionUnavailable {
					t.Fatal("typed nil classification", err)
				}
			}
			if !bytes.Equal(before, preparationDatabaseSnapshot(t, f.db)) {
				t.Fatal("error wrote database")
			}
		})
	}
}
func TestOutputAccess_ByteBoundsAndMediaPolicy(t *testing.T) {
	for _, tc := range []struct {
		name, media string
		size        int
		status      int
	}{
		{"empty", "text/plain", 0, 200}, {"exact_limit", "application/octet-stream", 10 << 20, 200}, {"over_limit", "text/plain", (10 << 20) + 1, 503},
		{"utf8", "text/plain; charset=UTF-8", 7, 200}, {"markdown", "text/markdown; charset=utf-8", 7, 200}, {"json", "application/json", 7, 200},
		{"octet_params", "application/octet-stream; charset=utf-8", 7, 422}, {"other_charset", "text/plain; charset=iso-8859-1", 7, 422}, {"html", "text/html", 7, 422}, {"svg", "image/svg+xml", 7, 422}, {"script", "application/javascript", 7, 422}, {"xml", "application/xml", 7, 422},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, store, db, e, q := acceptedSucceededInput(t)
			f := currentFlow{svc: svc, store: store, db: db, candidate: q}
			content := bytes.Repeat([]byte("x"), tc.size)
			digest := domain.HashBytes(content)
			if err := store.Within(t.Context(), func(tx port.Transaction) error {
				if err := tx.StoreArtifact(t.Context(), port.Artifact{Digest: digest, MediaType: tc.media, ByteLength: uint64(tc.size), StorageKey: artifactStorageKey(digest), Availability: "Present"}); err != nil {
					return err
				}
				return tx.(port.RunOutputTransaction).StoreRunOutput(t.Context(), port.RunOutputWrite{Fence: e.Fence, ArtifactDigest: digest, PublishedAtNS: fixedTime().UnixNano()})
			}); err != nil {
				t.Fatal(err)
			}
			opened := 0
			svc.artifacts = accessArtifactStore{open: func(context.Context, domain.Digest) (io.ReadCloser, error) {
				opened++
				return io.NopCloser(bytes.NewReader(content)), nil
			}}
			before := preparationDatabaseSnapshot(t, db)
			w := accessHTTP(t, f, "/api/v1/projects/"+string(projectID)+"/artifacts/sha256:"+digest.String())
			if w.Code != tc.status {
				t.Fatal(w.Code, w.Body)
			}
			if tc.status == 200 && !bytes.Equal(w.Body.Bytes(), content) {
				t.Fatal("wrong exact bytes")
			}
			if tc.status != 200 && opened != 0 {
				t.Fatal("rejected metadata/type opened bytes")
			}
			list := accessHTTP(t, f, accessListPath(f))
			want := 200
			if tc.name == "over_limit" {
				want = 503
			}
			if list.Code != want {
				t.Fatal("list bound/type policy", list.Code, list.Body)
			}
			if !bytes.Equal(before, preparationDatabaseSnapshot(t, db)) {
				t.Fatal("bound/type read wrote database")
			}
		})
	}
}
func TestOutputAccess_SameDigestRequiresIndependentProjectBinding(t *testing.T) {
	f := acceptedCurrentFlow(t, 0)
	foreign := domain.ProjectID("prj_0000000001")
	data, err := f.svc.ReadOutputArtifact(t.Context(), operator, foreign, f.candidate.Candidate.Digest)
	if !errors.Is(err, port.ErrNotFound) || data != nil {
		t.Fatal("unbound foreign access", err)
	}
	for _, statement := range []string{
		"INSERT INTO projects SELECT 'prj_0000000001','Foreign fixture',repository,repository_ref,version FROM projects LIMIT 1",
		"INSERT INTO work_items SELECT 'prj_0000000001',work_item_id,title,goal,owner_id,phase,version FROM work_items LIMIT 1",
		"INSERT INTO runs SELECT 'prj_0000000001',run_id,work_item_id,input_digest,adapter_id,adapter_version,scenario_id,attempt,desired_action,dispatch_state,observed_state,reconciliation_state,side_effect_outcome,created_at_ns FROM runs LIMIT 1",
		"INSERT INTO run_output_artifacts SELECT 'prj_0000000001',run_id,artifact_digest,input_digest,lease_epoch,restore_generation FROM run_output_artifacts LIMIT 1",
	} {
		if _, err := f.db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	before := preparationDatabaseSnapshot(t, f.db)
	for _, p := range []domain.ProjectID{projectID, foreign} {
		data, err = f.svc.ReadOutputArtifact(t.Context(), operator, p, f.candidate.Candidate.Digest)
		if err != nil || string(data) != "candidate" {
			t.Fatal("independent binding", p, err)
		}
	}
	data, err = f.svc.ReadOutputArtifact(t.Context(), "other", foreign, f.candidate.Candidate.Digest)
	if !errors.Is(err, port.ErrNotFound) || data != nil {
		t.Fatal("actor denied", err)
	}
	if !bytes.Equal(before, preparationDatabaseSnapshot(t, f.db)) {
		t.Fatal("cross-project reads wrote database")
	}
}
