package gitobject

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

// frameWriter parses and bounds the header before allocating the object body.
// exec drains stdout and stderr concurrently into separate bounded writers.
type frameWriter struct {
	id      specification.ObjectID
	maximum int64
	header  []byte
	body    []byte
	offset  int
	kind    specification.ObjectKind
	err     error
	cancel  context.CancelFunc
	parsed  bool
}

func (w *frameWriter) reject(code specification.ErrorCode, field string) error {
	w.err = errorAt(code, field)
	w.cancel()
	return w.err
}
func (w *frameWriter) Write(data []byte) (int, error) {
	original := len(data)
	if w.err != nil {
		return 0, w.err
	}
	if !w.parsed {
		for len(data) > 0 {
			b := data[0]
			data = data[1:]
			if len(w.header) >= 128 {
				return 0, w.reject(specification.Capacity, "stdout_header")
			}
			w.header = append(w.header, b)
			if b == '\n' {
				w.parsed = true
				break
			}
		}
		if !w.parsed {
			return original, nil
		}
		parts := strings.Split(string(w.header[:len(w.header)-1]), " ")
		if len(parts) == 2 && parts[0] == w.id.String() && parts[1] == "missing" {
			return 0, w.reject(specification.Unavailable, "missing_object")
		}
		if len(parts) != 3 || parts[0] != w.id.String() {
			return 0, w.reject(specification.Integrity, "stdout_header")
		}
		w.kind = specification.ObjectKind(parts[1])
		if w.kind != specification.CommitObject && w.kind != specification.TreeObject && w.kind != specification.BlobObject {
			return 0, w.reject(specification.Integrity, "stdout_kind")
		}
		size, e := strconv.ParseInt(parts[2], 10, 64)
		if e != nil || size < 0 || strconv.FormatInt(size, 10) != parts[2] {
			return 0, w.reject(specification.Integrity, "stdout_size")
		}
		if size > w.maximum {
			return 0, w.reject(specification.Capacity, "object_bytes")
		}
		w.body = make([]byte, int(size)+1)
	}
	if len(data) > len(w.body)-w.offset {
		return 0, w.reject(specification.Integrity, "extra_output")
	}
	copy(w.body[w.offset:], data)
	w.offset += len(data)
	return original, nil
}

type stderrWriter struct {
	count  int
	cancel context.CancelFunc
	err    error
}

func (w *stderrWriter) Write(data []byte) (int, error) {
	if len(data) > 8192-w.count {
		w.err = errorAt(specification.Capacity, "stderr_bytes")
		w.cancel()
		return 0, w.err
	}
	w.count += len(data)
	return len(data), nil
}
func sterileEnv(facade string) []string {
	return []string{"LC_ALL=C", "LANG=C", "TZ=UTC", "HOME=" + filepath.Join(facade, "home"), "XDG_CONFIG_HOME=" + filepath.Join(facade, "xdg"), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_SYSTEM=/dev/null", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_TERMINAL_PROMPT=0", "GIT_NO_REPLACE_OBJECTS=1", "GIT_OPTIONAL_LOCKS=0", "GIT_ATTR_NOSYSTEM=1"}
}
func runBatch(ctx context.Context, executable, facade string, id specification.ObjectID, maximum int64) (specification.Object, error) {
	if nilContext(ctx) || maximum < 1 || maximum > maximumObject {
		return specification.Object{}, errorAt(specification.Invalid, "maximum_bytes")
	}
	if _, err := specification.ParseObjectID(id.Format(), id.String()); err != nil {
		return specification.Object{}, errorAt(specification.Invalid, "object_oid")
	}
	ctx, deadlineCancel := context.WithTimeout(ctx, objectTimeout)
	defer deadlineCancel()
	if err := ctx.Err(); err != nil {
		return specification.Object{}, contextError(err)
	}
	childCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	cmd := exec.CommandContext(childCtx, executable, "--no-pager", "--no-replace-objects", "--git-dir="+facade, "-c", "protocol.allow=never", "-c", "core.hooksPath="+filepath.Join(facade, "hooks"), "cat-file", "--batch")
	cmd.Dir = facade
	cmd.Env = sterileEnv(facade)
	cmd.Stdin = bytes.NewReader([]byte(id.String() + "\n"))
	cmd.WaitDelay = time.Second
	stdout := &frameWriter{id: id, maximum: maximum, cancel: cancel}
	stderr := &stderrWriter{cancel: cancel}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	err := cmd.Run()
	if stdout.err != nil {
		return specification.Object{}, stdout.err
	}
	if stderr.err != nil {
		return specification.Object{}, stderr.err
	}
	if e := ctx.Err(); e != nil {
		return specification.Object{}, contextError(e)
	}
	if err != nil {
		if _, ok := errors.AsType[*exec.ExitError](err); ok {
			return specification.Object{}, errorAt(specification.Unavailable, "git_exit")
		}
		return specification.Object{}, errorAt(specification.Unavailable, "git_start")
	}
	if !stdout.parsed || stdout.offset != len(stdout.body) || len(stdout.body) == 0 || stdout.body[len(stdout.body)-1] != '\n' {
		return specification.Object{}, errorAt(specification.Integrity, "truncated_output")
	}
	return specification.Object{Kind: stdout.kind, Data: stdout.body[:len(stdout.body)-1]}, nil
}

var _ io.Writer = (*frameWriter)(nil)
