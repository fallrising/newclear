package logql

import (
	"bytes"
	"context"
	"errors"
	"io"
	"maps"
	"slices"
	"strconv"
	"strings"

	"encoding/json/jsontext"

	"github.com/prometheus/prometheus/model/labels"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

const maxJSONDepth = 5

// Execute applies the parts of q that plan says the driver did not evaluate.
// The order is line filters, parse stages, field filters, then either stream
// collection or aggregation. Limit stops a stream collection early; it does
// not truncate an aggregation.
func Execute(ctx context.Context, it spi.LogIterator, q spi.LogQuery, plan spi.PushdownPlan) (res spi.LogResult, err error) {
	if it == nil {
		return spi.LogResult{}, badRequest("iterator is required")
	}
	defer func() {
		if cerr := it.Close(); cerr != nil && err == nil {
			res = spi.LogResult{}
			err = spi.Wrap(spi.ErrInternal, "logql", "Execute", cerr)
		}
	}()
	if ctx == nil {
		return spi.LogResult{}, badRequest("context is required")
	}
	if err = ctx.Err(); err != nil {
		return spi.LogResult{}, spi.Wrap(spi.ErrTimeout, "logql", "Execute", err)
	}
	if len(plan.Filters) != len(q.Filters) {
		return spi.LogResult{}, badRequest("pushdown filter plan does not match the query")
	}
	if q.Agg != nil && len(q.Agg.By) > 0 && len(q.Agg.Without) > 0 {
		return spi.LogResult{}, badRequest("by and without are mutually exclusive")
	}
	if !plan.Fields {
		for _, field := range q.Fields {
			if numericOp(field.Op) && field.Num == nil {
				return spi.LogResult{}, badRequest("numeric comparison requires a threshold")
			}
		}
		fields, aerr := anchorFieldPatterns(q.Fields)
		if aerr != nil {
			return spi.LogResult{}, aerr
		}
		q.Fields = fields
	}

	aggregating := q.Agg != nil && !plan.Agg
	var times []int64
	var window int64
	var series int
	groups := map[uint64][]*bucket{}
	if aggregating {
		if err = validateAgg(q.Agg); err != nil {
			return spi.LogResult{}, err
		}
		times = bucketTimes(q.Start, q.End, q.Agg.Step)
		window = int64(q.Agg.Window)
	}
	streams := map[uint64][]*logStream{}
	emitted := 0
	for {
		if err = ctx.Err(); err != nil {
			return spi.LogResult{}, spi.Wrap(spi.ErrTimeout, "logql", "Execute", err)
		}
		if !it.Next() {
			break
		}
		rec, keep, ferr := accept(it.At(), q, plan)
		if ferr != nil {
			return spi.LogResult{}, ferr
		}
		if !keep {
			continue
		}
		if aggregating {
			if err = addBucket(groups, rec, times, window, &series); err != nil {
				return spi.LogResult{}, err
			}
			continue
		}
		addStream(streams, rec)
		emitted++
		if !plan.Limit && q.Limit > 0 && emitted >= q.Limit {
			return spi.LogResult{Streams: emitStreams(streams)}, nil
		}
	}
	if err = it.Err(); err != nil {
		return spi.LogResult{}, classifyIter(err)
	}
	if aggregating {
		matrix, aerr := aggregate(q, groups, times)
		if aerr != nil {
			return spi.LogResult{}, aerr
		}
		return spi.LogResult{Matrix: matrix}, nil
	}
	return spi.LogResult{Streams: emitStreams(streams)}, nil
}

func badRequest(msg string) error {
	return spi.Wrap(spi.ErrBadRequest, "logql", "Execute", errors.New(msg))
}

func anchorFieldPatterns(fields []spi.FieldFilter) ([]spi.FieldFilter, error) {
	out := slices.Clone(fields)
	for i := range out {
		if out[i].Op != spi.CmpRe && out[i].Op != spi.CmpNotRe {
			continue
		}
		compiled, err := compileAnchoredField(out[i].Value)
		if err != nil {
			return nil, err
		}
		out[i].Compiled = compiled
	}
	return out, nil
}

func classifyIter(err error) error {
	if _, ok := errors.AsType[*spi.Error](err); ok {
		return err
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return spi.Wrap(spi.ErrTimeout, "logql", "Execute", err)
	}
	return spi.Wrap(spi.ErrInternal, "logql", "Execute", err)
}

func accept(rec utm.LogRecord, q spi.LogQuery, plan spi.PushdownPlan) (utm.LogRecord, bool, error) {
	for i := range q.Filters {
		if plan.Filters[i] {
			continue
		}
		if !q.Filters[i].Matches(rec.Body) {
			return utm.LogRecord{}, false, nil
		}
	}
	var extracted *parsedFields
	if !plan.Stages && len(q.Stages) > 0 {
		var err error
		extracted, err = extract(rec.Body, q.Stages)
		if err != nil {
			return utm.LogRecord{}, false, err
		}
	}
	ls := mergeLabels(rec.Labels, extracted)
	if !plan.Fields {
		annotate := false
		for _, field := range q.Fields {
			drop, ann, err := applyField(ls, field)
			if err != nil {
				return utm.LogRecord{}, false, err
			}
			if drop {
				return utm.LogRecord{}, false, nil
			}
			annotate = annotate || ann
		}
		if annotate {
			ls = addErrorLabel(rec.Labels, ls, "LabelFilterErr")
		}
	}
	out := rec
	out.Labels = ls
	if rec.Attrs != nil {
		out.Attrs = maps.Clone(rec.Attrs)
	}
	return out, true, nil
}

type parsedFields struct {
	keys []string
	vals map[string]string
}

func (p *parsedFields) putFirst(key, value string) {
	if p.vals == nil {
		p.vals = map[string]string{}
	}
	if _, exists := p.vals[key]; exists {
		return
	}
	p.vals[key] = value
	p.keys = append(p.keys, key)
}

func (p *parsedFields) putLast(key, value string) {
	if p.vals == nil {
		p.vals = map[string]string{}
	}
	if _, exists := p.vals[key]; !exists {
		p.keys = append(p.keys, key)
	}
	p.vals[key] = value
}

func extract(body string, stages []spi.ParseStage) (*parsedFields, error) {
	acc := &parsedFields{}
	for _, stage := range stages {
		var (
			fields  *parsedFields
			ok      bool
			errName string
		)
		switch stage.Kind {
		case spi.ParseJSON:
			fields, ok = parseJSON(body)
			errName = "JSONParserErr"
		case spi.ParseLogfmt:
			fields, ok = parseLogfmt(body)
			errName = "LogfmtParserErr"
		default:
			return nil, badRequest("unsupported parse stage")
		}
		if !ok {
			acc.putFirst("__error__", errName)
			continue
		}
		for _, key := range fields.keys {
			acc.putFirst(key, fields.vals[key])
		}
	}
	return acc, nil
}

// parseJSON flattens one JSON object. The root object is depth 0. A value
// nested deeper than 5 stays compact JSON. Arrays and nulls create no label.
func parseJSON(body string) (*parsedFields, bool) {
	dec := jsontext.NewDecoder(strings.NewReader(body), jsontext.AllowDuplicateNames(true))
	if dec.PeekKind() != jsontext.KindBeginObject {
		return nil, false
	}
	out := &parsedFields{}
	if err := readObject(dec, "", 0, out); err != nil {
		return nil, false
	}
	if _, err := dec.ReadToken(); !errors.Is(err, io.EOF) {
		return nil, false
	}
	return out, true
}

func readObject(dec *jsontext.Decoder, prefix string, depth int, out *parsedFields) error {
	if _, err := dec.ReadToken(); err != nil {
		return err
	}
	for {
		kind := dec.PeekKind()
		if kind == jsontext.KindEndObject {
			break
		}
		if kind == jsontext.KindInvalid {
			_, err := dec.ReadToken()
			if err == nil {
				err = errors.New("invalid json")
			}
			return err
		}
		keyTok, err := dec.ReadToken()
		if err != nil {
			return err
		}
		if keyTok.Kind() != jsontext.KindString {
			return errors.New("invalid json key")
		}
		name := sanitizeLabelKey(keyTok.String())
		if prefix != "" {
			name = prefix + "_" + name
		}
		if err := readValue(dec, name, depth, out); err != nil {
			return err
		}
	}
	_, err := dec.ReadToken()
	return err
}

func readValue(dec *jsontext.Decoder, name string, depth int, out *parsedFields) error {
	switch dec.PeekKind() {
	case jsontext.KindBeginObject:
		if depth+1 > maxJSONDepth {
			return readCompact(dec, name, out)
		}
		return readObject(dec, name, depth+1, out)
	case jsontext.KindBeginArray:
		return dec.SkipValue()
	case jsontext.KindNull:
		_, err := dec.ReadToken()
		return err
	case jsontext.KindNumber:
		tok, err := dec.ReadToken()
		if err != nil {
			return err
		}
		value, err := formatJSONNumber(tok.String())
		if err != nil {
			return err
		}
		out.putFirst(name, value)
		return nil
	case jsontext.KindTrue, jsontext.KindFalse, jsontext.KindString:
		tok, err := dec.ReadToken()
		if err != nil {
			return err
		}
		out.putFirst(name, tok.String())
		return nil
	default:
		_, err := dec.ReadToken()
		if err == nil {
			err = errors.New("invalid json value")
		}
		return err
	}
}

func readCompact(dec *jsontext.Decoder, name string, out *parsedFields) error {
	val, err := dec.ReadValue()
	if err != nil {
		return err
	}
	raw := jsontext.Value(bytes.Clone(val))
	if err := raw.Compact(); err != nil {
		return err
	}
	out.putFirst(name, string(raw))
	return nil
}

func parseLogfmt(s string) (*parsedFields, bool) {
	out := &parsedFields{}
	i := 0
	for i < len(s) {
		if isLogfmtSpace(s[i]) {
			i++
			continue
		}
		start := i
		for i < len(s) && !isLogfmtSpace(s[i]) && s[i] != '=' && s[i] != '"' {
			i++
		}
		if i == start {
			return nil, false
		}
		key := s[start:i]
		val := ""
		if i < len(s) && s[i] == '=' {
			i++
			if i < len(s) && s[i] == '"' {
				var closed bool
				val, i, closed = quotedLogfmt(s, i+1)
				if !closed {
					return nil, false
				}
			} else {
				start = i
				for i < len(s) && !isLogfmtSpace(s[i]) {
					i++
				}
				val = s[start:i]
			}
		}
		out.putLast(key, val)
	}
	return out, true
}

func quotedLogfmt(s string, i int) (string, int, bool) {
	var b strings.Builder
	for i < len(s) {
		if s[i] == '\\' && i+1 < len(s) {
			b.WriteByte(s[i+1])
			i += 2
			continue
		}
		if s[i] == '"' {
			return b.String(), i + 1, true
		}
		b.WriteByte(s[i])
		i++
	}
	return "", i, false
}

func isLogfmtSpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r'
}

func mergeLabels(stream utm.Labels, extracted *parsedFields) utm.Labels {
	if extracted == nil || len(extracted.keys) == 0 {
		return stream
	}
	reserved := make(map[string]struct{}, len(stream))
	for _, lb := range stream {
		reserved[lb.Name] = struct{}{}
	}
	used := maps.Clone(reserved)
	b := labels.NewBuilder(stream)
	for _, key := range extracted.keys {
		name := renameExtracted(key, reserved)
		if _, taken := used[name]; taken {
			continue
		}
		used[name] = struct{}{}
		b.Set(name, extracted.vals[key])
	}
	return b.Labels()
}

func renameExtracted(name string, reserved map[string]struct{}) string {
	if _, hit := reserved[name]; hit {
		return name + "_extracted"
	}
	return name
}

func addErrorLabel(stream, current utm.Labels, msg string) utm.Labels {
	if _, ok := labelValue(current, "__error__"); ok {
		return current
	}
	reserved := make(map[string]struct{}, len(stream))
	for _, lb := range stream {
		reserved[lb.Name] = struct{}{}
	}
	name := renameExtracted("__error__", reserved)
	if _, ok := labelValue(current, name); ok {
		return current
	}
	b := labels.NewBuilder(current)
	b.Set(name, msg)
	return b.Labels()
}

func sanitizeLabelKey(key string) string {
	var b strings.Builder
	b.Grow(len(key))
	for _, r := range key {
		if r == '_' || r == ':' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			continue
		}
		b.WriteByte('_')
	}
	name := b.String()
	if name == "" || (name[0] >= '0' && name[0] <= '9') {
		return "_" + name
	}
	return name
}

func formatJSONNumber(raw string) (string, error) {
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return "", err
	}
	return strconv.FormatFloat(value, 'f', -1, 64), nil
}

func labelValue(ls utm.Labels, name string) (string, bool) {
	for _, lb := range ls {
		if lb.Name == name {
			return lb.Value, true
		}
	}
	return "", false
}

func applyField(ls utm.Labels, field spi.FieldFilter) (bool, bool, error) {
	value, ok := labelValue(ls, field.Field)
	switch field.Op {
	case spi.CmpEq:
		if !ok || value != field.Value {
			return true, false, nil
		}
	case spi.CmpNe:
		if ok && value == field.Value {
			return true, false, nil
		}
	case spi.CmpRe:
		if !ok || field.Compiled == nil || !field.Compiled.MatchString(value) {
			return true, false, nil
		}
	case spi.CmpNotRe:
		if !ok {
			return false, false, nil
		}
		if field.Compiled == nil || field.Compiled.MatchString(value) {
			return true, false, nil
		}
	case spi.CmpGt, spi.CmpGte, spi.CmpLt, spi.CmpLte:
		if field.Num == nil {
			return false, false, badRequest("numeric comparison requires a threshold")
		}
		if !ok {
			return false, true, nil
		}
		number, err := strconv.ParseFloat(value, 64)
		if err != nil {
			return false, true, nil
		}
		if !compareNumber(field.Op, number, *field.Num) {
			return true, false, nil
		}
	default:
		return false, false, badRequest("unsupported field comparison")
	}
	return false, false, nil
}

func numericOp(op spi.CompareOp) bool {
	switch op {
	case spi.CmpGt, spi.CmpGte, spi.CmpLt, spi.CmpLte:
		return true
	default:
		return false
	}
}

func compareNumber(op spi.CompareOp, got, want float64) bool {
	switch op {
	case spi.CmpGt:
		return got > want
	case spi.CmpGte:
		return got >= want
	case spi.CmpLt:
		return got < want
	case spi.CmpLte:
		return got <= want
	default:
		return false
	}
}

type logStream struct {
	labels  utm.Labels
	entries []utm.LogRecord
}

func addStream(streams map[uint64][]*logStream, rec utm.LogRecord) {
	h := rec.Labels.Hash()
	for _, stream := range streams[h] {
		if labels.Equal(stream.labels, rec.Labels) {
			stream.entries = append(stream.entries, rec)
			return
		}
	}
	streams[h] = append(streams[h], &logStream{labels: rec.Labels, entries: []utm.LogRecord{rec}})
}

func emitStreams(streams map[uint64][]*logStream) []spi.LogStreamData {
	if len(streams) == 0 {
		return nil
	}
	out := make([]spi.LogStreamData, 0, len(streams))
	for _, list := range streams {
		for _, stream := range list {
			out = append(out, spi.LogStreamData{Labels: stream.labels, Entries: stream.entries})
		}
	}
	slices.SortFunc(out, func(a, b spi.LogStreamData) int {
		return labels.Compare(a.Labels, b.Labels)
	})
	return out
}
