package normalize

import (
	"math"
	"testing"

	"go.opentelemetry.io/collector/pdata/pcommon"
)

func TestOTelTimestampNanoSaturatesOverflow(t *testing.T) {
	t.Parallel()

	if got := otelTimestampNano(pcommon.Timestamp(math.MaxUint64)); got != math.MaxInt64 {
		t.Fatalf("otelTimestampNano(MaxUint64) = %d, want %d", got, math.MaxInt64)
	}
}
