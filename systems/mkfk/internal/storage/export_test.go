package storage

import (
	"errors"
	"sync/atomic"
	"syscall"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
)

// Faults switches WAL write and sync failures on at run time for tests in
// the external storage_test package.
type Faults struct {
	FailWrite atomic.Bool // WriteAt returns ENOSPC, as on a full disk
	FailSync  atomic.Bool
}

func OpenPartitionLogWithFaults(directory, topic string, partitionID uint32, faults *Faults) (*PartitionLog, error) {
	return openPartitionLog(&faultToggleFS{FileSystem: adapters.OSFileSystem{}, faults: faults}, directory, topic, partitionID)
}

type faultToggleFS struct {
	adapters.FileSystem
	faults *Faults
}

func (f *faultToggleFS) Open(path string, options adapters.OpenOptions) (adapters.DurableFile, error) {
	file, err := f.FileSystem.Open(path, options)
	if err != nil {
		return nil, err
	}
	return &faultToggleFile{DurableFile: file, faults: f.faults}, nil
}

type faultToggleFile struct {
	adapters.DurableFile
	faults *Faults
}

func (f *faultToggleFile) WriteAt(data []byte, offset int64) (int, error) {
	if f.faults.FailWrite.Load() {
		return 0, syscall.ENOSPC
	}
	return f.DurableFile.WriteAt(data, offset)
}

func (f *faultToggleFile) Sync() error {
	if f.faults.FailSync.Load() {
		return errors.New("injected sync failure")
	}
	return f.DurableFile.Sync()
}
