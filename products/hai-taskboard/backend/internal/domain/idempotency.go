package domain

type CommandKind string

const CommandCompleteWorkItem CommandKind = "CompleteWorkItem"

type IdempotencyScope struct {
	Principal ActorID
	ProjectID ProjectID
	Command   CommandKind
	Key       string
}

type IdempotencyRecord struct {
	scope         IdempotencyScope
	requestDigest Digest
	resultDigest  Digest
	expired       bool
}

func NewIdempotencyRecord(scope IdempotencyScope, requestDigest, resultDigest Digest, expired bool) IdempotencyRecord {
	return IdempotencyRecord{scope: scope, requestDigest: requestDigest, resultDigest: resultDigest, expired: expired}
}

type IdempotencyDecision string

const (
	IdempotencyNew    IdempotencyDecision = "new"
	IdempotencyReplay IdempotencyDecision = "replay"
)

func CheckIdempotency(record *IdempotencyRecord, scope IdempotencyScope, requestDigest Digest) (IdempotencyDecision, Digest, error) {
	if record == nil || record.scope != scope {
		return IdempotencyNew, Digest{}, nil
	}
	if record.expired {
		return "", Digest{}, Rejection{Code: CodeIdempotencyExpired}
	}
	if record.requestDigest != requestDigest {
		return "", Digest{}, Rejection{Code: CodeIdempotencyConflict}
	}
	return IdempotencyReplay, record.resultDigest, nil
}
