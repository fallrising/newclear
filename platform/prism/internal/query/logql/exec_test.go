package logql

import (
	"context"
	"maps"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/prometheus/model/labels"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

type observeIter struct {
	recs   []utm.LogRecord
	idx    int
	reads  int
	closed bool
}

func (o *observeIter) Next() bool {
	if o.closed || o.idx >= len(o.recs) {
		return false
	}
	o.idx++
	o.reads++
	return true
}

func (o *observeIter) At() utm.LogRecord { return o.recs[o.idx-1] }

func (o *observeIter) Err() error { return nil }

func (o *observeIter) Close() error {
	o.closed = true
	return nil
}

type genIter struct {
	n      int
	idx    int
	reads  int
	closed bool
}

func (g *genIter) Next() bool {
	if g.closed || g.idx >= g.n {
		return false
	}
	g.idx++
	g.reads++
	return true
}

func (g *genIter) At() utm.LogRecord {
	return utm.LogRecord{TS: int64(g.idx), Body: "x"}
}

func (g *genIter) Err() error { return nil }

func (g *genIter) Close() error {
	g.closed = true
	return nil
}

func mustExec(t *testing.T, it spi.LogIterator, q spi.LogQuery, plan spi.PushdownPlan) spi.LogResult {
	t.Helper()
	got, err := Execute(t.Context(), it, q, plan)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	return got
}

func entriesOf(t *testing.T, res spi.LogResult) []utm.LogRecord {
	t.Helper()
	if len(res.Matrix) != 0 {
		t.Fatalf("matrix %#v", res.Matrix)
	}
	var out []utm.LogRecord
	for _, stream := range res.Streams {
		out = append(out, stream.Entries...)
	}
	return out
}

func soleEntry(t *testing.T, res spi.LogResult) utm.LogRecord {
	t.Helper()
	rows := entriesOf(t, res)
	if len(res.Streams) != 1 || len(rows) != 1 {
		t.Fatalf("streams %#v", res.Streams)
	}
	return rows[0]
}

func assertEmpty(t *testing.T, res spi.LogResult) {
	t.Helper()
	if len(res.Streams) != 0 || len(res.Matrix) != 0 {
		t.Fatalf("want empty, got streams=%d matrix=%d", len(res.Streams), len(res.Matrix))
	}
}

func assertEntry(t *testing.T, got utm.LogRecord, ts int64, body string, ls labels.Labels, attrs map[string]string) {
	t.Helper()
	if got.TS != ts || got.Body != body || !labels.Equal(got.Labels, ls) || !maps.Equal(got.Attrs, attrs) {
		t.Fatalf("got ts=%d body=%q labels=%s attrs=%v\nwant ts=%d body=%q labels=%s attrs=%v",
			got.TS, got.Body, got.Labels, got.Attrs, ts, body, ls, attrs)
	}
}

func assertMatrix(t *testing.T, got, want []spi.SeriesData) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("series %d, want %d\n%#v", len(got), len(want), got)
	}
	for i := range want {
		if !labels.Equal(got[i].Labels, want[i].Labels) {
			t.Fatalf("series %d labels %s, want %s", i, got[i].Labels, want[i].Labels)
		}
		gotSamples := got[i].Samples
		wantSamples := want[i].Samples
		if len(gotSamples) != len(wantSamples) {
			t.Fatalf("series %d samples %#v, want %#v", i, gotSamples, wantSamples)
		}
		for j, wantSample := range wantSamples {
			gotSample := gotSamples[j]
			if gotSample.TS != wantSample.TS || gotSample.Value != wantSample.Value {
				t.Fatalf("series %d sample %d got (%d,%v) want (%d,%v)", i, j,
					gotSample.TS, gotSample.Value, wantSample.TS, wantSample.Value)
			}
		}
	}
}

func logPlan(stages, fields, agg, limit bool) spi.PushdownPlan {
	return spi.PushdownPlan{
		Selectors: true,
		TimeRange: true,
		Stages:    stages,
		Fields:    fields,
		Agg:       agg,
		Limit:     limit,
	}
}

func TestExecute_AC1_JSONScalarsSkipArraysNull(t *testing.T) {
	q := spi.LogQuery{
		Direction: spi.Forward,
		Stages:    []spi.ParseStage{{Kind: spi.ParseJSON}},
	}
	body := `{"status":401,"ok":true,"n":null,"servers":[{"b":1}]}`
	got := soleEntry(t, mustExec(t, &observeIter{recs: []utm.LogRecord{{Body: body}}}, q, logPlan(false, true, true, true)))
	assertEntry(t, got, 0, body, labels.FromStrings("ok", "true", "status", "401"), nil)
}

func TestExecute_AC2_JSONDepth(t *testing.T) {
	q := spi.LogQuery{
		Direction: spi.Forward,
		Stages:    []spi.ParseStage{{Kind: spi.ParseJSON}},
	}
	body := `{"a":{"b":{"c":{"d":{"e":{"f":{"g":1}}}}}}}`
	got := soleEntry(t, mustExec(t, &observeIter{recs: []utm.LogRecord{{Body: body}}}, q, logPlan(false, true, true, true)))
	assertEntry(t, got, 0, body, labels.FromStrings("a_b_c_d_e_f", `{"g":1}`), nil)
}

func TestExecute_AC3_JSONParserErr(t *testing.T) {
	q := spi.LogQuery{
		Direction: spi.Forward,
		Stages:    []spi.ParseStage{{Kind: spi.ParseJSON}},
	}
	got := soleEntry(t, mustExec(t, &observeIter{recs: []utm.LogRecord{{Body: "not-json"}}}, q, logPlan(false, true, true, true)))
	assertEntry(t, got, 0, "not-json", labels.FromStrings("__error__", "JSONParserErr"), nil)
}

func TestExecute_AC4_JSONThenLogfmt(t *testing.T) {
	body := `{"a":"1"}`
	q := spi.LogQuery{
		Direction: spi.Forward,
		Stages:    []spi.ParseStage{{Kind: spi.ParseJSON}, {Kind: spi.ParseLogfmt}},
	}
	got := soleEntry(t, mustExec(t, &observeIter{recs: []utm.LogRecord{{Body: body}}}, q, logPlan(false, true, true, true)))
	assertEntry(t, got, 0, body, labels.FromStrings("__error__", "LogfmtParserErr", "a", "1"), nil)
}

func TestExecute_AC5_MissingLabelMatchers(t *testing.T) {
	cases := []struct {
		name string
		op   spi.CompareOp
		keep bool
	}{
		{name: "eq", op: spi.CmpEq, keep: false},
		{name: "ne", op: spi.CmpNe, keep: true},
		{name: "re", op: spi.CmpRe, keep: false},
		{name: "nre", op: spi.CmpNotRe, keep: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q := spi.LogQuery{
				Direction: spi.Forward,
				Fields: []spi.FieldFilter{{
					Field:    "status",
					Op:       tc.op,
					Value:    "401",
					Compiled: regexp.MustCompile("401"),
				}},
			}
			got := mustExec(t, &observeIter{recs: []utm.LogRecord{{Body: "line"}}}, q, logPlan(true, false, true, true))
			rows := entriesOf(t, got)
			if tc.keep {
				if len(rows) != 1 || rows[0].Body != "line" {
					t.Fatalf("rows %#v", rows)
				}
				return
			}
			if len(rows) != 0 {
				t.Fatalf("kept %#v", rows)
			}
		})
	}
}

func TestExecute_AC6_NumericFilter(t *testing.T) {
	plan := logPlan(false, false, true, true)
	stage := []spi.ParseStage{{Kind: spi.ParseJSON}}
	pass := mustExec(t, &observeIter{recs: []utm.LogRecord{{Body: `{"status":"401"}`}}}, spi.LogQuery{
		Direction: spi.Forward,
		Stages:    stage,
		Fields:    []spi.FieldFilter{{Field: "status", Op: spi.CmpGt, Num: new(float64(400))}},
	}, plan)
	assertEntry(t, soleEntry(t, pass), 0, `{"status":"401"}`, labels.FromStrings("status", "401"), nil)

	drop := mustExec(t, &observeIter{recs: []utm.LogRecord{{Body: `{"status":"401"}`}}}, spi.LogQuery{
		Direction: spi.Forward,
		Stages:    stage,
		Fields:    []spi.FieldFilter{{Field: "status", Op: spi.CmpGt, Num: new(float64(500))}},
	}, plan)
	if rows := entriesOf(t, drop); len(rows) != 0 {
		t.Fatalf("kept %#v", rows)
	}

	bad := mustExec(t, &observeIter{recs: []utm.LogRecord{{Body: `{"status":"nope"}`}}}, spi.LogQuery{
		Direction: spi.Forward,
		Stages:    stage,
		Fields:    []spi.FieldFilter{{Field: "status", Op: spi.CmpGt, Num: new(float64(400))}},
	}, plan)
	assertEntry(t, soleEntry(t, bad), 0, `{"status":"nope"}`, labels.FromStrings("__error__", "LabelFilterErr", "status", "nope"), nil)

	got, err := Execute(t.Context(), &observeIter{recs: []utm.LogRecord{{Body: `{"status":"401"}`}}}, spi.LogQuery{
		Direction: spi.Forward,
		Stages:    stage,
		Fields:    []spi.FieldFilter{{Field: "status", Op: spi.CmpGt}},
	}, plan)
	if spi.Classify(err) != spi.ErrBadRequest {
		t.Fatalf("class %v err %v", spi.Classify(err), err)
	}
	assertEmpty(t, got)
}

func TestExecute_AC7_StreamLabelClash(t *testing.T) {
	body := `{"app":"parsed","status":"1"}`
	attrs := map[string]string{"app": "meta"}
	q := spi.LogQuery{Direction: spi.Forward, Stages: []spi.ParseStage{{Kind: spi.ParseJSON}}}
	rec := utm.LogRecord{Body: body, Labels: labels.FromStrings("app", "web", "job", "api"), Attrs: attrs}
	got := soleEntry(t, mustExec(t, &observeIter{recs: []utm.LogRecord{rec}}, q, logPlan(false, true, true, true)))
	assertEntry(t, got, 0, body, labels.FromStrings("app", "web", "app_extracted", "parsed", "job", "api", "status", "1"), attrs)
}

func TestExecute_AC8_ErrorLabelClash(t *testing.T) {
	q := spi.LogQuery{Direction: spi.Forward, Stages: []spi.ParseStage{{Kind: spi.ParseJSON}}}
	rec := utm.LogRecord{Body: "not-json", Labels: labels.FromStrings("__error__", "kept")}
	got := soleEntry(t, mustExec(t, &observeIter{recs: []utm.LogRecord{rec}}, q, logPlan(false, true, true, true)))
	assertEntry(t, got, 0, "not-json", labels.FromStrings("__error__", "kept", "__error___extracted", "JSONParserErr"), nil)
}

func ac9Query(fn string, step, window time.Duration) spi.LogQuery {
	return spi.LogQuery{
		Start:     0,
		End:       3_000_000,
		Direction: spi.Forward,
		Agg:       &spi.LogAggregation{RangeFunc: fn, Window: window, Step: step},
	}
}

func ac9Samples(values ...float64) []spi.SeriesData {
	samples := make([]spi.Sample, len(values))
	for i, value := range values {
		samples[i] = spi.Sample{TS: int64(i), Value: value}
	}
	return []spi.SeriesData{{Labels: labels.FromStrings("job", "api"), Samples: samples}}
}

func TestExecute_AC9_CountOverTime(t *testing.T) {
	q := ac9Query("count_over_time", 1_000_000, 1_000_000)
	rec := utm.LogRecord{TS: 1_000_000, Labels: labels.FromStrings("job", "api")}
	got := mustExec(t, &observeIter{recs: []utm.LogRecord{rec}}, q, logPlan(true, true, false, true))
	if len(got.Streams) != 0 {
		t.Fatalf("streams %#v", got.Streams)
	}
	assertMatrix(t, got.Matrix, ac9Samples(0, 1, 0))
}

func TestExecute_AC10_RateAndBytes(t *testing.T) {
	rec := utm.LogRecord{TS: 1_000_000, Body: "ab", Labels: labels.FromStrings("job", "api")}
	cases := []struct {
		fn     string
		values []float64
	}{
		{fn: "rate", values: []float64{0, 1000, 0}},
		{fn: "bytes_over_time", values: []float64{0, 2, 0}},
		{fn: "bytes_rate", values: []float64{0, 2000, 0}},
	}
	for _, tc := range cases {
		t.Run(tc.fn, func(t *testing.T) {
			q := ac9Query(tc.fn, 1_000_000, 1_000_000)
			got := mustExec(t, &observeIter{recs: []utm.LogRecord{rec}}, q, logPlan(true, true, false, true))
			assertMatrix(t, got.Matrix, ac9Samples(tc.values...))
		})
	}
}

func TestExecute_AC11_StepZero(t *testing.T) {
	q := ac9Query("count_over_time", 0, 3_000_000)
	rec := utm.LogRecord{TS: 1_000_000, Labels: labels.FromStrings("job", "api")}
	got := mustExec(t, &observeIter{recs: []utm.LogRecord{rec}}, q, logPlan(true, true, false, true))
	want := []spi.SeriesData{{
		Labels:  labels.FromStrings("job", "api"),
		Samples: []spi.Sample{{TS: utm.NanoToMilli(q.End), Value: 1}},
	}}
	assertMatrix(t, got.Matrix, want)
	if want[0].Samples[0].TS != 3 {
		t.Fatalf("milli %d", want[0].Samples[0].TS)
	}
}

func TestExecute_AC12_ByAndWithout(t *testing.T) {
	q := spi.LogQuery{
		Direction: spi.Forward,
		Agg: &spi.LogAggregation{
			RangeFunc: "count_over_time",
			Window:    time.Second,
			By:        []string{"job"},
			Without:   []string{"host"},
		},
	}
	got, err := Execute(t.Context(), &observeIter{recs: []utm.LogRecord{{Body: "x"}}}, q, logPlan(true, true, false, true))
	if spi.Classify(err) != spi.ErrBadRequest {
		t.Fatalf("class %v err %v", spi.Classify(err), err)
	}
	assertEmpty(t, got)
}

func TestExecute_AC13_TopKBottomK(t *testing.T) {
	recs := []utm.LogRecord{
		{TS: 1_000_000, Labels: labels.FromStrings("job", "c")},
		{TS: 1_000_000, Labels: labels.FromStrings("job", "c")},
		{TS: 1_000_000, Labels: labels.FromStrings("job", "b")},
		{TS: 1_000_000, Labels: labels.FromStrings("job", "a")},
	}
	top := spi.LogQuery{
		Start:     0,
		End:       2_000_000,
		Direction: spi.Forward,
		Agg:       &spi.LogAggregation{RangeFunc: "count_over_time", Window: 2_000_000, Step: 0, VectorOp: "topk", K: 2},
	}
	got := mustExec(t, &observeIter{recs: recs}, top, logPlan(true, true, false, true))
	assertMatrix(t, got.Matrix, []spi.SeriesData{
		{Labels: labels.FromStrings("job", "c"), Samples: []spi.Sample{{TS: 2, Value: 2}}},
		{Labels: labels.FromStrings("job", "a"), Samples: []spi.Sample{{TS: 2, Value: 1}}},
	})

	bottom := spi.LogQuery{
		Start:     0,
		End:       2_000_000,
		Direction: spi.Forward,
		Agg:       &spi.LogAggregation{RangeFunc: "count_over_time", Window: 2_000_000, Step: 0, VectorOp: "bottomk", K: 1},
	}
	got = mustExec(t, &observeIter{recs: recs}, bottom, logPlan(true, true, false, true))
	assertMatrix(t, got.Matrix, []spi.SeriesData{
		{Labels: labels.FromStrings("job", "a"), Samples: []spi.Sample{{TS: 2, Value: 1}}},
	})
}

func TestExecute_AC14_LimitClose(t *testing.T) {
	it := &observeIter{recs: []utm.LogRecord{{Body: "b1"}, {Body: "b2"}, {Body: "b3"}}}
	q := spi.LogQuery{Direction: spi.Forward, Limit: 1}
	got := mustExec(t, it, q, logPlan(true, true, true, false))
	rows := entriesOf(t, got)
	if len(rows) != 1 || rows[0].Body != "b1" || !it.closed || it.reads != 1 {
		t.Fatalf("rows %#v closed %v reads %d", rows, it.closed, it.reads)
	}

	pushed := &observeIter{recs: []utm.LogRecord{{Body: "b1"}, {Body: "b2"}}}
	got = mustExec(t, pushed, q, logPlan(true, true, true, true))
	rows = entriesOf(t, got)
	if len(rows) != 2 || rows[0].Body != "b1" || rows[1].Body != "b2" || pushed.reads != 2 {
		t.Fatalf("rows %#v reads %d", rows, pushed.reads)
	}
}

func TestExecute_AC15_LimitZero(t *testing.T) {
	recs := []utm.LogRecord{{Body: "b1"}, {Body: "b2"}, {Body: "b3"}}
	q := spi.LogQuery{Direction: spi.Forward, Limit: 0}
	for _, pushed := range []bool{true, false} {
		got := mustExec(t, &observeIter{recs: recs}, q, logPlan(true, true, true, pushed))
		rows := entriesOf(t, got)
		if len(rows) != 3 || rows[0].Body != "b1" || rows[1].Body != "b2" || rows[2].Body != "b3" {
			t.Fatalf("limit pushed %v rows %#v", pushed, rows)
		}
	}
}

func TestExecute_AC16_LineFilterPushdown(t *testing.T) {
	q := spi.LogQuery{
		Direction: spi.Forward,
		Filters:   []spi.LineFilter{{Op: spi.LineContains, Value: "keep"}},
	}
	plan := logPlan(true, true, true, true)
	plan.Filters = []bool{false}
	got := mustExec(t, &observeIter{recs: []utm.LogRecord{{Body: "keep"}, {Body: "drop"}}}, q, plan)
	rows := entriesOf(t, got)
	if len(rows) != 1 || rows[0].Body != "keep" {
		t.Fatalf("rows %#v", rows)
	}

	plan.Filters = []bool{true}
	got = mustExec(t, &observeIter{recs: []utm.LogRecord{{Body: "keep"}}}, q, plan)
	rows = entriesOf(t, got)
	if len(rows) != 1 || rows[0].Body != "keep" {
		t.Fatalf("pushed rows %#v", rows)
	}
}

func TestExecute_AC17_SixteenPlans(t *testing.T) {
	q := spi.LogQuery{
		Direction: spi.Forward,
		Stages:    []spi.ParseStage{{Kind: spi.ParseJSON}},
		Fields:    []spi.FieldFilter{{Field: "status", Op: spi.CmpEq, Value: "ok"}},
		Limit:     10,
	}
	wantBody := `{"status":"ok"}`
	wantLabels := labels.FromStrings("status", "ok")
	for mask := range 16 {
		stages := mask&1 != 0
		fields := mask&2 != 0
		agg := mask&4 != 0
		limit := mask&8 != 0
		t.Run(planName(stages, fields, agg, limit), func(t *testing.T) {
			ok := utm.LogRecord{Body: wantBody}
			nope := utm.LogRecord{Body: "nope"}
			if stages {
				ok.Labels = labels.FromStrings("status", "ok")
				nope.Labels = labels.FromStrings("__error__", "JSONParserErr")
			}
			recs := []utm.LogRecord{ok, nope}
			if fields {
				recs = recs[:1]
			}
			if limit && len(recs) > 10 {
				recs = recs[:10]
			}
			got := mustExec(t, &observeIter{recs: recs}, q, logPlan(stages, fields, agg, limit))
			row := soleEntry(t, got)
			assertEntry(t, row, 0, wantBody, wantLabels, nil)
			if !labels.Equal(got.Streams[0].Labels, wantLabels) {
				t.Fatalf("stream labels %s", got.Streams[0].Labels)
			}
		})
	}
}

func planName(stages, fields, agg, limit bool) string {
	return "stages=" + strconv.FormatBool(stages) + ",fields=" + strconv.FormatBool(fields) + ",agg=" + strconv.FormatBool(agg) + ",limit=" + strconv.FormatBool(limit)
}

func TestExecute_AC18_AggPushdown(t *testing.T) {
	q := ac9Query("count_over_time", 1_000_000, 1_000_000)
	rec := utm.LogRecord{TS: 1_000_000, Labels: labels.FromStrings("job", "api")}
	direct := mustExec(t, &observeIter{recs: []utm.LogRecord{rec}}, q, logPlan(true, true, false, true))
	if len(direct.Streams) != 0 {
		t.Fatalf("streams %#v", direct.Streams)
	}
	assertMatrix(t, direct.Matrix, ac9Samples(0, 1, 0))

	pushed := mustExec(t, &observeIter{recs: []utm.LogRecord{rec}}, q, logPlan(true, true, true, true))
	if len(pushed.Matrix) != 0 {
		t.Fatalf("matrix %#v", pushed.Matrix)
	}
	again := mustExec(t, &observeIter{recs: entriesOf(t, pushed)}, q, logPlan(true, true, false, true))
	assertMatrix(t, again.Matrix, direct.Matrix)
}

func TestExecute_AC19_StreamLimit(t *testing.T) {
	it := &genIter{n: 1_000_000}
	q := spi.LogQuery{Direction: spi.Forward, Limit: 100}
	got := mustExec(t, it, q, logPlan(true, true, true, false))
	if it.reads >= 100_000 {
		t.Fatalf("reads %d", it.reads)
	}
	if rows := entriesOf(t, got); len(rows) != 100 {
		t.Fatalf("rows %d reads %d", len(rows), it.reads)
	}
	if !it.closed {
		t.Fatal("iterator was not closed")
	}
}

func TestExecute_MaxAggSeries(t *testing.T) {
	const extra = 40
	it := &observeIter{recs: make([]utm.LogRecord, maxAggSeries+1+extra)}
	for i := range it.recs {
		it.recs[i] = utm.LogRecord{TS: 1, Labels: labels.FromStrings("job", strconv.Itoa(i))}
	}
	q := spi.LogQuery{
		Start:     0,
		End:       2,
		Direction: spi.Forward,
		Agg:       &spi.LogAggregation{RangeFunc: "count_over_time", Window: 2, Step: 0},
	}
	got, err := Execute(t.Context(), it, q, logPlan(true, true, false, true))
	if spi.Classify(err) != spi.ErrTooLarge {
		t.Fatalf("class %v err %v", spi.Classify(err), err)
	}
	want := "query would produce 10001 series, exceeding the limit of 10000; add a 'by' clause or reduce the time range"
	if !strings.Contains(err.Error(), want) {
		t.Fatalf("message %v", err)
	}
	assertEmpty(t, got)
	if it.reads != maxAggSeries+1 {
		t.Fatalf("reads %d, limit must trip when the extra series is created", it.reads)
	}
	if !it.closed {
		t.Fatal("iterator was not closed")
	}
}

func TestAffectedRangeMatchesScan(t *testing.T) {
	cases := []struct {
		start, end, step, window int64
		stamps                   []int64
	}{
		{start: 0, end: 3_000_000, step: 1_000_000, window: 1_000_000, stamps: []int64{0, 1, 999_999, 1_000_000, 1_000_001, 2_000_000, 3_000_000}},
		{start: 0, end: 2, step: 0, window: 2, stamps: []int64{0, 1, 2, 3}},
		{start: 1_000, end: 10_000, step: 1_000, window: 2_500, stamps: []int64{-100, 0, 500, 1_000, 1_500, 9_000, 12_000}},
		{start: 0, end: 5_000, step: 1_000, window: 3_000, stamps: []int64{0, 1, 2_500, 4_999}},
	}
	for _, tc := range cases {
		times := bucketTimes(tc.start, tc.end, time.Duration(tc.step))
		for _, ts := range tc.stamps {
			lo, hi := affectedRange(ts, times, tc.window)
			var wantLo, wantHi int
			for i, bucket := range times {
				if !inWindow(ts, bucket, tc.window) {
					continue
				}
				if wantLo == wantHi {
					wantLo = i
				}
				wantHi = i + 1
			}
			if lo != wantLo || hi != wantHi {
				t.Fatalf("ts %d times %v window %d got [%d,%d) want [%d,%d)", ts, times, tc.window, lo, hi, wantLo, wantHi)
			}
		}
	}
}

func TestExecute_AC20_DuplicateJSONKey(t *testing.T) {
	body := `{"status":"first","status":"second"}`
	q := spi.LogQuery{Direction: spi.Forward, Stages: []spi.ParseStage{{Kind: spi.ParseJSON}}}
	got := soleEntry(t, mustExec(t, &observeIter{recs: []utm.LogRecord{{Body: body}}}, q, logPlan(false, true, true, true)))
	assertEntry(t, got, 0, body, labels.FromStrings("status", "first"), nil)
}

func TestExecute_AC21_ExtractedNameClash(t *testing.T) {
	q := spi.LogQuery{Direction: spi.Forward, Stages: []spi.ParseStage{{Kind: spi.ParseJSON}}}
	plan := logPlan(false, true, true, true)
	first := `{"app_extracted":"from-key","app":"from-app"}`
	got := soleEntry(t, mustExec(t, &observeIter{recs: []utm.LogRecord{{
		Body: first, Labels: labels.FromStrings("app", "web"),
	}}}, q, plan))
	assertEntry(t, got, 0, first, labels.FromStrings("app", "web", "app_extracted", "from-key"), nil)

	second := `{"app":"from-app","app_extracted":"from-key"}`
	got = soleEntry(t, mustExec(t, &observeIter{recs: []utm.LogRecord{{
		Body: second, Labels: labels.FromStrings("app", "web"),
	}}}, q, plan))
	assertEntry(t, got, 0, second, labels.FromStrings("app", "web", "app_extracted", "from-app"), nil)

	third := `{"app":"x"}`
	got = soleEntry(t, mustExec(t, &observeIter{recs: []utm.LogRecord{{
		Body: third, Labels: labels.FromStrings("app", "web", "app_extracted", "kept"),
	}}}, q, plan))
	assertEntry(t, got, 0, third, labels.FromStrings("app", "web", "app_extracted", "kept"), nil)
}

func TestExecute_AC22_AnchoredFieldRegex(t *testing.T) {
	plan := logPlan(true, false, true, true)
	rec := []utm.LogRecord{{Labels: labels.FromStrings("status", "401")}}
	cases := []struct {
		name string
		op   spi.CompareOp
		pat  string
		keep bool
	}{
		{name: "re-short", op: spi.CmpRe, pat: "40", keep: false},
		{name: "re-exact", op: spi.CmpRe, pat: "401", keep: true},
		{name: "re-wild", op: spi.CmpRe, pat: "40.*", keep: true},
		{name: "nre-short", op: spi.CmpNotRe, pat: "40", keep: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q := spi.LogQuery{Direction: spi.Forward, Fields: []spi.FieldFilter{{
				Field: "status", Op: tc.op, Value: tc.pat, Compiled: regexp.MustCompile(tc.pat),
			}}}
			rows := entriesOf(t, mustExec(t, &observeIter{recs: rec}, q, plan))
			if tc.keep && len(rows) != 1 {
				t.Fatalf("dropped %#v", rows)
			}
			if !tc.keep && len(rows) != 0 {
				t.Fatalf("kept %#v", rows)
			}
		})
	}
}

func TestExecute_AC22_InvalidPatternRejected(t *testing.T) {
	q := spi.LogQuery{Direction: spi.Forward, Fields: []spi.FieldFilter{{
		Field: "status", Op: spi.CmpRe, Value: `a)|(?:b`,
	}}}
	got, err := Execute(t.Context(), &observeIter{recs: []utm.LogRecord{{
		Labels: labels.FromStrings("status", "ab"),
	}}}, q, logPlan(true, false, true, true))
	if spi.Classify(err) != spi.ErrBadRequest {
		t.Fatalf("class %v err %v", spi.Classify(err), err)
	}
	assertEmpty(t, got)
}

func TestExecute_AC23_TopKByGroup(t *testing.T) {
	var recs []utm.LogRecord
	add := func(job, instance string, n int) {
		for range n {
			recs = append(recs, utm.LogRecord{TS: 1_000_000, Labels: labels.FromStrings("instance", instance, "job", job)})
		}
	}
	add("a", "1", 5)
	add("a", "2", 1)
	add("b", "1", 9)
	q := spi.LogQuery{
		Start:     0,
		End:       2_000_000,
		Direction: spi.Forward,
		Agg: &spi.LogAggregation{
			RangeFunc: "count_over_time",
			Window:    2_000_000,
			Step:      0,
			VectorOp:  "topk",
			K:         1,
			By:        []string{"job"},
		},
	}
	got := mustExec(t, &observeIter{recs: recs}, q, logPlan(true, true, false, true))
	assertMatrix(t, got.Matrix, []spi.SeriesData{
		{Labels: labels.FromStrings("instance", "1", "job", "a"), Samples: []spi.Sample{{TS: 2, Value: 5}}},
		{Labels: labels.FromStrings("instance", "1", "job", "b"), Samples: []spi.Sample{{TS: 2, Value: 9}}},
	})
}

func TestExecute_AC24_JSONNumberFormat(t *testing.T) {
	body := `{"a":401.0,"b":1e3,"c":1.50,"d":9007199254740993}`
	q := spi.LogQuery{Direction: spi.Forward, Stages: []spi.ParseStage{{Kind: spi.ParseJSON}}}
	got := soleEntry(t, mustExec(t, &observeIter{recs: []utm.LogRecord{{Body: body}}}, q, logPlan(false, true, true, true)))
	assertEntry(t, got, 0, body, labels.FromStrings(
		"a", "401",
		"b", "1000",
		"c", "1.5",
		"d", "9007199254740992",
	), nil)
}

func TestExecute_AC25_JSONKeySanitize(t *testing.T) {
	body := `{"a.b-c":"v"}`
	q := spi.LogQuery{Direction: spi.Forward, Stages: []spi.ParseStage{{Kind: spi.ParseJSON}}}
	got := soleEntry(t, mustExec(t, &observeIter{recs: []utm.LogRecord{{Body: body}}}, q, logPlan(false, true, true, true)))
	assertEntry(t, got, 0, body, labels.FromStrings("a_b_c", "v"), nil)
}

func TestExecute_AC26_ZeroWindow(t *testing.T) {
	q := spi.LogQuery{
		Start:     0,
		End:       2,
		Direction: spi.Forward,
		Agg:       &spi.LogAggregation{RangeFunc: "rate", Window: 0, Step: 0},
	}
	got, err := Execute(t.Context(), &observeIter{recs: []utm.LogRecord{{TS: 1, Body: "x"}}}, q, logPlan(true, true, false, true))
	if spi.Classify(err) != spi.ErrBadRequest {
		t.Fatalf("class %v err %v", spi.Classify(err), err)
	}
	assertEmpty(t, got)
}

func TestExecute_AC27_SubMillisecondStep(t *testing.T) {
	q := spi.LogQuery{
		Start:     0,
		End:       2_000_000,
		Direction: spi.Forward,
		Agg: &spi.LogAggregation{
			RangeFunc: "count_over_time",
			Window:    2_000_000,
			Step:      500_000,
		},
	}
	got, err := Execute(t.Context(), &observeIter{recs: []utm.LogRecord{{TS: 1}}}, q, logPlan(true, true, false, true))
	if spi.Classify(err) != spi.ErrBadRequest {
		t.Fatalf("class %v err %v", spi.Classify(err), err)
	}
	assertEmpty(t, got)
}

func TestExecute_AC28_KeepJSONParserErr(t *testing.T) {
	q := spi.LogQuery{
		Direction: spi.Forward,
		Stages:    []spi.ParseStage{{Kind: spi.ParseJSON}},
		Fields:    []spi.FieldFilter{{Field: "status", Op: spi.CmpGt, Num: new(float64(1))}},
	}
	got := soleEntry(t, mustExec(t, &observeIter{recs: []utm.LogRecord{{Body: "not-json"}}}, q, logPlan(false, false, true, true)))
	assertEntry(t, got, 0, "not-json", labels.FromStrings("__error__", "JSONParserErr"), nil)
}

func TestExecute_CancelClosesIterator(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	it := &observeIter{recs: []utm.LogRecord{{Body: "x"}}}
	_, err := Execute(ctx, it, spi.LogQuery{}, spi.PushdownPlan{})
	if spi.Classify(err) != spi.ErrTimeout {
		t.Fatalf("%v", err)
	}
	if !it.closed || it.reads != 0 {
		t.Fatalf("closed %v reads %d", it.closed, it.reads)
	}
}
