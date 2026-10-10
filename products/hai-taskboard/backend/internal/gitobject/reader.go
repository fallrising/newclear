// Package gitobject reads approved local captures through a sterile object-only
// Git facade. It never resolves revisions or reads config through source Git.
package gitobject

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

type Config struct {
	GitExecutable string
	GitDir        string
	ScratchDir    string
	ObjectFormat  specification.ObjectFormat
	AllowedRefs   []string
}
type Reader struct{ config Config }

const (
	openTimeout           = 30 * time.Second
	objectTimeout         = 2 * time.Second
	maximumObject         = 10 << 20
	maximumInventory      = 100000
	maximumInventoryBytes = int64(2 << 30)
	maximumRef            = 256
	maximumPackedRefs     = 8 << 20
	maximumPackedRecords  = 100000
)

func errorAt(code specification.ErrorCode, field string) error {
	return &specification.Error{Code: code, Field: field}
}

// Only context causes cross this I/O boundary. OS and child errors are redacted.
func contextError(err error) error {
	if errors.Is(err, context.Canceled) {
		return errors.Join(errorAt(specification.Unavailable, "context"), context.Canceled)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.Join(errorAt(specification.Unavailable, "context"), context.DeadlineExceeded)
	}
	return errorAt(specification.Unavailable, "io")
}
func validRef(ref string) bool {
	if len(ref) > 200 || !(strings.HasPrefix(ref, "refs/heads/") || strings.HasPrefix(ref, "refs/tags/")) || strings.Contains(ref, "..") || strings.Contains(ref, "@{") {
		return false
	}
	for _, c := range []byte(ref) {
		if c < 33 || c > 126 || strings.ContainsRune("~^:?*[\\", rune(c)) {
			return false
		}
	}
	for part := range strings.SplitSeq(ref, "/") {
		if part == "" || strings.HasPrefix(part, ".") || strings.HasSuffix(part, ".") || strings.HasSuffix(part, ".lock") {
			return false
		}
	}
	return true
}
func overlap(a, b string) bool {
	return a == b || strings.HasPrefix(a, b+string(os.PathSeparator)) || strings.HasPrefix(b, a+string(os.PathSeparator)) || a == string(os.PathSeparator) || b == string(os.PathSeparator)
}
func New(config Config) (*Reader, error) {
	for _, p := range []string{config.GitExecutable, config.GitDir, config.ScratchDir} {
		if !filepath.IsAbs(p) || filepath.Clean(p) != p || strings.ContainsRune(p, 0) {
			return nil, errorAt(specification.Invalid, "config_path")
		}
	}
	if overlap(config.GitDir, config.ScratchDir) {
		return nil, errorAt(specification.Invalid, "scratch_overlap")
	}
	if config.ObjectFormat != specification.SHA1 && config.ObjectFormat != specification.SHA256 {
		return nil, errorAt(specification.Invalid, "object_format")
	}
	if len(config.AllowedRefs) == 0 {
		return nil, errorAt(specification.Invalid, "allowed_refs")
	}
	seen := map[string]bool{}
	for _, ref := range config.AllowedRefs {
		if !validRef(ref) || seen[ref] {
			return nil, errorAt(specification.Invalid, "allowed_refs")
		}
		seen[ref] = true
	}
	config.AllowedRefs = slices.Clone(config.AllowedRefs)
	return &Reader{config}, nil
}
func (r *Reader) Open(ctx context.Context, ref string) (specification.Snapshot, error) {
	return r.open(ctx, ref, openTimeout)
}
func (r *Reader) open(ctx context.Context, ref string, duration time.Duration) (specification.Snapshot, error) {
	if r == nil || nilContext(ctx) {
		return nil, errorAt(specification.Invalid, "reader_context")
	}
	if !slices.Contains(r.config.AllowedRefs, ref) || !validRef(ref) {
		return nil, errorAt(specification.Invalid, "ref")
	}
	ctx, cancel := context.WithTimeout(ctx, duration)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return nil, contextError(err)
	}
	if err := checkAbsolute(r.config.GitExecutable, false); err != nil {
		return nil, err
	}
	info, err := os.Lstat(r.config.GitExecutable)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 {
		return nil, errorAt(specification.Invalid, "git_executable")
	}
	source, err := openRoot(r.config.GitDir)
	if err != nil {
		return nil, err
	}
	defer source.Close()
	for _, p := range []string{"commondir", "shallow", "objects/info/alternates", "objects/info/http-alternates"} {
		if _, err := checkedLstat(source, p); err == nil {
			return nil, errorAt(specification.Invalid, "unsupported_repository")
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, errorAt(specification.Invalid, "repository_metadata")
		}
	}
	oid, err := resolveRef(ctx, r.config, ref)
	if err != nil {
		return nil, err
	}
	scratch, err := openRoot(r.config.ScratchDir)
	if err != nil {
		return nil, err
	}
	defer scratch.Close()
	facade, err := os.MkdirTemp(r.config.ScratchDir, "proposal-")
	if err != nil {
		return nil, errorAt(specification.Unavailable, "facade_create")
	}
	cleanup := true
	defer func() {
		if cleanup {
			os.RemoveAll(facade)
		}
	}()
	root, err := os.OpenRoot(facade)
	if err != nil {
		return nil, errorAt(specification.Unavailable, "facade_open")
	}
	defer root.Close()
	for _, p := range []string{"objects", "refs", "hooks", "home", "xdg"} {
		if err := root.Mkdir(p, 0700); err != nil {
			return nil, errorAt(specification.Unavailable, "facade_directory")
		}
	}
	config := "[core]\n\tbare = true\n\trepositoryFormatVersion = 0\n"
	if r.config.ObjectFormat == specification.SHA256 {
		config = "[core]\n\tbare = true\n\trepositoryFormatVersion = 1\n[extensions]\n\tobjectFormat = sha256\n"
	}
	if err := root.WriteFile("config", []byte(config), 0600); err != nil {
		return nil, errorAt(specification.Unavailable, "facade_config")
	}
	if err := root.WriteFile("HEAD", []byte(oid.String()+"\n"), 0600); err != nil {
		return nil, errorAt(specification.Unavailable, "facade_head")
	}
	if err := captureObjects(ctx, r.config, facade); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, contextError(err)
	}
	cleanup = false
	return &snapshot{config: r.config, commit: oid, facade: facade}, nil
}

type snapshot struct {
	config Config
	commit specification.ObjectID
	facade string
	mu     sync.Mutex
	closed bool
}

func (s *snapshot) Commit() specification.ObjectID { return s.commit }
func (s *snapshot) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	if err := os.RemoveAll(s.facade); err != nil {
		return errorAt(specification.Unavailable, "facade_cleanup")
	}
	return nil
}
func (s *snapshot) ReadObject(ctx context.Context, id specification.ObjectID, maximum int64) (specification.Object, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if nilContext(ctx) || s.closed {
		return specification.Object{}, errorAt(specification.Invalid, "snapshot_context")
	}
	if maximum < 1 || maximum > maximumObject {
		return specification.Object{}, errorAt(specification.Invalid, "maximum_bytes")
	}
	parsed, err := specification.ParseObjectID(s.config.ObjectFormat, id.String())
	if err != nil || parsed != id {
		return specification.Object{}, errorAt(specification.Invalid, "object_oid")
	}
	return s.readObject(ctx, s.facade, id, maximum)
}
func (s *snapshot) readObject(ctx context.Context, facade string, id specification.ObjectID, maximum int64) (specification.Object, error) {
	return runBatch(ctx, s.config.GitExecutable, facade, id, maximum)
}

func nilContext(ctx context.Context) bool {
	if ctx == nil {
		return true
	}
	v := reflect.ValueOf(ctx)
	switch v.Kind() {
	case reflect.Pointer, reflect.Interface, reflect.Map, reflect.Slice, reflect.Func, reflect.Chan:
		return v.IsNil()
	}
	return false
}
