package promapi

import (
	"context"
	"errors"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/common/model"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/promql/parser"
)

func (h *QueryHandler) catalog(ctx context.Context, kind, path string, v url.Values) (any, []string, error) {
	switch kind {
	case "metadata":
		return h.metadata(ctx, v)
	case "series", "labels", "values":
	default:
		return nil, nil, qerr(spi.ErrNotFound)
	}
	if err := onlyParameters(v, "match[]", "start", "end", "limit"); err != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	if len(v["match[]"]) > 128 {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	if kind == "series" && len(v["match[]"]) == 0 {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	now := h.clock.Now()
	floor := now.Add(-time.Duration(h.config.MaxLookback))
	defaultStart := now.Add(-time.Duration(h.config.MaxRange))
	a, err := one(v, "start")
	if err != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	start, err := parseTime(a, defaultStart)
	if err != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	b, err := one(v, "end")
	if err != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	end, err := parseTime(b, now)
	if err != nil || end.Before(start) || end.After(now.Add(time.Duration(h.config.LookbackDelta))) {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	var warnings []string
	if start.Before(floor) {
		if end.Before(floor) {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
		start = floor
		warnings = append(warnings, "start time clamped to max lookback")
		h.adjust("clamp_time")
	}
	if end.Sub(start) > time.Duration(h.config.MaxRange) {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	ls, err := one(v, "limit")
	if err != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	limit, err := parseLimit(ls)
	if err != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	selectors := make([][]spi.Matcher, 0, max(1, len(v["match[]"])))
	for _, s := range v["match[]"] {
		ms, e := parseCatalogSelector(s)
		if e != nil {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
		selectors = append(selectors, ms)
	}
	if len(selectors) == 0 {
		selectors = append(selectors, nil)
	}
	if kind == "series" {
		data, more, e := h.series(ctx, selectors, start, end, limit)
		return data, append(warnings, more...), e
	}
	name := ""
	if kind == "values" {
		name = strings.TrimSuffix(strings.TrimPrefix(path, "/prom/api/v1/label/"), "/values")
		if !model.LabelName(name).IsValid() || reservedQueryLabel(name) {
			return nil, nil, qerr(spi.ErrBadRequest)
		}
	}
	data, more, e := h.labelCatalog(ctx, name, selectors, start, end, limit)
	return data, append(warnings, more...), e
}
func parseCatalogSelector(s string) ([]spi.Matcher, error) {
	if s == "" || len(s) > maxExpression {
		return nil, errors.New("empty selector")
	}
	parsed, err := parser.ParseMetricSelector(s)
	if err != nil || len(parsed) > 128 {
		return nil, errors.New("invalid selector")
	}
	positive := false
	out := make([]spi.Matcher, 0, len(parsed))
	for _, m := range parsed {
		if reservedQueryLabel(m.Name) || len(m.Name)+len(m.Value) > 1<<20 {
			return nil, errors.New("invalid matcher")
		}
		var typ spi.MatchType
		switch m.Type {
		case labels.MatchEqual:
			typ = spi.MatchEqual
		case labels.MatchNotEqual:
			typ = spi.MatchNotEqual
		case labels.MatchRegexp:
			typ = spi.MatchRegexp
		case labels.MatchNotRegexp:
			typ = spi.MatchNotRegexp
		default:
			return nil, errors.New("invalid matcher")
		}
		if (typ == spi.MatchRegexp || typ == spi.MatchNotRegexp) && len(m.Value) > 4096 {
			return nil, errors.New("regexp too long")
		}
		if !m.Matches("") {
			positive = true
		}
		converted, e := spi.NewMatcher(typ, m.Name, m.Value)
		if e != nil {
			return nil, e
		}
		out = append(out, converted)
	}
	if !positive {
		return nil, errors.New("selector matches empty")
	}
	return out, nil
}
func (h *QueryHandler) series(ctx context.Context, selectors [][]spi.Matcher, start, end time.Time, limit int) (any, []string, error) {
	result := make([]map[string]string, 0)
	seen := make(map[string]struct{})
	metadata := 0
	processed := 0
	var warnings []string
	for _, ms := range selectors {
		set, err := h.store.Select(ctx, spi.SeriesQuery{Tenant: h.tenant, Matchers: ms, Start: utm.TimeToMilli(start), End: utm.TimeToMilli(end)})
		if err != nil {
			return nil, nil, err
		}
		func() {
			defer func() {
				if closeErr := set.Close(); err == nil {
					err = closeErr
				}
			}()
			for set.Next() {
				processed++
				if processed > maxQueryResult {
					err = qerr(spi.ErrTooLarge)
					return
				}
				if ctx.Err() != nil {
					err = ctx.Err()
					return
				}
				series := set.At()
				if series == nil {
					err = qerr(spi.ErrInternal)
					return
				}
				labelSet := series.Labels()
				wire, e := labelsWire(labelSet)
				if e != nil {
					err = e
					return
				}
				key := labelSet.String()
				if _, ok := seen[key]; ok {
					continue
				}
				if len(seen) >= maxQueryResult {
					err = qerr(spi.ErrTooLarge)
					return
				}
				metadata += len(key) + 64
				if metadata > maxQueryMetadata {
					err = qerr(spi.ErrTooLarge)
					return
				}
				seen[key] = struct{}{}
				result = append(result, wire)
			}
			if err == nil {
				err = set.Err()
			}
			if err == nil {
				returned := set.Warnings()
				if len(returned) > maxQueryWarnings {
					err = qerr(spi.ErrTooLarge)
				} else if len(returned) > 0 {
					bytes := 0
					for _, warning := range returned {
						bytes += len(warning)
						if len(warning) > 4096 || bytes > 16384 {
							err = qerr(spi.ErrTooLarge)
							break
						}
					}
					if err == nil && len(warnings) == 0 {
						warnings = append(warnings, "catalog completed with backend warnings")
					}
				}
			}
		}()
		if err != nil {
			return nil, nil, err
		}
	}
	slices.SortFunc(result, func(a, b map[string]string) int { return strings.Compare(labelMapKey(a), labelMapKey(b)) })
	if limit > 0 && len(result) > limit {
		result = result[:limit]
		warnings = append(warnings, "results truncated to requested limit")
		h.adjust("truncate_results")
	}
	return result, warnings, nil
}
func labelMapKey(m map[string]string) string {
	var b strings.Builder
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		b.WriteString(key)
		b.WriteByte(0)
		b.WriteString(m[key])
		b.WriteByte(0)
	}
	return b.String()
}
func (h *QueryHandler) labelCatalog(ctx context.Context, name string, selectors [][]spi.Matcher, start, end time.Time, limit int) (any, []string, error) {
	values := make(map[string]struct{})
	metadata := 0
	processed := 0
	for _, ms := range selectors {
		q := spi.LabelQuery{Tenant: h.tenant, Matchers: ms, Start: utm.TimeToMilli(start), End: utm.TimeToMilli(end), Limit: maxQueryResult + 1}
		var got []string
		var err error
		if name == "" {
			got, err = h.store.LabelNames(ctx, q)
		} else {
			got, err = h.store.LabelValues(ctx, name, q)
		}
		if err != nil {
			return nil, nil, err
		}
		if len(got) > maxQueryResult {
			return nil, nil, qerr(spi.ErrTooLarge)
		}
		for _, value := range got {
			processed++
			if processed > maxQueryResult {
				return nil, nil, qerr(spi.ErrTooLarge)
			}
			if ctx.Err() != nil {
				return nil, nil, ctx.Err()
			}
			if name == "" && reservedQueryLabel(value) {
				continue
			}
			if _, ok := values[value]; ok {
				continue
			}
			if len(values) >= maxQueryResult {
				return nil, nil, qerr(spi.ErrTooLarge)
			}
			metadata += len(value) + 16
			if metadata > maxQueryMetadata {
				return nil, nil, qerr(spi.ErrTooLarge)
			}
			values[strings.Clone(value)] = struct{}{}
		}
	}
	// Tier-1 LabelNames implementations may omit the metric name. Probe boundedly.
	var warnings []string
	if name == "" {
		warningCount := 0
		warningBytes := 0
		for _, ms := range selectors {
			set, err := h.store.Select(ctx, spi.SeriesQuery{Tenant: h.tenant, Matchers: ms, Start: utm.TimeToMilli(start), End: utm.TimeToMilli(end), Hints: spi.SelectHints{Limit: 1}})
			if err != nil {
				return nil, nil, err
			}
			found := set.Next()
			err = set.Err()
			if err == nil {
				returned := set.Warnings()
				warningCount += len(returned)
				if warningCount > maxQueryWarnings {
					err = qerr(spi.ErrTooLarge)
				}
				if err == nil {
					for _, warning := range returned {
						warningBytes += len(warning)
						if len(warning) > 4096 || warningBytes > 16384 {
							err = qerr(spi.ErrTooLarge)
							break
						}
					}
				}
				if err == nil && len(returned) > 0 && len(warnings) == 0 {
					warnings = append(warnings, "catalog completed with backend warnings")
				}
			}
			if closeErr := set.Close(); err == nil {
				err = closeErr
			}
			if err != nil {
				return nil, nil, err
			}
			if found {
				if len(values) >= maxQueryResult {
					return nil, nil, qerr(spi.ErrTooLarge)
				}
				values["__name__"] = struct{}{}
				break
			}
		}
	}
	output := make([]string, 0, len(values))
	for value := range values {
		output = append(output, value)
	}
	slices.Sort(output)
	if limit > 0 && len(output) > limit {
		output = output[:limit]
		warnings = append(warnings, "results truncated to requested limit")
		h.adjust("truncate_results")
	}
	return output, warnings, nil
}
func (h *QueryHandler) metadata(ctx context.Context, v url.Values) (any, []string, error) {
	if err := onlyParameters(v, "metric", "limit"); err != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	metric, err := one(v, "metric")
	if err != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	ls, err := one(v, "limit")
	if err != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	limit, err := parseLimit(ls)
	if err != nil {
		return nil, nil, qerr(spi.ErrBadRequest)
	}
	output := make(map[string][]map[string]string)
	store, ok := h.store.(spi.MetadataStore)
	if !ok {
		return output, nil, nil
	}
	records, err := store.Metadata(ctx, h.tenant, metric, maxQueryResult+1)
	if err != nil {
		return nil, nil, err
	}
	if len(records) > maxQueryResult {
		return nil, nil, qerr(spi.ErrTooLarge)
	}
	bytes := 0
	count := 0
	for _, md := range records {
		if ctx.Err() != nil {
			return nil, nil, ctx.Err()
		}
		bytes += len(md.Metric) + len(md.Help) + len(md.Unit) + 64
		if bytes > maxQueryMetadata {
			return nil, nil, qerr(spi.ErrTooLarge)
		}
		if limit > 0 && count >= limit {
			continue
		}
		key := strings.Clone(md.Metric)
		output[key] = append(output[key], map[string]string{"type": md.Type.String(), "help": strings.Clone(md.Help), "unit": strings.Clone(md.Unit)})
		count++
	}
	var warnings []string
	if limit > 0 && len(records) > limit {
		warnings = append(warnings, "results truncated to requested limit")
		h.adjust("truncate_results")
	}
	return output, warnings, nil
}
