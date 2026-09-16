//go:build linux

package adapters

import (
	"fmt"
	"io/fs"
	"os"
	"syscall"
)

// OSFileSystem is the Linux implementation used by the M1 storage adapter.
// Open uses O_NOFOLLOW so a final path component cannot redirect I/O through a
// symlink outside the formatted data directory.
type OSFileSystem struct{}

func (OSFileSystem) Open(path string, options OpenOptions) (DurableFile, error) {
	flags := syscall.O_CLOEXEC | syscall.O_NOFOLLOW
	switch {
	case options.Read && options.Write:
		flags |= syscall.O_RDWR
	case options.Write:
		flags |= syscall.O_WRONLY
	default:
		flags |= syscall.O_RDONLY
	}
	if options.CreateNew {
		flags |= syscall.O_CREAT | syscall.O_EXCL
	}
	fd, err := syscall.Open(path, flags, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	return os.NewFile(uintptr(fd), path), nil
}

func (OSFileSystem) CreateTemp(directory, pattern string) (DurableFile, string, error) {
	file, err := os.CreateTemp(directory, pattern)
	if err != nil {
		return nil, "", err
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		_ = os.Remove(file.Name())
		return nil, "", err
	}
	return file, file.Name(), nil
}

func (OSFileSystem) MkdirAll(path string, mode fs.FileMode) error {
	return os.MkdirAll(path, mode)
}

func (OSFileSystem) ReadDir(path string) ([]fs.DirEntry, error) {
	return os.ReadDir(path)
}

func (OSFileSystem) Rename(from, to string) error {
	return os.Rename(from, to)
}

func (OSFileSystem) Remove(path string) error {
	return os.Remove(path)
}

func (OSFileSystem) SyncDir(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	if err := directory.Sync(); err != nil {
		_ = directory.Close()
		return err
	}
	return directory.Close()
}

func (OSFileSystem) Lstat(path string) (fs.FileInfo, error) {
	return os.Lstat(path)
}
