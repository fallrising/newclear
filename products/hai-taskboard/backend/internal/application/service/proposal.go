package service

import (
	"bytes"
	"context"
	"errors"
	"reflect"
	"slices"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

// rollbackMutationError prevents execute from recording a rejection after mutation began.
type rollbackMutationError struct{ error }

func (e rollbackMutationError) Unwrap() error { return e.error }

func nilRepositoryDependency(v any) bool {
	if v == nil {
		return true
	}
	r := reflect.ValueOf(v)
	switch r.Kind() {
	case reflect.Pointer, reflect.Interface, reflect.Func, reflect.Map, reflect.Slice, reflect.Chan:
		return r.IsNil()
	}
	return false
}

func (service *Service) approvedRepository(principal domain.ActorID, value command.ProposeSpecification) (port.ApprovedRepository, []byte, error) {
	deny := func() (port.ApprovedRepository, []byte, error) {
		return port.ApprovedRepository{}, nil, command.NewError(command.CodePermissionDenied, "repository binding is not approved", false, nil, nil)
	}
	if principal != service.config.Operator || nilRepositoryDependency(service.config.RepositoryAuthority) {
		return deny()
	}
	approved, err := service.config.RepositoryAuthority.Lookup(value.ProjectID, value.BindingID)
	if err != nil {
		return deny()
	}
	canonical, digest, err := port.CanonicalRepositoryBinding(approved)
	if err != nil || nilRepositoryDependency(approved.Reader) || approved.ApprovedBy != service.config.Operator || approved.Binding.ProjectID != value.ProjectID || approved.Binding.ID != value.BindingID || approved.Binding.Version != value.BindingVersion || digest != approved.Binding.Digest || digest != value.BindingDigest || !slices.Contains(approved.Refs, value.Ref) || !slices.Contains(approved.ManifestPaths, value.ManifestPath) {
		return deny()
	}
	return approved, canonical, nil
}

func (service *Service) ProposeSpecification(ctx context.Context, principal domain.ActorID, value command.ProposeSpecification) (command.Outcome, error) {
	if principal != service.config.Operator {
		return failureOutcome(value.Metadata, command.NewError(command.CodePermissionDenied, "principal is not authorized", false, nil, nil))
	}
	request, digest, err := command.CanonicalProposeSpecification(value)
	if err != nil {
		return failureOutcome(value.Metadata, invalidRequest(err))
	}
	// Replay must precede authority and immutable-object reads, even after revocation/source loss.
	var replay port.CommandResult
	var replayFailure *command.Error
	var found bool
	err = service.unit.Within(ctx, func(tx port.Transaction) error {
		var err error
		replay, replayFailure, found, err = loadReplay(ctx, tx, principal, value.ProjectID, command.ProposeSpecificationOperation, value.IdempotencyKey, digest, service.clock.Now().UTC())
		if err != nil || found {
			return err
		}
		admission, ok := tx.(port.AdmissionTransaction)
		if !ok {
			return errors.New("admission transaction unavailable")
		}
		project, err := admission.LoadProject(ctx, value.ProjectID)
		if err != nil {
			return err
		}
		if project.Version != value.ExpectedVersion {
			return command.NewError(command.CodeVersionConflict, "project version does not match", false, nil, nil)
		}
		return nil
	})
	if err != nil {
		return service.commandFailure(value.Metadata, err)
	}
	if found {
		if replayFailure != nil {
			return command.Outcome{Payload: bytes.Clone(replay.Payload), Replayed: true}, replayFailure
		}
		return command.Outcome{Payload: bytes.Clone(replay.Payload), Replayed: true}, nil
	}
	approved, canonical, err := service.approvedRepository(principal, value)
	if err != nil {
		return service.commandFailure(value.Metadata, err)
	}
	proposal, err := specification.Import(ctx, approved.Reader, specification.Request{Binding: approved.Binding, Ref: value.Ref, ManifestPath: value.ManifestPath})
	if err != nil {
		if ctx.Err() != nil {
			return command.Outcome{}, ctx.Err()
		}
		return failureOutcome(value.Metadata, invalidRequest(err))
	}
	return service.execute(ctx, principal, value.Metadata, command.ProposeSpecificationOperation, value.ProjectID, request, digest, func(ctx context.Context, tx port.Transaction, now time.Time) (mutation, error) {
		admission, ok := tx.(port.AdmissionTransaction)
		if !ok {
			return mutation{}, errors.New("admission transaction unavailable")
		}
		current, currentCanonical, err := service.approvedRepository(principal, value)
		if err != nil {
			return mutation{}, err
		}
		if !bytes.Equal(canonical, currentCanonical) {
			return mutation{}, command.NewError(command.CodePermissionDenied, "repository binding changed", false, nil, nil)
		}
		project, err := admission.LoadProject(ctx, value.ProjectID)
		if err != nil {
			return mutation{}, err
		}
		if project.Version != value.ExpectedVersion {
			return mutation{}, command.NewError(command.CodeVersionConflict, "project version does not match", false, nil, nil)
		}
		if err := ctx.Err(); err != nil {
			return mutation{}, err
		}
		if err := admission.StoreProposal(ctx, current, proposal, now.UnixNano()); err != nil {
			return mutation{}, rollbackMutationError{err}
		}
		result := command.Result{Type: "SpecificationProposed", ProjectID: value.ProjectID, Version: project.Version, ProposalDigest: "sha256:" + proposal.Digest().String(), GraphDigest: "sha256:" + proposal.Graph().Revision().String(), ObjectFormat: string(proposal.Commit().Format()), CommitOID: proposal.Commit().String()}
		return changeMutation(value.ProjectID, "project", string(value.ProjectID), project.Version, result, proposal.Digest()), nil
	})
}
