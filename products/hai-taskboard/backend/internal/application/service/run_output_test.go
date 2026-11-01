package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"io"
	"reflect"
	"testing"
)

func TestRunOutput_FencedPublicationAndCandidateBinding(t *testing.T) {
	svc, store, _, envelope, candidate := acceptedSucceededInput(t)
	if err := store.Within(t.Context(), func(tx port.Transaction) error {
		outputs, err := tx.(port.RunOutputTransaction).LoadRunOutputs(t.Context(), projectID, candidate.RunID)
		if err != nil {
			return err
		}
		if len(outputs) != 1 {
			t.Fatalf("successful Fake publication produced %d Run output associations; want 1", len(outputs))
		}
		output := outputs[0]
		if output.ProjectID != projectID || output.RunID != candidate.RunID || output.InputDigest != envelope.Fence.InputDigest || output.ArtifactDigest != candidate.Candidate.Digest || output.LeaseEpoch != envelope.Fence.Epoch || output.RestoreGeneration != envelope.Fence.RestoreGeneration {
			t.Fatal("publication lost exact output fence identity")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SubmitCandidate(t.Context(), operator, candidate); err != nil {
		t.Fatal(err)
	}
}

func outputCount(t *testing.T, db *sql.DB) int {
	t.Helper()
	var n int
	if err := db.QueryRow("SELECT count(*) FROM run_output_artifacts").Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
func runningOutput(t *testing.T) (*Service, *sqlite.Store, *sql.DB, RunObservation) {
	t.Helper()
	svc, store, db, q := acceptedReadyInput(t)
	svc.artifacts = currentArtifacts{}
	id := dispatchAccepted(t, svc, db, q)
	e, err := svc.ClaimDispatch(t.Context(), "worker", claimInput(id))
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []RunObservationKind{ObservationDispatchReceived, ObservationStartAcknowledged} {
		if _, err := svc.PublishRunObservation(t.Context(), "worker", RunObservation{Fence: e.Fence, Kind: kind}); err != nil {
			t.Fatal(err)
		}
	}
	return svc, store, db, RunObservation{Fence: e.Fence, Kind: ObservationTerminalSuccess, ArtifactDigest: domain.HashString("candidate"), ArtifactBytes: []byte("candidate"), ArtifactMediaType: "text/plain"}
}
func addSupplementOutput(t *testing.T, store *sqlite.Store, fence port.RunFence) command.ArtifactLocator {
	t.Helper()
	a := command.ArtifactLocator{Digest: domain.HashString("supplement"), MediaType: "text/plain", ByteLength: 10, Availability: "Present"}
	if err := store.Within(t.Context(), func(tx port.Transaction) error {
		if err := tx.StoreArtifact(t.Context(), port.Artifact{Digest: a.Digest, MediaType: a.MediaType, ByteLength: a.ByteLength, Availability: a.Availability, StorageKey: artifactStorageKey(a.Digest)}); err != nil {
			return err
		}
		return tx.(port.RunOutputTransaction).StoreRunOutput(t.Context(), port.RunOutputWrite{Fence: fence, ArtifactDigest: a.Digest, PublishedAtNS: fixedTime().UnixNano()})
	}); err != nil {
		t.Fatal(err)
	}
	return a
}
func TestRunOutput_PublicationFailureNeverAssociates(t *testing.T) {
	for _, kind := range []string{"epoch", "generation", "holder", "input", "unknown", "failed"} {
		t.Run(kind, func(t *testing.T) {
			svc, _, db, o := runningOutput(t)
			switch kind {
			case "epoch":
				o.Fence.Epoch++
			case "generation":
				o.Fence.RestoreGeneration++
			case "holder":
				o.Fence.Holder = "other"
			case "input":
				o.Fence.InputDigest = domain.HashString("other")
			case "unknown":
				o.Kind = ObservationUnknownOutcome
				o.ArtifactDigest = domain.Digest{}
				o.ArtifactBytes = nil
				o.ArtifactMediaType = ""
			case "failed":
				o.Kind = ObservationTerminalFailure
				o.ArtifactDigest = domain.Digest{}
				o.ArtifactBytes = nil
				o.ArtifactMediaType = ""
			}
			_, err := svc.PublishRunObservation(t.Context(), o.Fence.Holder, o)
			if kind != "unknown" && kind != "failed" && err == nil {
				t.Fatal("stale fence accepted")
			}
			if (kind == "unknown" || kind == "failed") && err != nil {
				t.Fatal(err)
			}
			if outputCount(t, db) != 0 {
				t.Fatal("unsuccessful publication associated output")
			}
		})
	}
}
func TestRunOutput_PublicationAtomicAndExactRetry(t *testing.T) {
	for _, table := range []string{"artifacts", "run_output_artifacts", "audit_entries", "projection_events"} {
		t.Run(table, func(t *testing.T) {
			svc, _, db, o := runningOutput(t)
			before := currentHistoryCounts(t, db)
			if _, err := db.Exec("CREATE TRIGGER output_fault BEFORE INSERT ON " + table + " BEGIN SELECT RAISE(ABORT,'fault'); END"); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.PublishRunObservation(t.Context(), "worker", o); err == nil {
				t.Fatal("fault accepted")
			}
			if outputCount(t, db) != 0 || !reflect.DeepEqual(before, currentHistoryCounts(t, db)) {
				t.Fatal("partial terminal publication survived")
			}
		})
	}
	svc, store, db, o := runningOutput(t)
	if _, err := svc.PublishRunObservation(t.Context(), "worker", o); err != nil {
		t.Fatal(err)
	}
	before := currentHistoryCounts(t, db)
	if _, err := svc.PublishRunObservation(t.Context(), "worker", o); err != nil {
		t.Fatal(err)
	}
	if outputCount(t, db) != 1 || !reflect.DeepEqual(before, currentHistoryCounts(t, db)) {
		t.Fatal("retry duplicated publication")
	}
	o.ArtifactDigest = domain.HashString("supplement")
	o.ArtifactBytes = []byte("supplement")
	if _, err := svc.PublishRunObservation(t.Context(), "worker", o); err == nil {
		t.Fatal("retry changed output")
	}
	if outputCount(t, db) != 1 {
		t.Fatal("retry appended different output")
	}
	addSupplementOutput(t, store, o.Fence)
	o.ArtifactDigest = domain.HashString("candidate")
	o.ArtifactBytes = []byte("candidate")
	before = currentHistoryCounts(t, db)
	if _, err := svc.PublishRunObservation(t.Context(), "worker", o); err != nil {
		t.Fatal("exact retry lost its binding in a complete multi-output history", err)
	}
	if outputCount(t, db) != 2 || !reflect.DeepEqual(before, currentHistoryCounts(t, db)) {
		t.Fatal("exact retry changed multi-output history")
	}
}
func TestRunOutput_ExactManifestAndLegacyDenial(t *testing.T) {
	for _, kind := range []string{"global", "foreign_run", "foreign_project", "extra", "missing", "media", "length", "unavailable", "legacy", "candidate_digest", "full"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, e, q := acceptedSucceededInput(t)
			switch kind {
			case "global", "foreign_run", "foreign_project":
				a := command.ArtifactLocator{Digest: domain.HashString("supplement"), MediaType: "text/plain", ByteLength: 10, Availability: "Present"}
				if err := store.Within(t.Context(), func(tx port.Transaction) error {
					return tx.StoreArtifact(t.Context(), port.Artifact{Digest: a.Digest, MediaType: a.MediaType, ByteLength: a.ByteLength, Availability: a.Availability, StorageKey: artifactStorageKey(a.Digest)})
				}); err != nil {
					t.Fatal(err)
				}
				q.Candidate.Digest = a.Digest
				q.Candidate.Artifacts = []command.ArtifactLocator{a}
				if kind != "global" {
					foreignProject := string(projectID)
					if kind == "foreign_project" {
						foreignProject = "prj_0000000001"
						for _, statement := range []string{
							"INSERT INTO projects SELECT 'prj_0000000001','Foreign fixture',repository,repository_ref,version FROM projects LIMIT 1",
							"INSERT INTO work_items SELECT 'prj_0000000001',work_item_id,title,goal,owner_id,phase,version FROM work_items LIMIT 1",
						} {
							if _, err := db.Exec(statement); err != nil {
								t.Fatal(err)
							}
						}
					}
					if _, err := db.Exec("INSERT INTO runs SELECT ?, 'run_0000000001',work_item_id,input_digest,adapter_id,adapter_version,scenario_id,attempt,desired_action,dispatch_state,observed_state,reconciliation_state,side_effect_outcome,created_at_ns FROM runs LIMIT 1", foreignProject); err != nil {
						t.Fatal(err)
					}
					if _, err := db.Exec("INSERT INTO run_output_artifacts(project_id,run_id,artifact_digest,input_digest,lease_epoch,restore_generation) VALUES(?,?,?,?,?,?)", foreignProject, "run_0000000001", a.Digest.String(), e.Fence.InputDigest.String(), e.Fence.Epoch, e.Fence.RestoreGeneration); err != nil {
						t.Fatal(err)
					}
				}
			case "extra":
				q.Candidate.Artifacts = append(q.Candidate.Artifacts, command.ArtifactLocator{Digest: domain.HashString("supplement"), MediaType: "text/plain", ByteLength: 10, Availability: "Present"})
			case "missing":
				addSupplementOutput(t, store, e.Fence)
			case "full":
				q.Candidate.Artifacts = append(q.Candidate.Artifacts, addSupplementOutput(t, store, e.Fence))
			case "media":
				q.Candidate.Artifacts[0].MediaType = "application/octet-stream"
			case "length":
				q.Candidate.Artifacts[0].ByteLength++
			case "unavailable":
				q.Candidate.Artifacts[0].Availability = "Missing"
			case "candidate_digest":
				q.Candidate.Digest = domain.HashString("other")
			case "legacy":
				for _, sql := range []string{"DROP TRIGGER run_output_artifacts_no_delete", "DELETE FROM run_output_artifacts"} {
					if _, err := db.Exec(sql); err != nil {
						t.Fatal(err)
					}
				}
			}
			if kind != "full" {
				svc.artifacts = rejectCurrentArtifacts{t: t}
			}
			_, err := svc.SubmitCandidate(t.Context(), operator, q)
			if kind == "full" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil {
				t.Fatal("unproduced manifest accepted")
			}
		})
	}
}
func TestRunOutput_RechecksOutputIdentitiesAfterBytes(t *testing.T) {
	for _, kind := range []string{"fence", "set", "metadata"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, e, q := acceptedSucceededInput(t)
			changed := false
			svc.artifacts = changingCurrentArtifacts{base: svc.artifacts, after: func() {
				if changed {
					return
				}
				changed = true
				switch kind {
				case "set":
					addSupplementOutput(t, store, e.Fence)
				case "fence":
					for _, sql := range []string{"DROP TRIGGER run_output_artifacts_no_update", "UPDATE run_output_artifacts SET lease_epoch=lease_epoch+1"} {
						if _, err := db.Exec(sql); err != nil {
							t.Fatal(err)
						}
					}
				case "metadata":
					// Fault injection deliberately bypasses immutable metadata protection.
					for _, sql := range []string{"DROP TRIGGER artifacts_immutable_update", "UPDATE artifacts SET media_type='application/octet-stream'"} {
						if _, err := db.Exec(sql); err != nil {
							t.Fatal(err)
						}
					}
				}
			}}
			if _, err := svc.SubmitCandidate(t.Context(), operator, q); err == nil {
				t.Fatal("changed output identity accepted")
			}
			if !changed {
				t.Fatal("no external byte preflight")
			}
			var n int
			if err := db.QueryRow("SELECT count(*) FROM candidates").Scan(&n); err != nil || n != 0 {
				t.Fatal("partial candidate", err)
			}
		})
	}
}

type outputPostwriteUnit struct {
	base  port.UnitOfWork
	after func() error
	apply bool
}

func (u outputPostwriteUnit) Within(ctx context.Context, f func(port.Transaction) error) error {
	return u.base.Within(ctx, func(tx port.Transaction) error {
		return f(outputPostwriteTx{AuthorityTransaction: tx.(port.AuthorityTransaction), outputs: tx.(port.RunOutputTransaction), after: u.after, apply: u.apply})
	})
}

type outputPostwriteTx struct {
	port.AuthorityTransaction
	outputs port.RunOutputTransaction
	after   func() error
	apply   bool
}

func (tx outputPostwriteTx) LoadRunOutputs(ctx context.Context, p domain.ProjectID, r domain.RunID) ([]port.RunOutput, error) {
	return tx.outputs.LoadRunOutputs(ctx, p, r)
}
func (tx outputPostwriteTx) StoreRunOutput(ctx context.Context, w port.RunOutputWrite) error {
	if err := tx.outputs.StoreRunOutput(ctx, w); err != nil {
		return err
	}
	if tx.apply {
		return nil
	}
	return tx.after()
}
func (tx outputPostwriteTx) ApplyRunPublication(ctx context.Context, p port.RunPublication) (port.RunAuthority, error) {
	result, err := tx.AuthorityTransaction.ApplyRunPublication(ctx, p)
	if err != nil {
		return result, err
	}
	if tx.apply {
		return result, tx.after()
	}
	return result, nil
}
func TestRunOutput_PostwriteErrorsRollback(t *testing.T) {
	for _, kind := range []string{"typed", "cancel", "apply_lifecycle", "apply_fence"} {
		t.Run(kind, func(t *testing.T) {
			svc, store, db, o := runningOutput(t)
			before := currentHistoryCounts(t, db)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			svc.unit = outputPostwriteUnit{base: store, apply: kind == "apply_lifecycle" || kind == "apply_fence", after: func() error {
				if kind == "apply_lifecycle" {
					return port.ErrRunLifecycle
				}
				if kind == "apply_fence" {
					return port.ErrFenceRejected
				}
				if kind == "cancel" {
					cancel()
					return ctx.Err()
				}
				return command.NewError(command.CodeLifecycleRejected, "injected", false, nil, nil)
			}}
			_, err := svc.PublishRunObservation(ctx, "worker", o)
			if err == nil {
				t.Fatal("postwrite accepted")
			}
			if kind == "cancel" && !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
			if outputCount(t, db) != 0 || !reflect.DeepEqual(before, currentHistoryCounts(t, db)) {
				t.Fatal("postwrite retained output")
			}
		})
	}
}

type missingOutputBytes struct{}

func (missingOutputBytes) Put(context.Context, io.Reader) (domain.Digest, uint64, error) {
	return domain.Digest{}, 0, port.ErrNotFound
}
func (missingOutputBytes) Open(context.Context, domain.Digest) (io.ReadCloser, error) {
	return nil, port.ErrNotFound
}
func TestRunOutput_MissingBytesRejects(t *testing.T) {
	svc, _, db, _, q := acceptedSucceededInput(t)
	svc.artifacts = missingOutputBytes{}
	if _, err := svc.SubmitCandidate(t.Context(), operator, q); err == nil {
		t.Fatal("missing bytes accepted")
	}
	var n int
	if err := db.QueryRow("SELECT count(*) FROM candidates").Scan(&n); err != nil || n != 0 {
		t.Fatal(fmt.Sprint(n), err)
	}
}
