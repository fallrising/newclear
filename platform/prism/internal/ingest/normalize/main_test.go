package normalize

import (
	"context"
	"os"
	"testing"
	"time"

	"go.uber.org/goleak"
)

var fixedNow = time.Date(2025, time.January, 2, 3, 4, 5, 0, time.UTC)

func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m)
}

func testNormalizer(t *testing.T, options Options) *Normalizer {
	t.Helper()
	if options.Now == nil {
		options.Now = func() time.Time { return fixedNow }
	}
	normalizer := New(context.Background(), options)
	t.Cleanup(normalizer.Close)
	return normalizer
}

func fixturePath(name string) string {
	return "../../../test/fixtures/otlp/" + name
}

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(fixturePath(name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return data
}
