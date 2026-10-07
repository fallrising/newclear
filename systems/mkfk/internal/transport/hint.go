package transport

import (
	"errors"
	"strconv"
)

// LeaderHint wraps a NOT_LEADER or NOT_COORDINATOR cause with the broker the
// client should refresh to. LeaderID 0 means no leader is known yet.
type LeaderHint struct {
	Err      error
	LeaderID uint32
	Term     uint64
}

func (h *LeaderHint) Error() string { return h.Err.Error() }
func (h *LeaderHint) Unwrap() error { return h.Err }

// hintDetails renders a known leader as the envelope's error details.
func hintDetails(err error) map[string]any {
	var hint *LeaderHint
	if !errors.As(err, &hint) || hint.LeaderID == 0 {
		return nil
	}
	return map[string]any{"leader_id": hint.LeaderID, "leader_term": strconv.FormatUint(hint.Term, 10)}
}
