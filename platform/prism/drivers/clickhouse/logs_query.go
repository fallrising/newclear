package clickhouse

import (
	"context"
	"maps"
	"slices"
	"strings"
	"time"

	chdriver "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

func logSelectorFilter(matchers []spi.Matcher) (string, []any) {
	var sql strings.Builder
	var args []any
	for _, matcher := range matchers {
		if matcher.Name == utm.LabelTenant || matcher.Type != spi.MatchEqual && matcher.Type != spi.MatchNotEqual {
			continue
		}
		if matcher.Type == spi.MatchEqual {
			sql.WriteString(" AND labels[?] = ?")
		} else {
			sql.WriteString(" AND labels[?] != ?")
		}
		args = append(args, matcher.Name, matcher.Value)
	}
	return sql.String(), args
}

type logIterator struct {
	lease     *readLease
	selectors []spi.Matcher
	current   utm.LogRecord
}

func (i *logIterator) Next() bool {
	for {
		var ts, observed time.Time
		var tenant, cluster, host, service, env, severity, severityText, body, traceID, spanID string
		var labelMap, attrs, resAttrs map[string]string
		var serviceInstance, serviceVersion, namespace string
		var seq uint64
		ok := i.lease.Next(func(rows chdriver.Rows) (int, error) {
			if err := rows.Scan(&ts, &observed, &tenant, &cluster, &host, &service, &env, &severity, &severityText, &body, &traceID, &spanID, &labelMap, &attrs, &resAttrs, &serviceInstance, &serviceVersion, &namespace, &seq); err != nil {
				return 0, err
			}
			if !safeMap(labelMap) || !safeMap(attrs) || !safeMap(resAttrs) {
				return 0, tooLarge("logs.search")
			}
			return len(tenant) + len(cluster) + len(host) + len(service) + len(env) + len(severity) + len(severityText) + len(body) + len(traceID) + len(spanID) + len(serviceInstance) + len(serviceVersion) + len(namespace) + mapSize(labelMap) + mapSize(attrs) + mapSize(resAttrs) + 32, nil
		})
		if !ok {
			return false
		}
		if !matchesMap(labelMap, i.selectors) {
			continue
		}
		if len(attrs) == 0 {
			attrs = nil
		}
		if len(resAttrs) == 0 {
			resAttrs = nil
		}
		i.current = utm.LogRecord{Resource: &utm.Resource{Tenant: tenant, Cluster: cluster, Host: host, Service: service, Env: env, Attrs: resAttrs, ServiceInstance: serviceInstance, ServiceVersion: serviceVersion, Namespace: namespace},
			TS: utm.TimeToNano(ts), ObservedTS: utm.TimeToNano(observed), Severity: utm.ParseSeverity(severity), SeverityText: severityText, Body: body, TraceID: traceID, SpanID: spanID, Labels: labels.FromMap(labelMap), Attrs: attrs}
		return true
	}
}
func (i *logIterator) At() utm.LogRecord { return i.current }
func (i *logIterator) Err() error        { return i.lease.Err() }
func (i *logIterator) Close() error      { return i.lease.Close() }

func (s *logStore) Search(ctx context.Context, q spi.LogQuery) (spi.LogIterator, error) {
	b, err := queryBackend(ctx, s.host, "logs.search")
	if err != nil {
		return nil, err
	}
	if err := validateMatchers(q.Selectors, q.Tenant, "logs.search"); err != nil {
		return nil, err
	}
	if q.Direction != spi.Forward && q.Direction != spi.Backward {
		return nil, inputError("logs.search", "invalid direction")
	}
	start, end, ok := nanoRange(q.Start, q.End)
	if !ok {
		return spi.EmptyLogIterator(), nil
	}
	filter, filterArgs := logSelectorFilter(q.Selectors)
	direction := " DESC"
	if q.Direction == spi.Forward {
		direction = " ASC"
	}
	sql := "SELECT ts,observed_ts,tenant,cluster,host,service,env,toString(severity),severity_text,body,trace_id,span_id,labels,attrs,res_attrs,service_instance,service_version,namespace,write_seq FROM logs WHERE tenant = ? AND ts >= fromUnixTimestamp64Nano(?) AND ts < fromUnixTimestamp64Nano(?)" + filter +
		" ORDER BY ts" + direction + ", write_seq ASC, observed_ts ASC, cluster ASC, host ASC, service ASC, env ASC, toString(severity) ASC, severity_text ASC, body ASC, trace_id ASC, span_id ASC, arraySort(arrayZip(mapKeys(labels),mapValues(labels))) ASC, arraySort(arrayZip(mapKeys(attrs),mapValues(attrs))) ASC, arraySort(arrayZip(mapKeys(res_attrs),mapValues(res_attrs))) ASC, service_instance ASC, service_version ASC, namespace ASC" + querySettings(b.opts)
	args := append([]any{q.Tenant, start, end}, filterArgs...)
	lease, err := b.queryRows(ctx, "logs.search", sql, args...)
	if err != nil {
		return nil, err
	}
	return &logIterator{lease: lease, selectors: q.Selectors}, nil
}

func (s *logStore) liveLabels(ctx context.Context, q spi.LabelQuery, op string) ([]map[string]string, error) {
	b, err := queryBackend(ctx, s.host, op)
	if err != nil {
		return nil, err
	}
	if err := validateMatchers(q.Matchers, q.Tenant, op); err != nil {
		return nil, err
	}
	start, end, ok := nanoRange(q.Start, q.End)
	if !ok {
		return []map[string]string{}, nil
	}
	filter, filterArgs := logSelectorFilter(q.Matchers)
	sql := "SELECT labels FROM logs WHERE tenant = ? AND ts >= fromUnixTimestamp64Nano(?) AND ts < fromUnixTimestamp64Nano(?)" + filter + querySettings(b.opts)
	args := append([]any{q.Tenant, start, end}, filterArgs...)
	result := make([]map[string]string, 0)
	err = b.read(ctx, op, sql, args, func(rows chdriver.Rows, budget *queryBudget) error {
		for rows.Next() {
			if err := ctx.Err(); err != nil {
				return err
			}
			var values map[string]string
			if err := rows.Scan(&values); err != nil {
				return err
			}
			if !safeMap(values) {
				return tooLarge(op)
			}
			if err := budget.add(mapSize(values) + 8); err != nil {
				return err
			}
			if matchesMap(values, q.Matchers) {
				result = append(result, values)
			}
		}
		return nil
	})
	return result, err
}

func (s *logStore) LabelNames(ctx context.Context, q spi.LabelQuery) ([]string, error) {
	items, err := s.liveLabels(ctx, q, "logs.label_names")
	if err != nil {
		return nil, err
	}
	names := map[string]struct{}{}
	for _, values := range items {
		for name := range values {
			if !utm.IsReserved(name) {
				names[name] = struct{}{}
			}
		}
	}
	result := slices.Sorted(maps.Keys(names))
	if q.Limit > 0 && len(result) > q.Limit {
		result = result[:q.Limit]
	}
	return result, nil
}
func (s *logStore) LabelValues(ctx context.Context, name string, q spi.LabelQuery) ([]string, error) {
	if err := validateLabelName(name, "logs.label_values"); err != nil {
		return nil, err
	}
	items, err := s.liveLabels(ctx, q, "logs.label_values")
	if err != nil {
		return nil, err
	}
	values := map[string]struct{}{}
	for _, item := range items {
		if value, ok := item[name]; ok {
			values[value] = struct{}{}
		}
	}
	result := slices.Sorted(maps.Keys(values))
	if q.Limit > 0 && len(result) > q.Limit {
		result = result[:q.Limit]
	}
	return result, nil
}
