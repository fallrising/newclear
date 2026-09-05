// Package spi defines Prism's storage driver interfaces.
package spi

import (
	"context"
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// Driver opens a named storage backend.
type Driver interface {
	Name() string
	Open(ctx context.Context, cfg Config) (Backend, error)
}

// Config contains the common configuration passed to a storage driver.
type Config struct {
	DSN        string
	Options    map[string]string
	Logger     *slog.Logger
	Registerer prometheus.Registerer
	Clock      Clock
}

// String returns a string option or def when key is absent.
func (c Config) String(key, def string) string {
	value, ok := c.Options[key]
	if !ok {
		return def
	}
	return value
}

// Int returns an integer option or def when key is absent.
func (c Config) Int(key string, def int) (int, error) {
	value, ok := c.Options[key]
	if !ok {
		return def, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("spi: option %q must be an integer: %w", key, err)
	}
	return parsed, nil
}

// Bool returns a boolean option or def when key is absent.
func (c Config) Bool(key string, def bool) (bool, error) {
	value, ok := c.Options[key]
	if !ok {
		return def, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("spi: option %q must be a boolean: %w", key, err)
	}
	return parsed, nil
}

// Duration returns a duration option or def when key is absent.
func (c Config) Duration(key string, def time.Duration) (time.Duration, error) {
	value, ok := c.Options[key]
	if !ok {
		return def, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("spi: option %q must be a duration: %w", key, err)
	}
	return parsed, nil
}

// Clock provides the current time and can be replaced in tests.
type Clock interface {
	Now() time.Time
}

type systemClock struct{}

func (systemClock) Now() time.Time { return time.Now() }

// SystemClock is the default wall clock passed to drivers.
var SystemClock Clock = systemClock{}

// Backend exposes the signal stores supported by a storage driver.
type Backend interface {
	Capabilities() Capabilities
	Metrics() MetricStore
	Logs() LogStore
	Traces() TraceStore
	Migrate(ctx context.Context) error
	Ping(ctx context.Context) error
	Close() error
}

var (
	driversMu sync.RWMutex
	drivers   = map[string]Driver{}
)

// Register registers a driver. A nil driver or duplicate name causes a panic.
func Register(name string, d Driver) {
	driversMu.Lock()
	defer driversMu.Unlock()
	if d == nil {
		panic("spi: Register driver is nil")
	}
	if _, duplicate := drivers[name]; duplicate {
		panic("spi: Register called twice for driver " + name)
	}
	drivers[name] = d
}

// Drivers returns the registered driver names in sorted order.
func Drivers() []string {
	driversMu.RLock()
	defer driversMu.RUnlock()
	return slices.Sorted(maps.Keys(drivers))
}

// Open opens the named driver and supplies default clock and logger values.
func Open(ctx context.Context, name string, cfg Config) (Backend, error) {
	driversMu.RLock()
	driver, ok := drivers[name]
	driversMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("spi: unknown driver %q (available: %v)", name, Drivers())
	}
	if cfg.Clock == nil {
		cfg.Clock = SystemClock
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	return driver.Open(ctx, cfg)
}
