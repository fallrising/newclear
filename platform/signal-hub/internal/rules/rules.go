// Package rules validates and evaluates the constrained metric rule language.
package rules

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/cyberphone/json-canonicalization/go/src/webpki.org/jsoncanonicalizer"
	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
)

type Rule struct {
	ID          string      `json:"id"`
	Version     int         `json:"version"`
	Title       string      `json:"title"`
	Filter      Filter      `json:"filter"`
	Aggregation Aggregation `json:"aggregation"`
	Bucket      string      `json:"bucket"`
	GroupBy     []string    `json:"group_by,omitempty"`
	Threshold   *Threshold  `json:"threshold,omitempty"`
}
type Filter struct {
	Types         []string       `json:"types,omitempty"`
	Sources       []string       `json:"sources,omitempty"`
	SeverityMin   string         `json:"severity_min,omitempty"`
	SubjectPrefix string         `json:"subject_prefix,omitempty"`
	Data          map[string]any `json:"data,omitempty"`
}
type Aggregation struct {
	Fn    string `json:"fn"`
	Field string `json:"field,omitempty"`
}
type Threshold struct {
	Op         string  `json:"op"`
	Value      float64 `json:"value"`
	ForBuckets int     `json:"for_buckets"`
	Severity   string  `json:"severity"`
}

var identifier = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)
var field = regexp.MustCompile(`^(source|type|subject|severity|data\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,2})$`)
var dataPath = regexp.MustCompile(`^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,2}$`)
var typePattern = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+(\.\*)?$`)
var sourcePattern = regexp.MustCompile(`^[^*]+\*?$`)
var severity = map[string]int{"debug": 0, "info": 1, "notice": 2, "warning": 3, "error": 4, "critical": 5}

// Parse rejects unknown/duplicate members, null structural values, and recursive rules.
func Parse(raw []json.RawMessage) ([]Rule, error) {
	out := make([]Rule, 0, len(raw))
	seen := map[string]bool{}
	for _, item := range raw {
		decoded, err := event.Decode(item)
		if err != nil {
			return nil, fmt.Errorf("invalid rule JSON: %w", err)
		}
		obj, ok := decoded.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("rule must be an object")
		}
		for _, key := range []string{"id", "version", "title", "filter", "aggregation", "bucket"} {
			if obj[key] == nil {
				return nil, fmt.Errorf("rule requires %s", key)
			}
		}
		for key, value := range obj {
			if value == nil {
				return nil, fmt.Errorf("rule %s cannot be null", key)
			}
		}
		for _, key := range []string{"filter", "aggregation", "threshold"} {
			value, exists := obj[key]
			if !exists {
				continue
			}
			nested, ok := value.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("%s must be an object", key)
			}
			for name, value := range nested {
				if value == nil {
					return nil, fmt.Errorf("%s.%s cannot be null", key, name)
				}
			}
		}
		agg := obj["aggregation"].(map[string]any)
		if agg["fn"] == nil {
			return nil, fmt.Errorf("aggregation requires fn")
		}
		if value, exists := obj["threshold"]; exists {
			for _, key := range []string{"op", "value", "for_buckets", "severity"} {
				if value.(map[string]any)[key] == nil {
					return nil, fmt.Errorf("threshold requires %s", key)
				}
			}
		}
		canonical, err := Canonical(obj)
		if err != nil {
			return nil, fmt.Errorf("invalid canonical rule: %w", err)
		}
		d := json.NewDecoder(bytes.NewReader(canonical))
		d.DisallowUnknownFields()
		d.UseNumber()
		var r Rule
		if err := d.Decode(&r); err != nil {
			return nil, fmt.Errorf("invalid rule: %w", err)
		}
		if !identifier.MatchString(r.ID) || r.Version < 1 || r.Title == "" {
			return nil, fmt.Errorf("invalid rule identity")
		}
		if seen[r.ID] {
			return nil, fmt.Errorf("duplicate rule id %s", r.ID)
		}
		seen[r.ID] = true
		if len(r.Filter.Types) == 0 {
			return nil, fmt.Errorf("rule requires explicit types")
		}
		for _, pattern := range r.Filter.Types {
			if !typePattern.MatchString(pattern) || matches(pattern, "signalhub.rule.example") || strings.HasPrefix(pattern, "signalhub.rule.") {
				return nil, fmt.Errorf("invalid or recursive type filter")
			}
		}
		if duplicate(r.Filter.Types) {
			return nil, fmt.Errorf("duplicate type filter")
		}
		if value, exists := obj["filter"].(map[string]any)["sources"]; exists {
			if len(r.Filter.Sources) == 0 || value == nil {
				return nil, fmt.Errorf("sources cannot be empty")
			}
		}
		for _, pattern := range r.Filter.Sources {
			if !sourcePattern.MatchString(pattern) {
				return nil, fmt.Errorf("invalid source filter")
			}
		}
		if duplicate(r.Filter.Sources) {
			return nil, fmt.Errorf("duplicate source filter")
		}
		if r.Filter.SeverityMin != "" {
			if _, ok := severity[r.Filter.SeverityMin]; !ok {
				return nil, fmt.Errorf("invalid severity")
			}
		} else if _, exists := obj["filter"].(map[string]any)["severity_min"]; exists {
			return nil, fmt.Errorf("empty severity")
		}
		for path, value := range r.Filter.Data {
			if !dataPath.MatchString(path) {
				return nil, fmt.Errorf("invalid data path")
			}
			switch value.(type) {
			case nil, string, bool, json.Number:
			default:
				return nil, fmt.Errorf("data comparison requires scalar")
			}
		}
		if !slices.Contains([]string{"count", "count_distinct", "sum", "min", "max", "avg"}, r.Aggregation.Fn) {
			return nil, fmt.Errorf("invalid aggregate")
		}
		if r.Aggregation.Fn == "count" {
			if r.Aggregation.Field != "" {
				return nil, fmt.Errorf("count forbids field")
			}
		} else if !field.MatchString(r.Aggregation.Field) {
			return nil, fmt.Errorf("aggregate requires field")
		}
		if !slices.Contains([]string{"5m", "1h", "1d"}, r.Bucket) {
			return nil, fmt.Errorf("invalid bucket")
		}
		if len(r.GroupBy) > 2 || duplicate(r.GroupBy) {
			return nil, fmt.Errorf("invalid grouping")
		}
		for _, v := range r.GroupBy {
			if !field.MatchString(v) {
				return nil, fmt.Errorf("invalid group field")
			}
		}
		if r.Threshold != nil {
			v := r.Threshold
			_, ok := severity[v.Severity]
			if !ok || v.ForBuckets < 1 || math.IsInf(v.Value, 0) || math.IsNaN(v.Value) || !slices.Contains([]string{">", ">=", "<", "<=", "==", "!="}, v.Op) {
				return nil, fmt.Errorf("invalid threshold")
			}
		}
		out = append(out, r)
	}
	return out, nil
}
func duplicate(values []string) bool {
	seen := map[string]bool{}
	for _, v := range values {
		if seen[v] {
			return true
		}
		seen[v] = true
	}
	return false
}
func matches(pattern, value string) bool {
	if prefix, ok := strings.CutSuffix(pattern, "*"); ok {
		return strings.HasPrefix(value, prefix)
	}
	return pattern == value
}
func (r Rule) Duration() time.Duration {
	switch r.Bucket {
	case "5m":
		return 5 * time.Minute
	case "1h":
		return time.Hour
	default:
		return 24 * time.Hour
	}
}
func (r Rule) Start(t time.Time) time.Time { return t.UTC().Truncate(r.Duration()) }
func Canonical(value any) ([]byte, error) {
	// The JCS implementation accepts only container roots. Wrapping also gives
	// scalars their canonical representation without coercing JSON types.
	raw, err := json.Marshal([]any{value})
	if err != nil {
		return nil, err
	}
	canonical, err := jsoncanonicalizer.Transform(raw)
	if err != nil {
		return nil, err
	}
	return canonical[1 : len(canonical)-1], nil
}
func (r Rule) Hash() (string, error) {
	raw, err := Canonical(r)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:]), nil
}

// Lookup distinguishes explicit null from a missing path.
func Lookup(fields map[string]any, path string) (any, bool) {
	var current any = fields
	for part := range strings.SplitSeq(path, ".") {
		obj, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		current, ok = obj[part]
		if !ok {
			return nil, false
		}
	}
	return current, true
}
func (r Rule) Matches(fields map[string]any) bool {
	for _, pair := range []struct {
		patterns []string
		key      string
	}{{r.Filter.Types, "type"}, {r.Filter.Sources, "source"}} {
		if len(pair.patterns) == 0 {
			continue
		}
		value, _ := fields[pair.key].(string)
		found := false
		for _, p := range pair.patterns {
			if matches(p, value) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	if r.Filter.SeverityMin != "" {
		v, _ := fields["severity"].(string)
		if v == "" {
			v = "info"
		}
		if severity[v] < severity[r.Filter.SeverityMin] {
			return false
		}
	}
	subject, _ := fields["subject"].(string)
	if !strings.HasPrefix(subject, r.Filter.SubjectPrefix) {
		return false
	}
	for path, want := range r.Filter.Data {
		got, ok := Lookup(fields, "data."+path)
		if !ok {
			return false
		}
		a, err := Canonical(got)
		if err != nil {
			return false
		}
		b, err := Canonical(want)
		if err != nil || !bytes.Equal(a, b) {
			return false
		}
	}
	return true
}
func (r Rule) GroupKey(fields map[string]any) (string, error) {
	values := make([]any, len(r.GroupBy))
	for i, path := range r.GroupBy {
		values[i], _ = Lookup(fields, path)
	}
	raw, err := Canonical(values)
	return string(raw), err
}
func (t Threshold) Satisfied(value *float64) bool {
	if value == nil {
		return false
	}
	switch t.Op {
	case ">":
		return *value > t.Value
	case ">=":
		return *value >= t.Value
	case "<":
		return *value < t.Value
	case "<=":
		return *value <= t.Value
	case "==":
		return *value == t.Value
	case "!=":
		return *value != t.Value
	}
	return false
}
