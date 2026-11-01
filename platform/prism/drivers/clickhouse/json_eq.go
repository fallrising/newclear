package clickhouse

import (
	"bytes"
	"errors"
	"io"
	"maps"
	"strconv"
	"strings"

	"encoding/json/jsontext"

	"github.com/prometheus/prometheus/model/labels"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

// JSON Eq fine filter. drivers/clickhouse must not import internal/query, so
// this repeats the | json rules in 16 §3.6 and internal/query/logql.parseJSON:
// nested '_', sanitized keys, depth > 5 compact JSON, FormatFloat numbers,
// first duplicate key, skipped arrays and nulls, and one _extracted rename.
const jsonEqMaxDepth = 5

func hasJSONEq(q spi.LogQuery) bool {
	if len(q.Fields) == 0 {
		return false
	}
	for _, stage := range q.Stages {
		if stage.Kind == spi.ParseJSON {
			return true
		}
	}
	return false
}

func filterJSONEq(records []utm.LogRecord, q spi.LogQuery) []utm.LogRecord {
	if !hasJSONEq(q) {
		return records
	}
	out := make([]utm.LogRecord, 0, len(records))
	for _, record := range records {
		if jsonEqMatch(record.Labels, record.Body, q.Fields) {
			out = append(out, record)
		}
	}
	if q.Agg == nil && q.Limit > 0 && len(out) > q.Limit {
		out = out[:q.Limit]
	}
	return out
}

func jsonEqMatch(stream utm.Labels, body string, fields []spi.FieldFilter) bool {
	parsed, ok := jsonParse(body)
	if !ok {
		parsed = &jsonFields{}
		parsed.putFirst("__error__", "JSONParserErr")
	}
	got := jsonMergeLabels(stream, parsed)
	for _, field := range fields {
		value, found := jsonLabelValue(got, field.Field)
		if !found || value != field.Value {
			return false
		}
	}
	return true
}

type jsonFields struct {
	keys []string
	vals map[string]string
}

func (p *jsonFields) putFirst(key, value string) {
	if p.vals == nil {
		p.vals = map[string]string{}
	}
	if _, exists := p.vals[key]; exists {
		return
	}
	p.vals[key] = value
	p.keys = append(p.keys, key)
}

func jsonParse(body string) (*jsonFields, bool) {
	dec := jsontext.NewDecoder(strings.NewReader(body), jsontext.AllowDuplicateNames(true))
	if dec.PeekKind() != jsontext.KindBeginObject {
		return nil, false
	}
	out := &jsonFields{}
	if err := jsonReadObject(dec, "", 0, out); err != nil {
		return nil, false
	}
	if _, err := dec.ReadToken(); !errors.Is(err, io.EOF) {
		return nil, false
	}
	return out, true
}

func jsonReadObject(dec *jsontext.Decoder, prefix string, depth int, out *jsonFields) error {
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
		name := jsonSanitizeKey(keyTok.String())
		if prefix != "" {
			name = prefix + "_" + name
		}
		if err := jsonReadValue(dec, name, depth, out); err != nil {
			return err
		}
	}
	_, err := dec.ReadToken()
	return err
}

func jsonReadValue(dec *jsontext.Decoder, name string, depth int, out *jsonFields) error {
	switch dec.PeekKind() {
	case jsontext.KindBeginObject:
		if depth+1 > jsonEqMaxDepth {
			return jsonReadCompact(dec, name, out)
		}
		return jsonReadObject(dec, name, depth+1, out)
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
		value, err := jsonFormatNumber(tok.String())
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

func jsonReadCompact(dec *jsontext.Decoder, name string, out *jsonFields) error {
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

func jsonMergeLabels(stream utm.Labels, extracted *jsonFields) utm.Labels {
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
		name := jsonRenameExtracted(key, reserved)
		if _, taken := used[name]; taken {
			continue
		}
		used[name] = struct{}{}
		b.Set(name, extracted.vals[key])
	}
	return b.Labels()
}

func jsonRenameExtracted(name string, reserved map[string]struct{}) string {
	if _, hit := reserved[name]; hit {
		return name + "_extracted"
	}
	return name
}

func jsonSanitizeKey(key string) string {
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

func jsonFormatNumber(raw string) (string, error) {
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return "", err
	}
	return strconv.FormatFloat(value, 'f', -1, 64), nil
}

func jsonLabelValue(ls utm.Labels, name string) (string, bool) {
	for _, lb := range ls {
		if lb.Name == name {
			return lb.Value, true
		}
	}
	return "", false
}
