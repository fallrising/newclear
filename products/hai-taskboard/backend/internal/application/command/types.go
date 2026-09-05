// Package command defines transport-neutral application command DTOs and
// their canonical V1 representations. Authenticated identity is deliberately
// absent: services receive it as a separate trusted argument.
package command

import (
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

type Operation string

const (
	CreateProjectOperation    Operation = "CreateProject"
	CreateWorkItemOperation   Operation = "CreateWorkItem"
	MarkReadyOperation        Operation = "MarkReady"
	DispatchRunOperation      Operation = "DispatchRun"
	CompleteWorkItemOperation Operation = "CompleteWorkItem"
)

// Metadata contains caller-supplied command identity. CorrelationID is not
// part of the idempotency request digest; replay returns the originally
// recorded response bytes and therefore its original correlation identity.
type Metadata struct {
	CommandID       string
	IdempotencyKey  string
	ExpectedVersion uint64
	IssuedAt        time.Time
	CorrelationID   string
}

type ACRevision struct {
	ACID           domain.ACID
	RevisionDigest domain.Digest
}

type CreateProject struct {
	Metadata
	ProjectID      domain.ProjectID
	Name           string
	RepositoryRoot string
	ApprovedRef    string
}

type CreateWorkItem struct {
	Metadata
	ProjectID           domain.ProjectID
	WorkItemID          domain.WorkItemID
	Title               string
	Goal                string
	OwnerID             domain.ActorID
	RequiredACRevisions []ACRevision
}

type MarkReady struct {
	Metadata
	ProjectID  domain.ProjectID
	WorkItemID domain.WorkItemID
}

type DispatchRun struct {
	Metadata
	ProjectID    domain.ProjectID
	WorkItemID   domain.WorkItemID
	AdapterID    string
	ScenarioID   string
	RetryOfRunID domain.RunID
}

type CompleteWorkItem struct {
	Metadata
	ProjectID  domain.ProjectID
	WorkItemID domain.WorkItemID
	Subject    domain.CompletionSubject
}

type Result struct {
	Type       string
	ProjectID  domain.ProjectID
	WorkItemID domain.WorkItemID
	RunID      domain.RunID
	Version    uint64
	Phase      domain.Phase
}

type Outcome struct {
	Payload            []byte
	Replayed           bool
	ProjectionDeferred bool
}
