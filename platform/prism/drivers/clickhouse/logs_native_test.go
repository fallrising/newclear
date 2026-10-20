package clickhouse

import (
	"strings"
	"testing"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

func TestLogStore_AC44_ImplementsNativeLogQuerier(t *testing.T) {
	var store spi.LogStore = &logStore{}
	if _, ok := store.(spi.NativeLogQuerier); !ok {
		t.Fatal("log store does not implement NativeLogQuerier")
	}
}

func TestCapabilities_AC57_AC61_DeclaredLogPushdown(t *testing.T) {
	caps := (&backend{}).Capabilities()
	if !caps.Logs.NativeLogQuery || !caps.Logs.Aggregation {
		t.Fatalf("logs caps = %+v", caps.Logs)
	}
	push := caps.Logs.Pushdown
	if !push.Substring || !push.Regex || !push.ParsedFieldJSON || !push.Sort {
		t.Fatalf("pushdown = %+v", push)
	}
	if push.ParsedFieldLogfmt || push.Limit || caps.Logs.LiveTail || caps.Logs.Stats {
		t.Fatalf("unexpected log capability %+v", caps.Logs)
	}
	if caps.Retention.Enforced || caps.Metrics.NativePromQL || caps.Traces.Dependencies || caps.Traces.RED {
		t.Fatalf("unrelated caps changed: %+v", caps)
	}
	if err := caps.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestSearchNative_AC45_AC56_LogfmtUnsupportedWithoutClickHouse(t *testing.T) {
	_, err := (&logStore{}).SearchNative(t.Context(), spi.LogQuery{
		Stages: []spi.ParseStage{{Kind: spi.ParseLogfmt}},
		Fields: []spi.FieldFilter{{Field: "level", Op: spi.CmpEq, Value: "keep"}},
	})
	if spi.Classify(err) != spi.ErrUnsupported {
		t.Fatalf("SearchNative() error = %v", err)
	}
}

func TestSearchNative_AC49_NonEqualityJSONUnsupported(t *testing.T) {
	for _, op := range []spi.CompareOp{spi.CmpNe, spi.CmpRe, spi.CmpNotRe, spi.CmpGt, spi.CmpGte, spi.CmpLt, spi.CmpLte} {
		_, err := (&logStore{}).SearchNative(t.Context(), spi.LogQuery{
			Stages: []spi.ParseStage{{Kind: spi.ParseJSON}},
			Fields: []spi.FieldFilter{{Field: "status", Op: op, Value: "500"}},
		})
		if spi.Classify(err) != spi.ErrUnsupported {
			t.Fatalf("op %d error = %v", op, err)
		}
	}
}

func TestSearchNative_AC53_AC62_AggregationUnsupported(t *testing.T) {
	base := spi.LogAggregation{RangeFunc: "count_over_time", Window: 2 * time.Second, Step: 3 * time.Second}
	cases := []spi.LogAggregation{
		base,
		{RangeFunc: "count_over_time", Window: time.Second, Step: 0},
		{RangeFunc: "count_over_time", Window: 500 * time.Microsecond, Step: 500 * time.Microsecond},
		{RangeFunc: "bytes_rate", Window: time.Second, Step: time.Second},
		{RangeFunc: "count_over_time", Window: time.Second, Step: time.Second, VectorOp: "sum"},
		{RangeFunc: "count_over_time", Window: time.Second, Step: time.Second, VectorOp: "avg"},
		{RangeFunc: "count_over_time", Window: time.Second, Step: time.Second, VectorOp: "min"},
		{RangeFunc: "count_over_time", Window: time.Second, Step: time.Second, VectorOp: "max"},
		{RangeFunc: "count_over_time", Window: time.Second, Step: time.Second, VectorOp: "count"},
		{RangeFunc: "count_over_time", Window: time.Second, Step: time.Second, VectorOp: "topk", K: 1},
		{RangeFunc: "count_over_time", Window: time.Second, Step: time.Second, VectorOp: "bottomk", K: 1},
	}
	for _, agg := range cases {
		_, err := (&logStore{}).SearchNative(t.Context(), spi.LogQuery{Agg: &agg})
		if spi.Classify(err) != spi.ErrUnsupported {
			t.Fatalf("agg %+v error = %v", agg, err)
		}
	}
}

func TestNativeLogSQL_AC51_OrdersByWriteSeq(t *testing.T) {
	forward, _, err := nativeLogSQL(spi.LogQuery{Tenant: "ac", Direction: spi.Forward, Start: 1, End: 2}, options{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(forward, "ORDER BY ts ASC, write_seq ASC") || strings.Contains(forward, "_part_offset") {
		t.Fatalf("forward SQL = %s", forward)
	}
	backward, _, err := nativeLogSQL(spi.LogQuery{Tenant: "ac", Direction: spi.Backward, Start: 1, End: 2}, options{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(backward, "ORDER BY ts DESC, write_seq ASC") || strings.Contains(backward, "_part_offset") {
		t.Fatalf("backward SQL = %s", backward)
	}
}

func TestNativeLogSQL_AC48_SeparatedHintUsesPosition(t *testing.T) {
	query := spi.LogQuery{
		Tenant: "ac", Direction: spi.Forward, Start: 1, End: 2,
		Filters: []spi.LineFilter{{Op: spi.LineMatch, Value: "hello token", LiteralHint: "hello token"}},
	}
	sql, _, err := nativeLogSQL(query, options{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "position(body, ?)") || !strings.Contains(sql, "match(body, ?)") || strings.Contains(sql, "hasToken") {
		t.Fatalf("SQL = %s", sql)
	}
	query.Filters[0].LiteralHint = "hellotoken"
	sql, _, err = nativeLogSQL(query, options{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "hasToken(body, ?)") || !strings.Contains(sql, "match(body, ?)") {
		t.Fatalf("token SQL = %s", sql)
	}
	query.Filters = []spi.LineFilter{{Op: spi.LineNotMatch, Value: "^hello$", LiteralHint: "hello"}}
	sql, _, err = nativeLogSQL(query, options{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "NOT match(body, ?)") || strings.Contains(sql, "hasToken") {
		t.Fatalf("negative SQL = %s", sql)
	}
}

func TestNativeLogSQL_AC55_FixedReadSettings(t *testing.T) {
	sql, _, err := nativeLogSQL(spi.LogQuery{Tenant: "ac", Direction: spi.Forward, Start: 1, End: 2}, options{})
	if err != nil {
		t.Fatal(err)
	}
	for _, setting := range []string{
		"max_execution_time = 55",
		"max_memory_usage = 1000000000",
		"max_rows_to_read = 5000000",
		"max_result_rows = 5000000",
		"max_result_bytes = 67108864",
	} {
		if !strings.Contains(sql, setting) {
			t.Fatalf("SQL missing %s: %s", setting, sql)
		}
	}
	if strings.Contains(sql, "max_bytes_to_read") {
		t.Fatalf("SQL sets a byte read cap: %s", sql)
	}
}

func TestNativeMatrix_AC52_EmptyWindowEmitsZero(t *testing.T) {
	start := int64(1_757_030_400) * int64(time.Second)
	record := utm.LogRecord{
		TS:     start + int64(500*time.Millisecond),
		Body:   "late",
		Labels: labels.FromStrings("host", "h1"),
	}
	for _, fn := range []string{"count_over_time", "rate", "bytes_over_time"} {
		query := spi.LogQuery{Agg: &spi.LogAggregation{RangeFunc: fn, Window: time.Second, Step: time.Second}}
		matrix := nativeMatrix(query, []utm.LogRecord{record}, start, start+int64(time.Second))
		if len(matrix) != 1 || matrix[0].Labels.Get("host") != "h1" || len(matrix[0].Samples) != 1 {
			t.Fatalf("%s matrix = %#v", fn, matrix)
		}
		sample := matrix[0].Samples[0]
		if sample.TS != 1_757_030_400_000 || sample.Value != 0 {
			t.Fatalf("%s sample = %#v", fn, sample)
		}
	}
	absent := spi.LogQuery{Agg: &spi.LogAggregation{RangeFunc: "count_over_time", Window: time.Second, Step: time.Second}}
	if matrix := nativeMatrix(absent, nil, start, start+int64(time.Second)); len(matrix) != 0 {
		t.Fatalf("no input records produced %#v", matrix)
	}
}

func TestSearchNative_AC54_ErrorText(t *testing.T) {
	for _, code := range []int32{158, 307, 241} {
		server := classifiedError("logs.search_native", &clickhouse.Exception{Code: code, Message: "password=private"})
		if spi.Classify(server) != spi.ErrTooLarge || !strings.Contains(server.Error(), "storage operation failed") || strings.Contains(server.Error(), "private") {
			t.Fatalf("code %d error = %v", code, server)
		}
	}
	timeout := classifiedError("logs.search_native", &clickhouse.Exception{Code: 159, Message: "password=private"})
	if spi.Classify(timeout) != spi.ErrTimeout || strings.Contains(timeout.Error(), "private") {
		t.Fatalf("timeout error = %v", timeout)
	}
	syntax := classifiedError("logs.search_native", &clickhouse.Exception{Code: 62, Message: "password=private"})
	if spi.Classify(syntax) != spi.ErrInternal || strings.Contains(syntax.Error(), "private") {
		t.Fatalf("syntax error = %v", syntax)
	}
	local := tooLarge("logs.search_native")
	if spi.Classify(local) != spi.ErrTooLarge || !strings.Contains(local.Error(), "query result exceeds limit") {
		t.Fatalf("local error = %v", local)
	}
}
