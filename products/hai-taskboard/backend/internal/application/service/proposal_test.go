package service

import (
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

const literalManifest = `{"schema_version":1,"nodes":[{"id":"SPEC-A","path":"a.md","required":true,"work_item_ids":["wi_A"],"required_ac_revisions":[{"ac_id":"AC-A","ac_revision_digest":"1111111111111111111111111111111111111111111111111111111111111111"}],"recipe_digest":"2222222222222222222222222222222222222222222222222222222222222222"}],"edges":[]}`
const literalSource = "Committed source\n"

type fakeReader struct {
	snapshot *fakeSnapshot
	opens    atomic.Int64
}
type fakeSnapshot struct {
	commit  specification.ObjectID
	objects map[specification.ObjectID]specification.Object
	closes  int
}

func (f *fakeReader) Open(context.Context, string) (specification.Snapshot, error) {
	f.opens.Add(1)
	return f.snapshot, nil
}
func (f *fakeSnapshot) Commit() specification.ObjectID { return f.commit }
func (f *fakeSnapshot) ReadObject(ctx context.Context, id specification.ObjectID, maximum int64) (specification.Object, error) {
	if err := ctx.Err(); err != nil {
		return specification.Object{}, err
	}
	o, ok := f.objects[id]
	if !ok {
		return specification.Object{}, errors.New("object unavailable")
	}
	return o, nil
}
func (f *fakeSnapshot) Close() error { return nil }
func fixtureID(t *testing.T, format specification.ObjectFormat, value string) specification.ObjectID {
	t.Helper()
	id, err := specification.ParseObjectID(format, value)
	if err != nil {
		t.Fatal(err)
	}
	return id
}
func independentHash(format specification.ObjectFormat, kind specification.ObjectKind, data []byte) string {
	raw := append([]byte(fmt.Sprintf("%s %d\x00", kind, len(data))), data...)
	if format == specification.SHA1 {
		s := sha1.Sum(raw)
		return hex.EncodeToString(s[:])
	}
	s := sha256.Sum256(raw)
	return hex.EncodeToString(s[:])
}
func literalFixture(t *testing.T, format specification.ObjectFormat) (*fakeReader, specification.Request) {
	t.Helper()
	var manifest, source, tree, commit, treeRaw, commitRaw string
	switch format {
	case specification.SHA1:
		manifest = "ce49519650f3e54f3a5de7f43b40a39af228a53f"
		source = "5205b123b53e3ea2ebb654b4a7789516cfa07109"
		tree = "cee8c103c86dc28864cb43dd71029592dc732260"
		commit = "6d7d41dd90d02573581137f9663bc274872fb041"
		treeRaw = "31303036343420612e6d64005205b123b53e3ea2ebb654b4a7789516cfa07109313030363434206d616e69666573742e6a736f6e00ce49519650f3e54f3a5de7f43b40a39af228a53f"
		commitRaw = "tree cee8c103c86dc28864cb43dd71029592dc732260\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nfixture\n"
	case specification.SHA256:
		manifest = "496d85419354e65ba77a840d08124da1488ee9ce2a957d5bd66fda4c3fc2a6e0"
		source = "5355b3eb54c4133d1edfd50d255781d51cbdad38b30f2b66d048fcd11fc6c1a3"
		tree = "dd4603c42f4fd1ca34a0fad7932892c15e0fe5313cd42bea483aefede9f22c32"
		commit = "af03dec2f925a4936d7b53162e97a6403e6ae97893b78a8b92504335fd7e94c7"
		treeRaw = "31303036343420612e6d64005355b3eb54c4133d1edfd50d255781d51cbdad38b30f2b66d048fcd11fc6c1a3313030363434206d616e69666573742e6a736f6e00496d85419354e65ba77a840d08124da1488ee9ce2a957d5bd66fda4c3fc2a6e0"
		commitRaw = "tree dd4603c42f4fd1ca34a0fad7932892c15e0fe5313cd42bea483aefede9f22c32\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nfixture\n"
	}
	rawTree, err := hex.DecodeString(treeRaw)
	if err != nil {
		t.Fatal(err)
	}
	objects := map[specification.ObjectID]specification.Object{fixtureID(t, format, manifest): {Kind: specification.BlobObject, Data: []byte(literalManifest)}, fixtureID(t, format, source): {Kind: specification.BlobObject, Data: []byte(literalSource)}, fixtureID(t, format, tree): {Kind: specification.TreeObject, Data: rawTree}, fixtureID(t, format, commit): {Kind: specification.CommitObject, Data: []byte(commitRaw)}}
	for id, o := range objects {
		if got := independentHash(format, o.Kind, o.Data); got != id.String() {
			t.Fatalf("independent fixture mismatch: %s != %s", got, id.String())
		}
	}
	return &fakeReader{snapshot: &fakeSnapshot{commit: fixtureID(t, format, commit), objects: objects}}, specification.Request{Binding: specification.RepositoryBinding{ProjectID: "project", ID: "binding", Version: 1, Digest: domain.HashString("approved"), ObjectFormat: format}, Ref: "refs/heads/main", ManifestPath: "manifest.json"}
}

func proposalFixture(t *testing.T) (*Service, *sqlite.Store, *sql.DB, *fakeReader, command.ProposeSpecification) {
	t.Helper()
	root := t.TempDir()
	path := filepath.Join(root, "admission.db")
	store, err := sqlite.OpenAtRootWithClock(t.Context(), root, path, fixedTime)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err = store.CreateProject(t.Context(), port.Project{ID: projectID, Name: "Project", Repository: "legacy", Ref: "main", Version: 1}); err != nil {
		t.Fatal(err)
	}
	item, e := domain.NewWorkItem(workItemID, projectID, domain.PhaseDraft, 1)
	if e != nil {
		t.Fatal(e)
	}
	if e = store.CreateWorkItem(t.Context(), port.WorkItem{Item: item, Title: "Item", Goal: "Goal", Owner: operator}); e != nil {
		t.Fatal(e)
	}
	svc := testService(t, newMemoryUnit(), true)
	svc.unit = store
	reader, _ := literalFixture(t, specification.SHA1)
	svc.config.RepositoryAuthority = fixedRepository{port.ApprovedRepository{Binding: specification.RepositoryBinding{ProjectID: projectID, ID: "binding", Version: 1, Digest: domain.HashString("approved"), ObjectFormat: specification.SHA1}, ConfigurationID: "local-repo-1", ApprovedBy: operator, Refs: []string{"refs/heads/main"}, ManifestPaths: []string{"manifest.json"}, Reader: reader}}
	request := command.ProposeSpecification{Metadata: command.Metadata{CommandID: "cmd_01HABCDEFGP", IdempotencyKey: "00000000-0000-4000-8000-000000000002", ExpectedVersion: 1, IssuedAt: fixedTime(), CorrelationID: "proposal"}, ProjectID: projectID, BindingID: "binding", BindingVersion: 1, BindingDigest: domain.HashString("approved"), Ref: "refs/heads/main", ManifestPath: "manifest.json"}
	approved, _ := svc.config.RepositoryAuthority.Lookup(projectID, "binding")
	_, approved.Binding.Digest, err = port.CanonicalRepositoryBinding(approved)
	if err != nil {
		t.Fatal(err)
	}
	svc.config.RepositoryAuthority = fixedRepository{approved}
	request.BindingDigest = approved.Binding.Digest
	return svc, store, db, reader, request
}

func TestAdmission_ProposalProvenanceAndCrashIsolation(t *testing.T) {
	t.Run("positive_reopen_source_loss_replay", func(t *testing.T) {
		svc, store, db, reader, request := proposalFixture(t)
		first, err := svc.ProposeSpecification(t.Context(), operator, request)
		if err != nil {
			t.Fatalf("valid approved immutable proposal failed: %v", err)
		}
		var eventPayload []byte
		if err := db.QueryRow("SELECT payload FROM projection_events").Scan(&eventPayload); err != nil {
			t.Fatal(err)
		}
		expectedEvent := []byte(`{"api_version":"v1","event_type":"project.changed","project_id":"prj_01HABCDEFGH","resource_kind":"project","resource_id":"prj_01HABCDEFGH","resource_version":1}`)
		if !bytes.Equal(eventPayload, expectedEvent) {
			t.Fatalf("proposal projection is incompatible with existing SSE: %s", eventPayload)
		}
		assertAdmissionUnchanged(t, db)
		var decoded struct {
			Result struct {
				ProposalDigest string `json:"proposal_digest"`
			} `json:"result"`
		}
		if err := json.Unmarshal(first.Payload, &decoded); err != nil {
			t.Fatal(err)
		}
		d, err := domain.ParseDigest(strings.TrimPrefix(decoded.Result.ProposalDigest, "sha256:"))
		if err != nil {
			t.Fatal(err)
		}
		if err := store.Within(t.Context(), func(tx port.Transaction) error {
			p, e := tx.(port.AdmissionTransaction).LoadProposal(t.Context(), projectID, d)
			if e == nil && p.Commit() != reader.snapshot.commit {
				t.Fatal("stored commit mismatch")
			}
			return e
		}); err != nil {
			t.Fatal(err)
		}
		var seq int
		var name, dbPath string
		if err := db.QueryRow("PRAGMA database_list").Scan(&seq, &name, &dbPath); err != nil {
			t.Fatal(err)
		}
		if err := store.Close(); err != nil {
			t.Fatal(err)
		}
		reopened, err := sqlite.OpenAtRootWithClock(t.Context(), filepath.Dir(dbPath), dbPath, fixedTime)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { reopened.Close() })
		svc.unit = reopened
		originalCommit := reader.snapshot.commit
		moved, _ := specification.ParseObjectID(specification.SHA1, strings.Repeat("f", 40))
		reader.snapshot.commit = moved
		movedReplay, err := svc.ProposeSpecification(t.Context(), operator, request)
		if err != nil || !movedReplay.Replayed || !bytes.Equal(first.Payload, movedReplay.Payload) {
			t.Fatalf("moved ref replay %v", err)
		}
		reader.snapshot.commit = originalCommit
		reader.snapshot = nil
		svc.config.RepositoryAuthority = nil
		replay, err := svc.ProposeSpecification(t.Context(), operator, request)
		if err != nil || !replay.Replayed || !bytes.Equal(first.Payload, replay.Payload) {
			t.Fatalf("proposal replay: %v", err)
		}
	})
	admissionCases(t)
}

type fixedRepository struct{ value port.ApprovedRepository }

func (r fixedRepository) Lookup(domain.ProjectID, string) (port.ApprovedRepository, error) {
	return r.value, nil
}

func admissionCounts(t *testing.T, db *sql.DB) []int {
	t.Helper()
	var counts []int
	for _, table := range []string{"repository_binding_versions", "specification_proposals", "dependency_revisions", "command_results", "idempotency_records", "audit_entries", "projection_events"} {
		var n int
		if err := db.QueryRow("SELECT count(*) FROM " + table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		counts = append(counts, n)
	}
	return counts
}
func assertAdmissionUnchanged(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, table := range []string{"accepted_spec_revisions", "project_spec_heads", "work_item_spec_heads", "current_ac_requirements", "work_item_ac_requirements", "runs"} {
		var n int
		if err := db.QueryRow("SELECT count(*) FROM " + table).Scan(&n); err != nil || n != 0 {
			t.Fatalf("%s mutated: %d, %v", table, n, err)
		}
	}
	var n int
	if err := db.QueryRow("SELECT count(*) FROM work_items WHERE phase!='Draft'").Scan(&n); err != nil || n != 0 {
		t.Fatalf("phase changed: %v", err)
	}
}
func anotherProposal(q command.ProposeSpecification) command.ProposeSpecification {
	q.CommandID = "cmd_01HABCDEFGQ"
	q.IdempotencyKey = "00000000-0000-4000-8000-000000000003"
	return q
}

type proposalReaderFunc func(context.Context, string) (specification.Snapshot, error)

func (f proposalReaderFunc) Open(c context.Context, r string) (specification.Snapshot, error) {
	return f(c, r)
}
func admissionCases(t *testing.T) {
	t.Run("different_keys_dedup_and_same_graph_new_provenance", func(t *testing.T) {
		svc, _, db, _, q := proposalFixture(t)
		if _, err := svc.ProposeSpecification(t.Context(), operator, q); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.ProposeSpecification(t.Context(), operator, anotherProposal(q)); err != nil {
			t.Fatal(err)
		}
		counts := admissionCounts(t, db)
		if !reflect.DeepEqual(counts, []int{1, 1, 1, 2, 2, 2, 2}) {
			t.Fatalf("dedup counts %v", counts)
		}
		approved, _ := svc.config.RepositoryAuthority.Lookup(projectID, q.BindingID)
		approved.Binding.Version = 2
		_, approved.Binding.Digest, _ = port.CanonicalRepositoryBinding(approved)
		svc.config.RepositoryAuthority = fixedRepository{approved}
		q.CommandID = "cmd_01HABCDEFGR"
		q.IdempotencyKey = "00000000-0000-4000-8000-000000000004"
		q.BindingVersion = 2
		q.BindingDigest = approved.Binding.Digest
		if _, err := svc.ProposeSpecification(t.Context(), operator, q); err != nil {
			t.Fatal(err)
		}
		counts = admissionCounts(t, db)
		if !reflect.DeepEqual(counts, []int{2, 2, 1, 3, 3, 3, 3}) {
			t.Fatalf("provenance counts %v", counts)
		}
		assertAdmissionUnchanged(t, db)
	})
	t.Run("same_key_concurrency_and_conflict", func(t *testing.T) {
		svc, _, db, reader, q := proposalFixture(t)
		var opens atomic.Int64
		approved, _ := svc.config.RepositoryAuthority.Lookup(projectID, q.BindingID)
		snapshot := reader.snapshot
		approved.Reader = proposalReaderFunc(func(context.Context, string) (specification.Snapshot, error) { opens.Add(1); return snapshot, nil })
		svc.config.RepositoryAuthority = fixedRepository{approved}
		var wg sync.WaitGroup
		results := make(chan command.Outcome, 4)
		errs := make(chan error, 4)
		for range 4 {
			wg.Go(func() { out, e := svc.ProposeSpecification(t.Context(), operator, q); results <- out; errs <- e })
		}
		wg.Wait()
		close(results)
		close(errs)
		for e := range errs {
			if e != nil {
				t.Fatal(e)
			}
		}
		var payload []byte
		for out := range results {
			if payload == nil {
				payload = out.Payload
			}
			if !bytes.Equal(payload, out.Payload) {
				t.Fatal("concurrent result mismatch")
			}
		}
		if counts := admissionCounts(t, db); !reflect.DeepEqual(counts, []int{1, 1, 1, 1, 1, 1, 1}) {
			t.Fatal(counts)
		}
		before := opens.Load()
		q.ManifestPath = "other.json"
		_, err := svc.ProposeSpecification(t.Context(), operator, q)
		assertCommandError(t, err, command.CodeIdempotencyConflict)
		if opens.Load() != before {
			t.Fatal("conflict read Git")
		}
		assertAdmissionUnchanged(t, db)
	})
	for _, kind := range []string{"unauthenticated", "wrong_project", "missing_authority", "typed_nil_authority", "typed_nil_reader", "scope", "wrong_digest", "wrong_approver", "revoked_during_import", "binding_changed_during_import", "project_changed_during_import", "cancel"} {
		t.Run(kind, func(t *testing.T) {
			svc, _, db, reader, q := proposalFixture(t)
			approved, _ := svc.config.RepositoryAuthority.Lookup(projectID, q.BindingID)
			principal := operator
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			if kind == "unauthenticated" {
				principal = ""
			}
			if kind == "wrong_project" {
				q.ProjectID = "prj_01HABCDEFGJ"
			}
			if kind == "missing_authority" {
				svc.config.RepositoryAuthority = nil
			}
			if kind == "typed_nil_authority" {
				svc.config.RepositoryAuthority = (*fixedRepository)(nil)
			}
			if kind == "typed_nil_reader" {
				approved.Reader = (*fakeReader)(nil)
				svc.config.RepositoryAuthority = fixedRepository{approved}
			}
			if kind == "scope" {
				q.Ref = "refs/heads/other"
			}
			if kind == "wrong_digest" {
				q.BindingDigest = domain.HashString("forged")
			}
			if kind == "wrong_approver" {
				approved.ApprovedBy = "other"
				svc.config.RepositoryAuthority = fixedRepository{approved}
			}
			if kind == "revoked_during_import" || kind == "binding_changed_during_import" || kind == "project_changed_during_import" || kind == "cancel" {
				approved.Reader = proposalReaderFunc(func(c context.Context, r string) (specification.Snapshot, error) {
					switch kind {
					case "revoked_during_import":
						svc.config.RepositoryAuthority = nil
					case "binding_changed_during_import":
						changed := approved
						changed.ConfigurationID = "replacement"
						_, changed.Binding.Digest, _ = port.CanonicalRepositoryBinding(changed)
						svc.config.RepositoryAuthority = fixedRepository{changed}
					case "project_changed_during_import":
						if _, err := db.Exec("UPDATE projects SET version=2 WHERE project_id=?", projectID); err != nil {
							t.Fatal(err)
						}
					case "cancel":
						cancel()
					}
					return reader.Open(c, r)
				})
				svc.config.RepositoryAuthority = fixedRepository{approved}
			}
			_, err := svc.ProposeSpecification(ctx, principal, q)
			if err == nil {
				t.Fatal("denial accepted")
			}
			counts := admissionCounts(t, db)
			if counts[0] != 0 || counts[1] != 0 || counts[2] != 0 || counts[5] != 0 || counts[6] != 0 {
				t.Fatalf("partial rejection %v", counts)
			}
			if kind == "unauthenticated" || kind == "scope" || kind == "wrong_digest" || kind == "wrong_approver" || kind == "missing_authority" || kind == "wrong_project" {
				if reader.opens.Load() != 0 {
					t.Fatal("denial read Git")
				}
			}
			assertAdmissionUnchanged(t, db)
		})
	}
	for _, table := range []string{"repository_binding_versions", "dependency_revisions", "specification_proposals", "audit_entries", "projection_events", "command_results", "idempotency_records"} {
		t.Run("rollback_"+table, func(t *testing.T) {
			svc, _, db, _, q := proposalFixture(t)
			before := admissionCounts(t, db)
			if _, err := db.Exec("CREATE TRIGGER admission_fault BEFORE INSERT ON " + table + " BEGIN SELECT RAISE(ABORT,'injected'); END"); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.ProposeSpecification(t.Context(), operator, q); err == nil {
				t.Fatal("fault accepted")
			}
			if after := admissionCounts(t, db); !reflect.DeepEqual(before, after) {
				t.Fatalf("postwrite fault left rows: %v", after)
			}
			assertAdmissionUnchanged(t, db)
		})
	}
	for _, kind := range []string{"canonical", "normalized", "binding", "graph"} {
		t.Run("corrupt_"+kind, func(t *testing.T) {
			svc, _, db, _, q := proposalFixture(t)
			if _, err := svc.ProposeSpecification(t.Context(), operator, q); err != nil {
				t.Fatal(err)
			}
			var statements []string
			switch kind {
			case "canonical":
				statements = []string{"DROP TRIGGER specification_proposals_immutable_update", "UPDATE specification_proposals SET canonical_content=x'7b7d'"}
			case "normalized":
				statements = []string{"DROP TRIGGER specification_proposals_immutable_update", "UPDATE specification_proposals SET manifest_path='wrong.json'"}
			case "binding":
				statements = []string{"DROP TRIGGER repository_binding_versions_immutable_update", "UPDATE repository_binding_versions SET approved_by_actor='other'"}
			case "graph":
				statements = []string{"DROP TRIGGER dependency_revisions_immutable_update", "UPDATE dependency_revisions SET content=x'7b7d'"}
			}
			for _, sql := range statements {
				if _, err := db.Exec(sql); err != nil {
					t.Fatal(err)
				}
			}
			before := admissionCounts(t, db)
			_, err := svc.ProposeSpecification(t.Context(), operator, anotherProposal(q))
			assertCommandError(t, err, command.CodeStorageCorruption)
			if after := admissionCounts(t, db); !reflect.DeepEqual(before, after) {
				t.Fatalf("corruption mutated %v", after)
			}
			assertAdmissionUnchanged(t, db)
		})
	}
}

type proposalHookUnit struct {
	base  port.UnitOfWork
	after func() error
}

func (u proposalHookUnit) Within(ctx context.Context, fn func(port.Transaction) error) error {
	return u.base.Within(ctx, func(tx port.Transaction) error {
		return fn(proposalHookTransaction{AdmissionTransaction: tx.(port.AdmissionTransaction), after: u.after})
	})
}

type proposalHookTransaction struct {
	port.AdmissionTransaction
	after func() error
}

func (tx proposalHookTransaction) StoreProposal(ctx context.Context, a port.ApprovedRepository, p specification.Proposal, now int64) error {
	if err := tx.AdmissionTransaction.StoreProposal(ctx, a, p, now); err != nil {
		return err
	}
	return tx.after()
}
func TestAdmission_PostwriteRejectionAndCancellationRollback(t *testing.T) {
	for _, kind := range []string{"recordable_error", "cancellation"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, _, q := proposalFixture(t)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			before := admissionCounts(t, db)
			svc.unit = proposalHookUnit{base: store, after: func() error {
				if kind == "cancellation" {
					cancel()
					return nil
				}
				return command.NewError(command.CodeVersionConflict, "injected postwrite rejection", false, nil, nil)
			}}
			if _, err := svc.ProposeSpecification(ctx, operator, q); err == nil {
				t.Fatal("postwrite failure accepted")
			}
			if counts := admissionCounts(t, db); !reflect.DeepEqual(before, counts) {
				t.Fatalf("postwrite failure committed %v", counts)
			}
			assertAdmissionUnchanged(t, db)
		})
	}
}
