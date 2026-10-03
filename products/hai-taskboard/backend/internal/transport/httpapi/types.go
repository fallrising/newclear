package httpapi

import (
	"bytes"
	"context"
	"errors"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

var (
	ErrUnauthenticated     = errors.New("unauthenticated")
	ErrPermissionDenied    = errors.New("permission denied")
	ErrProjectionCorrupt   = errors.New("projection source returned corrupt data")
	ErrProjectionNotFound  = errors.New("projection not found")
	ErrCommandResultAbsent = errors.New("command result unavailable")
)

type Session struct {
	ID        string
	Principal domain.ActorID
}

// SessionAuthority is the sole source of request identity and continuous SSE
// authorization. Command-result authorization can encode original-actor or
// audit-reader policy without asking the result store whether a row exists.
type SessionAuthority interface {
	Authenticate(context.Context, string) (Session, error)
	AuthorizeProject(context.Context, Session, domain.ProjectID) error
	AuthorizeCommandResult(context.Context, Session, domain.ProjectID, string) error
	Revoked(Session) <-chan struct{}
}

// CommandService is the already-accepted application-facing command surface.
type CommandService interface {
	CreateProject(context.Context, domain.ActorID, command.CreateProject) (command.Outcome, error)
	CreateWorkItem(context.Context, domain.ActorID, command.CreateWorkItem) (command.Outcome, error)
	MarkReady(context.Context, domain.ActorID, command.MarkReady) (command.Outcome, error)
	DispatchRun(context.Context, domain.ActorID, command.DispatchRun) (command.Outcome, error)
	CompleteWorkItem(context.Context, domain.ActorID, command.CompleteWorkItem) (command.Outcome, error)
}

type StoredCommandResult struct {
	CommandID string
	ProjectID domain.ProjectID
	Digest    domain.Digest
	Payload   []byte
}

func (result StoredCommandResult) Clone() StoredCommandResult {
	result.Payload = bytes.Clone(result.Payload)
	return result
}

type CommandResultSource interface {
	LoadCommandResult(context.Context, domain.ProjectID, string) (StoredCommandResult, error)
}

// UnitCommandResults adapts only the public application persistence port. It
// performs no command and never reconstructs a result from mutable state.
type UnitCommandResults struct{ Unit port.UnitOfWork }

func (source UnitCommandResults) LoadCommandResult(ctx context.Context, projectID domain.ProjectID, commandID string) (StoredCommandResult, error) {
	if source.Unit == nil {
		return StoredCommandResult{}, ErrCommandResultAbsent
	}
	var result port.CommandResult
	err := source.Unit.Within(ctx, func(tx port.Transaction) error {
		var err error
		result, err = tx.LoadCommandResult(ctx, projectID, commandID)
		return err
	})
	if err != nil {
		return StoredCommandResult{}, err
	}
	return StoredCommandResult{CommandID: result.ID, ProjectID: result.ProjectID, Digest: result.Digest, Payload: bytes.Clone(result.Payload)}, nil
}

type ProjectionEvent struct {
	ProjectID domain.ProjectID
	Cursor    port.Cursor
	Payload   []byte
}

func (event ProjectionEvent) Clone() ProjectionEvent {
	event.Payload = bytes.Clone(event.Payload)
	return event
}

type ProjectionSnapshot struct {
	ProjectID       domain.ProjectID
	Cursor          port.Cursor
	MinimumSequence uint64
	Payload         []byte
}

func (snapshot ProjectionSnapshot) Clone() ProjectionSnapshot {
	snapshot.Payload = bytes.Clone(snapshot.Payload)
	return snapshot
}

type ProjectionReplay struct {
	Epoch           uint64
	HighWater       uint64
	MinimumSequence uint64
	Events          []ProjectionEvent
}

func (replay ProjectionReplay) Clone() ProjectionReplay {
	events := make([]ProjectionEvent, len(replay.Events))
	for index, event := range replay.Events {
		events[index] = event.Clone()
	}
	replay.Events = events
	return replay
}

// ProjectionSource owns consistent snapshot/high-water and durable replay
// reads. Implementations may use a read transaction but never a write one.
type ProjectionSource interface {
	Snapshot(context.Context, domain.ProjectID) (ProjectionSnapshot, error)
	Replay(context.Context, domain.ProjectID, port.Cursor) (ProjectionReplay, error)
}
