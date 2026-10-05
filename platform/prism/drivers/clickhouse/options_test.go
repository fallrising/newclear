package clickhouse

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

func TestParseOptionsRejectsUnsafeInputs(t *testing.T) {
	tests := []struct {
		name, dsn string
		opts      map[string]string
		class     spi.ErrClass
	}{
		{"unknown DSN", "clickhouse://user:secret@localhost:9000/prism?bad=1", nil, spi.ErrBadRequest},
		{"duplicate DSN", "clickhouse://localhost:9000/prism?secure=false&secure=true", nil, spi.ErrBadRequest},
		{"malformed escape", "clickhouse://localhost:9000/prism?secure=%ZZ", nil, spi.ErrBadRequest},
		{"semicolon query", "clickhouse://localhost:9000/prism?secure=false;password=secret", nil, spi.ErrBadRequest},
		{"duplicate user source", "clickhouse://user:secret@localhost:9000/prism?username=other", nil, spi.ErrBadRequest},
		{"duplicate database source", "clickhouse://localhost:9000/prism?database=other", nil, spi.ErrBadRequest},
		{"negative timeout", "clickhouse://localhost:9000/prism?dial_timeout=-1s", nil, spi.ErrBadRequest},
		{"unknown option", "clickhouse://localhost:9000/prism", map[string]string{"surprise": "1"}, spi.ErrBadRequest},
		{"cluster", "clickhouse://localhost:9000/prism", map[string]string{"cluster": "prod"}, spi.ErrUnsupported},
		{"invalid retention", "clickhouse://localhost:9000/prism", map[string]string{"retention_logs_days": "-1"}, spi.ErrBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseOptions(t.Context(), spi.Config{DSN: tt.dsn, Options: tt.opts})
			if spi.Classify(err) != tt.class {
				t.Fatalf("class=%s, want %s: %v", spi.Classify(err), tt.class, err)
			}
			if strings.Contains(err.Error(), "secret") {
				t.Fatal("secret leaked")
			}
		})
	}
}

func TestCredentialFileRejectsSpecialFiles(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "password")
	if err := os.WriteFile(file, []byte("private\n"), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := readCredential(t.Context(), file)
	if err != nil || got != "private" {
		t.Fatalf("got %q, %v", got, err)
	}
	if _, err := readCredential(t.Context(), "/dev/null"); err == nil {
		t.Fatal("device accepted")
	}
	link := filepath.Join(dir, "link")
	if err := os.Symlink(file, link); err != nil {
		t.Fatal(err)
	}
	if _, err := readCredential(t.Context(), link); err == nil {
		t.Fatal("symlink accepted")
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := readCredential(ctx, file); err == nil {
		t.Fatal("canceled read accepted")
	}
	if _, err := parseOptions(ctx, spi.Config{DSN: "clickhouse://localhost:9000/prism", Options: map[string]string{"password_file": file}}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation identity lost: %v", err)
	}
}

func TestConfiguredMaxExecutionTimeIsAvailableToMigrationPreflight(t *testing.T) {
	opts, err := parseOptions(t.Context(), spi.Config{
		DSN:     "clickhouse://localhost:9000/prism",
		Options: map[string]string{"max_execution_time": "7"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if opts.maxExec != 7 || opts.native.Settings["max_execution_time"] != 7 {
		t.Fatalf("configured max_execution_time was lost: option=%d, native=%v", opts.maxExec, opts.native.Settings["max_execution_time"])
	}
}
