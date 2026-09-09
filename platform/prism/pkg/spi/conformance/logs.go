package conformance

import (
	"context"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

// RunLogs executes the C-LOG conformance tests.
func RunLogs(t *testing.T, f Factory, opts Options) {
	t.Helper()
	validateOptions(t, opts)

	t.Run("C-LOG-01 write and search round trip", func(t *testing.T) {
		_, store := openLogStore(t, f, opts)
		records := NewFixtures().Logs(1, 3, 1_000, time.Nanosecond)
		writeLogs(t, store, records, opts)
		got := searchLogs(t, store, fixtureLogQuery(1_000, 1_003, spi.Forward))
		if !reflect.DeepEqual(got, records) {
			t.Fatalf("Search() = %#v, want %#v", got, records)
		}
	})

	t.Run("C-LOG-02 direction controls ordering", func(t *testing.T) {
		_, store := openLogStore(t, f, opts)
		writeLogs(t, store, NewFixtures().Logs(1, 3, 1, time.Nanosecond), opts)
		forward := searchLogs(t, store, fixtureLogQuery(1, 4, spi.Forward))
		backward := searchLogs(t, store, fixtureLogQuery(1, 4, spi.Backward))
		assertLogTimestamps(t, forward, []int64{1, 2, 3})
		assertLogTimestamps(t, backward, []int64{3, 2, 1})
	})

	t.Run("C-LOG-03 declared filter pushdown is effective", func(t *testing.T) {
		cases := logFilterCases()
		for _, test := range cases {
			t.Run(test.name, func(t *testing.T) {
				backend, store := openLogStore(t, f, opts)
				if !test.supported(backend.Capabilities().Logs.Pushdown) {
					t.Skip("filter pushdown is not declared")
				}
				records, query := test.input()
				writeLogs(t, store, records, opts)
				got := searchLogs(t, store, query)
				if len(got) != 1 || got[0].Attrs["expected"] != "true" {
					t.Fatalf("Search() returned %#v; declared pushdown did not filter", got)
				}
			})
		}
	})

	t.Run("C-LOG-04 unsupported filters return a superset", func(t *testing.T) {
		cases := logFilterCases()
		for _, test := range cases {
			t.Run(test.name, func(t *testing.T) {
				backend, store := openLogStore(t, f, opts)
				if test.supported(backend.Capabilities().Logs.Pushdown) {
					t.Skip("filter pushdown is declared")
				}
				records, query := test.input()
				writeLogs(t, store, records, opts)
				got := searchLogs(t, store, query)
				if !reflect.DeepEqual(got, records) {
					t.Fatalf("Search() = %#v, want unfiltered superset %#v", got, records)
				}
			})
		}
	})

	t.Run("C-LOG-05 limit follows pushdown plan", func(t *testing.T) {
		backend, store := openLogStore(t, f, opts)
		records := []utm.LogRecord{
			newLogRecord(1, "keep first", "limit", true),
			newLogRecord(2, "drop", "limit", false),
			newLogRecord(3, "keep second", "limit", true),
		}
		writeLogs(t, store, records, opts)
		query := logQuery("limit", 1, 4)
		query.Filters = []spi.LineFilter{{Op: spi.LineContains, Value: "keep"}}
		query.Limit = 1
		plan := query.PushdownPlan(backend.Capabilities().Logs.Pushdown, backend.Capabilities().Logs.Aggregation)
		iterator, err := store.Search(context.Background(), query)
		if err != nil {
			if !plan.Limit && spi.Classify(err) == spi.ErrTooLarge {
				return
			}
			t.Fatalf("Search() error = %v", err)
		}
		got := collectLogs(t, iterator)
		if plan.Limit {
			if len(got) != 1 || got[0].Attrs["expected"] != "true" {
				t.Fatalf("Search() returned %#v, want one filtered record", got)
			}
			return
		}
		want := 3
		if backend.Capabilities().Logs.Pushdown.Substring {
			want = 2
		}
		if len(got) != want {
			t.Fatalf("Search() returned %d records, want untruncated %d", len(got), want)
		}
		for _, record := range got {
			if backend.Capabilities().Logs.Pushdown.Substring && record.Attrs["expected"] != "true" {
				t.Fatalf("Search() returned non-matching record after declared filter pushdown: %#v", record)
			}
		}
	})

	t.Run("C-LOG-06 one MiB line round trip", func(t *testing.T) {
		_, store := openLogStore(t, f, opts)
		record := newLogRecord(1, strings.Repeat("x", 1<<20), "large", true)
		if err := store.Write(context.Background(), []utm.LogRecord{record}); err != nil {
			if spi.Classify(err) == spi.ErrTooLarge {
				return
			}
			t.Fatalf("LogStore.Write() error = %v", err)
		}
		waitForVisibility(opts)
		got := searchLogs(t, store, logQuery("large", 1, 2))
		if len(got) != 1 || got[0].Body != record.Body {
			t.Fatalf("one MiB log was not preserved: count=%d", len(got))
		}
	})

	t.Run("C-LOG-07 arbitrary string bytes are preserved", func(t *testing.T) {
		_, store := openLogStore(t, f, opts)
		records := []utm.LogRecord{
			newLogRecord(1, "繁體中文🙂", "bytes", true),
			newLogRecord(2, string([]byte{'a', 0xff, 0xfe, 0, 'z'}), "bytes", true),
		}
		writeLogs(t, store, records, opts)
		got := searchLogs(t, store, logQuery("bytes", 1, 3))
		if len(got) != len(records) {
			t.Fatalf("Search() returned %d records, want %d", len(got), len(records))
		}
		for i := range records {
			if !reflect.DeepEqual([]byte(got[i].Body), []byte(records[i].Body)) {
				t.Fatalf("record %d body bytes = %v, want %v", i, []byte(got[i].Body), []byte(records[i].Body))
			}
		}
	})

	t.Run("C-LOG-08 equal timestamps preserve write order", func(t *testing.T) {
		skipDeviation(t, opts, "C-LOG-08")
		_, store := openLogStore(t, f, opts)
		records := make([]utm.LogRecord, 8)
		for i := range records {
			records[i] = newLogRecord(1, string(rune('a'+i)), "stable", true)
		}
		writeLogs(t, store, records, opts)
		for _, direction := range []spi.Direction{spi.Forward, spi.Backward} {
			got := searchLogs(t, store, func() spi.LogQuery {
				query := logQuery("stable", 1, 2)
				query.Direction = direction
				return query
			}())
			if len(got) != len(records) {
				t.Fatalf("direction %v returned %d records, want %d", direction, len(got), len(records))
			}
			for i := range records {
				if got[i].Body != records[i].Body {
					t.Fatalf("direction %v record %d body = %q, want %q", direction, i, got[i].Body, records[i].Body)
				}
			}
		}
	})

	t.Run("C-LOG-09 label values respect time range", func(t *testing.T) {
		_, store := openLogStore(t, f, opts)
		records := []utm.LogRecord{
			newLogRecord(10, "old", "labels", true),
			newLogRecord(20, "current-b", "labels", true),
			newLogRecord(21, "current-a", "labels", true),
			newLogRecord(22, "current-b-duplicate", "labels", true),
			newLogRecord(30, "new", "labels", true),
		}
		records[0].Labels = append(records[0].Labels, labels.Label{Name: "window", Value: "old"})
		records[1].Labels = append(records[1].Labels, labels.Label{Name: "window", Value: "b"})
		records[2].Labels = append(records[2].Labels, labels.Label{Name: "window", Value: "a"})
		records[3].Labels = append(records[3].Labels, labels.Label{Name: "window", Value: "b"})
		records[4].Labels = append(records[4].Labels, labels.Label{Name: "window", Value: "new"})
		writeLogs(t, store, records, opts)
		values, err := store.LabelValues(context.Background(), "window", spi.LabelQuery{
			Tenant: fixtureTenant, Matchers: []spi.Matcher{newMatcher(t, spi.MatchEqual, "case", "labels")}, Start: 20, End: 30,
		})
		if err != nil {
			t.Fatalf("LabelValues() error = %v", err)
		}
		if want := []string{"a", "b"}; !slices.Equal(values, want) {
			t.Fatalf("LabelValues() = %v, want %v", values, want)
		}
	})
}

type logFilterCase struct {
	name      string
	supported func(spi.LogPushdown) bool
	input     func() ([]utm.LogRecord, spi.LogQuery)
}

func logFilterCases() []logFilterCase {
	return []logFilterCase{
		{
			name:      "substring contains",
			supported: func(caps spi.LogPushdown) bool { return caps.Substring },
			input: func() ([]utm.LogRecord, spi.LogQuery) {
				query := logQuery("substring-contains", 1, 3)
				query.Filters = []spi.LineFilter{{Op: spi.LineContains, Value: "needle"}}
				return []utm.LogRecord{
					newLogRecord(1, "contains needle", "substring-contains", true),
					newLogRecord(2, "does not match", "substring-contains", false),
				}, query
			},
		},
		{
			name:      "substring excludes",
			supported: func(caps spi.LogPushdown) bool { return caps.Substring },
			input: func() ([]utm.LogRecord, spi.LogQuery) {
				query := logQuery("substring-excludes", 1, 3)
				query.Filters = []spi.LineFilter{{Op: spi.LineNotContains, Value: "drop"}}
				return []utm.LogRecord{
					newLogRecord(1, "keep", "substring-excludes", true),
					newLogRecord(2, "drop", "substring-excludes", false),
				}, query
			},
		},
		{
			name:      "regex matches",
			supported: func(caps spi.LogPushdown) bool { return caps.Regex },
			input: func() ([]utm.LogRecord, spi.LogQuery) {
				query := logQuery("regex-matches", 1, 3)
				query.Filters = []spi.LineFilter{{Op: spi.LineMatch, Value: `status=2..`, Compiled: regexp.MustCompile(`status=2..`)}}
				return []utm.LogRecord{
					newLogRecord(1, "status=200", "regex-matches", true),
					newLogRecord(2, "status=500", "regex-matches", false),
				}, query
			},
		},
		{
			name:      "regex excludes",
			supported: func(caps spi.LogPushdown) bool { return caps.Regex },
			input: func() ([]utm.LogRecord, spi.LogQuery) {
				query := logQuery("regex-excludes", 1, 3)
				query.Filters = []spi.LineFilter{{Op: spi.LineNotMatch, Value: `status=5..`, Compiled: regexp.MustCompile(`status=5..`)}}
				return []utm.LogRecord{
					newLogRecord(1, "status=200", "regex-excludes", true),
					newLogRecord(2, "status=500", "regex-excludes", false),
				}, query
			},
		},
		{
			name:      "json field",
			supported: func(caps spi.LogPushdown) bool { return caps.ParsedFieldJSON },
			input: func() ([]utm.LogRecord, spi.LogQuery) {
				query := logQuery("json", 1, 3)
				query.Stages = []spi.ParseStage{{Kind: spi.ParseJSON}}
				query.Fields = []spi.FieldFilter{{Field: "level", Op: spi.CmpEq, Value: "keep"}}
				return []utm.LogRecord{
					newLogRecord(1, `{"level":"keep"}`, "json", true),
					newLogRecord(2, `{"level":"drop"}`, "json", false),
				}, query
			},
		},
		{
			name:      "logfmt field",
			supported: func(caps spi.LogPushdown) bool { return caps.ParsedFieldLogfmt },
			input: func() ([]utm.LogRecord, spi.LogQuery) {
				query := logQuery("logfmt", 1, 3)
				query.Stages = []spi.ParseStage{{Kind: spi.ParseLogfmt}}
				query.Fields = []spi.FieldFilter{{Field: "level", Op: spi.CmpEq, Value: "keep"}}
				return []utm.LogRecord{
					newLogRecord(1, "level=keep", "logfmt", true),
					newLogRecord(2, "level=drop", "logfmt", false),
				}, query
			},
		},
	}
}

func openLogStore(t *testing.T, factory Factory, opts Options) (spi.Backend, spi.LogStore) {
	t.Helper()
	backend := openBackend(t, factory)
	requireSignal(t, backend, opts, spi.SignalLogs)
	store := backend.Logs()
	if store == nil {
		t.Fatal("logs signal declared with nil LogStore")
	}
	return backend, store
}

func writeLogs(t *testing.T, store spi.LogStore, records []utm.LogRecord, opts Options) {
	t.Helper()
	if err := store.Write(context.Background(), records); err != nil {
		t.Fatalf("LogStore.Write() error = %v", err)
	}
	waitForVisibility(opts)
}

func searchLogs(t *testing.T, store spi.LogStore, query spi.LogQuery) []utm.LogRecord {
	t.Helper()
	iterator, err := store.Search(context.Background(), query)
	if err != nil {
		t.Fatalf("LogStore.Search() error = %v", err)
	}
	return collectLogs(t, iterator)
}

func collectLogs(t *testing.T, iterator spi.LogIterator) []utm.LogRecord {
	t.Helper()
	if iterator == nil {
		t.Fatal("LogStore.Search() returned a nil LogIterator")
	}
	defer func() {
		if err := iterator.Close(); err != nil {
			t.Errorf("LogIterator.Close() error = %v", err)
		}
	}()
	var records []utm.LogRecord
	for iterator.Next() {
		records = append(records, iterator.At())
	}
	if err := iterator.Err(); err != nil {
		t.Fatalf("LogIterator.Err() = %v", err)
	}
	return records
}

func fixtureLogQuery(start, end int64, direction spi.Direction) spi.LogQuery {
	matcher, err := spi.NewMatcher(spi.MatchEqual, "job", "fixture")
	if err != nil {
		panic(err)
	}
	return spi.LogQuery{
		Tenant: fixtureTenant, Selectors: []spi.Matcher{matcher}, Start: start, End: end, Direction: direction,
	}
}

func logQuery(caseName string, start, end int64) spi.LogQuery {
	matcher, err := spi.NewMatcher(spi.MatchEqual, "case", caseName)
	if err != nil {
		panic(err)
	}
	return spi.LogQuery{
		Tenant: fixtureTenant, Selectors: []spi.Matcher{matcher}, Start: start, End: end, Direction: spi.Forward,
	}
}

func newLogRecord(ts int64, body, caseName string, expected bool) utm.LogRecord {
	return utm.LogRecord{
		Resource: &utm.Resource{Tenant: fixtureTenant, Service: "log-service"},
		TS:       ts,
		Severity: utm.SevInfo,
		Body:     body,
		Labels:   labels.FromStrings("case", caseName),
		Attrs:    map[string]string{"expected": boolString(expected)},
	}
}

func boolString(value bool) string {
	if value {
		return "true"
	}
	return "false"
}

func assertLogTimestamps(t *testing.T, records []utm.LogRecord, want []int64) {
	t.Helper()
	got := make([]int64, len(records))
	for i, record := range records {
		got[i] = record.TS
	}
	if !slices.Equal(got, want) {
		t.Fatalf("log timestamps = %v, want %v", got, want)
	}
}
