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

func TestNativeQueryReadAndByteCaps(t *testing.T) {
	for _, tc := range []struct{ key, value string }{
		{"max_rows_to_read", "0"},
		{"max_result_bytes", "1099511627777"},
	} {
		_, err := parseOptions(t.Context(), spi.Config{DSN: "clickhouse://localhost:9000/prism", Options: map[string]string{tc.key: tc.value}})
		if spi.Classify(err) != spi.ErrBadRequest {
			t.Fatalf("%s=%s: %v", tc.key, tc.value, err)
		}
	}
	opts, err := parseOptions(t.Context(), spi.Config{DSN: "clickhouse://localhost:9000/prism"})
	if err != nil {
		t.Fatal(err)
	}
	if opts.maxRowsRead != 5_000_000 || opts.maxResultBytes != 64<<20 || opts.native.Settings["read_overflow_mode"] != "throw" || opts.native.Settings["result_overflow_mode"] != "throw" {
		t.Fatalf("read bounds missing: %+v", opts)
	}
}

func TestConfiguredMemoryCapIsExplicitInReadSQL(t *testing.T) {
	opts, err := parseOptions(t.Context(), spi.Config{
		DSN:     "clickhouse://localhost:9000/prism",
		Options: map[string]string{"max_memory_usage": "10000000"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if opts.native.Settings["max_memory_usage"] != 10_000_000 {
		t.Fatalf("validated native memory cap missing: %v", opts.native.Settings["max_memory_usage"])
	}
	if !strings.Contains(querySettings(opts), "max_memory_usage = 10000000") {
		t.Fatalf("read SQL omits configured memory cap: %s", querySettings(opts))
	}
	if !strings.Contains(querySettings(options{}), "max_memory_usage = 1000000000") {
		t.Fatalf("read SQL omits bounded default memory cap: %s", querySettings(options{}))
	}
}
