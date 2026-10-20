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

func TestNativeLogSQL_AC56_AC70_JSONEqHasNoFinalExtractOrLimit(t *testing.T) {
	query := spi.LogQuery{
		Tenant: "ac", Direction: spi.Forward, Start: 1, End: 2, Limit: 1,
		Stages: []spi.ParseStage{{Kind: spi.ParseJSON}},
		Fields: []spi.FieldFilter{{Field: "a_b", Op: spi.CmpEq, Value: "v"}},
	}
	sql, _, err := nativeLogSQL(query, options{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sql, "JSONExtractString") || strings.Contains(sql, " LIMIT ") {
		t.Fatalf("SQL finalizes JSON or limits before the fine filter: %s", sql)
	}
	plain := spi.LogQuery{Tenant: "ac", Direction: spi.Forward, Start: 1, End: 2, Limit: 1}
	sql, _, err = nativeLogSQL(plain, options{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, " LIMIT ?") {
		t.Fatalf("non-JSON SQL = %s", sql)
	}
}

func TestJSONEqMatch_AC49_AC65_AC71(t *testing.T) {
	eq := func(field, value string) []spi.FieldFilter {
		return []spi.FieldFilter{{Field: field, Op: spi.CmpEq, Value: value}}
	}
	host := labels.FromStrings("host", "h1")
	if !jsonEqMatch(host, `{"status":"500"}`, eq("status", "500")) || jsonEqMatch(host, `{"status":"200"}`, eq("status", "500")) {
		t.Fatal("AC-49 status equality")
	}
	if jsonEqMatch(host, `{"other":"1"}`, eq("status", "500")) || jsonEqMatch(host, `{"a":{"c":"v"}}`, eq("a_b", "v")) {
		t.Fatal("AC-49 missing field must drop the row")
	}
	if !jsonEqMatch(host, `{"a":{"b":"v"}}`, eq("a_b", "v")) || jsonEqMatch(host, `{"a":{"b":"no"}}`, eq("a_b", "v")) || !jsonEqMatch(host, `{"a_b":"v"}`, eq("a_b", "v")) {
		t.Fatal("AC-65 nested flatten")
	}
	if !jsonEqMatch(host, `{"a.b":"v"}`, eq("a_b", "v")) || !jsonEqMatch(host, `{"a-b":"v"}`, eq("a_b", "v")) || jsonEqMatch(host, `{"a.b":"no"}`, eq("a_b", "v")) {
		t.Fatal("AC-66 sanitized key")
	}
	if !jsonEqMatch(host, `{"1x":"v"}`, eq("_1x", "v")) || jsonEqMatch(host, `{"1x":"v"}`, eq("1x", "v")) {
		t.Fatal("AC-66 leading digit")
	}
	deep := `{"a":{"b":{"c":{"d":{"e":{"f":{"g":1}}}}}}}`
	if !jsonEqMatch(host, deep, eq("a_b_c_d_e_f", `{"g":1}`)) || jsonEqMatch(host, deep, eq("a_b_c_d_e_f_g", "1")) {
		t.Fatal("AC-67 depth")
	}
	if !jsonEqMatch(host, `{"n":1e-7}`, eq("n", "0.0000001")) || jsonEqMatch(host, `{"n":1e-7}`, eq("n", "1e-7")) {
		t.Fatal("AC-68 1e-7")
	}
	if !jsonEqMatch(host, `{"n":1e21}`, eq("n", "1000000000000000000000")) || jsonEqMatch(host, `{"n":1e21}`, eq("n", "1e21")) {
		t.Fatal("AC-68 1e21")
	}
	if !jsonEqMatch(host, `{"n":9007199254740993}`, eq("n", "9007199254740992")) || jsonEqMatch(host, `{"n":9007199254740993}`, eq("n", "9007199254740993")) {
		t.Fatal("AC-68 integer precision")
	}
	if !jsonEqMatch(host, `{"n":-0}`, eq("n", "-0")) || jsonEqMatch(host, `{"n":-0}`, eq("n", "0")) {
		t.Fatal("AC-68 negative zero")
	}
	web := labels.FromStrings("app", "web")
	if !jsonEqMatch(web, `{"app":"parsed"}`, eq("app_extracted", "parsed")) || jsonEqMatch(web, `{"app":"parsed"}`, eq("app", "parsed")) {
		t.Fatal("AC-69 extracted rename")
	}
	taken := labels.FromStrings("app", "web", "app_extracted", "kept")
	if jsonEqMatch(taken, `{"app":"x"}`, eq("app_extracted", "x")) {
		t.Fatal("AC-69 occupied extracted name")
	}
	// The executor stores labels with prometheus labels.Builder.Set, which deletes
	// a value of "". {"k":""} therefore never creates label k, and k="" keeps none
	// of these rows. That is the Search+executor result.
	for _, body := range []string{`{"other":"1"}`, `{"k":null}`, `{"k":{"a":1}}`, `{"k":[1]}`, `{"k":""}`} {
		if jsonEqMatch(host, body, eq("k", "")) {
			t.Fatalf("AC-71 kept %s", body)
		}
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
