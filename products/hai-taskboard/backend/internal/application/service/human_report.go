package service

import (
	"context"
	json "encoding/json/v2"
	"errors"
	"io"
	"slices"
	"strings"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type humanReportSnapshot struct {
	material        port.CompletionMaterial
	identity        inputIdentity
	run             port.RunAuthority
	artifact        port.Artifact
	artifactPresent bool
	count           int
}

func humanReportTransaction(tx port.Transaction) (port.HumanReportTransaction, error) {
	t, ok := tx.(port.HumanReportTransaction)
	if !ok || nilRepositoryDependency(t) {
		return nil, humanReportCommandUnavailable()
	}
	return t, nil
}
func humanReportCommandUnavailable() error {
	return command.NewError(command.CodeCapabilityUnsupported, "human report command capability is unavailable", false, nil, nil)
}
func humanReportConflict() error {
	return command.NewError(command.CodeIdempotencyConflict, "report or command identity is already used", false, nil, nil)
}
func humanReportCapacity() error {
	return command.NewError(command.CodeLifecycleRejected, "human report capacity exceeded", false, nil, nil)
}
func humanReportDenied() error {
	return command.NewError(command.CodePermissionDenied, "human report principal or policy is unauthorized", false, nil, nil)
}

func (s *Service) humanReportPreflight(ctx context.Context, tx port.Transaction, actor domain.ActorID, v command.SubmitHumanReport, a port.Artifact) (humanReportSnapshot, error) {
	var snap humanReportSnapshot
	reports, err := humanReportTransaction(tx)
	if err != nil {
		return snap, err
	}
	authority, err := authorityTransaction(tx)
	if err != nil {
		return snap, humanReportCommandUnavailable()
	}
	if nilRepositoryDependency(s.artifacts) {
		return snap, humanReportCommandUnavailable()
	}
	snap.run, err = authority.LoadRunAuthority(ctx, v.ProjectID, v.RunID)
	if err != nil {
		return snap, err
	}
	if snap.run.Run.WorkItemID != v.WorkItemID {
		return snap, port.ErrNotFound
	}
	if snap.run.Lease.Fence.Epoch != v.LeaseEpoch || snap.run.RestoreGeneration != v.RestoreGeneration {
		return snap, command.NewError(command.CodeStaleSubject, "human report fence is stale", false, nil, nil)
	}
	if actor == snap.run.Lease.Fence.Holder {
		return snap, humanReportDenied()
	}
	policy := s.completionFor(snap.run.Run.ProjectID)
	if v.Kind == "evidence" {
		e := v.Evidence
		rule, ok := policy.Checks[e.ACID]
		if !ok || rule.VerifierClass != "human" || !rule.Independent || rule.EnvironmentDigest.IsZero() || rule.EnvironmentDigest != e.EnvironmentDigest || policy.RecipeDigest != e.RecipeDigest || actor == rule.ProhibitedVerifierActor || rule.ProhibitedVerifierRunRole == "human" {
			return snap, humanReportDenied()
		}
	}
	query := port.CompletionMaterialQuery{ProjectID: v.ProjectID, WorkItemID: v.WorkItemID, RunID: v.RunID, SubjectDigest: v.SubjectDigest, MaximumRecords: 1024}
	selected, _, err := s.currentCompletionMaterial(ctx, tx, query)
	if err != nil {
		return snap, err
	}
	query.CandidateID = selected.Candidate.ID
	snap.material, snap.identity, err = s.currentCompletionMaterial(ctx, tx, query)
	if err != nil {
		return snap, err
	}
	m := snap.material
	if m.WorkItem.Version() != v.ExpectedVersion {
		return snap, domain.Rejection{Code: domain.CodeVersionConflict}
	}
	subject, err := preparationSubject(m, policy)
	if err != nil || subject.Digest() != v.SubjectDigest {
		return snap, command.NewError(command.CodeStaleSubject, "completion subject is not current", false, nil, nil)
	}
	if v.Kind == "review" && m.WorkItem.Phase() != domain.PhaseReview {
		return snap, port.ErrRunLifecycle
	}
	if v.Kind == "evidence" {
		e := v.Evidence
		if !slices.ContainsFunc(m.RequiredACRevisions, func(ac port.ACRequirement) bool { return ac.ACID == e.ACID && ac.RevisionDigest == e.ACRevisionDigest }) {
			return snap, command.NewError(command.CodeStaleSubject, "AC revision is not current", false, nil, nil)
		}
	}
	exists, err := reports.HumanReportIDExists(ctx, v.ProjectID, v.ReportID)
	if err != nil {
		return snap, err
	}
	if exists {
		return snap, humanReportConflict()
	}
	if _, err = tx.LoadCommandResult(ctx, v.ProjectID, v.CommandID); err == nil {
		return snap, humanReportConflict()
	} else if !errors.Is(err, port.ErrNotFound) {
		return snap, err
	}
	snap.artifact, err = authority.LoadArtifact(ctx, a.Digest)
	if err == nil {
		snap.artifactPresent = true
		if snap.artifact != a {
			return snap, outputAccessCorruption()
		}
	} else if !errors.Is(err, port.ErrNotFound) {
		return snap, err
	}
	snap.count, err = reports.CountHumanReports(ctx, v.ProjectID, v.SubjectDigest)
	if err != nil {
		return snap, err
	}
	if err = s.humanReportAdmission(m, v, a, snap.count); err != nil {
		return snap, err
	}
	snap.material.RequiredACRevisions = slices.Clone(m.RequiredACRevisions)
	snap.material.CandidateArtifacts = slices.Clone(m.CandidateArtifacts)
	snap.material.Artifacts = slices.Clone(m.Artifacts)
	snap.material.Evidence = slices.Clone(m.Evidence)
	snap.material.Reviews = slices.Clone(m.Reviews)
	snap.material.Approvals = slices.Clone(m.Approvals)
	return snap, nil
}

// Admission mirrors completion's exact collections and material eligibility,
// without opening existing bytes or adding a Review-byte completion predicate.
func (s *Service) humanReportAdmission(m port.CompletionMaterial, v command.SubmitHumanReport, a port.Artifact, count int) error {
	policy := s.completionFor(m.WorkItem.ProjectID())
	reviews, evidence := len(m.Reviews), len(m.Evidence)
	artifacts := len(m.Artifacts)
	if v.Kind == "review" {
		reviews++
	} else {
		evidence++
		artifacts++
	}
	if count < 0 || count >= 1024 || reviews > 1024 || evidence > 1024 || artifacts > 1024 || len(m.CandidateArtifacts) > 1024 || len(m.RequiredACRevisions) > 1024 || len(m.Approvals) > 1024 {
		return humanReportCapacity()
	}
	known := make(map[domain.Digest]port.Artifact)
	var total uint64
	add := func(a port.Artifact) error {
		if old, ok := known[a.Digest]; ok {
			if old != a {
				return outputAccessCorruption()
			}
			return nil
		}
		if a.Digest.IsZero() || a.ByteLength > maxRunArtifactBytes || total+a.ByteLength > 50<<20 || len(known) >= 1024 {
			return humanReportCapacity()
		}
		known[a.Digest] = a
		total += a.ByteLength
		return nil
	}
	for _, a := range m.CandidateArtifacts {
		if err := add(a); err != nil {
			return err
		}
	}
	byDigest := make(map[domain.Digest]port.Artifact)
	for _, a := range m.Artifacts {
		if old, ok := byDigest[a.Digest]; ok && old != a {
			return outputAccessCorruption()
		}
		byDigest[a.Digest] = a
	}
	for _, e := range m.Evidence {
		rule, required := policy.Checks[e.ACID]
		bound := slices.ContainsFunc(m.RequiredACRevisions, func(ac port.ACRequirement) bool { return ac.ACID == e.ACID && ac.RevisionDigest == e.ACRevisionDigest })
		if !required || !bound || e.SubjectDigest != v.SubjectDigest || e.VerifierClass != rule.VerifierClass || e.Verdict != "Passed" || e.Applicability != "Current" || e.Availability != "Present" || e.RecipeDigest != policy.RecipeDigest || (!rule.EnvironmentDigest.IsZero() && e.EnvironmentDigest != rule.EnvironmentDigest) {
			continue
		}
		if a, ok := byDigest[e.ArtifactDigest]; ok && a.Availability == "Present" {
			if err := add(a); err != nil {
				return err
			}
		}
	}
	if v.Kind == "evidence" {
		return add(a)
	}
	return nil
}

func (s *Service) SubmitHumanReport(ctx context.Context, actor domain.ActorID, v command.SubmitHumanReport) (command.Outcome, error) {
	// Retain one immutable intent across the external store boundary.
	if v.Review != nil {
		v.Review = new(*v.Review)
	}
	if v.Evidence != nil {
		v.Evidence = new(*v.Evidence)
	}
	request, digest, err := command.CanonicalSubmitHumanReport(v)
	if err != nil {
		return failureOutcome(v.Metadata, invalidRequest(err))
	}
	if out, found, err := s.replayBeforeExternalIO(ctx, actor, v.Metadata, command.SubmitHumanReportOperation, v.ProjectID, digest); found {
		return out, err
	}
	a := port.Artifact{Digest: domain.HashString(v.Content), MediaType: v.MediaType, ByteLength: uint64(len(v.Content)), Availability: "Present"}
	a.StorageKey = artifactStorageKey(a.Digest)
	var before humanReportSnapshot
	err = s.unit.Within(ctx, func(tx port.Transaction) error {
		var err error
		before, err = s.humanReportPreflight(ctx, tx, actor, v, a)
		return err
	})
	if err != nil {
		return s.commandFailure(v.Metadata, err)
	}
	sealed, length, err := s.artifacts.Put(ctx, strings.NewReader(v.Content))
	if ctx.Err() != nil {
		return s.commandFailure(v.Metadata, outputAccessUnavailable())
	}
	if err != nil {
		return s.commandFailure(v.Metadata, outputAccessUnavailable())
	}
	if sealed != a.Digest || length != a.ByteLength {
		return s.commandFailure(v.Metadata, outputAccessCorruption())
	}
	if _, err = s.readHumanReportBytes(ctx, a); err != nil {
		return s.commandFailure(v.Metadata, err)
	}
	return s.execute(ctx, actor, v.Metadata, command.SubmitHumanReportOperation, v.ProjectID, request, digest, func(ctx context.Context, tx port.Transaction, now time.Time) (change mutation, applyErr error) {
		after, err := s.humanReportPreflight(ctx, tx, actor, v, a)
		if err != nil {
			return mutation{}, err
		}
		if after.identity != before.identity || after.run != before.run || !sameCompletionMaterial(after.material, before.material) || after.count != before.count {
			return mutation{}, staleCurrentInput(nil)
		}
		// A concurrent identical digest publication is safe only with identical immutable metadata.
		if before.artifactPresent && (!after.artifactPresent || after.artifact != before.artifact) {
			return mutation{}, outputAccessCorruption()
		}
		defer func() {
			if applyErr != nil {
				applyErr = rollbackMutationError{applyErr}
			}
		}()
		if !after.artifactPresent {
			if err = tx.StoreArtifact(ctx, a); err != nil {
				return mutation{}, err
			}
		}
		if v.Kind == "review" {
			verdict := "Approved"
			if v.Review.Verdict == "ChangesRequested" {
				verdict = "Rejected"
			}
			err = tx.StoreReview(ctx, port.Review{ID: domain.ReviewID(v.ReportID), ProjectID: v.ProjectID, SubjectDigest: v.SubjectDigest, Verdict: verdict, Reviewer: actor, Independent: true, CreatedAtNS: now.UnixNano()})
		} else {
			e := v.Evidence
			err = tx.StoreEvidence(ctx, port.Evidence{ID: domain.EvidenceID(v.ReportID), ProjectID: v.ProjectID, SubjectDigest: v.SubjectDigest, ACID: e.ACID, ACRevisionDigest: e.ACRevisionDigest, Verdict: "Passed", Applicability: "Current", Availability: "Present", VerifierClass: "human", VerifierActor: actor, VerifierRole: "human", RecipeDigest: e.RecipeDigest, EnvironmentDigest: e.EnvironmentDigest, ArtifactDigest: a.Digest})
		}
		if err != nil {
			return mutation{}, err
		}
		reports, err := humanReportTransaction(tx)
		if err != nil {
			return mutation{}, err
		}
		if err = reports.StoreHumanReport(ctx, port.HumanReport{ProjectID: v.ProjectID, WorkItemID: v.WorkItemID, RunID: v.RunID, ID: v.ReportID, Kind: v.Kind, SubjectDigest: v.SubjectDigest, Actor: actor, CreatedAtNS: now.UnixNano(), LeaseEpoch: v.LeaseEpoch, RestoreGeneration: v.RestoreGeneration, Artifact: a}); err != nil {
			return mutation{}, err
		}
		result := command.Result{Type: "HumanReportSubmitted", ReportID: v.ReportID, ReportKind: v.Kind, ProjectID: v.ProjectID, WorkItemID: v.WorkItemID, RunID: v.RunID, Version: after.material.WorkItem.Version(), Phase: after.material.WorkItem.Phase()}
		return changeMutation(v.ProjectID, "work_item", string(v.WorkItemID), result.Version, result, v.SubjectDigest), nil
	})
}

func (s *Service) readHumanReportBytes(ctx context.Context, a port.Artifact) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, outputAccessUnavailable()
	}
	if nilRepositoryDependency(s.artifacts) {
		return nil, outputAccessUnavailable()
	}
	r, err := s.artifacts.Open(ctx, a.Digest)
	if err != nil || nilRepositoryDependency(r) {
		if !nilRepositoryDependency(r) {
			_ = r.Close()
		}
		return nil, outputAccessUnavailable()
	}
	content, readErr := io.ReadAll(io.LimitReader(r, port.HumanReportByteLimit+1))
	closeErr := r.Close()
	if ctx.Err() != nil {
		return nil, outputAccessUnavailable()
	}
	if readErr != nil || closeErr != nil || uint64(len(content)) != a.ByteLength || len(content) > port.HumanReportByteLimit || domain.HashBytes(content) != a.Digest {
		return nil, outputAccessCorruption()
	}
	return content, nil
}

func (s *Service) loadHumanReport(ctx context.Context, actor domain.ActorID, project domain.ProjectID, id string) (port.HumanReport, error) {
	if actor == "" || actor != s.config.Operator || project == "" || !port.ValidHumanReportID(id) {
		return port.HumanReport{}, port.ErrNotFound
	}
	var r port.HumanReport
	err := s.unit.Within(ctx, func(tx port.Transaction) error {
		reader, err := humanReportTransaction(tx)
		if err != nil {
			return outputAccessUnavailable()
		}
		r, err = reader.LoadHumanReport(ctx, project, id)
		return err
	})
	if err != nil {
		return port.HumanReport{}, err
	}
	if r.ProjectID != project || r.ID != id || !port.ValidHumanReport(r) {
		return port.HumanReport{}, outputAccessCorruption()
	}
	if ctx.Err() != nil {
		return port.HumanReport{}, outputAccessUnavailable()
	}
	return r, nil
}
func (s *Service) DescribeHumanReport(ctx context.Context, actor domain.ActorID, project domain.ProjectID, id string) ([]byte, error) {
	r, err := s.loadHumanReport(ctx, actor, project, id)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"project_id": r.ProjectID, "work_item_id": r.WorkItemID, "run_id": r.RunID, "report_id": r.ID, "kind": r.Kind, "completion_subject_digest": "sha256:" + r.SubjectDigest.String(), "actor_id": r.Actor, "created_at": time.Unix(0, r.CreatedAtNS).UTC().Format(time.RFC3339Nano), "lease_epoch": r.LeaseEpoch, "restore_generation": r.RestoreGeneration, "artifact": map[string]any{"sha256": "sha256:" + r.Artifact.Digest.String(), "media_type": r.Artifact.MediaType, "byte_length": r.Artifact.ByteLength, "availability": "Present", "href": "/api/v1/projects/" + string(project) + "/human-reports/" + id + "/content", "disposition": "attachment"}}, json.Deterministic(true))
}
func (s *Service) ReadHumanReport(ctx context.Context, actor domain.ActorID, project domain.ProjectID, id string) (port.HumanReport, []byte, error) {
	before, err := s.loadHumanReport(ctx, actor, project, id)
	if err != nil {
		return port.HumanReport{}, nil, err
	}
	content, err := s.readHumanReportBytes(ctx, before.Artifact)
	if err != nil {
		return port.HumanReport{}, nil, err
	}
	after, err := s.loadHumanReport(ctx, actor, project, id)
	if ctx.Err() != nil {
		return port.HumanReport{}, nil, outputAccessUnavailable()
	}
	if err != nil {
		return port.HumanReport{}, nil, errors.Join(outputAccessCorruption(), err)
	}
	if before != after {
		return port.HumanReport{}, nil, outputAccessCorruption()
	}
	return before, content, nil
}
