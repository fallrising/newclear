package raft

import (
	"errors"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
)

const (
	DefaultTickInterval   = 100 * time.Millisecond
	DefaultHeartbeatTicks = uint64(1)
	MinimumElectionTicks  = uint64(6)
	MaximumElectionTicks  = uint64(12)
)

// RandomElectionTimeout converts an injected random value into the specified
// 600-1200 ms election range when Tick is driven at DefaultTickInterval.
func RandomElectionTimeout(random adapters.RandomSource) (uint64, error) {
	if random == nil {
		return 0, errors.New("random source is required")
	}
	value, err := random.Uint64()
	if err != nil {
		return 0, err
	}
	return MinimumElectionTicks + value%(MaximumElectionTicks-MinimumElectionTicks+1), nil
}
