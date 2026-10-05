package clickhouse

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

func TestClassifiedErrorRedactsServerText(t *testing.T) {
	tests := []struct {
		code  int32
		class spi.ErrClass
	}{{210, spi.ErrUnavailable}, {159, spi.ErrTimeout}, {241, spi.ErrTooLarge}, {202, spi.ErrThrottled}, {62, spi.ErrInternal}}
	for _, tt := range tests {
		err := classifiedError("Write", &clickhouse.Exception{Code: tt.code, Message: "password=private"})
		if spi.Classify(err) != tt.class {
			t.Fatalf("code=%d class=%s", tt.code, spi.Classify(err))
		}
		if strings.Contains(err.Error(), "private") {
			t.Fatal("server text leaked")
		}
	}
	err := classifiedError("Write", errors.Join(errors.New("private"), context.Canceled))
	if !errors.Is(err, context.Canceled) || strings.Contains(err.Error(), "private") {
		t.Fatalf("cancellation lost or leaked: %v", err)
	}
	if !errors.Is(classifiedError("Migrate", errDrift), errDrift) {
		t.Fatal("drift identity lost")
	}
}
