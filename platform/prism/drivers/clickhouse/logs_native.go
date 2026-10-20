package clickhouse

import (
	"context"
	"strings"
	"time"
	"unicode"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

const nativeLogOp = "logs.search_native"

func (s *logStore) SearchNative(ctx context.Context, q spi.LogQuery) (spi.LogResult, error) {
	if err := rejectNative(q); err != nil {
		return spi.LogResult{}, err
	}
	if q.Direction != spi.Forward && q.Direction != spi.Backward {
		return spi.LogResult{}, inputError(nativeLogOp, "invalid direction")
	}
	b, err := queryBackend(ctx, s.host, nativeLogOp)
	if err != nil {
		return spi.LogResult{}, err
	}
	if err := validateMatchers(q.Selectors, q.Tenant, nativeLogOp); err != nil {
		return spi.LogResult{}, err
	}
	if q.Agg != nil {
		return searchNativeAgg(ctx, b, q)
	}
	start, end, ok := nanoRange(q.Start, q.End)
	if !ok {
		return spi.LogResult{}, nil
	}
	q.Start, q.End = start, end
	sql, args, err := nativeLogSQL(q, b.opts)
	if err != nil {
		return spi.LogResult{}, err
	}
	records, err := scanNativeLogs(ctx, b, sql, args, q.Selectors)
	if err != nil {
		return spi.LogResult{}, err
	}
	return spi.LogResult{Streams: groupLogStreams(records)}, nil
}

func rejectNative(q spi.LogQuery) error {
	sawJSON := false
	for _, stage := range q.Stages {
		if stage.Kind != spi.ParseJSON {
			return unsupportedError(nativeLogOp, "parse stage is not pushed down")
		}
		sawJSON = true
	}
	if len(q.Fields) > 0 && !sawJSON {
		return unsupportedError(nativeLogOp, "field filter is not pushed down")
	}
	for _, field := range q.Fields {
		if field.Op != spi.CmpEq {
			return unsupportedError(nativeLogOp, "field comparison is not pushed down")
		}
	}
	if q.Agg != nil {
		return rejectNativeAgg(q.Agg)
	}
	return nil
}

func rejectNativeAgg(agg *spi.LogAggregation) error {
	switch agg.RangeFunc {
	case "count_over_time", "rate", "bytes_over_time":
	default:
		return unsupportedError(nativeLogOp, "aggregation is not pushed down")
	}
	if agg.VectorOp != "" || agg.Step < time.Millisecond || agg.Window <= 0 || agg.Window%agg.Step != 0 {
		return unsupportedError(nativeLogOp, "aggregation is not pushed down")
	}
	return nil
}

func nativeLogSQL(q spi.LogQuery, opts options) (string, []any, error) {
	if err := rejectNative(q); err != nil {
		return "", nil, err
	}
	if q.Direction != spi.Forward && q.Direction != spi.Backward {
		return "", nil, inputError(nativeLogOp, "invalid direction")
	}
	selectorSQL, selectorArgs := logSelectorFilter(q.Selectors)
	lineSQL, lineArgs, err := nativeLineSQL(q.Filters)
	if err != nil {
		return "", nil, err
	}
	fieldSQL, fieldArgs := nativeFieldSQL(q.Fields)
	direction := "DESC"
	if q.Direction == spi.Forward {
		direction = "ASC"
	}
	args := append([]any{q.Tenant, q.Start, q.End}, selectorArgs...)
	args = append(args, lineArgs...)
	args = append(args, fieldArgs...)
	limit := ""
	if q.Agg == nil && q.Limit > 0 {
		limit = " LIMIT ?"
		args = append(args, uint64(q.Limit))
	}
	sql := "SELECT ts,observed_ts,tenant,cluster,host,service,env,toString(severity),severity_text,body,trace_id,span_id,labels,attrs,res_attrs,service_instance,service_version,namespace,write_seq FROM logs WHERE tenant = ? AND ts >= fromUnixTimestamp64Nano(?) AND ts < fromUnixTimestamp64Nano(?)" + selectorSQL + lineSQL + fieldSQL + " ORDER BY ts " + direction + ", write_seq ASC" + limit + querySettings(opts)
	return sql, args, nil
}

func nativeLineSQL(filters []spi.LineFilter) (string, []any, error) {
	var sql strings.Builder
	var args []any
	for _, filter := range filters {
		switch filter.Op {
		case spi.LineContains:
			sql.WriteString(" AND position(body, ?) > 0")
			args = append(args, filter.Value)
		case spi.LineNotContains:
			sql.WriteString(" AND position(body, ?) = 0")
			args = append(args, filter.Value)
		case spi.LineMatch:
			hint := filter.LiteralHint
			switch {
			case hint != "" && hintHasSeparator(hint):
				sql.WriteString(" AND position(body, ?) > 0 AND match(body, ?)")
				args = append(args, hint, filter.Value)
			case hint != "":
				sql.WriteString(" AND hasToken(body, ?) AND match(body, ?)")
				args = append(args, hint, filter.Value)
			default:
				sql.WriteString(" AND match(body, ?)")
				args = append(args, filter.Value)
			}
		case spi.LineNotMatch:
			sql.WriteString(" AND NOT match(body, ?)")
			args = append(args, filter.Value)
		default:
			return "", nil, unsupportedError(nativeLogOp, "line filter is not pushed down")
		}
	}
	return sql.String(), args, nil
}

func hintHasSeparator(hint string) bool {
	for _, r := range hint {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			return true
		}
	}
	return false
}

func nativeFieldSQL(fields []spi.FieldFilter) (string, []any) {
	var sql strings.Builder
	var args []any
	for _, field := range fields {
		sql.WriteString(" AND JSONExtractString(body, ?) = ?")
		args = append(args, field.Field, field.Value)
	}
	return sql.String(), args
}

func scanNativeLogs(ctx context.Context, b *backend, sql string, args []any, selectors []spi.Matcher) ([]utm.LogRecord, error) {
	lease, err := b.queryRows(ctx, nativeLogOp, sql, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = lease.Close() }()
	iterator := &logIterator{lease: lease, selectors: selectors}
	var records []utm.LogRecord
	for iterator.Next() {
		records = append(records, iterator.At())
	}
	if err := iterator.Err(); err != nil {
		return nil, err
	}
	return records, nil
}

func groupLogStreams(records []utm.LogRecord) []spi.LogStreamData {
	if len(records) == 0 {
		return nil
	}
	type stream struct {
		labels  utm.Labels
		entries []utm.LogRecord
	}
	var streams []stream
	index := map[string]int{}
	for _, record := range records {
		key := record.Labels.String()
		at, ok := index[key]
		if !ok {
			at = len(streams)
			index[key] = at
			streams = append(streams, stream{labels: record.Labels})
		}
		streams[at].entries = append(streams[at].entries, record)
	}
	out := make([]spi.LogStreamData, len(streams))
	for i, stream := range streams {
		out[i] = spi.LogStreamData{Labels: stream.labels, Entries: stream.entries}
	}
	return out
}

func searchNativeAgg(ctx context.Context, b *backend, q spi.LogQuery) (spi.LogResult, error) {
	start, end, ok := nanoRange(q.Start, q.End)
	if !ok {
		return spi.LogResult{}, nil
	}
	scan := q
	scan.Agg = nil
	scan.Limit = 0
	scan.Start, scan.End = start, end
	sql, args, err := nativeLogSQL(scan, b.opts)
	if err != nil {
		return spi.LogResult{}, err
	}
	records, err := scanNativeLogs(ctx, b, sql, args, q.Selectors)
	if err != nil {
		return spi.LogResult{}, err
	}
	return spi.LogResult{Matrix: nativeMatrix(q, records, start, end)}, nil
}

func nativeMatrix(q spi.LogQuery, records []utm.LogRecord, start, end int64) []spi.SeriesData {
	times := nativeBucketTimes(start, end, q.Agg.Step)
	window := int64(q.Agg.Window)
	type accumulator struct {
		labels utm.Labels
		count  []int
		bytes  []int
	}
	var groups []accumulator
	index := map[string]int{}
	for _, record := range records {
		key := record.Labels.String()
		at, ok := index[key]
		if !ok {
			at = len(groups)
			index[key] = at
			groups = append(groups, accumulator{labels: record.Labels, count: make([]int, len(times)), bytes: make([]int, len(times))})
		}
		for i, ts := range times {
			if nativeInWindow(record.TS, ts, window) {
				groups[at].count[i]++
				groups[at].bytes[i] += len(record.Body)
			}
		}
	}
	seconds := q.Agg.Window.Seconds()
	out := make([]spi.SeriesData, 0, len(groups))
	for _, group := range groups {
		samples := make([]spi.Sample, len(times))
		for i, ts := range times {
			value := float64(group.count[i])
			switch q.Agg.RangeFunc {
			case "rate":
				value /= seconds
			case "bytes_over_time":
				value = float64(group.bytes[i])
			}
			samples[i] = spi.Sample{TS: utm.NanoToMilli(ts), Value: value}
		}
		out = append(out, spi.SeriesData{Labels: group.labels, Samples: samples})
	}
	return out
}

func nativeBucketTimes(start, end int64, step time.Duration) []int64 {
	stepNs := int64(step)
	var times []int64
	for t := start; t < end; {
		times = append(times, t)
		if stepNs > end-t {
			break
		}
		t += stepNs
	}
	return times
}

func nativeInWindow(ts, bucket, window int64) bool {
	if window <= 0 || ts > bucket {
		return false
	}
	return bucket-ts < window
}
