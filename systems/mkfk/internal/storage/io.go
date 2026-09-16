package storage

import (
	"errors"
	"io"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
)

func writeAllAt(file adapters.DurableFile, offset int64, data []byte) error {
	for len(data) > 0 {
		written, err := file.WriteAt(data, offset)
		if written > 0 {
			offset += int64(written)
			data = data[written:]
		}
		if err != nil {
			return err
		}
		if written == 0 {
			return io.ErrNoProgress
		}
	}
	return nil
}

func readExactlyAt(file adapters.DurableFile, offset int64, destination []byte) error {
	for len(destination) > 0 {
		read, err := file.ReadAt(destination, offset)
		if read > 0 {
			offset += int64(read)
			destination = destination[read:]
		}
		if err != nil {
			if errors.Is(err, io.EOF) && len(destination) == 0 {
				return nil
			}
			return err
		}
		if read == 0 {
			return io.ErrNoProgress
		}
	}
	return nil
}

func readBoundedFile(filesystem adapters.FileSystem, path string, maximum int64) ([]byte, error) {
	file, err := filesystem.Open(path, adapters.OpenOptions{Read: true})
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() < 0 || info.Size() > maximum {
		return nil, errors.New("file exceeds bounded read size")
	}
	data := make([]byte, int(info.Size()))
	if err := readExactlyAt(file, 0, data); err != nil {
		return nil, err
	}
	return data, nil
}
