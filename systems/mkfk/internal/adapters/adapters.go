// Package adapters defines the injected side-effect boundary around the
// deterministic state machines.
package adapters

import (
	"context"
	"io"
	"io/fs"
	"path/filepath"
	"time"
)

type Timer interface {
	C() <-chan time.Time
	Stop() bool
	Reset(time.Duration) bool
}

type Clock interface {
	Now() time.Time
	NewTimer(time.Duration) Timer
}

type RandomSource interface {
	Uint64() (uint64, error)
}

type PeerMessage struct {
	Destination uint32
	Group       string
	Term        uint64
	RPCID       uint64
	Body        []byte
}

type PeerTransport interface {
	Send(context.Context, PeerMessage) error
}

type DurableFile interface {
	io.ReaderAt
	io.WriterAt
	Stat() (fs.FileInfo, error)
	Truncate(int64) error
	Sync() error
	Close() error
}

type OpenOptions struct {
	Read      bool
	Write     bool
	CreateNew bool
}

type FileSystem interface {
	Open(string, OpenOptions) (DurableFile, error)
	CreateTemp(string, string) (DurableFile, string, error)
	MkdirAll(string, fs.FileMode) error
	ReadDir(string) ([]fs.DirEntry, error)
	Rename(string, string) error
	Remove(string) error
	SyncDir(string) error
	Lstat(string) (fs.FileInfo, error)
}

// CleanChildPath prevents unchecked topic strings from escaping the data root.
// Symlink checks remain the responsibility of the FileSystem implementation.
func CleanChildPath(root string, elements ...string) (string, bool) {
	candidate := filepath.Join(append([]string{root}, elements...)...)
	relative, err := filepath.Rel(root, candidate)
	if err != nil || relative == ".." || filepath.IsAbs(relative) {
		return "", false
	}
	for _, element := range elements {
		if element == "" || element == "." || element == ".." || filepath.Base(element) != element {
			return "", false
		}
	}
	return candidate, true
}

type Event struct {
	Kind      string
	NodeID    uint32
	Topic     string
	Partition uint32
	Term      uint64
	RequestID string
	// Metadata must never contain record keys, values, credentials, or tokens.
	Metadata map[string]string
}

type EventSink interface {
	Record(Event)
}
