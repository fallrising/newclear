package sqlite

import (
	"bytes"
	"context"
	"errors"
	"io"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/service"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func TestCompleteWorkItem_RejectsPostPublicationArtifactTamper(t *testing.T) {
	t.Run("intact-control", func(t *testing.T) {
		fixture, complete, _ := integrityQAFixture(t)
		before := integrityDurableCounts(t, fixture)
		outcome, err := fixture.application.CompleteWorkItem(t.Context(), verticalOperator, complete)
		mustVerticalOutcome(t, outcome, err)
		item, err := fixture.store.LoadWorkItem(t.Context(), verticalProject, verticalWorkItem)
		after := integrityDurableCounts(t, fixture)
		if err != nil || item.Phase() != domain.PhaseDone || item.Version() != 6 || after[0] != before[0]+1 || after[1] != before[1]+1 {
			t.Fatalf("intact completion did not persist Done/proof/consumption: phase=%s version=%d counts=%v err=%v", item.Phase(), item.Version(), after, err)
		}
	})
	for _, name := range []string{"candidate-delete", "candidate-replace", "candidate-length", "evidence-delete", "evidence-replace", "evidence-length"} {
		t.Run(name, func(t *testing.T) {
			fixture, complete, report := integrityQAFixture(t)
			before := integrityDurableCounts(t, fixture)
			digest := complete.Subject.CandidateDigest()
			reason := domain.CodeCandidateUnavailable
			if strings.HasPrefix(name, "evidence-") {
				digest = report
				reason = domain.CodeEvidenceUnavailable
			}
			fixture.artifacts.mu.Lock()
			if name == "candidate-delete" || name == "evidence-delete" {
				delete(fixture.artifacts.objects, digest)
			} else if strings.HasSuffix(name, "-length") {
				fixture.artifacts.objects[digest] = append(fixture.artifacts.objects[digest], '!')
			} else {
				fixture.artifacts.objects[digest] = bytes.Repeat([]byte("x"), len(fixture.artifacts.objects[digest]))
			}
			fixture.artifacts.mu.Unlock()
			fixture.artifacts.ResetOpenStats()
			if _, err := fixture.application.CompleteWorkItem(t.Context(), verticalOperator, complete); err == nil {
				t.Error("completion accepted tampered published material")
			} else {
				assertIntegrityRejection(t, err, reason)
			}
			assertIntegrityUnchanged(t, fixture, before)
		})
	}
}

func TestCompletionMaterial_BoundedCollectionsRejectOverflow(t *testing.T) {
	for _, collection := range []string{"candidate", "evidence", "review", "approval", "requirement"} {
		t.Run(collection, func(t *testing.T) {
			fixture, complete, _ := integrityQAFixture(t)
			subjectMaterial := loadVerticalSubjectMaterial(t, fixture.store, complete.Subject.Digest())
			if collection == "candidate" {
				bindIntegritySupplement(t, fixture, []byte("supplement"))
			} else if err := fixture.store.Within(t.Context(), func(tx port.Transaction) error {
				switch collection {
				case "evidence":
					record := subjectMaterial.Evidence[0]
					record.ID = "evidence-extra"
					return tx.StoreEvidence(t.Context(), record)
				case "review":
					record := subjectMaterial.Reviews[0]
					record.ID = "review-extra"
					return tx.StoreReview(t.Context(), record)
				case "approval":
					record := subjectMaterial.Approvals[0]
					record.ID = "approval-extra"
					return tx.StoreApproval(t.Context(), record)
				case "requirement":
					if err := tx.StoreACRevision(t.Context(), port.ACRevision{ID: "extra-ac", ProjectID: verticalProject, ACID: "AC-2", Digest: fixture.acDigest, Content: []byte("AC-2"), CreatedAtNS: fixedClockTime.UnixNano()}); err != nil {
						return err
					}
					return tx.RequireACRevision(t.Context(), port.ACRequirement{ProjectID: verticalProject, WorkItemID: verticalWorkItem, ACID: "AC-2", RevisionDigest: fixture.acDigest})
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			before := integrityDurableCounts(t, fixture)
			err := fixture.store.Within(t.Context(), func(tx port.Transaction) error {
				_, err := tx.LoadCompletionMaterial(t.Context(), port.CompletionMaterialQuery{ProjectID: verticalProject, WorkItemID: verticalWorkItem,
					CandidateID: complete.Subject.CandidateID(), RunID: verticalRun, SubjectDigest: complete.Subject.Digest(), GraphRevisionDigest: fixture.graphDigest, MaximumRecords: 1})
				return err
			})
			if _, ok := errors.AsType[domain.StorageCorruptionError](err); !ok {
				t.Fatalf("overflow was silently truncated: %v", err)
			}
			assertIntegrityUnchanged(t, fixture, before)
			// Exactly the requested number of rows must be returned, not rejected or
			// silently dropped. This fixture contains two records of this collection.
			var material port.CompletionMaterial
			err = fixture.store.Within(t.Context(), func(tx port.Transaction) error {
				var err error
				material, err = tx.LoadCompletionMaterial(t.Context(), port.CompletionMaterialQuery{ProjectID: verticalProject, WorkItemID: verticalWorkItem,
					CandidateID: complete.Subject.CandidateID(), RunID: verticalRun, SubjectDigest: complete.Subject.Digest(), GraphRevisionDigest: fixture.graphDigest, MaximumRecords: 2})
				return err
			})
			counts := map[string]int{"candidate": len(material.CandidateArtifacts), "evidence": len(material.Evidence), "review": len(material.Reviews), "approval": len(material.Approvals), "requirement": len(material.RequiredACRevisions)}
			if err != nil || counts[collection] != 2 {
				t.Fatalf("exact row limit rejected or lost data: counts=%v err=%v", counts, err)
			}
			assertIntegrityUnchanged(t, fixture, before)
		})
	}
}

func TestCompleteWorkItem_MaterialVerificationOutsideWriteTransaction(t *testing.T) {
	fixture, complete, report := integrityQAFixture(t)
	fixture.artifacts.ResetOpenStats()
	before := integrityDurableCounts(t, fixture)
	if _, err := fixture.application.CompleteWorkItem(t.Context(), "unauthorized", complete); err == nil {
		t.Fatal("unauthorized completion accepted")
	}
	if calls, _ := fixture.artifacts.OpenStats(); calls != 0 {
		t.Fatal("unauthorized completion opened material")
	}
	assertIntegrityUnchanged(t, fixture, before)
	tracked := &integrityArtifactReader{delegate: fixture.artifacts, unit: fixture.unit}
	fixture.application = integrityService(t, fixture, tracked)
	first, err := fixture.application.CompleteWorkItem(t.Context(), verticalOperator, complete)
	mustVerticalOutcome(t, first, err)
	calls, inside := fixture.artifacts.OpenStats()
	if calls != 2 || inside != 0 || tracked.readInside || tracked.closeInside || tracked.closed != calls {
		t.Fatalf("material I/O calls/inside/readInside/closeInside/closed = %d/%d/%t/%t/%d", calls, inside, tracked.readInside, tracked.closeInside, tracked.closed)
	}
	fixture.artifacts.Delete(report)
	fixture.artifacts.Delete(complete.Subject.CandidateDigest())
	before = integrityDurableCounts(t, fixture)
	replayed, err := fixture.application.CompleteWorkItem(t.Context(), verticalOperator, complete)
	if err != nil || !replayed.Replayed || !bytes.Equal(replayed.Payload, first.Payload) {
		t.Fatalf("exact completion replay after loss = (%#v,%v)", replayed, err)
	}
	conflict := complete
	conflict.ExpectedVersion++
	if _, err := fixture.application.CompleteWorkItem(t.Context(), verticalOperator, conflict); err == nil {
		t.Fatal("changed same-key request accepted")
	} else {
		assertVerticalCommandCode(t, err, command.CodeIdempotencyConflict)
	}
	if after, _ := fixture.artifacts.OpenStats(); after != calls || integrityDurableCounts(t, fixture) != before {
		t.Fatal("replay/conflict reopened material or mutated durable authority")
	}
}

func TestCompleteWorkItem_RejectsMaterialSnapshotChange(t *testing.T) {
	for _, name := range []string{"work-item-version", "candidate-binding"} {
		t.Run(name, func(t *testing.T) {
			fixture, complete, _ := integrityQAFixture(t)
			before := integrityDurableCounts(t, fixture)
			tracked := &integrityArtifactReader{delegate: fixture.artifacts, unit: fixture.unit}
			tracked.afterClose = sync.OnceFunc(func() {
				if name == "work-item-version" {
					if _, err := fixture.store.AddBlocker(t.Context(), verticalProject, verticalWorkItem, 5, domain.Blocker{ID: "new-blocker", Reason: "changed during preflight"}); err != nil {
						t.Fatal(err)
					}
					return
				}
				bindIntegritySupplement(t, fixture, []byte("newly-bound-object"))
			})
			fixture.application = integrityService(t, fixture, tracked)
			if _, err := fixture.application.CompleteWorkItem(t.Context(), verticalOperator, complete); err == nil {
				t.Fatal("changed completion snapshot accepted")
			} else if name == "work-item-version" {
				assertVerticalCommandCode(t, err, command.CodeVersionConflict)
			} else {
				assertVerticalCommandCode(t, err, command.CodeStaleSubject)
			}
			if integrityDurableCounts(t, fixture) != before {
				t.Fatal("snapshot conflict mutated completion authority")
			}
			item, err := fixture.store.LoadWorkItem(t.Context(), verticalProject, verticalWorkItem)
			if err != nil || item.Phase() != domain.PhaseQA {
				t.Fatalf("snapshot conflict phase = %s err=%v", item.Phase(), err)
			}
		})
	}
	for _, name := range []string{"evidence", "review", "approval"} {
		t.Run(name, func(t *testing.T) {
			fixture, complete, _ := integrityQAFixture(t)
			before := integrityDurableCounts(t, fixture)
			subjectMaterial := loadVerticalSubjectMaterial(t, fixture.store, complete.Subject.Digest())
			tracked := &integrityArtifactReader{delegate: fixture.artifacts, unit: fixture.unit}
			tracked.afterClose = sync.OnceFunc(func() {
				if err := fixture.store.Within(t.Context(), func(tx port.Transaction) error {
					switch name {
					case "evidence":
						record := subjectMaterial.Evidence[0]
						record.ID, record.Verdict = "changed-evidence", "Failed"
						return tx.StoreEvidence(t.Context(), record)
					case "review":
						record := subjectMaterial.Reviews[0]
						record.ID, record.Verdict, record.CreatedAtNS = "changed-review", "Rejected", record.CreatedAtNS+1
						return tx.StoreReview(t.Context(), record)
					case "approval":
						record := subjectMaterial.Approvals[0]
						record.ID, record.ExpiresAtNS = "changed-approval", fixedClockTime.UnixNano()
						return tx.StoreApproval(t.Context(), record)
					}
					return nil
				}); err != nil {
					t.Fatal(err)
				}
			})
			fixture.application = integrityService(t, fixture, tracked)
			if _, err := fixture.application.CompleteWorkItem(t.Context(), verticalOperator, complete); err == nil {
				t.Fatal("subject-relevant record added during verification was accepted")
			} else {
				assertVerticalCommandCode(t, err, command.CodeStaleSubject)
			}
			assertIntegrityUnchanged(t, fixture, before)
		})
	}
	for _, name := range []string{"locator-length", "candidate-availability", "report-availability"} {
		t.Run(name+"-hostile-port", func(t *testing.T) {
			fixture, complete, _ := integrityQAFixture(t)
			before := integrityDurableCounts(t, fixture)
			// SQLite metadata is immutable (proved separately below). Model an
			// untrusted persistence adapter returning changed metadata only on the
			// final read; do not weaken a trigger or manufacture a durable mutation.
			unit := &hostileIntegrityUnit{delegate: fixture.unit, change: func(material *port.CompletionMaterial) {
				switch name {
				case "locator-length":
					material.CandidateArtifacts[0].ByteLength++
				case "candidate-availability":
					material.CandidateArtifacts[0].Availability = "Missing"
					material.CandidateAvailable = false
				case "report-availability":
					material.Artifacts[0].Availability = "Quarantined"
				}
			}}
			tracked := &integrityArtifactReader{delegate: fixture.artifacts, unit: fixture.unit, afterClose: sync.OnceFunc(func() { unit.armed = true })}
			application, err := service.New(unit, fixture.clock, &verticalIDs{counts: map[port.IDKind]uint64{port.IDAuditGroup: 100}}, verticalExecutor{}, tracked, &verticalProjection{}, service.Config{
				Operator: verticalOperator, IdempotencyTTL: time.Hour, Specification: verticalSpecification{}, Completion: fixture.policy})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := application.CompleteWorkItem(t.Context(), verticalOperator, complete); err == nil {
				t.Fatal("changed locator/availability port snapshot was accepted")
			} else {
				assertVerticalCommandCode(t, err, command.CodeStaleSubject)
			}
			assertIntegrityUnchanged(t, fixture, before)
		})
	}
}

func TestArtifactMetadata_ImmutableLocatorAndAvailability(t *testing.T) {
	fixture, complete, _ := integrityQAFixture(t)
	digest := complete.Subject.CandidateDigest()
	var before port.Artifact
	if err := fixture.store.Within(t.Context(), func(tx port.Transaction) error {
		var err error
		before, err = tx.(port.AuthorityTransaction).LoadArtifact(t.Context(), digest)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{"UPDATE artifacts SET byte_length=byte_length+1 WHERE digest=?", "UPDATE artifacts SET availability='Missing' WHERE digest=?"} {
		if _, err := fixture.store.db.ExecContext(t.Context(), statement, digest.String()); err == nil || !strings.Contains(err.Error(), "immutable") {
			t.Fatalf("immutable metadata update did not reject: %v", err)
		}
	}
	if err := fixture.store.Within(t.Context(), func(tx port.Transaction) error {
		after, err := tx.(port.AuthorityTransaction).LoadArtifact(t.Context(), digest)
		if err == nil && after != before {
			t.Fatal("rejected metadata update changed locator/availability")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
}

func assertIntegrityRejection(t *testing.T, err error, reason domain.RejectionCode) {
	t.Helper()
	assertVerticalCommandCode(t, err, command.CodeDoneGateUnsatisfied)
	failure, ok := errors.AsType[*command.Error](err)
	if !ok || !slices.Contains(failure.Reasons, reason) {
		t.Fatalf("material rejection does not name %s: %#v", reason, err)
	}
}

type hostileIntegrityUnit struct {
	delegate *verticalTrackingUnit
	armed    bool
	change   func(*port.CompletionMaterial)
}

func (unit *hostileIntegrityUnit) Within(ctx context.Context, operation func(port.Transaction) error) error {
	return unit.delegate.Within(ctx, func(tx port.Transaction) error {
		return operation(hostileIntegrityTransaction{Transaction: tx, unit: unit})
	})
}

type hostileIntegrityTransaction struct {
	port.Transaction
	unit *hostileIntegrityUnit
}

func (tx hostileIntegrityTransaction) LoadCompletionMaterial(ctx context.Context, query port.CompletionMaterialQuery) (port.CompletionMaterial, error) {
	material, err := tx.Transaction.LoadCompletionMaterial(ctx, query)
	if err == nil && tx.unit.armed {
		material.CandidateArtifacts = slices.Clone(material.CandidateArtifacts)
		material.Artifacts = slices.Clone(material.Artifacts)
		tx.unit.change(&material)
	}
	return material, err
}

func TestCompleteWorkItem_RechecksAllCandidateBindingsAndProjectScope(t *testing.T) {
	t.Run("zero-byte-supplement-is-valid", func(t *testing.T) {
		fixture, complete, _ := integrityQAFixture(t)
		bindIntegritySupplement(t, fixture, nil)
		outcome, err := fixture.application.CompleteWorkItem(t.Context(), verticalOperator, complete)
		mustVerticalOutcome(t, outcome, err)
		item, err := fixture.store.LoadWorkItem(t.Context(), verticalProject, verticalWorkItem)
		if err != nil || item.Phase() != domain.PhaseDone {
			t.Fatalf("lawful empty supplemental object did not complete: %s %v", item.Phase(), err)
		}
	})
	t.Run("supplemental-object-and-length", func(t *testing.T) {
		fixture, complete, _ := integrityQAFixture(t)
		supplement := bindIntegritySupplement(t, fixture, []byte("extra-candidate-object"))
		fixture.artifacts.mu.Lock()
		fixture.artifacts.objects[supplement] = []byte("different-length")
		fixture.artifacts.mu.Unlock()
		before := integrityDurableCounts(t, fixture)
		if _, err := fixture.application.CompleteWorkItem(t.Context(), verticalOperator, complete); err == nil {
			t.Fatal("tampered supplemental candidate binding accepted")
		}
		assertIntegrityUnchanged(t, fixture, before)
	})
	t.Run("cross-project-candidate", func(t *testing.T) {
		fixture, complete, _ := integrityQAFixture(t)
		otherProject := domain.ProjectID("prj_01HABCDEFG2")
		outcome, err := fixture.application.CreateProject(t.Context(), verticalOperator, command.CreateProject{Metadata: verticalMetadata(11, 0), ProjectID: otherProject, Name: "Other", RepositoryRoot: "/fixture/other", ApprovedRef: "main"})
		mustVerticalOutcome(t, outcome, err)
		if err := fixture.store.Within(t.Context(), func(tx port.Transaction) error {
			return tx.StoreACRevision(t.Context(), port.ACRevision{ID: "other-ac", ProjectID: otherProject, ACID: "AC-1", Digest: fixture.acDigest, Content: []byte("AC-1"), CreatedAtNS: fixedClockTime.UnixNano()})
		}); err != nil {
			t.Fatal(err)
		}
		outcome, err = fixture.application.CreateWorkItem(t.Context(), verticalOperator, command.CreateWorkItem{Metadata: verticalMetadata(12, 0), ProjectID: otherProject, WorkItemID: verticalWorkItem, Title: "Other", Goal: "Scoped", OwnerID: verticalOperator, RequiredACRevisions: []command.ACRevision{{ACID: "AC-1", RevisionDigest: fixture.acDigest}}})
		mustVerticalOutcome(t, outcome, err)
		complete.ProjectID = otherProject
		complete.ExpectedVersion = 1
		complete.Subject, err = domain.NewCompletionSubject(domain.CompletionSubjectConfig{ProjectID: otherProject, WorkItemID: verticalWorkItem, WorkItemVersion: 1,
			CandidateID: complete.Subject.CandidateID(), CandidateDigest: complete.Subject.CandidateDigest(), RunID: complete.Subject.RunID(), RunInputDigest: complete.Subject.RunInputDigest(),
			RequiredACRevisions: []domain.ACRevisionBinding{{ACID: "AC-1", RevisionDigest: fixture.acDigest}}, AcceptedGraphRevisionDigest: fixture.graphDigest,
			PolicyRevisionDigest: fixture.policy.RevisionDigest, CompletionRecipeDigest: fixture.policy.RecipeDigest})
		if err != nil {
			t.Fatal(err)
		}
		before := integrityDurableCounts(t, fixture)
		fixture.artifacts.ResetOpenStats()
		if _, err := fixture.application.CompleteWorkItem(t.Context(), verticalOperator, complete); err == nil {
			t.Fatal("another project's candidate authorized completion")
		}
		if calls, _ := fixture.artifacts.OpenStats(); calls != 0 {
			t.Fatal("cross-project candidate exposed artifact material")
		}
		assertIntegrityUnchanged(t, fixture, before)
	})
}

func bindIntegritySupplement(t *testing.T, fixture verticalFixture, content []byte) domain.Digest {
	t.Helper()
	digest, length, err := fixture.artifacts.Put(t.Context(), bytes.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	err = fixture.store.Within(t.Context(), func(tx port.Transaction) error {
		if err := tx.StoreArtifact(t.Context(), port.Artifact{Digest: digest, MediaType: "text/plain", ByteLength: length, StorageKey: "sha256:" + digest.String(), Availability: "Present"}); err != nil {
			return err
		}
		return tx.BindCandidateArtifact(t.Context(), verticalProject, "candidate-1", digest)
	})
	if err != nil {
		t.Fatal(err)
	}
	return digest
}

func integrityService(t *testing.T, fixture verticalFixture, artifacts port.ArtifactStore) *service.Service {
	t.Helper()
	application, err := service.New(fixture.unit, fixture.clock, &verticalIDs{counts: map[port.IDKind]uint64{port.IDAuditGroup: 100}}, verticalExecutor{}, artifacts, &verticalProjection{}, service.Config{
		Operator: verticalOperator, IdempotencyTTL: time.Hour, Specification: verticalSpecification{}, Completion: fixture.policy,
	})
	if err != nil {
		t.Fatal(err)
	}
	return application
}

type integrityArtifactReader struct {
	delegate    port.ArtifactStore
	unit        *verticalTrackingUnit
	afterClose  func()
	readInside  bool
	closeInside bool
	closed      int
}

func (store *integrityArtifactReader) Put(ctx context.Context, reader io.Reader) (domain.Digest, uint64, error) {
	return store.delegate.Put(ctx, reader)
}

func (store *integrityArtifactReader) Open(ctx context.Context, digest domain.Digest) (io.ReadCloser, error) {
	reader, err := store.delegate.Open(ctx, digest)
	if err != nil {
		return nil, err
	}
	return &integrityReadCloser{ReadCloser: reader, store: store}, nil
}

type integrityReadCloser struct {
	io.ReadCloser
	store *integrityArtifactReader
}

func (reader *integrityReadCloser) Read(buffer []byte) (int, error) {
	reader.store.readInside = reader.store.readInside || reader.store.unit.Inside()
	return reader.ReadCloser.Read(buffer)
}

func (reader *integrityReadCloser) Close() error {
	reader.store.closeInside = reader.store.closeInside || reader.store.unit.Inside()
	reader.store.closed++
	err := reader.ReadCloser.Close()
	if reader.store.afterClose != nil {
		reader.store.afterClose()
	}
	return err
}

func integrityQAFixture(t *testing.T) (verticalFixture, command.CompleteWorkItem, domain.Digest) {
	t.Helper()
	fixture, claim, candidate, subject := verticalCandidateFixture(t)
	outcome, err := fixture.application.SubmitCandidate(t.Context(), verticalOperator, command.SubmitCandidate{
		Metadata: verticalMetadata(5, 3), ProjectID: verticalProject, WorkItemID: verticalWorkItem, RunID: verticalRun,
		Candidate: command.Candidate{ID: "candidate-1", RunID: verticalRun, Digest: candidate, InputSubjectDigest: claim.Fence.InputDigest, CreatedAt: fixedClockTime,
			Artifacts: []command.ArtifactLocator{{Digest: candidate, MediaType: "text/plain", ByteLength: uint64(len("candidate-v1")), Availability: "Present"}}},
	})
	mustVerticalOutcome(t, outcome, err)
	outcome, err = fixture.application.PublishFixtureReview(t.Context(), verticalOperator, command.PublishFixtureReview{
		Metadata: verticalMetadata(6, 4), ProjectID: verticalProject, RunID: verticalRun, LeaseEpoch: claim.Fence.Epoch, RestoreGeneration: claim.Fence.RestoreGeneration,
		Review: command.Review{ID: "review-1", SubjectDigest: subject.Digest(), ReviewerID: verticalOperator, ReviewerClass: "independent", Verdict: "Approved", CreatedAt: fixedClockTime},
	})
	mustVerticalOutcome(t, outcome, err)
	report, length, err := fixture.artifacts.Put(t.Context(), bytes.NewBufferString("independent-report-v1"))
	if err != nil {
		t.Fatal(err)
	}
	outcome, err = fixture.application.PublishFixtureEvidence(t.Context(), verticalOperator, command.PublishFixtureEvidence{
		Metadata: verticalMetadata(7, 4), ProjectID: verticalProject, RunID: verticalRun, LeaseEpoch: claim.Fence.Epoch, RestoreGeneration: claim.Fence.RestoreGeneration,
		Evidence: command.Evidence{ID: "evidence-1", SubjectDigest: subject.Digest(), ACID: "AC-1", ACRevisionDigest: fixture.acDigest,
			ObservationVerdict: "Passing", ReviewDisposition: "Accepted", Applicability: "Fresh", MaterialAvailability: "Present",
			VerifierID: verticalOperator, VerifierClass: "independent", RecipeDigest: fixture.policy.RecipeDigest,
			EnvironmentDigest: fixture.policy.Checks["AC-1"].EnvironmentDigest, ObservedAt: fixedClockTime,
			Report: command.ArtifactLocator{Digest: report, MediaType: "text/plain", ByteLength: length, Availability: "Present"}},
	})
	mustVerticalOutcome(t, outcome, err)
	outcome, err = fixture.application.ApproveSubject(t.Context(), verticalOperator, command.ApproveSubject{
		Metadata: verticalMetadata(8, 4), ProjectID: verticalProject, WorkItemID: verticalWorkItem, CandidateID: "candidate-1", RequestID: "approval-1", SubjectDigest: subject.Digest(), Decision: "Approved",
	})
	mustVerticalOutcome(t, outcome, err)
	outcome, err = fixture.application.RequestQA(t.Context(), verticalOperator, command.RequestQA{
		Metadata: verticalMetadata(9, 4), ProjectID: verticalProject, WorkItemID: verticalWorkItem, CandidateID: "candidate-1", SubjectDigest: subject.Digest(),
	})
	mustVerticalOutcome(t, outcome, err)
	return fixture, command.CompleteWorkItem{Metadata: verticalMetadata(10, 5), ProjectID: verticalProject, WorkItemID: verticalWorkItem, Subject: subject}, report
}

func integrityDurableCounts(t *testing.T, fixture verticalFixture) [5]int {
	t.Helper()
	var counts [5]int
	for index, table := range []string{"completion_records", "approval_consumptions", "audit_entries", "projection_events", "outbox"} {
		if err := fixture.store.db.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM "+table).Scan(&counts[index]); err != nil {
			t.Fatal(err)
		}
	}
	return counts
}

func assertIntegrityUnchanged(t *testing.T, fixture verticalFixture, before [5]int) {
	t.Helper()
	item, err := fixture.store.LoadWorkItem(t.Context(), verticalProject, verticalWorkItem)
	if err != nil || item.Phase() != domain.PhaseQA || item.Version() != 5 {
		t.Errorf("rejected completion changed QA phase/version: item=%#v err=%v", item, err)
	}
	if after := integrityDurableCounts(t, fixture); after != before {
		t.Errorf("rejected completion changed durable authority: before=%v after=%v", before, after)
	}
}
