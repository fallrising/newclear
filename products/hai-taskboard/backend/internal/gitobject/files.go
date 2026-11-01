package gitobject

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

func checkAbsolute(path string, directory bool) error {
	current := string(os.PathSeparator)
	parts := strings.Split(strings.TrimPrefix(path, current), current)
	for i, p := range parts {
		current = filepath.Join(current, p)
		info, err := os.Lstat(current)
		if err != nil {
			return errorAt(specification.Unavailable, "config_path")
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return errorAt(specification.Invalid, "symlink")
		}
		if (i < len(parts)-1 || directory) && !info.IsDir() {
			return errorAt(specification.Invalid, "directory")
		}
	}
	return nil
}
func openRoot(path string) (*os.Root, error) {
	if err := checkAbsolute(path, true); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(path)
	if err != nil {
		return nil, errorAt(specification.Unavailable, "directory_open")
	}
	return root, nil
}
func checkedLstat(root *os.Root, path string) (os.FileInfo, error) {
	parts := strings.Split(filepath.ToSlash(path), "/")
	current := ""
	for i, p := range parts {
		if p == "" || p == "." || p == ".." {
			return nil, errorAt(specification.Invalid, "path_component")
		}
		current = filepath.Join(current, p)
		info, err := root.Lstat(current)
		if err != nil {
			return nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, errorAt(specification.Invalid, "symlink")
		}
		if i < len(parts)-1 && !info.IsDir() {
			return nil, errorAt(specification.Invalid, "directory")
		}
		if i == len(parts)-1 {
			return info, nil
		}
	}
	return nil, errorAt(specification.Invalid, "path")
}
func boundedFile(ctx context.Context, root *os.Root, path string, maximum int64) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, contextError(err)
	}
	before, err := checkedLstat(root, path)
	if err != nil {
		return nil, err
	}
	if !before.Mode().IsRegular() {
		return nil, errorAt(specification.Invalid, "regular_file")
	}
	if before.Size() < 0 || before.Size() > maximum {
		return nil, errorAt(specification.Capacity, "file_bytes")
	}
	file, err := root.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, errorAt(specification.Unavailable, "file_open")
	}
	defer file.Close()
	after, err := file.Stat()
	if err != nil || !after.Mode().IsRegular() || !os.SameFile(before, after) {
		return nil, errorAt(specification.Integrity, "file_identity")
	}
	if after.Size() < 0 || after.Size() > maximum {
		return nil, errorAt(specification.Capacity, "file_bytes")
	}
	data := make([]byte, 0, after.Size())
	buffer := make([]byte, 4096)
	for {
		if err := ctx.Err(); err != nil {
			return nil, contextError(err)
		}
		n, e := file.Read(buffer)
		if int64(n) > maximum-int64(len(data)) {
			return nil, errorAt(specification.Capacity, "file_bytes")
		}
		data = append(data, buffer[:n]...)
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, errorAt(specification.Unavailable, "file_read")
		}
	}
	final, err := root.Lstat(path)
	if err != nil || !os.SameFile(before, final) {
		return nil, errorAt(specification.Integrity, "file_identity")
	}
	return data, nil
}
func resolveRef(ctx context.Context, config Config, ref string) (specification.ObjectID, error) {
	root, err := openRoot(config.GitDir)
	if err != nil {
		return specification.ObjectID{}, err
	}
	defer root.Close()
	data, err := boundedFile(ctx, root, ref, maximumRef)
	if err == nil {
		value := string(data)
		value = strings.TrimSuffix(value, "\n")
		id, e := specification.ParseObjectID(config.ObjectFormat, value)
		if e != nil {
			return specification.ObjectID{}, errorAt(specification.Invalid, "loose_ref")
		}
		return id, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return specification.ObjectID{}, redactFile(err)
	}
	data, err = boundedFile(ctx, root, "packed-refs", maximumPackedRefs)
	if err != nil {
		return specification.ObjectID{}, redactFile(err)
	}
	var result specification.ObjectID
	count := 0
	previousRecord := false
	previousRelevant := false
	for line := range bytes.SplitSeq(data, []byte("\n")) {
		if err := ctx.Err(); err != nil {
			return specification.ObjectID{}, contextError(err)
		}
		if len(line) == 0 {
			continue
		}
		if line[0] == '#' {
			previousRecord = false
			continue
		}
		if line[0] == '^' {
			if !previousRecord {
				return specification.ObjectID{}, errorAt(specification.Invalid, "packed_ref")
			}
			if _, err := specification.ParseObjectID(config.ObjectFormat, string(line[1:])); previousRelevant && err != nil {
				return specification.ObjectID{}, errorAt(specification.Invalid, "packed_ref")
			}
			previousRecord = false
			continue
		}
		count++
		if count > maximumPackedRecords {
			return specification.ObjectID{}, errorAt(specification.Capacity, "packed_records")
		}
		oid, name, ok := strings.Cut(string(line), " ")
		if !ok {
			return specification.ObjectID{}, errorAt(specification.Invalid, "packed_ref")
		}
		previousRecord = true
		previousRelevant = name == ref
		if name != ref {
			continue
		}
		id, e := specification.ParseObjectID(config.ObjectFormat, oid)
		if e != nil {
			return specification.ObjectID{}, errorAt(specification.Invalid, "packed_ref")
		}
		previousRecord = true
		if name == ref {
			if !result.IsZero() {
				return specification.ObjectID{}, errorAt(specification.Invalid, "duplicate_ref")
			}
			result = id
		}
	}
	if result.IsZero() {
		return result, errorAt(specification.Unavailable, "ref")
	}
	return result, nil
}
func redactFile(err error) error {
	if _, ok := errors.AsType[*specification.Error](err); ok {
		return err
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return contextError(err)
	}
	return errorAt(specification.Unavailable, "file")
}

type inventoryBudget struct {
	entries        int
	bytes          int64
	maximumEntries int
	maximumBytes   int64
}

func (b *inventoryBudget) add(info os.FileInfo) error {
	if b.entries >= b.maximumEntries {
		return errorAt(specification.Capacity, "inventory_entries")
	}
	b.entries++
	if info.Mode().IsRegular() {
		size := info.Size()
		if size < 0 || b.bytes < 0 || b.bytes > b.maximumBytes || size > b.maximumBytes-b.bytes {
			return errorAt(specification.Capacity, "inventory_bytes")
		}
		b.bytes += size
	}
	return nil
}
func captureObjects(ctx context.Context, config Config, facade string) error {
	return captureWithBudget(ctx, config, facade, &inventoryBudget{maximumEntries: maximumInventory, maximumBytes: maximumInventoryBytes})
}
func captureWithBudget(ctx context.Context, config Config, facade string, budget *inventoryBudget) error {
	source, err := openRoot(config.GitDir)
	if err != nil {
		return err
	}
	defer source.Close()
	dest, err := os.OpenRoot(facade)
	if err != nil {
		return errorAt(specification.Unavailable, "facade_open")
	}
	defer dest.Close()
	size := 40
	if config.ObjectFormat == specification.SHA256 {
		size = 64
	}
	packs := map[string]bool{}
	indexes := map[string]bool{}
	var walk func(string) error
	walk = func(path string) error {
		if err := ctx.Err(); err != nil {
			return contextError(err)
		}
		before, err := checkedLstat(source, path)
		if err != nil {
			return redactFile(err)
		}
		if !before.IsDir() {
			return errorAt(specification.Invalid, "objects_directory")
		}
		dir, err := source.Open(path)
		if err != nil {
			return errorAt(specification.Unavailable, "inventory_open")
		}
		defer dir.Close()
		info, err := dir.Stat()
		if err != nil || !info.IsDir() || !os.SameFile(before, info) {
			return errorAt(specification.Integrity, "directory_identity")
		}
		for {
			entries, e := dir.ReadDir(128)
			if e != nil && e != io.EOF {
				return errorAt(specification.Unavailable, "inventory_read")
			}
			for _, entry := range entries {
				if err := ctx.Err(); err != nil {
					return contextError(err)
				}
				child := filepath.Join(path, entry.Name())
				info, err := source.Lstat(child)
				if err != nil {
					return errorAt(specification.Unavailable, "inventory_stat")
				}
				if err := budget.add(info); err != nil {
					return err
				}
				if info.Mode()&os.ModeSymlink != 0 {
					return errorAt(specification.Invalid, "object_symlink")
				}
				if info.IsDir() {
					if err := walk(child); err != nil {
						return err
					}
					continue
				}
				if !info.Mode().IsRegular() {
					return errorAt(specification.Invalid, "object_file")
				}
				relative := filepath.ToSlash(strings.TrimPrefix(child, "objects/"))
				parts := strings.Split(relative, "/")
				name := entry.Name()
				whitelisted := false
				if len(parts) == 2 && len(parts[0]) == 2 && lowerHex(parts[0]) && len(parts[1]) == size-2 && lowerHex(parts[1]) {
					whitelisted = true
				}
				if len(parts) == 2 && parts[0] == "pack" {
					if strings.HasSuffix(name, ".promisor") {
						return errorAt(specification.Invalid, "promisor")
					}
					stem, ext, _ := strings.CutLast(name, ".")
					oid, ok := strings.CutPrefix(stem, "pack-")
					if ok && len(oid) == size && lowerHex(oid) && (ext == "pack" || ext == "idx") {
						whitelisted = true
						if ext == "pack" {
							packs[stem] = true
						} else {
							indexes[stem] = true
						}
					}
				}
				if !whitelisted {
					continue
				}
				parent := filepath.Dir(child)
				if err := dest.MkdirAll(parent, 0700); err != nil {
					return errorAt(specification.Unavailable, "facade_directory")
				}
				if err := os.Link(filepath.Join(source.Name(), child), filepath.Join(dest.Name(), child)); err != nil {
					return errorAt(specification.Unavailable, "object_link")
				}
				// os.Root.Link's oldname must be confined too; links across two roots use
				// absolute OS link under the trusted parent, with both identities verified.
				after, err := source.Lstat(child)
				if err != nil || !os.SameFile(info, after) {
					return errorAt(specification.Integrity, "object_identity")
				}
				linked, err := dest.Lstat(child)
				if err != nil || !os.SameFile(info, linked) {
					return errorAt(specification.Integrity, "object_identity")
				}
			}
			if e == io.EOF {
				break
			}
		}
		final, err := source.Lstat(path)
		if err != nil || !os.SameFile(before, final) {
			return errorAt(specification.Integrity, "directory_identity")
		}
		return nil
	}
	if err := walk("objects"); err != nil {
		return err
	}
	for name := range packs {
		if !indexes[name] {
			return errorAt(specification.Invalid, "pack_index")
		}
	}
	for name := range indexes {
		if !packs[name] {
			return errorAt(specification.Invalid, "index_pack")
		}
	}
	return nil
}
func lowerHex(s string) bool {
	for _, c := range []byte(s) {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
