package port

// IDKind identifies an application-owned immutable identity namespace.
type IDKind string

const (
	IDAuditGroup          IDKind = "audit_group"
	IDRun                 IDKind = "run"
	IDOutbox              IDKind = "outbox"
	IDCompletionRecord    IDKind = "completion_record"
	IDApprovalConsumption IDKind = "approval_consumption"
)

// IDSource creates opaque stable IDs. Persistence adapters never allocate
// application identities.
type IDSource interface {
	Next(IDKind) (string, error)
}
