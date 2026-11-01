package group

import "github.com/fallrising/newclear/systems/mkfk/internal/raft"

// Completion reports the outcome of one proposal. Unknown means leadership
// changed before the entry applied: it may or may not have been written.
type Completion struct {
	Index     uint64
	RequestID string
	Result    Result
	Unknown   bool
}

// Output carries what a call produced: messages the caller must send and
// completed proposals. Applied entries have already been applied.
type Output struct {
	Messages    []raft.Message
	Completions []Completion
}

// Ticket identifies a client proposal that has not applied yet.
type Ticket struct {
	Index     uint64
	RequestID string
}

type proposal struct {
	term      uint64
	requestID string
}

type memberKey struct{ group, member string }
