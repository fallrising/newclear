package spi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"maps"
	"reflect"
	"strings"
	"testing"
	"time"
)

type testDriver struct {
	name string
	open func(context.Context, Config) (Backend, error)
}

func (d testDriver) Name() string { return d.name }

func (d testDriver) Open(ctx context.Context, cfg Config) (Backend, error) {
	return d.open(ctx, cfg)
}

type testBackend struct{}

func (*testBackend) Capabilities() Capabilities    { return Capabilities{} }
func (*testBackend) Metrics() MetricStore          { return nil }
func (*testBackend) Logs() LogStore                { return nil }
func (*testBackend) Traces() TraceStore            { return nil }
func (*testBackend) Migrate(context.Context) error { return nil }
func (*testBackend) Ping(context.Context) error    { return nil }
func (*testBackend) Close() error                  { return nil }

type fixedClock struct {
	now time.Time
}

func (c fixedClock) Now() time.Time { return c.now }

type testContextKey struct{}

func TestConfigOptions(t *testing.T) {
	t.Parallel()

	cfg := Config{Options: map[string]string{
		"string":   "value",
		"empty":    "",
		"int":      "42",
		"bad_int":  "many",
		"bool":     "true",
		"bad_bool": "sometimes",
		"duration": "1.5s",
		"bad_dur":  "later",
	}}
	if got := cfg.String("string", "default"); got != "value" {
		t.Fatalf("String() = %q, want value", got)
	}
	if got := cfg.String("missing", "default"); got != "default" {
		t.Fatalf("String() missing = %q, want default", got)
	}
	if got := cfg.String("empty", "default"); got != "" {
		t.Fatalf("String() empty = %q, want empty", got)
	}

	if got, err := cfg.Int("int", 7); err != nil || got != 42 {
		t.Fatalf("Int() = %d, %v; want 42, nil", got, err)
	}
	if got, err := cfg.Int("missing", 7); err != nil || got != 7 {
		t.Fatalf("Int() missing = %d, %v; want 7, nil", got, err)
	}
	if _, err := cfg.Int("bad_int", 7); err == nil {
		t.Fatal("Int() accepted an invalid value")
	}

	if got, err := cfg.Bool("bool", false); err != nil || !got {
		t.Fatalf("Bool() = %v, %v; want true, nil", got, err)
	}
	if got, err := cfg.Bool("missing", true); err != nil || !got {
		t.Fatalf("Bool() missing = %v, %v; want true, nil", got, err)
	}
	if _, err := cfg.Bool("bad_bool", false); err == nil {
		t.Fatal("Bool() accepted an invalid value")
	}

	if got, err := cfg.Duration("duration", time.Second); err != nil || got != 1500*time.Millisecond {
		t.Fatalf("Duration() = %v, %v; want 1.5s, nil", got, err)
	}
	if got, err := cfg.Duration("missing", time.Second); err != nil || got != time.Second {
		t.Fatalf("Duration() missing = %v, %v; want 1s, nil", got, err)
	}
	if _, err := cfg.Duration("bad_dur", time.Second); err == nil {
		t.Fatal("Duration() accepted an invalid value")
	}
}

func TestRegisterAndDrivers(t *testing.T) {
	isolateDriverRegistry(t)

	Register("zeta", testDriver{name: "zeta", open: successfulOpen})
	Register("alpha", testDriver{name: "alpha", open: successfulOpen})
	if got, want := Drivers(), []string{"alpha", "zeta"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Drivers() = %v, want %v", got, want)
	}

	assertPanic(t, "nil driver", func() { Register("nil", nil) })
	assertPanic(t, "duplicate driver", func() {
		Register("alpha", testDriver{name: "other", open: successfulOpen})
	})
}

func TestOpen(t *testing.T) {
	isolateDriverRegistry(t)

	wantBackend := &testBackend{}
	contextKey := testContextKey{}
	ctx := context.WithValue(context.Background(), contextKey, "present")
	var captured Config
	Register("capture", testDriver{
		name: "capture",
		open: func(gotCtx context.Context, cfg Config) (Backend, error) {
			if gotCtx.Value(contextKey) != "present" {
				t.Fatal("Open() did not pass the caller context")
			}
			captured = cfg
			return wantBackend, nil
		},
	})

	gotBackend, err := Open(ctx, "capture", Config{DSN: "memory://"})
	if err != nil || gotBackend != wantBackend {
		t.Fatalf("Open() = %v, %v; want test backend, nil", gotBackend, err)
	}
	if captured.Clock == nil || captured.Logger == nil {
		t.Fatalf("Open() defaults missing: Clock=%v Logger=%v", captured.Clock, captured.Logger)
	}
	if captured.Clock != SystemClock || captured.Logger != slog.Default() {
		t.Fatal("Open() did not use SystemClock and slog.Default")
	}

	wantClock := fixedClock{now: time.Unix(123, 0)}
	wantLogger := slog.New(slog.NewTextHandler(io.Discard, nil))
	_, err = Open(ctx, "capture", Config{Clock: wantClock, Logger: wantLogger})
	if err != nil {
		t.Fatalf("Open() with explicit defaults returned %v", err)
	}
	if captured.Clock != wantClock || captured.Logger != wantLogger {
		t.Fatal("Open() replaced explicit Clock or Logger")
	}
}

func TestOpenErrors(t *testing.T) {
	isolateDriverRegistry(t)

	Register("known", testDriver{name: "known", open: successfulOpen})
	if _, err := Open(context.Background(), "missing", Config{}); err == nil || !strings.Contains(err.Error(), "known") {
		t.Fatalf("Open() unknown driver error = %v, want available driver list", err)
	}

	wantErr := errors.New("open failed")
	Register("broken", testDriver{
		name: "broken",
		open: func(context.Context, Config) (Backend, error) {
			return nil, wantErr
		},
	})
	if _, err := Open(context.Background(), "broken", Config{}); !errors.Is(err, wantErr) {
		t.Fatalf("Open() error = %v, want %v", err, wantErr)
	}
}

func successfulOpen(context.Context, Config) (Backend, error) {
	return &testBackend{}, nil
}

func isolateDriverRegistry(t *testing.T) {
	t.Helper()
	driversMu.Lock()
	saved := maps.Clone(drivers)
	clear(drivers)
	driversMu.Unlock()
	t.Cleanup(func() {
		driversMu.Lock()
		drivers = saved
		driversMu.Unlock()
	})
}

func assertPanic(t *testing.T, name string, fn func()) {
	t.Helper()
	defer func() {
		if recover() == nil {
			t.Errorf("%s did not panic", name)
		}
	}()
	fn()
}
