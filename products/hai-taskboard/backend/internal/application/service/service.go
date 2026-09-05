// Package service owns application command decisions and their atomic
// persistence orchestration.
package service

import (
	"bytes"
	"context"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type Service struct {
	unit                port.UnitOfWork
	clock               port.Clock
	ids                 port.IDSource
	executorDeclaration port.ExecutorDeclaration
	artifacts           port.ArtifactStore
	projections         port.ProjectionSink
	config              Config
}

func New(
	unit port.UnitOfWork,
	clock port.Clock,
	ids port.IDSource,
	executor port.Executor,
	artifacts port.ArtifactStore,
	projections port.ProjectionSink,
	config Config,
) (*Service, error) {
	if unit == nil || clock == nil || ids == nil || executor == nil || artifacts == nil || projections == nil ||
		config.Operator == "" || config.IdempotencyTTL <= 0 || config.Specification == nil ||
		config.Completion.RevisionDigest.IsZero() || config.Completion.RecipeDigest.IsZero() || len(config.Completion.Checks) == 0 {
		return nil, errors.New("invalid command service dependencies")
	}
	declaration := executor.Declaration().Clone()
	if !validExecutorDeclaration(declaration) {
		return nil, errors.New("P0-A requires a declared fake/v1 executor")
	}
	config.Completion = config.Completion.clone()
	return &Service{
		unit: unit, clock: clock, ids: ids, executorDeclaration: declaration, artifacts: artifacts,
		projections: projections, config: config,
	}, nil
}

func (service *Service) CreateProject(ctx context.Context, principal domain.ActorID, value command.CreateProject) (command.Outcome, error) {
	request, digest, err := command.CanonicalCreateProject(value)
	if err != nil {
		return failureOutcome(value.Metadata, invalidRequest(err))
	}
	return service.execute(ctx, principal, value.Metadata, command.CreateProjectOperation, value.ProjectID, request, digest,
		func(ctx context.Context, tx port.Transaction, _ time.Time) (mutation, error) {
			project := port.Project{ID: value.ProjectID, Name: value.Name, Repository: value.RepositoryRoot, Ref: value.ApprovedRef, Version: 1}
			if err := tx.CreateProject(ctx, project); err != nil {
				return mutation{}, err
			}
			result := command.Result{Type: "ProjectCreated", ProjectID: value.ProjectID, Version: 1}
			return changeMutation(value.ProjectID, "project", string(value.ProjectID), 1, result, digest), nil
		})
}

func (service *Service) CreateWorkItem(ctx context.Context, principal domain.ActorID, value command.CreateWorkItem) (command.Outcome, error) {
	request, digest, err := command.CanonicalCreateWorkItem(value)
	if err != nil {
		return failureOutcome(value.Metadata, invalidRequest(err))
	}
	return service.execute(ctx, principal, value.Metadata, command.CreateWorkItemOperation, value.ProjectID, request, digest,
		func(ctx context.Context, tx port.Transaction, _ time.Time) (mutation, error) {
			item, err := domain.NewWorkItem(value.WorkItemID, value.ProjectID, domain.PhaseDraft, 1)
			if err != nil {
				return mutation{}, invalidRequest(err)
			}
			if err := tx.CreateWorkItem(ctx, port.WorkItem{Item: item, Title: value.Title, Goal: value.Goal, Owner: value.OwnerID}); err != nil {
				return mutation{}, err
			}
			for _, revision := range value.RequiredACRevisions {
				if err := tx.RequireACRevision(ctx, port.ACRequirement{
					ProjectID: value.ProjectID, WorkItemID: value.WorkItemID,
					ACID: revision.ACID, RevisionDigest: revision.RevisionDigest,
				}); err != nil {
					return mutation{}, err
				}
			}
			result := command.Result{
				Type: "WorkItemCreated", ProjectID: value.ProjectID, WorkItemID: value.WorkItemID,
				Version: item.Version(), Phase: item.Phase(),
			}
			return changeMutation(value.ProjectID, "work_item", string(value.WorkItemID), item.Version(), result, digest), nil
		})
}

func (service *Service) MarkReady(ctx context.Context, principal domain.ActorID, value command.MarkReady) (command.Outcome, error) {
	request, digest, err := command.CanonicalMarkReady(value)
	if err != nil {
		return failureOutcome(value.Metadata, invalidRequest(err))
	}
	return service.execute(ctx, principal, value.Metadata, command.MarkReadyOperation, value.ProjectID, request, digest,
		func(ctx context.Context, tx port.Transaction, _ time.Time) (mutation, error) {
			material, err := tx.LoadCompletionMaterial(ctx, port.CompletionMaterialQuery{
				ProjectID: value.ProjectID, WorkItemID: value.WorkItemID,
			})
			if err != nil {
				return mutation{}, err
			}
			next, err := material.WorkItem.Transition(domain.PhaseReady, domain.TransitionGuards{
				ExpectedVersion:    value.ExpectedVersion,
				HasAcceptedAC:      len(material.RequiredACRevisions) > 0,
				SpecificationValid: service.config.Specification.ValidFor(value.ProjectID, value.WorkItemID, slices.Clone(material.RequiredACRevisions)),
			})
			if err != nil {
				return mutation{}, err
			}
			if err := tx.UpdateWorkItem(ctx, next, value.ExpectedVersion); err != nil {
				return mutation{}, err
			}
			result := command.Result{Type: "WorkItemReady", ProjectID: value.ProjectID, WorkItemID: value.WorkItemID, Version: next.Version(), Phase: next.Phase()}
			return changeMutation(value.ProjectID, "work_item", string(value.WorkItemID), next.Version(), result, digest), nil
		})
}

func (service *Service) DispatchRun(ctx context.Context, principal domain.ActorID, value command.DispatchRun) (command.Outcome, error) {
	request, digest, err := command.CanonicalDispatchRun(value)
	if err != nil {
		return failureOutcome(value.Metadata, invalidRequest(err))
	}
	return service.execute(ctx, principal, value.Metadata, command.DispatchRunOperation, value.ProjectID, request, digest,
		func(ctx context.Context, tx port.Transaction, now time.Time) (mutation, error) {
			declaration := service.executorDeclaration
			if declaration.AdapterID != value.AdapterID || value.RetryOfRunID != "" {
				return mutation{}, command.NewError(command.CodeLifecycleRejected, "executor declaration or retry is not available", false, nil, nil)
			}
			material, err := tx.LoadCompletionMaterial(ctx, port.CompletionMaterialQuery{ProjectID: value.ProjectID, WorkItemID: value.WorkItemID})
			if err != nil {
				return mutation{}, err
			}
			if material.ActiveOrUnknownRun {
				return mutation{}, domain.Rejection{Code: domain.CodeActiveOrUnknownRun}
			}
			next, err := material.WorkItem.Transition(domain.PhaseDeveloping, domain.TransitionGuards{
				ExpectedVersion: value.ExpectedVersion, ExplicitStart: true,
			})
			if err != nil {
				return mutation{}, err
			}
			runIDValue, err := service.nextID(port.IDRun)
			if err != nil {
				return mutation{}, err
			}
			runID := domain.RunID(runIDValue)
			runInput := dispatchInputDigest(material.WorkItem, material.RequiredACRevisions, service.config.Completion)
			if err := tx.UpdateWorkItem(ctx, next, value.ExpectedVersion); err != nil {
				return mutation{}, err
			}
			if err := tx.CreateRun(ctx, port.Run{
				ID: runID, ProjectID: value.ProjectID, WorkItemID: value.WorkItemID, InputDigest: runInput,
				AdapterID: declaration.AdapterID, AdapterVersion: declaration.AdapterVersion, ScenarioID: value.ScenarioID,
				Attempt: 1, DesiredAction: "Dispatch", DispatchState: "Pending", ObservedState: "Unknown",
				ReconciliationState: "None", SideEffectOutcome: "NotApplicable", CreatedAtNS: now.UnixNano(),
			}); err != nil {
				return mutation{}, err
			}
			result := command.Result{Type: "RunDispatched", ProjectID: value.ProjectID, WorkItemID: value.WorkItemID, RunID: runID, Version: next.Version(), Phase: next.Phase()}
			resultMutation := changeMutation(value.ProjectID, "run", string(runID), next.Version(), result, digest)
			resultMutation.outbox = &outboxMutation{runID: runID, payloadDigest: runInput}
			return resultMutation, nil
		})
}

func (service *Service) CompleteWorkItem(ctx context.Context, principal domain.ActorID, value command.CompleteWorkItem) (command.Outcome, error) {
	request, digest, err := command.CanonicalCompleteWorkItem(value)
	if err != nil {
		return failureOutcome(value.Metadata, invalidRequest(err))
	}
	return service.execute(ctx, principal, value.Metadata, command.CompleteWorkItemOperation, value.ProjectID, request, digest,
		func(ctx context.Context, tx port.Transaction, now time.Time) (mutation, error) {
			material, err := tx.LoadCompletionMaterial(ctx, port.CompletionMaterialQuery{
				ProjectID: value.ProjectID, WorkItemID: value.WorkItemID, CandidateID: value.Subject.CandidateID(),
				RunID: value.Subject.RunID(), SubjectDigest: value.Subject.Digest(), GraphRevisionDigest: value.Subject.GraphRevisionDigest(),
			})
			if err != nil {
				return mutation{}, err
			}
			input, selected, err := service.completionInput(principal, value, material, now)
			if err != nil {
				return mutation{}, err
			}
			completion, err := domain.CompleteWorkItem(input)
			if err != nil {
				return mutation{}, err
			}
			consumptions := make([]port.ApprovalConsumption, len(selected.approvals))
			for index, approval := range selected.approvals {
				id, err := service.nextID(port.IDApprovalConsumption)
				if err != nil {
					return mutation{}, err
				}
				consumptions[index] = port.ApprovalConsumption{
					ID: id, ProjectID: value.ProjectID, CompletionRecordID: completion.Record.ID(), ApprovalID: approval,
					CommandID: value.CommandID, SubjectDigest: completion.Record.SubjectDigest(), Actor: principal, TimestampNS: now.UnixNano(),
				}
			}
			if err := tx.StoreCompletion(ctx, port.Completion{
				Item: completion.WorkItem, Record: completion.Record, Actor: principal, TimestampNS: now.UnixNano(),
				EvidenceIDs: selected.evidence, ReviewIDs: selected.reviews, ApprovalIDs: selected.approvals,
				Consumptions: consumptions,
			}); err != nil {
				return mutation{}, err
			}
			if err := tx.UpdateWorkItem(ctx, completion.WorkItem, value.ExpectedVersion); err != nil {
				return mutation{}, err
			}
			result := command.Result{Type: "WorkItemCompleted", ProjectID: value.ProjectID, WorkItemID: value.WorkItemID, Version: completion.WorkItem.Version(), Phase: completion.WorkItem.Phase()}
			return changeMutation(value.ProjectID, "work_item", string(value.WorkItemID), completion.WorkItem.Version(), result, completion.Record.SubjectDigest()), nil
		})
}

func validExecutorDeclaration(declaration port.ExecutorDeclaration) bool {
	if declaration.AdapterID != "fake/v1" || declaration.AdapterVersion == "" {
		return false
	}
	capabilities := make(map[string]struct{}, len(declaration.Capabilities))
	for _, capability := range declaration.Capabilities {
		switch capability {
		case "start_ack", "heartbeat", "lookup", "cancel_ack", "durable_checkpoint":
		default:
			return false
		}
		if _, duplicate := capabilities[capability]; duplicate {
			return false
		}
		capabilities[capability] = struct{}{}
	}
	return true
}

type mutate func(context.Context, port.Transaction, time.Time) (mutation, error)

type mutation struct {
	projectID       domain.ProjectID
	resourceKind    string
	resourceID      string
	resourceVersion uint64
	result          command.Result
	subjectDigest   domain.Digest
	outbox          *outboxMutation
}

type outboxMutation struct {
	runID         domain.RunID
	payloadDigest domain.Digest
}

type changeEvent struct {
	APIVersion      string           `json:"api_version"`
	EventType       string           `json:"event_type"`
	ProjectID       domain.ProjectID `json:"project_id"`
	ResourceKind    string           `json:"resource_kind"`
	ResourceID      string           `json:"resource_id"`
	ResourceVersion uint64           `json:"resource_version"`
}

func changeMutation(projectID domain.ProjectID, resourceKind, resourceID string, version uint64, result command.Result, subject domain.Digest) mutation {
	return mutation{projectID: projectID, resourceKind: resourceKind, resourceID: resourceID, resourceVersion: version, result: result, subjectDigest: subject}
}

func (service *Service) execute(
	ctx context.Context,
	principal domain.ActorID,
	metadata command.Metadata,
	operation command.Operation,
	projectID domain.ProjectID,
	request []byte,
	requestDigest domain.Digest,
	apply mutate,
) (command.Outcome, error) {
	if domain.HashBytes(request) != requestDigest {
		return command.Outcome{}, errors.New("canonical request digest mismatch")
	}
	if principal != service.config.Operator {
		return failureOutcome(metadata, command.NewError(command.CodePermissionDenied, "principal is not authorized", false, nil, nil))
	}
	now := service.clock.Now().UTC()
	if now.IsZero() {
		return command.Outcome{}, errors.New("clock returned zero time")
	}
	var outcome command.Outcome
	var recordedFailure *command.Error
	var committedProjection *port.CommittedProjection
	err := service.unit.Within(ctx, func(tx port.Transaction) error {
		replayed, replayFailure, found, err := loadReplay(ctx, tx, principal, projectID, operation, metadata.IdempotencyKey, requestDigest, now)
		if err != nil {
			return err
		}
		if found {
			outcome = command.Outcome{Payload: bytes.Clone(replayed.Payload), Replayed: true}
			recordedFailure = replayFailure
			return nil
		}

		changed, err := apply(ctx, tx, now)
		if err != nil {
			failure := classifyError(err)
			if failure == nil || !recordableFailure(failure) {
				return err
			}
			payload, encodeErr := command.CanonicalFailure(metadata, failure)
			if encodeErr != nil {
				return encodeErr
			}
			if err := tx.StoreCommandResult(ctx, port.CommandResult{
				ID: metadata.CommandID, ProjectID: projectID, Digest: domain.HashBytes(payload), Payload: payload, TimestampNS: now.UnixNano(),
			}); err != nil {
				return err
			}
			if err := tx.StoreIdempotency(ctx, port.Idempotency{
				Principal: principal, ProjectID: projectID, Operation: string(operation), Key: metadata.IdempotencyKey,
				RequestDigest: requestDigest, CommandID: metadata.CommandID, ExpiresAtNS: now.Add(service.config.IdempotencyTTL).UnixNano(),
			}); err != nil {
				return err
			}
			outcome = command.Outcome{Payload: bytes.Clone(payload)}
			recordedFailure = failure
			return nil
		}
		eventPayload, err := json.Marshal(changeEvent{
			APIVersion: "v1", EventType: changed.resourceKind + ".changed", ProjectID: changed.projectID,
			ResourceKind: changed.resourceKind, ResourceID: changed.resourceID, ResourceVersion: changed.resourceVersion,
		})
		if err != nil {
			return err
		}
		auditGroupID, err := service.nextID(port.IDAuditGroup)
		if err != nil {
			return err
		}
		auditSequence, err := tx.AppendAudit(ctx, port.AuditEntry{
			GroupID: auditGroupID, CommandID: metadata.CommandID, ProjectID: projectID, Actor: principal,
			Operation: string(operation), SubjectDigest: changed.subjectDigest,
			BeforeDigest: requestDigest, AfterDigest: domain.HashBytes(eventPayload), TimestampNS: now.UnixNano(),
		})
		if err != nil {
			return err
		}
		if changed.outbox != nil {
			outboxID, err := service.nextID(port.IDOutbox)
			if err != nil {
				return err
			}
			if err := tx.EnqueueOutbox(ctx, port.OutboxIntent{
				ID: outboxID, CommandID: metadata.CommandID, AuditGroupID: auditGroupID, ProjectID: projectID,
				RunID: changed.outbox.runID, PayloadDigest: changed.outbox.payloadDigest, TimestampNS: now.UnixNano(),
			}); err != nil {
				return err
			}
		}
		cursor, err := tx.AppendProjectionEvent(ctx, port.ProjectionEvent{
			ProjectID: projectID, PayloadDigest: domain.HashBytes(eventPayload), Payload: eventPayload, AuditSequence: auditSequence,
		})
		if err != nil {
			return err
		}
		payload, err := command.CanonicalSuccess(metadata, operation, changed.result, auditSequence, cursor)
		if err != nil {
			return err
		}
		if err := tx.StoreCommandResult(ctx, port.CommandResult{
			ID: metadata.CommandID, ProjectID: projectID, Digest: domain.HashBytes(payload), Payload: payload, TimestampNS: now.UnixNano(),
		}); err != nil {
			return err
		}
		if err := tx.StoreIdempotency(ctx, port.Idempotency{
			Principal: principal, ProjectID: projectID, Operation: string(operation), Key: metadata.IdempotencyKey,
			RequestDigest: requestDigest, CommandID: metadata.CommandID, ExpiresAtNS: now.Add(service.config.IdempotencyTTL).UnixNano(),
		}); err != nil {
			return err
		}
		outcome = command.Outcome{Payload: bytes.Clone(payload)}
		projection := port.CommittedProjection{ProjectID: projectID, Cursor: cursor, Payload: eventPayload}
		committedProjection = &projection
		return nil
	})
	if err != nil {
		return service.commandFailure(metadata, err)
	}
	if recordedFailure != nil {
		return outcome, recordedFailure
	}
	if committedProjection != nil {
		if err := service.projections.PublishCommitted(ctx, committedProjection.Clone()); err != nil {
			outcome.ProjectionDeferred = true
		}
	}
	return outcome, nil
}

func loadReplay(
	ctx context.Context,
	tx port.Transaction,
	principal domain.ActorID,
	projectID domain.ProjectID,
	operation command.Operation,
	key string,
	requestDigest domain.Digest,
	now time.Time,
) (port.CommandResult, *command.Error, bool, error) {
	record, err := tx.LoadIdempotency(ctx, principal, projectID, string(operation), key)
	if errors.Is(err, port.ErrNotFound) {
		return port.CommandResult{}, nil, false, nil
	}
	if err != nil {
		return port.CommandResult{}, nil, false, err
	}
	if record.Principal != principal || record.ProjectID != projectID || record.Operation != string(operation) ||
		record.Key != key || record.CommandID == "" {
		return port.CommandResult{}, nil, false, domain.StorageCorruptionError{Reason: "idempotency scope mismatch"}
	}
	if record.Tombstoned || record.ExpiresAtNS <= now.UnixNano() {
		return port.CommandResult{}, nil, false, command.NewError(command.CodeIdempotencyExpired, "idempotency record is expired", false, []domain.RejectionCode{domain.CodeIdempotencyExpired}, nil)
	}
	if record.RequestDigest != requestDigest {
		return port.CommandResult{}, nil, false, command.NewError(command.CodeIdempotencyConflict, "idempotency key was used with different request bytes", false, []domain.RejectionCode{domain.CodeIdempotencyConflict}, nil)
	}
	result, err := tx.LoadCommandResult(ctx, projectID, record.CommandID)
	if err != nil {
		return port.CommandResult{}, nil, false, err
	}
	if result.ID != record.CommandID || result.ProjectID != projectID || len(result.Payload) == 0 ||
		domain.HashBytes(result.Payload) != result.Digest {
		return port.CommandResult{}, nil, false, domain.StorageCorruptionError{Reason: "command result identity or digest mismatch"}
	}
	failure, err := command.DecodeCanonicalResult(result.Payload, record.CommandID, operation)
	if err != nil {
		return port.CommandResult{}, nil, false, domain.StorageCorruptionError{Reason: "invalid canonical command result"}
	}
	return result, failure, true, nil
}

func recordableFailure(failure *command.Error) bool {
	return failure.Code == command.CodeVersionConflict || failure.Code == command.CodeStaleSubject ||
		failure.Code == command.CodeLifecycleRejected || failure.Code == command.CodeDoneGateUnsatisfied
}

func (service *Service) nextID(kind port.IDKind) (string, error) {
	id, err := service.ids.Next(kind)
	if err != nil {
		return "", err
	}
	if id == "" {
		return "", fmt.Errorf("ID source returned empty %s", kind)
	}
	return id, nil
}

func (service *Service) commandFailure(metadata command.Metadata, err error) (command.Outcome, error) {
	failure := classifyError(err)
	if failure == nil {
		return command.Outcome{}, err
	}
	return failureOutcome(metadata, failure)
}

func failureOutcome(metadata command.Metadata, failure *command.Error) (command.Outcome, error) {
	payload, err := command.CanonicalFailure(metadata, failure)
	if err != nil {
		return command.Outcome{}, failure
	}
	return command.Outcome{Payload: payload}, failure
}

func classifyError(err error) *command.Error {
	if failure, ok := errors.AsType[*command.Error](err); ok {
		return failure
	}
	if errors.Is(err, domain.ErrStorageCorruption) {
		return command.NewError(command.CodeStorageCorruption, "persisted state failed integrity validation", false, nil, err)
	}
	if errors.Is(err, port.ErrNotFound) {
		return command.NewError(command.CodeNotFound, "requested resource was not found", false, nil, err)
	}
	if gate, ok := errors.AsType[domain.GateError](err); ok {
		if slices.Contains(gate.Codes(), domain.CodeVersionConflict) {
			return command.NewError(command.CodeVersionConflict, "aggregate version does not match", false, gate.Codes(), err)
		}
		if slices.Contains(gate.Codes(), domain.CodeSubjectStale) {
			return command.NewError(command.CodeStaleSubject, "completion subject is stale", false, gate.Codes(), err)
		}
		return command.NewError(command.CodeDoneGateUnsatisfied, "work item completion requirements are not satisfied", false, gate.Codes(), err)
	}
	if rejection, ok := errors.AsType[domain.Rejection](err); ok {
		switch rejection.Code {
		case domain.CodeVersionConflict:
			return command.NewError(command.CodeVersionConflict, "aggregate version does not match", false, []domain.RejectionCode{rejection.Code}, err)
		case domain.CodeSubjectStale:
			return command.NewError(command.CodeStaleSubject, "completion subject is stale", false, []domain.RejectionCode{rejection.Code}, err)
		case domain.CodeIdempotencyConflict:
			return command.NewError(command.CodeIdempotencyConflict, "idempotency key conflict", false, []domain.RejectionCode{rejection.Code}, err)
		case domain.CodeIdempotencyExpired:
			return command.NewError(command.CodeIdempotencyExpired, "idempotency record is expired", false, []domain.RejectionCode{rejection.Code}, err)
		default:
			return command.NewError(command.CodeLifecycleRejected, "work item lifecycle guard rejected the command", false, []domain.RejectionCode{rejection.Code}, err)
		}
	}
	return nil
}

func invalidRequest(cause error) *command.Error {
	return command.NewError(command.CodeInvalidRequest, "command is invalid", false, nil, cause)
}

type selectedCompletion struct {
	evidence  []domain.EvidenceID
	reviews   []domain.ReviewID
	approvals []domain.ApprovalID
}

func (service *Service) completionInput(
	principal domain.ActorID,
	value command.CompleteWorkItem,
	material port.CompletionMaterial,
	now time.Time,
) (domain.CompletionInput, selectedCompletion, error) {
	current, err := currentSubject(material, service.config.Completion)
	if err != nil {
		switch {
		case !material.CandidatePresent || !material.RunPresent:
			current = value.Subject
		case material.GraphRevisionDigest.IsZero():
			return domain.CompletionInput{}, selectedCompletion{}, command.NewError(command.CodeStaleSubject, "accepted graph revision is not current", false, []domain.RejectionCode{domain.CodeSubjectStale}, err)
		default:
			return domain.CompletionInput{}, selectedCompletion{}, domain.StorageCorruptionError{Reason: "invalid current completion subject"}
		}
	}
	requirements := make([]domain.CheckRequirement, 0, len(material.RequiredACRevisions))
	revisions := make(map[domain.ACID]domain.Digest, len(material.RequiredACRevisions))
	for _, requirement := range material.RequiredACRevisions {
		rule, ok := service.config.Completion.Checks[requirement.ACID]
		if !ok || rule.VerifierClass == "" {
			return domain.CompletionInput{}, selectedCompletion{}, command.NewError(command.CodeDoneGateUnsatisfied, "verification policy is incomplete", false, []domain.RejectionCode{domain.CodeEvidenceMissing}, nil)
		}
		revisions[requirement.ACID] = requirement.RevisionDigest
		requirements = append(requirements, domain.CheckRequirement{
			CheckID: domain.CheckID(requirement.ACID), VerifierClass: rule.VerifierClass, Independent: rule.Independent,
			ProhibitedVerifierActor: rule.ProhibitedVerifierActor, ProhibitedVerifierRunRole: rule.ProhibitedVerifierRunRole,
		})
	}

	evidence := make([]domain.Evidence, 0, len(material.Evidence))
	selected := selectedCompletion{}
	artifactAvailability := make(map[domain.Digest]string, len(material.Artifacts))
	for _, artifact := range material.Artifacts {
		artifactAvailability[artifact.Digest] = artifact.Availability
	}
	for _, persisted := range material.Evidence {
		rule, required := service.config.Completion.Checks[persisted.ACID]
		revision, bound := revisions[persisted.ACID]
		if !required || !bound || revision != persisted.ACRevisionDigest || persisted.SubjectDigest != current.Digest() || persisted.VerifierClass != rule.VerifierClass {
			continue
		}
		applicability := domain.EvidenceApplicability(persisted.Applicability)
		availability := domain.EvidenceAvailability(persisted.Availability)
		if persisted.RecipeDigest != service.config.Completion.RecipeDigest ||
			(!rule.EnvironmentDigest.IsZero() && persisted.EnvironmentDigest != rule.EnvironmentDigest) {
			applicability = domain.EvidenceStale
		}
		if persisted.ArtifactDigest.IsZero() || artifactAvailability[persisted.ArtifactDigest] != "Present" {
			availability = domain.EvidenceUnavailable
		}
		value, err := domain.NewEvidence(domain.EvidenceConfig{
			ID: persisted.ID, SubjectDigest: persisted.SubjectDigest, CheckID: domain.CheckID(persisted.ACID),
			State: domain.EvidenceState(persisted.Verdict), Applicability: applicability,
			Availability: availability, VerifierActor: persisted.VerifierActor,
			VerifierRole: persisted.VerifierRole, VerifierClass: persisted.VerifierClass,
		})
		if err != nil {
			return domain.CompletionInput{}, selectedCompletion{}, domain.StorageCorruptionError{Reason: "invalid persisted evidence"}
		}
		evidence = append(evidence, value)
		selected.evidence = append(selected.evidence, persisted.ID)
	}

	var review *domain.Review
	for _, persisted := range material.Reviews {
		if persisted.SubjectDigest != current.Digest() {
			continue
		}
		value, err := domain.NewReview(persisted.ID, persisted.SubjectDigest, domain.ReviewVerdict(persisted.Verdict), persisted.Reviewer, persisted.Independent)
		if err != nil {
			return domain.CompletionInput{}, selectedCompletion{}, domain.StorageCorruptionError{Reason: "invalid persisted review"}
		}
		review = new(value)
		selected.reviews = []domain.ReviewID{persisted.ID}
	}

	var approval *domain.Approval
	for _, persisted := range material.Approvals {
		if persisted.SubjectDigest != current.Digest() || persisted.CommandKind != string(domain.CommandCompleteWorkItem) ||
			persisted.Actor != principal {
			continue
		}
		value, err := domain.NewApproval(persisted.ID, persisted.SubjectDigest, domain.CommandKind(persisted.CommandKind), persisted.Actor, time.Unix(0, persisted.ExpiresAtNS).UTC())
		if err != nil {
			return domain.CompletionInput{}, selectedCompletion{}, domain.StorageCorruptionError{Reason: "invalid persisted approval"}
		}
		if approval == nil || value.ExpiresAt().After(now) {
			approval = new(value)
			selected.approvals = []domain.ApprovalID{persisted.ID}
		}
		if value.ExpiresAt().After(now) {
			break
		}
	}

	recordID, err := service.nextID(port.IDCompletionRecord)
	if err != nil {
		return domain.CompletionInput{}, selectedCompletion{}, err
	}
	return domain.CompletionInput{
		WorkItem: material.WorkItem, ExpectedVersion: value.ExpectedVersion,
		RequestedSubject: value.Subject, CurrentSubject: current,
		CandidatePresent:   material.CandidatePresent && material.RunPresent,
		CandidateAvailable: material.CandidateAvailable,
		ActiveOrUnknownRun: material.ActiveOrUnknownRun,
		RequiredChecks:     requirements, Evidence: evidence, Review: review,
		ApprovalRequired: service.config.Completion.ApprovalRequired, Approval: approval,
		Now: now, RecordID: domain.CompletionRecordID(recordID),
	}, selected, nil
}

func currentSubject(material port.CompletionMaterial, policy CompletionPolicy) (domain.CompletionSubject, error) {
	revisions := make([]domain.ACRevisionBinding, len(material.RequiredACRevisions))
	for index, requirement := range material.RequiredACRevisions {
		revisions[index] = domain.ACRevisionBinding{ACID: requirement.ACID, RevisionDigest: requirement.RevisionDigest}
	}
	return domain.NewCompletionSubject(domain.CompletionSubjectConfig{
		ProjectID: material.WorkItem.ProjectID(), WorkItemID: material.WorkItem.ID(), WorkItemVersion: material.WorkItem.Version(),
		CandidateID: material.Candidate.ID, CandidateDigest: material.Candidate.Digest,
		RunID: material.Run.ID, RunInputDigest: material.Run.InputDigest,
		RequiredACRevisions: revisions, AcceptedGraphRevisionDigest: material.GraphRevisionDigest,
		PolicyRevisionDigest: policy.RevisionDigest, CompletionRecipeDigest: policy.RecipeDigest,
		IntegrationBaseDigest: policy.IntegrationBaseDigest,
	})
}

type dispatchInput struct {
	ProjectID           domain.ProjectID     `json:"project_id"`
	WorkItemID          domain.WorkItemID    `json:"work_item_id"`
	WorkItemVersion     uint64               `json:"work_item_version"`
	RequiredACRevisions []dispatchACRevision `json:"required_ac_revisions"`
	PolicyDigest        string               `json:"policy_revision_digest"`
	RecipeDigest        string               `json:"completion_recipe_digest"`
}

type dispatchACRevision struct {
	ACID   domain.ACID `json:"ac_id"`
	Digest string      `json:"revision_digest"`
}

func dispatchInputDigest(item domain.WorkItem, requirements []port.ACRequirement, policy CompletionPolicy) domain.Digest {
	revisions := make([]dispatchACRevision, len(requirements))
	for index, requirement := range requirements {
		revisions[index] = dispatchACRevision{ACID: requirement.ACID, Digest: requirement.RevisionDigest.String()}
	}
	slices.SortFunc(revisions, func(left, right dispatchACRevision) int {
		if left.ACID < right.ACID {
			return -1
		}
		if left.ACID > right.ACID {
			return 1
		}
		return 0
	})
	encoded, err := json.Marshal(dispatchInput{
		ProjectID: item.ProjectID(), WorkItemID: item.ID(), WorkItemVersion: item.Version(), RequiredACRevisions: revisions,
		PolicyDigest: policy.RevisionDigest.String(), RecipeDigest: policy.RecipeDigest.String(),
	})
	if err != nil {
		panic("validated dispatch input could not be encoded: " + err.Error())
	}
	return domain.HashBytes(encoded)
}
