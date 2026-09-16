// Package client provides the mkfk v1 producer client and its durable
// outbound ledger. It is intentionally not Kafka wire compatible.
package client

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/fallrising/newclear/systems/mkfk/internal/jsonstrict"
)

const LedgerVersion = 1

type Record struct {
	Key   []byte `json:"key"`
	Value []byte `json:"value"`
}

type PendingBatch struct {
	RequestID     string   `json:"request_id"`
	FirstSequence uint64   `json:"first_sequence"`
	Records       []Record `json:"records"`
}

type LedgerState struct {
	Version      int           `json:"version"`
	ClusterID    string        `json:"cluster_id"`
	ProducerID   string        `json:"producer_id"`
	Topic        string        `json:"topic"`
	Partition    uint32        `json:"partition"`
	Epoch        uint64        `json:"epoch"`
	NextSequence uint64        `json:"next_sequence"`
	Pending      *PendingBatch `json:"pending"`
}

type Ledger interface {
	Load() (LedgerState, bool, error)
	Save(LedgerState) error
}

type FileLedger struct {
	path string
	mu   sync.Mutex
}

func NewFileLedger(path string) (*FileLedger, error) {
	if path == "" || filepath.Base(path) == "." || filepath.Base(path) == string(filepath.Separator) {
		return nil, errors.New("ledger path must name a file")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	return &FileLedger{path: absolute}, nil
}

func (ledger *FileLedger) Load() (LedgerState, bool, error) {
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	data, err := os.ReadFile(ledger.path)
	if errors.Is(err, os.ErrNotExist) {
		return LedgerState{}, false, nil
	}
	if err != nil {
		return LedgerState{}, false, err
	}
	var state LedgerState
	if err := jsonstrict.Decode(data, &state); err != nil {
		return LedgerState{}, false, fmt.Errorf("decode outbound ledger: %w", err)
	}
	if err := state.Validate(); err != nil {
		return LedgerState{}, false, fmt.Errorf("validate outbound ledger: %w", err)
	}
	return cloneLedgerState(state), true, nil
}

func (ledger *FileLedger) Save(state LedgerState) error {
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	if err := state.Validate(); err != nil {
		return err
	}
	directory := filepath.Dir(ledger.path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	encoded, err := json.Marshal(state)
	if err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".mkfk-ledger-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	keepTemporary := true
	defer func() {
		if keepTemporary {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := writeAll(temporary, encoded); err != nil {
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
	if info, err := os.Lstat(ledger.path); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return errors.New("ledger destination must not be a symlink")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(temporaryPath, ledger.path); err != nil {
		return err
	}
	keepTemporary = false
	directoryHandle, err := os.Open(directory)
	if err != nil {
		return err
	}
	syncErr := directoryHandle.Sync()
	closeErr := directoryHandle.Close()
	if syncErr != nil {
		return syncErr
	}
	return closeErr
}

func (state LedgerState) Validate() error {
	if state.Version != LedgerVersion {
		return fmt.Errorf("unsupported ledger version %d", state.Version)
	}
	if state.ClusterID == "" || state.ProducerID == "" || state.Topic == "" {
		return errors.New("cluster, producer, and topic identities are required")
	}
	if state.Pending != nil {
		if state.Pending.RequestID == "" || len(state.Pending.Records) == 0 || state.Pending.FirstSequence != state.NextSequence {
			return errors.New("pending batch does not match the ledger sequence")
		}
		for _, record := range state.Pending.Records {
			if record.Value == nil {
				return errors.New("pending record value must not be null")
			}
		}
	}
	return nil
}

func cloneLedgerState(state LedgerState) LedgerState {
	if state.Pending == nil {
		return state
	}
	pending := *state.Pending
	pending.Records = cloneRecords(state.Pending.Records)
	state.Pending = &pending
	return state
}

func cloneRecords(records []Record) []Record {
	result := make([]Record, len(records))
	for index, record := range records {
		result[index] = Record{Key: cloneNullable(record.Key), Value: append([]byte{}, record.Value...)}
	}
	return result
}

func cloneNullable(value []byte) []byte {
	if value == nil {
		return nil
	}
	return append([]byte{}, value...)
}

type syncWriter interface {
	Write([]byte) (int, error)
}

func writeAll(writer syncWriter, data []byte) error {
	for len(data) > 0 {
		written, err := writer.Write(data)
		if err != nil {
			return err
		}
		if written <= 0 || written > len(data) {
			return errors.New("ledger write made invalid progress")
		}
		data = data[written:]
	}
	return nil
}
