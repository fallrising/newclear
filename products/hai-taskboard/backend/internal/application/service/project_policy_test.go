package service

import (
	"bytes"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func serviceProfile(t *testing.T, project domain.ProjectID, ac domain.ACID) port.PolicyProfile {
	t.Helper()
	p, e := port.NewPolicyProfile(port.PolicyProfileMaterial{Schema: 1, ProjectID: project, RecipeDigest: domain.HashString("initial recipe").String(), ApprovalRequired: true, IntegrationBase: port.RunInputIntegrationBase{Applicability: "present", Digest: new(domain.HashString("selected base").String())}, Rules: []port.RunInputVerificationRule{{ACID: ac, VerifierClass: "human", Independent: true, ProhibitedVerifierRunRole: "producer", EnvironmentDigest: domain.HashString("selected environment " + string(project)).String()}}})
	if e != nil {
		t.Fatal(e)
	}
	return p
}
func poisonDefault(s *Service) {
	s.config.Completion = CompletionPolicy{RevisionDigest: domain.HashString("wrong default"), RecipeDigest: domain.HashString("wrong recipe"), Checks: map[domain.ACID]VerificationRule{"AC-A": {VerifierClass: "producer"}}}
}

func TestProjectPolicies_SelectionAndIsolation(t *testing.T) {
	p := serviceProfile(t, projectID, "AC-A")
	other := serviceProfile(t, "other-project", "AC-A")
	for stage, name := range []string{"Candidate", "FixtureReview", "FixtureEvidence", "Approval", "QA", "Complete"} {
		for _, deny := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/other-only=%t", name, deny), func(t *testing.T) {
				f := acceptedCurrentFlowPolicy(t, stage, &p)
				poisonDefault(f.svc)
				f.svc.config.ProjectPolicies["other-project"] = other
				if deny {
					delete(f.svc.config.ProjectPolicies, projectID)
				}
				before := currentHistoryCounts(t, f.db)
				_, e := f.call(t, stage)
				if !deny {
					if e != nil {
						t.Fatalf("selected project consumer %s: %v", name, e)
					}
				} else {
					assertCommandError(t, e, command.CodeStaleSubject)
					if !reflect.DeepEqual(before, currentHistoryCounts(t, f.db)) {
						t.Fatal("cross-project rejection changed history")
					}
				}
			})
		}
	}
	t.Run("DescribeCompletion", func(t *testing.T) {
		f := acceptedCurrentFlowPolicy(t, 1, &p)
		poisonDefault(f.svc)
		b, e := f.svc.DescribeCompletion(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID)
		if e != nil {
			t.Fatal(e)
		}
		if !bytes.Contains(b, []byte(p.Digest().String())) || !bytes.Contains(b, []byte(*p.Material().IntegrationBase.Digest)) {
			t.Fatal("selected snapshot lost identity")
		}
	})
	for _, kind := range []string{"review", "evidence"} {
		t.Run("HumanPreflightAndCommit/"+kind, func(t *testing.T) {
			f := acceptedCurrentFlowPolicy(t, 1, &p)
			poisonDefault(f.svc)
			q := command.SubmitHumanReport{Metadata: initialMetadata(200, 5), ProjectID: projectID, WorkItemID: workItemID, RunID: f.candidate.RunID, ReportID: "report_0000000200", SubjectDigest: f.review.Review.SubjectDigest, LeaseEpoch: f.review.LeaseEpoch, RestoreGeneration: f.review.RestoreGeneration, Kind: kind, MediaType: "text/plain", Content: "candidate"}
			if kind == "review" {
				q.Review = &command.HumanReviewIntent{Verdict: "Approved"}
			} else {
				q.Evidence = &command.HumanEvidenceIntent{ACID: "AC-A", ACRevisionDigest: domain.HashBytes(initialContent), RecipeDigest: domain.HashString("initial recipe"), EnvironmentDigest: domain.HashString("selected environment " + string(projectID)), Verdict: "Passing"}
			}
			out, e := f.svc.SubmitHumanReport(t.Context(), operator, q)
			if e != nil {
				t.Fatal("selected human report", e)
			}
			f.svc.config.ProjectPolicies = nil
			f.svc.artifacts = identityNoArtifactIO{t: t}
			again, e := f.svc.SubmitHumanReport(t.Context(), operator, q)
			if e != nil || !again.Replayed || !bytes.Equal(out.Payload, again.Payload) {
				t.Fatal("human replay consulted current policy", e)
			}
		})
	}
	for _, operation := range []string{"Ready", "Dispatch", "ClaimDispatch"} {
		t.Run(operation, func(t *testing.T) {
			svc, _, db, dispatch := acceptedReadyInputPolicy(t, &p)
			poisonDefault(svc)
			if operation == "Ready" {
				q := command.MarkReady{Metadata: initialMetadata(50, 2), ProjectID: projectID, WorkItemID: workItemID}
				out, e := svc.MarkReady(t.Context(), operator, q)
				if e != nil || !out.Replayed {
					t.Fatal("Ready replay", e)
				}
				return
			}
			id := dispatchAccepted(t, svc, db, dispatch)
			if operation == "Dispatch" {
				var stored string
				if e := db.QueryRow("SELECT policy_revision_digest FROM accepted_spec_revisions").Scan(&stored); e != nil || stored != p.Digest().String() {
					t.Fatal("wrong accepted policy", e)
				}
				return
			}
			// Explicitly modeled configuration drift: production startup never hot-reloads.
			m := p.Material()
			m.ApprovalRequired = false
			changed, e := port.NewPolicyProfile(m)
			if e != nil {
				t.Fatal(e)
			}
			svc.config.ProjectPolicies[projectID] = changed
			if _, e = svc.ClaimDispatch(t.Context(), "worker", claimInput(id)); !errors.Is(e, port.ErrStaleRunInput) {
				t.Fatal("claim failed to fence selected drift", e)
			}
			var count int
			var state string
			if e = db.QueryRow("SELECT count(*) FROM run_leases").Scan(&count); e != nil {
				t.Fatal(e)
			}
			if e = db.QueryRow("SELECT reconciliation_state FROM runs").Scan(&state); e != nil || count != 0 || state != "NeedsReconcile" {
				t.Fatal("stale claim executed or leased", state, count, e)
			}
		})
	}
}

func TestProjectPolicies_InitialMissingRuleAndOwnedConfiguration(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(fmt.Sprintf("missing=%t", missing), func(t *testing.T) {
			svc, store, db, q := initialFixture(t)
			ac := domain.ACID("AC-A")
			if missing {
				ac = "other"
			}
			p := serviceProfile(t, projectID, ac)
			original := svc.config
			original.ProjectPolicies = map[domain.ProjectID]port.PolicyProfile{projectID: p, "other-project": serviceProfile(t, "other-project", "AC-A")}
			built, e := New(svc.unit, svc.clock, svc.ids, executorStub{declaration: svc.executorDeclaration}, svc.artifacts, svc.projections, original)
			if e != nil {
				t.Fatal(e)
			}
			svc = built
			delete(original.ProjectPolicies, projectID)
			original.Completion.Checks["AC-A"] = VerificationRule{}
			if svc.completionFor(projectID).RevisionDigest != p.Digest() || svc.config.Completion.Checks["AC-A"].VerifierClass == "" {
				t.Fatal("constructor leaked caller maps")
			}
			view := svc.completionFor(projectID)
			delete(view.Checks, ac)
			if len(svc.completionFor(projectID).Checks) != 1 {
				t.Fatal("selected rule map aliased")
			}
			q.PolicyRevisionDigest = p.Digest()
			if e = store.Within(t.Context(), func(tx port.Transaction) error {
				proposal, e := tx.(port.AdmissionTransaction).LoadProposal(t.Context(), projectID, q.ProposalDigest)
				if e != nil {
					return e
				}
				_, q.AcceptanceSubjectDigest, e = port.CanonicalInitialAcceptanceSubject(port.NewInitialAcceptanceSubject(projectID, q.ExpectedVersion, proposal, q.PolicyRevisionDigest, q.WorkItems))
				return e
			}); e != nil {
				t.Fatal(e)
			}
			description, e := svc.DescribeInitialAcceptance(t.Context(), operator, projectID, q.ProposalDigest)
			if missing {
				if e == nil {
					t.Fatal("missing selected rule used another project/default")
				}
			} else {
				if e != nil {
					t.Fatal(e)
				}
				var d struct {
					Policy string `json:"policy_revision_digest"`
				}
				if e = json.Unmarshal(description, &d); e != nil || d.Policy != "sha256:"+p.Digest().String() {
					t.Fatal("initial selected digest", e)
				}
			}
			before := initialCounts(t, db)
			_, e = svc.AcceptInitialSpecification(t.Context(), operator, q)
			if missing {
				assertCommandError(t, e, command.CodeInvalidRequest)
				if !reflect.DeepEqual(before, initialCounts(t, db)) {
					t.Fatal("missing rule wrote")
				}
			} else {
				if e != nil {
					t.Fatal(e)
				}
			}
			bad := svc.config
			bad.ProjectPolicies = map[domain.ProjectID]port.PolicyProfile{"wrong": p}
			if _, e = New(svc.unit, svc.clock, svc.ids, executorStub{declaration: svc.executorDeclaration}, svc.artifacts, svc.projections, bad); e == nil {
				t.Fatal("map key/project mismatch admitted")
			}
		})
	}
}
