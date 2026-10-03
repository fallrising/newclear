package service

import (
	"bytes"
	"context"
	json "encoding/json/v2"
	"errors"
	"io"
	"mime"
	"slices"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type ClaimDispatchRequest struct {
	ProjectID                 domain.ProjectID
	RunID                     domain.RunID
	Holder                    domain.ActorID
	ExpectedRestoreGeneration uint64
	LeaseDuration             time.Duration
}

type ClaimReconciliationRequest struct {
	PreviousFence port.RunFence
	Successor     domain.ActorID
	LeaseDuration time.Duration
}

type RunObservationKind string

const (
	ObservationDispatchReceived   RunObservationKind = "dispatch_received"
	ObservationStartAcknowledged  RunObservationKind = "start_acknowledged"
	ObservationStartLost          RunObservationKind = "start_lost"
	ObservationHeartbeat          RunObservationKind = "heartbeat"
	ObservationCheckpoint         RunObservationKind = "checkpoint"
	ObservationTerminalSuccess    RunObservationKind = "terminal_success"
	ObservationTerminalFailure    RunObservationKind = "terminal_failure"
	ObservationTimeout            RunObservationKind = "timeout"
	ObservationLookupRunning      RunObservationKind = "lookup_running"
	ObservationLookupUnknown      RunObservationKind = "lookup_unknown"
	ObservationCancelAcknowledged RunObservationKind = "cancel_acknowledged"
	ObservationUnknownOutcome     RunObservationKind = "unknown_outcome"
	ObservationLateResult         RunObservationKind = "late_result"
	ObservationStalePublication   RunObservationKind = "stale_publication"
)

type RunObservation struct {
	Fence             port.RunFence
	Kind              RunObservationKind
	ArtifactDigest    domain.Digest
	ArtifactMediaType string
	ArtifactBytes     []byte
}

const maxRunArtifactBytes = 10 * 1024 * 1024

func (service *Service) ClaimDispatch(ctx context.Context, principal domain.ActorID, request ClaimDispatchRequest) (port.ExecutorEnvelope, error) {
	if principal == "" || principal != request.Holder || request.ProjectID == "" || request.RunID == "" ||
		request.ExpectedRestoreGeneration == 0 || request.LeaseDuration <= 0 {
		return port.ExecutorEnvelope{}, command.NewError(command.CodePermissionDenied, "runtime principal does not own the requested lease", false, nil, nil)
	}
	now := service.clock.Now().UTC()
	if now.IsZero() {
		return port.ExecutorEnvelope{}, errors.New("clock returned zero time")
	}
	var envelope port.ExecutorEnvelope
	var committed *port.CommittedProjection
	err := service.unit.Within(ctx, func(tx port.Transaction) error {
		authority, err := authorityTransaction(tx)
		if err != nil {
			return err
		}
		envelope, err = authority.ClaimPendingRun(ctx, port.RunClaimRequest{
			ProjectID: request.ProjectID, RunID: request.RunID, Holder: request.Holder,
			ExpectedRestoreGeneration: request.ExpectedRestoreGeneration,
			ClaimedAtNS:               now.UnixNano(), DeadlineNS: now.Add(request.LeaseDuration).UnixNano(),
		})
		if err != nil {
			return err
		}
		if envelope.AdapterID != service.executorDeclaration.AdapterID || envelope.AdapterVersion != service.executorDeclaration.AdapterVersion {
			return command.NewError(command.CodeCapabilityUnsupported, "persisted Run names an unavailable executor", false, nil, nil)
		}
		envelope.Capabilities = slices.Clone(service.executorDeclaration.Capabilities)
		after, err := authority.LoadRunAuthority(ctx, request.ProjectID, request.RunID)
		if err != nil {
			return err
		}
		committed, err = service.appendRuntimeAudit(ctx, tx, principal, envelope.CommandID, "ClaimDispatch", after, true, now)
		return err
	})
	if err != nil {
		return port.ExecutorEnvelope{}, err
	}
	service.publishRuntimeProjection(ctx, committed)
	return envelope.Clone(), nil
}

// ClaimExpiredRunForReconciliation transfers recovery ownership without
// creating another executor dispatch. The previous complete fence is part of
// the compare-and-swap contract, so only one successor can win.
func (service *Service) ClaimExpiredRunForReconciliation(ctx context.Context, principal domain.ActorID, request ClaimReconciliationRequest) (port.RunAuthority, error) {
	if principal == "" || principal != request.Successor || request.Successor == "" ||
		request.PreviousFence.ProjectID == "" || request.PreviousFence.RunID == "" || request.PreviousFence.InputDigest.IsZero() ||
		request.PreviousFence.Holder == "" || request.PreviousFence.Epoch == 0 || request.PreviousFence.RestoreGeneration == 0 ||
		request.LeaseDuration <= 0 {
		return port.RunAuthority{}, command.NewError(command.CodePermissionDenied, "runtime principal cannot claim reconciliation ownership", false, nil, nil)
	}
	now := service.clock.Now().UTC()
	if now.IsZero() {
		return port.RunAuthority{}, errors.New("clock returned zero time")
	}
	var result port.RunAuthority
	var committed *port.CommittedProjection
	err := service.unit.Within(ctx, func(tx port.Transaction) error {
		authority, err := authorityTransaction(tx)
		if err != nil {
			return err
		}
		result, err = authority.ClaimExpiredRunForReconciliation(ctx, port.RunLeaseSuccessionRequest{
			PreviousFence: request.PreviousFence,
			Successor:     request.Successor,
			ClaimedAtNS:   now.UnixNano(),
			DeadlineNS:    now.Add(request.LeaseDuration).UnixNano(),
		})
		if err != nil {
			return err
		}
		committed, err = service.appendRuntimeAudit(ctx, tx, principal, result.Outbox.CommandID, "ClaimRunReconciliation", result, true, now)
		if err != nil {
			return err
		}
		result, err = authority.LoadRunAuthority(ctx, request.PreviousFence.ProjectID, request.PreviousFence.RunID)
		return err
	})
	if err != nil {
		return port.RunAuthority{}, err
	}
	service.publishRuntimeProjection(ctx, committed)
	return result, nil
}

func (service *Service) PublishRunObservation(ctx context.Context, principal domain.ActorID, observation RunObservation) (port.RunAuthority, error) {
	if principal == "" || principal != observation.Fence.Holder || !validObservationKind(observation.Kind) {
		return port.RunAuthority{}, command.NewError(command.CodePermissionDenied, "runtime publisher does not own the supplied fence", false, nil, nil)
	}
	now := service.clock.Now().UTC()
	if now.IsZero() {
		return port.RunAuthority{}, errors.New("clock returned zero time")
	}
	artifact, err := service.prepareRunArtifact(ctx, observation)
	if err != nil {
		return port.RunAuthority{}, err
	}
	var result port.RunAuthority
	var rejected error
	var committed *port.CommittedProjection
	err = service.unit.Within(ctx, func(tx port.Transaction) error {
		authorityTx, err := authorityTransaction(tx)
		if err != nil {
			return err
		}
		before, err := authorityTx.LoadRunAuthority(ctx, observation.Fence.ProjectID, observation.Fence.RunID)
		if err != nil {
			return err
		}
		if !currentFence(before, observation.Fence, now.UnixNano()) {
			rejected = port.FenceRejection{Reason: "publisher does not own current Run fence"}
			_, err = service.appendRuntimeAudit(ctx, tx, principal, before.Outbox.CommandID, "RejectRunPublication", before, false, now)
			return err
		}
		publication, err := service.publicationFor(before, observation)
		if err != nil {
			rejected = err
			_, auditErr := service.appendRuntimeAudit(ctx, tx, principal, before.Outbox.CommandID, "RejectRunPublication", before, false, now)
			return auditErr
		}
		result, err = authorityTx.ApplyRunPublication(ctx, publication)
		if err != nil {
			if errors.Is(err, port.ErrFenceRejected) || errors.Is(err, port.ErrRunLifecycle) {
				rejected = err
				_, auditErr := service.appendRuntimeAudit(ctx, tx, principal, before.Outbox.CommandID, "RejectRunPublication", before, false, now)
				return auditErr
			}
			return err
		}
		if artifact != nil {
			stored, loadErr := authorityTx.LoadArtifact(ctx, artifact.Digest)
			switch {
			case errors.Is(loadErr, port.ErrNotFound):
				if err := tx.StoreArtifact(ctx, *artifact); err != nil {
					return err
				}
			case loadErr != nil:
				return loadErr
			case stored != *artifact:
				return domain.StorageCorruptionError{Reason: "artifact metadata conflicts with sealed object"}
			}
		}
		if observation.Kind == ObservationCancelAcknowledged {
			item, err := tx.LoadWorkItem(ctx, before.Run.ProjectID, before.Run.WorkItemID)
			if err != nil {
				return err
			}
			canceled, err := item.Transition(domain.PhaseCanceled, domain.TransitionGuards{
				ExpectedVersion: item.Version(), FinalizeCancellationAllowed: true,
			})
			if err != nil {
				return err
			}
			if err := tx.UpdateWorkItem(ctx, canceled, item.Version()); err != nil {
				return err
			}
		}
		committed, err = service.appendRuntimeAudit(ctx, tx, principal, before.Outbox.CommandID, "PublishRunObservation", result, true, now)
		return err
	})
	if err != nil {
		return port.RunAuthority{}, err
	}
	if rejected != nil {
		return port.RunAuthority{}, rejected
	}
	service.publishRuntimeProjection(ctx, committed)
	return result, nil
}

func (service *Service) prepareRunArtifact(ctx context.Context, observation RunObservation) (*port.Artifact, error) {
	if observation.Kind != ObservationTerminalSuccess {
		if !observation.ArtifactDigest.IsZero() || observation.ArtifactMediaType != "" || len(observation.ArtifactBytes) != 0 {
			return nil, command.NewError(command.CodeInvalidRequest, "artifact is only valid for terminal success", false, nil, nil)
		}
		return nil, nil
	}
	if len(observation.ArtifactBytes) == 0 || len(observation.ArtifactBytes) > maxRunArtifactBytes || observation.ArtifactDigest.IsZero() ||
		domain.HashBytes(observation.ArtifactBytes) != observation.ArtifactDigest {
		return nil, command.NewError(command.CodeInvalidRequest, "terminal success artifact digest or length is invalid", false, nil, nil)
	}
	mediaType, parameters, err := mime.ParseMediaType(observation.ArtifactMediaType)
	if err != nil || mediaType == "" {
		return nil, command.NewError(command.CodeInvalidRequest, "terminal success artifact media type is invalid", false, nil, nil)
	}
	mediaType = mime.FormatMediaType(mediaType, parameters)
	sealed, length, err := service.artifacts.Put(ctx, bytes.NewReader(observation.ArtifactBytes))
	if err != nil {
		return nil, err
	}
	if sealed != observation.ArtifactDigest || length != uint64(len(observation.ArtifactBytes)) {
		return nil, domain.StorageCorruptionError{Reason: "artifact store returned mismatched identity"}
	}
	return &port.Artifact{
		Digest: sealed, MediaType: mediaType, ByteLength: length,
		StorageKey: artifactStorageKey(sealed), Availability: "Present",
	}, nil
}

func (service *Service) ReadRunAuthority(ctx context.Context, projectID domain.ProjectID, runID domain.RunID) (port.RunAuthority, error) {
	var result port.RunAuthority
	err := service.unit.Within(ctx, func(tx port.Transaction) error {
		authority, err := authorityTransaction(tx)
		if err != nil {
			return err
		}
		result, err = authority.LoadRunAuthority(ctx, projectID, runID)
		return err
	})
	return result, err
}

// replayBeforeExternalIO preserves the command's authorization and
// idempotency contract before an artifact store is consulted. A response-loss
// retry must remain replayable even when the immutable object is no longer
// available to a fresh command.
func (service *Service) replayBeforeExternalIO(
	ctx context.Context,
	principal domain.ActorID,
	metadata command.Metadata,
	operation command.Operation,
	projectID domain.ProjectID,
	requestDigest domain.Digest,
) (command.Outcome, bool, error) {
	if principal != service.config.Operator {
		outcome, err := failureOutcome(metadata, command.NewError(command.CodePermissionDenied, "principal is not authorized", false, nil, nil))
		return outcome, true, err
	}
	now := service.clock.Now().UTC()
	if now.IsZero() {
		return command.Outcome{}, true, errors.New("clock returned zero time")
	}
	var result port.CommandResult
	var replayFailure *command.Error
	var found bool
	err := service.unit.Within(ctx, func(tx port.Transaction) error {
		var err error
		result, replayFailure, found, err = loadReplay(
			ctx, tx, principal, projectID, operation, metadata.IdempotencyKey, requestDigest, now,
		)
		return err
	})
	if err != nil {
		outcome, commandErr := service.commandFailure(metadata, err)
		return outcome, true, commandErr
	}
	if !found {
		return command.Outcome{}, false, nil
	}
	outcome := command.Outcome{Payload: bytes.Clone(result.Payload), Replayed: true}
	if replayFailure != nil {
		return outcome, true, replayFailure
	}
	return outcome, true, nil
}

func (service *Service) verifyArtifacts(ctx context.Context, locators []command.ArtifactLocator) error {
	for _, locator := range locators {
		if err := service.verifyArtifact(ctx, locator); err != nil {
			return err
		}
	}
	return nil
}

func (service *Service) SubmitCandidate(ctx context.Context, principal domain.ActorID, value command.SubmitCandidate) (command.Outcome, error) {
	request, digest, err := command.CanonicalSubmitCandidate(value)
	if err != nil {
		return failureOutcome(value.Metadata, invalidRequest(err))
	}
	if replayed, found, err := service.replayBeforeExternalIO(ctx, principal, value.Metadata, command.SubmitCandidateOperation, value.ProjectID, digest); found {
		return replayed, err
	}
	verificationErr := service.verifyArtifacts(ctx, value.Candidate.Artifacts)
	return service.execute(ctx, principal, value.Metadata, command.SubmitCandidateOperation, value.ProjectID, request, digest,
		func(ctx context.Context, tx port.Transaction, now time.Time) (mutation, error) {
			if verificationErr != nil {
				return mutation{}, verificationErr
			}
			authorityTx, err := authorityTransaction(tx)
			if err != nil {
				return mutation{}, err
			}
			run, err := authorityTx.LoadRunAuthority(ctx, value.ProjectID, value.RunID)
			if err != nil {
				return mutation{}, err
			}
			item, err := tx.LoadWorkItem(ctx, value.ProjectID, value.WorkItemID)
			if err != nil {
				return mutation{}, err
			}
			if item.Version() != value.ExpectedVersion {
				return mutation{}, domain.Rejection{Code: domain.CodeVersionConflict}
			}
			if item.Phase() != domain.PhaseDeveloping || run.Run.WorkItemID != value.WorkItemID || run.Run.ObservedState != "Succeeded" ||
				run.Run.ReconciliationState != "None" || run.Run.SideEffectOutcome != "Confirmed" || value.Candidate.InputSubjectDigest != run.Run.InputDigest {
				return mutation{}, port.ErrRunLifecycle
			}
			candidateArtifact := false
			for _, artifact := range value.Candidate.Artifacts {
				if artifact.Availability != "Present" {
					return mutation{}, command.NewError(command.CodeLifecycleRejected, "candidate artifact is unavailable", false, nil, nil)
				}
				stored, err := authorityTx.LoadArtifact(ctx, artifact.Digest)
				switch {
				case errors.Is(err, port.ErrNotFound):
					err = tx.StoreArtifact(ctx, port.Artifact{Digest: artifact.Digest, MediaType: artifact.MediaType, ByteLength: artifact.ByteLength, StorageKey: artifactStorageKey(artifact.Digest), Availability: artifact.Availability})
				case err == nil && (stored.MediaType != artifact.MediaType || stored.ByteLength != artifact.ByteLength || stored.StorageKey != artifactStorageKey(artifact.Digest) || stored.Availability != artifact.Availability):
					err = domain.StorageCorruptionError{Reason: "artifact metadata conflicts with immutable digest"}
				}
				if err != nil {
					return mutation{}, err
				}
				candidateArtifact = candidateArtifact || artifact.Digest == value.Candidate.Digest
			}
			if !candidateArtifact {
				return mutation{}, command.NewError(command.CodeLifecycleRejected, "candidate digest is not present in its artifact manifest", false, nil, nil)
			}
			if err := tx.StoreCandidate(ctx, port.Candidate{ID: value.Candidate.ID, ProjectID: value.ProjectID, RunID: value.RunID, Digest: value.Candidate.Digest, InputSubjectDigest: value.Candidate.InputSubjectDigest, CreatedAtNS: now.UnixNano()}); err != nil {
				return mutation{}, err
			}
			for _, artifact := range value.Candidate.Artifacts {
				if err := tx.BindCandidateArtifact(ctx, value.ProjectID, value.Candidate.ID, artifact.Digest); err != nil {
					return mutation{}, err
				}
			}
			next, err := item.Transition(domain.PhaseReview, domain.TransitionGuards{ExpectedVersion: value.ExpectedVersion, HasCurrentCandidate: true})
			if err != nil {
				return mutation{}, err
			}
			if err := tx.UpdateWorkItem(ctx, next, value.ExpectedVersion); err != nil {
				return mutation{}, err
			}
			result := command.Result{Type: "CandidateSubmitted", ProjectID: value.ProjectID, WorkItemID: value.WorkItemID, RunID: value.RunID, Version: next.Version(), Phase: next.Phase()}
			return changeMutation(value.ProjectID, "work_item", string(value.WorkItemID), next.Version(), result, value.Candidate.Digest), nil
		})
}

func (service *Service) PublishFixtureReview(ctx context.Context, principal domain.ActorID, value command.PublishFixtureReview) (command.Outcome, error) {
	request, digest, err := command.CanonicalPublishFixtureReview(value)
	if err != nil {
		return failureOutcome(value.Metadata, invalidRequest(err))
	}
	return service.execute(ctx, principal, value.Metadata, command.PublishReviewOperation, value.ProjectID, request, digest,
		func(ctx context.Context, tx port.Transaction, now time.Time) (mutation, error) {
			authorityTx, err := authorityTransaction(tx)
			if err != nil {
				return mutation{}, err
			}
			run, material, subject, err := service.preparationForRun(ctx, authorityTx, value.ProjectID, value.RunID, value.Review.SubjectDigest)
			if err != nil {
				return mutation{}, err
			}
			if material.WorkItem.Version() != value.ExpectedVersion {
				return mutation{}, domain.Rejection{Code: domain.CodeVersionConflict}
			}
			if value.LeaseEpoch != run.Lease.Fence.Epoch || value.RestoreGeneration != run.RestoreGeneration {
				return mutation{}, port.FenceRejection{Reason: "fixture review fence is stale"}
			}
			if value.Review.ReviewerID != principal || principal == run.Lease.Fence.Holder || value.Review.ReviewerClass == "producer" {
				return mutation{}, command.NewError(command.CodePermissionDenied, "reviewer is not independent", false, nil, nil)
			}
			verdict := value.Review.Verdict
			if verdict == "ChangesRequested" {
				verdict = "Rejected"
			}
			if err := tx.StoreReview(ctx, port.Review{ID: value.Review.ID, ProjectID: value.ProjectID, SubjectDigest: subject.Digest(), Verdict: verdict, Reviewer: principal, Independent: true, CreatedAtNS: now.UnixNano()}); err != nil {
				return mutation{}, err
			}
			result := command.Result{Type: "FixtureReviewPublished", ProjectID: value.ProjectID, WorkItemID: material.WorkItem.ID(), RunID: value.RunID, Version: material.WorkItem.Version(), Phase: material.WorkItem.Phase()}
			return changeMutation(value.ProjectID, "work_item", string(material.WorkItem.ID()), material.WorkItem.Version(), result, subject.Digest()), nil
		})
}

func (service *Service) PublishFixtureEvidence(ctx context.Context, principal domain.ActorID, value command.PublishFixtureEvidence) (command.Outcome, error) {
	request, digest, err := command.CanonicalPublishFixtureEvidence(value)
	if err != nil {
		return failureOutcome(value.Metadata, invalidRequest(err))
	}
	if replayed, found, err := service.replayBeforeExternalIO(ctx, principal, value.Metadata, command.PublishEvidenceOperation, value.ProjectID, digest); found {
		return replayed, err
	}
	verificationErr := service.verifyArtifacts(ctx, []command.ArtifactLocator{value.Evidence.Report})
	return service.execute(ctx, principal, value.Metadata, command.PublishEvidenceOperation, value.ProjectID, request, digest,
		func(ctx context.Context, tx port.Transaction, _ time.Time) (mutation, error) {
			if verificationErr != nil {
				return mutation{}, verificationErr
			}
			authorityTx, err := authorityTransaction(tx)
			if err != nil {
				return mutation{}, err
			}
			run, material, subject, err := service.preparationForRun(ctx, authorityTx, value.ProjectID, value.RunID, value.Evidence.SubjectDigest)
			if err != nil {
				return mutation{}, err
			}
			if material.WorkItem.Version() != value.ExpectedVersion {
				return mutation{}, domain.Rejection{Code: domain.CodeVersionConflict}
			}
			if value.LeaseEpoch != run.Lease.Fence.Epoch || value.RestoreGeneration != run.RestoreGeneration {
				return mutation{}, port.FenceRejection{Reason: "fixture evidence fence is stale"}
			}
			rule, required := service.config.Completion.Checks[value.Evidence.ACID]
			if !required || value.Evidence.VerifierID != principal || principal == run.Lease.Fence.Holder || value.Evidence.VerifierClass == "producer" ||
				value.Evidence.VerifierClass != rule.VerifierClass || value.Evidence.RecipeDigest != service.config.Completion.RecipeDigest ||
				(!rule.EnvironmentDigest.IsZero() && value.Evidence.EnvironmentDigest != rule.EnvironmentDigest) {
				return mutation{}, command.NewError(command.CodePermissionDenied, "evidence verifier or recipe is not authorized", false, nil, nil)
			}
			boundRevision := false
			for _, requirement := range material.RequiredACRevisions {
				boundRevision = boundRevision || requirement.ACID == value.Evidence.ACID && requirement.RevisionDigest == value.Evidence.ACRevisionDigest
			}
			if !boundRevision || value.Evidence.ObservationVerdict != "Passing" || value.Evidence.ReviewDisposition != "Accepted" || value.Evidence.Applicability != "Fresh" || value.Evidence.MaterialAvailability != "Present" {
				return mutation{}, command.NewError(command.CodeLifecycleRejected, "evidence does not satisfy the current subject", false, nil, nil)
			}
			stored, err := authorityTx.LoadArtifact(ctx, value.Evidence.Report.Digest)
			switch {
			case errors.Is(err, port.ErrNotFound):
				err = tx.StoreArtifact(ctx, port.Artifact{Digest: value.Evidence.Report.Digest, MediaType: value.Evidence.Report.MediaType, ByteLength: value.Evidence.Report.ByteLength, StorageKey: artifactStorageKey(value.Evidence.Report.Digest), Availability: "Present"})
			case err == nil && (stored.MediaType != value.Evidence.Report.MediaType || stored.ByteLength != value.Evidence.Report.ByteLength || stored.StorageKey != artifactStorageKey(value.Evidence.Report.Digest) || stored.Availability != "Present"):
				err = domain.StorageCorruptionError{Reason: "evidence artifact conflicts with immutable digest"}
			}
			if err != nil {
				return mutation{}, err
			}
			if err := tx.StoreEvidence(ctx, port.Evidence{ID: value.Evidence.ID, ProjectID: value.ProjectID, SubjectDigest: subject.Digest(), ACID: value.Evidence.ACID, ACRevisionDigest: value.Evidence.ACRevisionDigest, Verdict: "Passed", Applicability: "Current", Availability: "Present", VerifierClass: value.Evidence.VerifierClass, VerifierActor: principal, VerifierRole: value.Evidence.VerifierClass, RecipeDigest: value.Evidence.RecipeDigest, EnvironmentDigest: value.Evidence.EnvironmentDigest, ArtifactDigest: value.Evidence.Report.Digest}); err != nil {
				return mutation{}, err
			}
			result := command.Result{Type: "FixtureEvidencePublished", ProjectID: value.ProjectID, WorkItemID: material.WorkItem.ID(), RunID: value.RunID, Version: material.WorkItem.Version(), Phase: material.WorkItem.Phase()}
			return changeMutation(value.ProjectID, "work_item", string(material.WorkItem.ID()), material.WorkItem.Version(), result, subject.Digest()), nil
		})
}

func (service *Service) ApproveSubject(ctx context.Context, principal domain.ActorID, value command.ApproveSubject) (command.Outcome, error) {
	request, digest, err := command.CanonicalApproveSubject(value)
	if err != nil {
		return failureOutcome(value.Metadata, invalidRequest(err))
	}
	return service.execute(ctx, principal, value.Metadata, command.ApproveSubjectOperation, value.ProjectID, request, digest,
		func(ctx context.Context, tx port.Transaction, now time.Time) (mutation, error) {
			authorityTx, err := authorityTransaction(tx)
			if err != nil {
				return mutation{}, err
			}
			completionMaterial, err := tx.LoadCompletionMaterial(ctx, port.CompletionMaterialQuery{
				ProjectID: value.ProjectID, WorkItemID: value.WorkItemID, CandidateID: value.CandidateID,
				SubjectDigest: value.SubjectDigest,
			})
			if err != nil {
				return mutation{}, err
			}
			if completionMaterial.WorkItem.Version() != value.ExpectedVersion {
				return mutation{}, domain.Rejection{Code: domain.CodeVersionConflict}
			}
			if completionMaterial.WorkItem.Phase() != domain.PhaseReview && completionMaterial.WorkItem.Phase() != domain.PhaseQA {
				return mutation{}, port.ErrRunLifecycle
			}
			current, err := preparationSubject(completionMaterial, service.config.Completion)
			if err != nil || current.Digest() != value.SubjectDigest {
				return mutation{}, command.NewError(command.CodeStaleSubject, "completion subject is not current", false, []domain.RejectionCode{domain.CodeSubjectStale}, err)
			}
			subjectMaterial, err := authorityTx.LoadSubjectMaterial(ctx, value.ProjectID, value.SubjectDigest)
			if err != nil {
				return mutation{}, err
			}
			approvedReview := false
			for _, review := range subjectMaterial.Reviews {
				approvedReview = approvedReview || review.SubjectDigest == value.SubjectDigest && review.Verdict == "Approved" && review.Independent
			}
			if !approvedReview || value.Decision != "Approved" {
				return mutation{}, command.NewError(command.CodeLifecycleRejected, "subject is not approved for completion", false, nil, nil)
			}
			if err := tx.StoreApproval(ctx, port.Approval{ID: domain.ApprovalID(value.RequestID), ProjectID: value.ProjectID, SubjectDigest: value.SubjectDigest, CommandKind: string(domain.CommandCompleteWorkItem), Actor: principal, ExpiresAtNS: now.Add(service.config.IdempotencyTTL).UnixNano()}); err != nil {
				return mutation{}, err
			}
			result := command.Result{
				Type: "SubjectApproved", ProjectID: value.ProjectID, WorkItemID: value.WorkItemID,
				Version: completionMaterial.WorkItem.Version(), Phase: completionMaterial.WorkItem.Phase(),
			}
			return changeMutation(value.ProjectID, "work_item", string(value.WorkItemID), value.ExpectedVersion, result, value.SubjectDigest), nil
		})
}

func (service *Service) RequestQA(ctx context.Context, principal domain.ActorID, value command.RequestQA) (command.Outcome, error) {
	request, digest, err := command.CanonicalRequestQA(value)
	if err != nil {
		return failureOutcome(value.Metadata, invalidRequest(err))
	}
	return service.execute(ctx, principal, value.Metadata, command.RequestQAOperation, value.ProjectID, request, digest,
		func(ctx context.Context, tx port.Transaction, _ time.Time) (mutation, error) {
			authorityTx, err := authorityTransaction(tx)
			if err != nil {
				return mutation{}, err
			}
			material, err := tx.LoadCompletionMaterial(ctx, port.CompletionMaterialQuery{ProjectID: value.ProjectID, WorkItemID: value.WorkItemID, CandidateID: value.CandidateID, SubjectDigest: value.SubjectDigest})
			if err != nil {
				return mutation{}, err
			}
			subject, err := preparationSubject(material, service.config.Completion)
			if err != nil || subject.Digest() != value.SubjectDigest {
				return mutation{}, command.NewError(command.CodeStaleSubject, "completion subject is not current", false, []domain.RejectionCode{domain.CodeSubjectStale}, err)
			}
			subjectMaterial, err := authorityTx.LoadSubjectMaterial(ctx, value.ProjectID, value.SubjectDigest)
			if err != nil {
				return mutation{}, err
			}
			approvedReview := false
			for _, review := range subjectMaterial.Reviews {
				approvedReview = approvedReview || review.SubjectDigest == value.SubjectDigest && review.Verdict == "Approved" && review.Independent
			}
			next, err := material.WorkItem.Transition(domain.PhaseQA, domain.TransitionGuards{ExpectedVersion: value.ExpectedVersion, RequiredReviewsApproved: approvedReview})
			if err != nil {
				return mutation{}, err
			}
			if err := tx.UpdateWorkItem(ctx, next, value.ExpectedVersion); err != nil {
				return mutation{}, err
			}
			result := command.Result{Type: "QARequested", ProjectID: value.ProjectID, WorkItemID: value.WorkItemID, Version: next.Version(), Phase: next.Phase()}
			return changeMutation(value.ProjectID, "work_item", string(value.WorkItemID), next.Version(), result, subject.Digest()), nil
		})
}

func (service *Service) RequestCancellation(ctx context.Context, principal domain.ActorID, value command.RequestCancellation) (command.Outcome, error) {
	request, digest, err := command.CanonicalRequestCancellation(value)
	if err != nil {
		return failureOutcome(value.Metadata, invalidRequest(err))
	}
	return service.execute(ctx, principal, value.Metadata, command.RequestCancelOperation, value.ProjectID, request, digest,
		func(ctx context.Context, tx port.Transaction, _ time.Time) (mutation, error) {
			authorityTx, err := authorityTransaction(tx)
			if err != nil {
				return mutation{}, err
			}
			item, err := tx.LoadWorkItem(ctx, value.ProjectID, value.WorkItemID)
			if err != nil {
				return mutation{}, err
			}
			if item.Version() != value.ExpectedVersion {
				return mutation{}, domain.Rejection{Code: domain.CodeVersionConflict}
			}
			authority, err := authorityTx.RequestRunCancellation(ctx, port.CancellationRequest{ProjectID: value.ProjectID, RunID: value.RunID, WorkItemID: value.WorkItemID})
			if err != nil {
				return mutation{}, err
			}
			result := command.Result{Type: "CancellationRequested", ProjectID: value.ProjectID, WorkItemID: value.WorkItemID, RunID: value.RunID, Version: item.Version(), Phase: item.Phase()}
			return changeMutation(value.ProjectID, "run", string(value.RunID), item.Version(), result, authority.Run.InputDigest), nil
		})
}

func authorityTransaction(tx port.Transaction) (port.AuthorityTransaction, error) {
	authority, ok := tx.(port.AuthorityTransaction)
	if !ok {
		return nil, errors.New("persistence adapter lacks vertical authority transaction")
	}
	return authority, nil
}

func currentFence(authority port.RunAuthority, fence port.RunFence, nowNS int64) bool {
	return authority.Run.ProjectID == fence.ProjectID && authority.Run.ID == fence.RunID && authority.Run.InputDigest == fence.InputDigest &&
		authority.Lease.Fence.Holder == fence.Holder && authority.Lease.Fence.Epoch == fence.Epoch && authority.RestoreGeneration == fence.RestoreGeneration &&
		authority.Outbox.ClaimEpoch == fence.Epoch && authority.Lease.DeadlineNS >= nowNS
}

func (service *Service) publicationFor(authority port.RunAuthority, observation RunObservation) (port.RunPublication, error) {
	run := authority.Run
	publication := port.RunPublication{Fence: observation.Fence, DesiredAction: run.DesiredAction, DispatchState: run.DispatchState, ObservedState: run.ObservedState, ReconciliationState: run.ReconciliationState, SideEffectOutcome: run.SideEffectOutcome}
	require := func(condition bool) error {
		if !condition {
			return port.ErrRunLifecycle
		}
		return nil
	}
	switch observation.Kind {
	case ObservationDispatchReceived:
		if err := require(run.DispatchState == "Claimed" && run.ObservedState == "Unknown"); err != nil {
			return port.RunPublication{}, err
		}
		publication.DispatchState, publication.ObservedState = "Sent", "Starting"
	case ObservationStartAcknowledged:
		if err := require(service.hasCapability("start_ack") && run.ObservedState == "Starting"); err != nil {
			return port.RunPublication{}, err
		}
		publication.DispatchState, publication.ObservedState = "Acknowledged", "Running"
	case ObservationStartLost:
		if err := require(service.hasCapability("start_ack") && run.ObservedState == "Starting"); err != nil {
			return port.RunPublication{}, err
		}
		publication.ObservedState, publication.ReconciliationState, publication.SideEffectOutcome = "Unknown", "NeedsReconcile", "OutcomeUnknown"
	case ObservationHeartbeat:
		if err := require(service.hasCapability("heartbeat") && run.ObservedState == "Running"); err != nil {
			return port.RunPublication{}, err
		}
	case ObservationCheckpoint:
		if err := require(service.hasCapability("durable_checkpoint") && run.ObservedState == "Running"); err != nil {
			return port.RunPublication{}, err
		}
	case ObservationTerminalSuccess, ObservationTerminalFailure:
		if err := require(run.ObservedState == "Running" && run.ReconciliationState != "NeedsReconcile"); err != nil {
			return port.RunPublication{}, err
		}
		publication.DispatchState, publication.ReconciliationState, publication.SideEffectOutcome = "Acknowledged", "None", "Confirmed"
		if observation.Kind == ObservationTerminalSuccess {
			publication.ObservedState = "Succeeded"
		} else {
			publication.ObservedState = "Failed"
		}
	case ObservationTimeout, ObservationUnknownOutcome:
		if err := require(run.ObservedState == "Running" || run.ObservedState == "Starting"); err != nil {
			return port.RunPublication{}, err
		}
		publication.ObservedState, publication.ReconciliationState, publication.SideEffectOutcome = "Unknown", "NeedsReconcile", "OutcomeUnknown"
	case ObservationLookupRunning:
		if err := require(service.hasCapability("lookup") && run.ReconciliationState == "NeedsReconcile"); err != nil {
			return port.RunPublication{}, err
		}
		publication.ObservedState, publication.ReconciliationState = "Running", "Reconciled"
	case ObservationLookupUnknown:
		if err := require(service.hasCapability("lookup") && run.ReconciliationState == "NeedsReconcile"); err != nil {
			return port.RunPublication{}, err
		}
		publication.ObservedState, publication.ReconciliationState, publication.SideEffectOutcome = "Unknown", "NeedsReconcile", "OutcomeUnknown"
	case ObservationCancelAcknowledged:
		if err := require(service.hasCapability("cancel_ack") && run.DesiredAction == "CancelRequested" && run.ObservedState != "Succeeded" && run.ObservedState != "Failed" && run.ObservedState != "Canceled"); err != nil {
			return port.RunPublication{}, err
		}
		publication.ObservedState, publication.ReconciliationState, publication.SideEffectOutcome = "Canceled", "None", "Confirmed"
	case ObservationLateResult, ObservationStalePublication:
		return port.RunPublication{}, port.ErrRunLifecycle
	default:
		return port.RunPublication{}, command.NewError(command.CodeInvalidRequest, "unknown Run observation", false, nil, nil)
	}
	return publication, nil
}

func validObservationKind(kind RunObservationKind) bool {
	switch kind {
	case ObservationDispatchReceived, ObservationStartAcknowledged, ObservationStartLost, ObservationHeartbeat,
		ObservationCheckpoint, ObservationTerminalSuccess, ObservationTerminalFailure, ObservationTimeout,
		ObservationLookupRunning, ObservationLookupUnknown, ObservationCancelAcknowledged, ObservationUnknownOutcome,
		ObservationLateResult, ObservationStalePublication:
		return true
	default:
		return false
	}
}

func (service *Service) hasCapability(capability string) bool {
	return slices.Contains(service.executorDeclaration.Capabilities, capability)
}

func (service *Service) appendRuntimeAudit(ctx context.Context, tx port.Transaction, actor domain.ActorID, commandID, operation string, authority port.RunAuthority, project bool, now time.Time) (*port.CommittedProjection, error) {
	stored, err := tx.LoadCommandResult(ctx, authority.Run.ProjectID, commandID)
	if err != nil || stored.ID != commandID || stored.ProjectID != authority.Run.ProjectID || len(stored.Payload) == 0 || domain.HashBytes(stored.Payload) != stored.Digest {
		if err != nil {
			return nil, err
		}
		return nil, domain.StorageCorruptionError{Reason: "runtime mutation lacks final command result"}
	}
	groupID, err := service.nextID(port.IDAuditGroup)
	if err != nil {
		return nil, err
	}
	after, err := json.Marshal(struct {
		RunID               domain.RunID `json:"run_id"`
		InputDigest         string       `json:"input_digest"`
		DispatchState       string       `json:"dispatch_state"`
		ObservedState       string       `json:"observed_state"`
		ReconciliationState string       `json:"reconciliation_state"`
		SideEffectOutcome   string       `json:"side_effect_outcome"`
		LeaseEpoch          uint64       `json:"lease_epoch"`
		RestoreGeneration   uint64       `json:"restore_generation"`
	}{
		RunID: authority.Run.ID, InputDigest: authority.Run.InputDigest.String(), DispatchState: authority.Run.DispatchState,
		ObservedState: authority.Run.ObservedState, ReconciliationState: authority.Run.ReconciliationState,
		SideEffectOutcome: authority.Run.SideEffectOutcome, LeaseEpoch: authority.Lease.Fence.Epoch,
		RestoreGeneration: authority.RestoreGeneration,
	})
	if err != nil {
		return nil, err
	}
	sequence, err := tx.AppendAudit(ctx, port.AuditEntry{GroupID: groupID, CommandID: commandID, ProjectID: authority.Run.ProjectID, Actor: actor, Operation: operation, SubjectDigest: authority.Run.InputDigest, AfterDigest: domain.HashBytes(after), TimestampNS: now.UnixNano()})
	if err != nil || !project {
		return nil, err
	}
	event, err := json.Marshal(changeEvent{APIVersion: "v1", EventType: "run.changed", ProjectID: authority.Run.ProjectID, ResourceKind: "run", ResourceID: string(authority.Run.ID), ResourceVersion: max(authority.Lease.Fence.Epoch, uint64(1))})
	if err != nil {
		return nil, err
	}
	cursor, err := tx.AppendProjectionEvent(ctx, port.ProjectionEvent{ProjectID: authority.Run.ProjectID, PayloadDigest: domain.HashBytes(event), Payload: event, AuditSequence: sequence})
	if err != nil {
		return nil, err
	}
	projection := port.CommittedProjection{ProjectID: authority.Run.ProjectID, Cursor: cursor, Payload: event}
	return &projection, nil
}

func (service *Service) publishRuntimeProjection(ctx context.Context, projection *port.CommittedProjection) {
	if projection != nil {
		_ = service.projections.PublishCommitted(ctx, projection.Clone())
	}
}

func (service *Service) preparationForRun(ctx context.Context, tx port.AuthorityTransaction, projectID domain.ProjectID, runID domain.RunID, requested domain.Digest) (port.RunAuthority, port.CompletionMaterial, domain.CompletionSubject, error) {
	run, err := tx.LoadRunAuthority(ctx, projectID, runID)
	if err != nil {
		return port.RunAuthority{}, port.CompletionMaterial{}, domain.CompletionSubject{}, err
	}
	material, err := tx.LoadCompletionMaterial(ctx, port.CompletionMaterialQuery{ProjectID: projectID, WorkItemID: run.Run.WorkItemID, RunID: runID, SubjectDigest: requested})
	if err != nil {
		return port.RunAuthority{}, port.CompletionMaterial{}, domain.CompletionSubject{}, err
	}
	subject, err := preparationSubject(material, service.config.Completion)
	if err != nil || subject.Digest() != requested {
		return port.RunAuthority{}, port.CompletionMaterial{}, domain.CompletionSubject{}, command.NewError(command.CodeStaleSubject, "completion subject is not current", false, []domain.RejectionCode{domain.CodeSubjectStale}, err)
	}
	return run, material, subject, nil
}

func preparationSubject(material port.CompletionMaterial, policy CompletionPolicy) (domain.CompletionSubject, error) {
	version := material.WorkItem.Version()
	if material.WorkItem.Phase() == domain.PhaseReview {
		version++
	}
	revisions := make([]domain.ACRevisionBinding, len(material.RequiredACRevisions))
	for index, requirement := range material.RequiredACRevisions {
		revisions[index] = domain.ACRevisionBinding{ACID: requirement.ACID, RevisionDigest: requirement.RevisionDigest}
	}
	return domain.NewCompletionSubject(domain.CompletionSubjectConfig{
		ProjectID: material.WorkItem.ProjectID(), WorkItemID: material.WorkItem.ID(), WorkItemVersion: version,
		CandidateID: material.Candidate.ID, CandidateDigest: material.Candidate.Digest,
		RunID: material.Run.ID, RunInputDigest: material.Run.InputDigest,
		RequiredACRevisions: revisions, AcceptedGraphRevisionDigest: material.GraphRevisionDigest,
		PolicyRevisionDigest: policy.RevisionDigest, CompletionRecipeDigest: policy.RecipeDigest,
		IntegrationBaseDigest: policy.IntegrationBaseDigest,
	})
}

func (service *Service) verifyArtifact(ctx context.Context, locator command.ArtifactLocator) error {
	if locator.Availability != "Present" {
		return command.NewError(command.CodeLifecycleRejected, "artifact is unavailable", false, nil, nil)
	}
	reader, err := service.artifacts.Open(ctx, locator.Digest)
	if err != nil {
		return command.NewError(command.CodeLifecycleRejected, "artifact bytes are unavailable", false, nil, err)
	}
	defer reader.Close()
	content, err := io.ReadAll(io.LimitReader(reader, int64(locator.ByteLength)+1))
	if err != nil {
		return err
	}
	if uint64(len(content)) != locator.ByteLength || domain.HashBytes(content) != locator.Digest {
		return command.NewError(command.CodeLifecycleRejected, "artifact bytes do not match their immutable locator", false, nil, nil)
	}
	return nil
}

func artifactStorageKey(digest domain.Digest) string { return "sha256:" + digest.String() }
