package conformance_test

import (
	"context"
	"testing"

	_ "github.com/fallrising/newclear/platform/prism/drivers/memory"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/spi/conformance"
)

func TestMemoryDriver(t *testing.T) {
	conformance.Run(t, func(t *testing.T) (spi.Backend, func()) {
		t.Helper()
		backend, err := spi.Open(context.Background(), "memory", spi.Config{})
		if err != nil {
			t.Fatalf("spi.Open(memory) error = %v", err)
		}
		return backend, func() { _ = backend.Close() }
	}, conformance.Options{})
}
