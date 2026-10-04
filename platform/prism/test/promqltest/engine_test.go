package promqltest

import (
	"context"
	"fmt"
	"io/fs"
	"testing"

	_ "github.com/fallrising/newclear/platform/prism/drivers/memory"
	"github.com/fallrising/newclear/platform/prism/internal/query/promqladapter"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/histogram"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/promql/parser"
	"github.com/prometheus/prometheus/storage"
	"go.uber.org/goleak"
)

const (
	corpusTenant         = "official-corpus"
	fixtureMaxRows       = 1_000_000
	fixtureMaxLabelBytes = 1 << 20
)

func TestMain(main *testing.M) { goleak.VerifyTestMain(main) }

// fixtureStorage is an upstream-fixture loader, not a substitute query engine.
// Every query delegates through the production adapter into the memory SPI.
type fixtureStorage struct {
	backend   spi.Backend
	queryable storage.Queryable
	selects   int
	writes    int
	rows      int
}

func newFixtureStorage(t *testing.T) *fixtureStorage {
	t.Helper()
	backend, err := spi.Open(t.Context(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	fixture := &fixtureStorage{backend: backend}
	fixture.queryable = promqladapter.New(&countingStore{MetricStore: backend.Metrics(), fixture: fixture}, corpusTenant, promqladapter.Limits{})
	return fixture
}

func (s *fixtureStorage) Querier(start, end int64) (storage.Querier, error) {
	return s.queryable.Querier(start, end)
}
func (s *fixtureStorage) Close() error { return s.backend.Close() }
func (s *fixtureStorage) Appender(ctx context.Context) *fixtureAppender {
	return &fixtureAppender{ctx: ctx, fixture: s}
}

type countingStore struct {
	spi.MetricStore
	fixture *fixtureStorage
}

func (s *countingStore) Select(ctx context.Context, query spi.SeriesQuery) (spi.SeriesSet, error) {
	s.fixture.selects++
	return s.MetricStore.Select(ctx, query)
}

type fixtureAppender struct {
	ctx     context.Context
	fixture *fixtureStorage
	points  []utm.MetricPoint
}

func (a *fixtureAppender) Append(_ storage.SeriesRef, metric labels.Labels, ts int64, value float64) (storage.SeriesRef, error) {
	if err := a.ctx.Err(); err != nil {
		return 0, err
	}
	if a.fixture.rows+len(a.points) >= fixtureMaxRows {
		return 0, fmt.Errorf("fixture rows exceed %d", fixtureMaxRows)
	}
	size := 0
	metric.Range(func(label labels.Label) { size += len(label.Name) + len(label.Value) })
	if size > fixtureMaxLabelBytes {
		return 0, fmt.Errorf("fixture label bytes exceed %d", fixtureMaxLabelBytes)
	}
	builder := labels.NewBuilder(metric)
	builder.Set(utm.LabelTenant, corpusTenant)
	a.points = append(a.points, utm.MetricPoint{Name: metric.Get(utm.LabelName), Labels: builder.Labels(), TS: ts, Value: value})
	return 0, nil
}
func (*fixtureAppender) AppendHistogram(storage.SeriesRef, labels.Labels, int64, *histogram.Histogram, *histogram.FloatHistogram) (storage.SeriesRef, error) {
	return 0, fmt.Errorf("native histogram fixture is outside float-only SPI")
}
func (a *fixtureAppender) Rollback() error { a.points = nil; return nil }
func (a *fixtureAppender) Commit() error {
	if err := a.ctx.Err(); err != nil {
		return err
	}
	if len(a.points) == 0 {
		return nil
	}
	if err := a.fixture.backend.Metrics().Write(a.ctx, a.points); err != nil {
		return err
	}
	a.fixture.writes++
	a.fixture.rows += len(a.points)
	a.points = nil
	return nil
}

func TestOfficialFloatCorpus(t *testing.T) {
	if *corpusDriver != "memory" {
		t.Fatalf("unsupported corpus driver %q; only memory is implemented", *corpusDriver)
	}
	previous := parser.EnableExperimentalFunctions
	parser.EnableExperimentalFunctions = true
	t.Cleanup(func() { parser.EnableExperimentalFunctions = previous })
	files, err := fs.Glob(corpus, "testdata/upstream/*.test")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range files {
		t.Run(name, func(t *testing.T) {
			data, err := corpus.ReadFile(name)
			if err != nil {
				t.Fatal(err)
			}
			audit, err := auditCorpus(string(data))
			if err != nil {
				t.Fatal(err)
			}
			supported := 0
			for _, entry := range audit.Cases {
				if entry.Reason == "" {
					supported++
				}
			}
			engine := NewTestEngine(false, 0, DefaultMaxSamplesPerQuery)
			if err := runTest(t, audit.Input, engine); err != nil {
				t.Fatal(err)
			}
			t.Logf("original_eval=%d float_eval=%d excluded_native=%d", len(audit.Cases), supported, len(audit.Cases)-supported)
		})
	}
}
