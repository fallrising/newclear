package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"strconv"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
	"github.com/fallrising/newclear/systems/mkfk/internal/jsonstrict"
)

const (
	hardStateVersion  = 1
	hardStateMaxBytes = 16 << 10
)

type HardState struct {
	CurrentTerm uint64
	VotedFor    *uint32
	CommitIndex uint64
}

type hardStateWire struct {
	Version     uint16  `json:"version"`
	CurrentTerm string  `json:"current_term"`
	VotedFor    *uint32 `json:"voted_for"`
	CommitIndex string  `json:"commit_index"`
}

func (state HardState) Validate(lastLogIndex uint64) error {
	if state.CurrentTerm > math.MaxInt64 {
		return errors.New("current term exceeds MaxInt64")
	}
	if state.CommitIndex > math.MaxInt64 {
		return errors.New("commit index exceeds MaxInt64")
	}
	if state.CommitIndex > lastLogIndex {
		return fmt.Errorf("commit index %d exceeds last log index %d", state.CommitIndex, lastLogIndex)
	}
	if state.VotedFor != nil && *state.VotedFor == 0 {
		return errors.New("voted_for must be null or a positive node ID")
	}
	if state.CurrentTerm == 0 && state.VotedFor != nil {
		return errors.New("term zero cannot contain a vote")
	}
	return nil
}

func validateHardStateTransition(previous, next HardState, lastLogIndex uint64) error {
	if err := next.Validate(lastLogIndex); err != nil {
		return err
	}
	if next.CurrentTerm < previous.CurrentTerm {
		return errors.New("current term cannot decrease")
	}
	if next.CommitIndex < previous.CommitIndex {
		return errors.New("commit index cannot decrease")
	}
	if next.CurrentTerm == previous.CurrentTerm && previous.VotedFor != nil {
		if next.VotedFor == nil || *previous.VotedFor != *next.VotedFor {
			return errors.New("durable vote cannot change or clear in the same term")
		}
	}
	return nil
}

func encodeHardState(state HardState) ([]byte, error) {
	wire := hardStateWire{
		Version:     hardStateVersion,
		CurrentTerm: strconv.FormatUint(state.CurrentTerm, 10),
		VotedFor:    state.VotedFor,
		CommitIndex: strconv.FormatUint(state.CommitIndex, 10),
	}
	encoded, err := json.Marshal(wire)
	if err != nil {
		return nil, err
	}
	return append(encoded, '\n'), nil
}

func decodeHardState(data []byte) (HardState, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return HardState{}, err
	}
	for _, field := range []string{"version", "current_term", "voted_for", "commit_index"} {
		if _, exists := fields[field]; !exists {
			return HardState{}, fmt.Errorf("required hardstate field %q is missing", field)
		}
	}
	var wire hardStateWire
	if err := jsonstrict.Decode(data, &wire); err != nil {
		return HardState{}, err
	}
	if wire.Version != hardStateVersion {
		return HardState{}, fmt.Errorf("unsupported hardstate version %d", wire.Version)
	}
	term, err := parseCanonicalUint64(wire.CurrentTerm)
	if err != nil {
		return HardState{}, fmt.Errorf("current_term: %w", err)
	}
	commit, err := parseCanonicalUint64(wire.CommitIndex)
	if err != nil {
		return HardState{}, fmt.Errorf("commit_index: %w", err)
	}
	return HardState{CurrentTerm: term, VotedFor: wire.VotedFor, CommitIndex: commit}, nil
}

func readHardState(filesystem adapters.FileSystem, directory string) (HardState, error) {
	data, err := readBoundedFile(filesystem, filepath.Join(directory, "hardstate.json"), hardStateMaxBytes)
	if err != nil {
		return HardState{}, err
	}
	return decodeHardState(data)
}

func persistHardState(filesystem adapters.FileSystem, directory string, state HardState) error {
	encoded, err := encodeHardState(state)
	if err != nil {
		return err
	}
	temporary, temporaryPath, err := filesystem.CreateTemp(directory, ".hardstate-*.tmp")
	if err != nil {
		return err
	}
	keepTemporary := true
	defer func() {
		if keepTemporary {
			_ = filesystem.Remove(temporaryPath)
		}
	}()
	if err := writeAllAt(temporary, 0, encoded); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := filesystem.Rename(temporaryPath, filepath.Join(directory, "hardstate.json")); err != nil {
		return err
	}
	keepTemporary = false
	if err := filesystem.SyncDir(directory); err != nil {
		return err
	}
	return nil
}

func parseCanonicalUint64(value string) (uint64, error) {
	if value == "" || value[0] == '+' || value[0] == '-' || len(value) > 1 && value[0] == '0' {
		return 0, errors.New("expected canonical unsigned decimal string")
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0, err
	}
	return parsed, nil
}
