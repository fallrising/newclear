package clickhouse

import (
	"context"
	"errors"
	"maps"
	"math"
	"slices"
	"strings"
	"time"

	chdriver "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

type spanIterator struct {
	lease   *readLease
	current utm.Span
}

func (i *spanIterator) Next() bool {
	var ts time.Time
	var tenant, traceID, spanID, parentID, service, name, kind, status, statusMsg, host, env string
	var duration uint64
	var attrs, resAttrs map[string]string
	var traceState, serviceInstance, serviceVersion, namespace, cluster string
	var eventTS []time.Time
	var eventNames []string
	var eventAttrs []map[string]string
	var linkTraces, linkSpans []string
	var linkAttrs []map[string]string
	ok := i.lease.Next(func(rows chdriver.Rows) (int, error) {
		if err := rows.Scan(&ts, &tenant, &traceID, &spanID, &parentID, &service, &name, &kind, &duration, &status, &statusMsg, &host, &env, &attrs, &resAttrs, &traceState, &serviceInstance, &serviceVersion, &namespace, &cluster, &eventTS, &eventNames, &eventAttrs, &linkTraces, &linkSpans, &linkAttrs); err != nil {
			return 0, err
		}
		if !safeMap(attrs) || !safeMap(resAttrs) || len(eventTS) != len(eventNames) || len(eventTS) != len(eventAttrs) || len(linkTraces) != len(linkSpans) || len(linkTraces) != len(linkAttrs) || len(eventTS) > maxNested || len(linkTraces) > maxNested {
			return 0, tooLarge("traces.get_trace")
		}
		size := len(tenant) + len(traceID) + len(spanID) + len(parentID) + len(service) + len(name) + len(kind) + len(status) + len(statusMsg) + len(host) + len(env) + len(traceState) + len(serviceInstance) + len(serviceVersion) + len(namespace) + len(cluster) + mapSize(attrs) + mapSize(resAttrs) + 32
		for n := range eventTS {
			if !safeMap(eventAttrs[n]) {
				return 0, tooLarge("traces.get_trace")
			}
			size += len(eventNames[n]) + mapSize(eventAttrs[n]) + 8
		}
		for n := range linkTraces {
			if !safeMap(linkAttrs[n]) {
				return 0, tooLarge("traces.get_trace")
			}
			size += len(linkTraces[n]) + len(linkSpans[n]) + mapSize(linkAttrs[n])
		}
		return size, nil
	})
	if !ok {
		return false
	}
	start := utm.TimeToNano(ts)
	if duration > math.MaxInt64 || start > math.MaxInt64-int64(duration) {
		i.lease.mu.Lock()
		i.lease.finish(spi.Wrap(spi.ErrInternal, driverName, "traces.get_trace", errors.New("span duration overflow")))
		i.lease.mu.Unlock()
		return false
	}
	if len(attrs) == 0 {
		attrs = nil
	}
	if len(resAttrs) == 0 {
		resAttrs = nil
	}
	events := make([]utm.SpanEvent, len(eventTS))
	for n := range eventTS {
		if len(eventAttrs[n]) == 0 {
			eventAttrs[n] = nil
		}
		events[n] = utm.SpanEvent{TS: utm.TimeToNano(eventTS[n]), Name: eventNames[n], Attrs: eventAttrs[n]}
	}
	if len(events) == 0 {
		events = nil
	}
	links := make([]utm.SpanLink, len(linkTraces))
	for n := range linkTraces {
		if len(linkAttrs[n]) == 0 {
			linkAttrs[n] = nil
		}
		links[n] = utm.SpanLink{TraceID: linkTraces[n], SpanID: linkSpans[n], Attrs: linkAttrs[n]}
	}
	if len(links) == 0 {
		links = nil
	}
	statusCode := utm.StatusUnset
	switch status {
	case "ok":
		statusCode = utm.StatusOK
	case "error":
		statusCode = utm.StatusError
	case "unset":
	default:
		i.lease.mu.Lock()
		i.lease.finish(spi.Wrap(spi.ErrInternal, driverName, "traces.get_trace", errors.New("invalid span status")))
		i.lease.mu.Unlock()
		return false
	}
	i.current = utm.Span{Resource: &utm.Resource{Tenant: tenant, Service: service, Host: host, Env: env, Attrs: resAttrs, ServiceInstance: serviceInstance, ServiceVersion: serviceVersion, Namespace: namespace, Cluster: cluster},
		TraceID: traceID, SpanID: spanID, ParentSpanID: parentID, TraceState: traceState, Name: name, Kind: utm.ParseSpanKind(kind), StartNano: start, EndNano: start + int64(duration), StatusCode: statusCode, StatusMsg: statusMsg, Attrs: attrs, Events: events, Links: links}
	return true
}
func (i *spanIterator) At() utm.Span { return i.current }
func (i *spanIterator) Err() error   { return i.lease.Err() }
func (i *spanIterator) Close() error { return i.lease.Close() }

func (s *traceStore) GetTrace(ctx context.Context, tenant, traceID string) (spi.SpanIterator, error) {
	b, err := queryBackend(ctx, s.host, "traces.get_trace")
	if err != nil {
		return nil, err
	}
	if tenant == "" || !utm.ValidTraceID(traceID) {
		return nil, inputError("traces.get_trace", "invalid trace identity")
	}
	sql := "SELECT ts,tenant,trace_id,span_id,parent_id,service,name,toString(kind),duration_ns,toString(status_code),status_msg,host,env,attrs,res_attrs,trace_state,service_instance,service_version,namespace,cluster,`events.ts`,`events.name`,`events.attrs`,`links.trace_id`,`links.span_id`,`links.attrs` FROM spans WHERE tenant = ? AND trace_id = ? ORDER BY ts,span_id" + querySettings(b.opts)
	lease, err := b.queryRows(ctx, "traces.get_trace", sql, tenant, traceID)
	if err != nil {
		return nil, err
	}
	return &spanIterator{lease: lease}, nil
}

func (s *traceStore) FindTraceIDs(ctx context.Context, q spi.TraceQuery) ([]spi.TraceIDWithTime, error) {
	b, err := queryBackend(ctx, s.host, "traces.find_trace_ids")
	if err != nil {
		return nil, err
	}
	if q.Tenant == "" {
		return nil, inputError("traces.find_trace_ids", "invalid trace query")
	}
	start, end, ok := nanoRange(q.Start, q.End)
	if !ok {
		return []spi.TraceIDWithTime{}, nil
	}
	var where strings.Builder
	where.WriteString("tenant = ? AND service = ? AND ts >= fromUnixTimestamp64Nano(?) AND ts < fromUnixTimestamp64Nano(?)")
	args := []any{q.Tenant, q.Service, start, end}
	if q.Operation != "" {
		where.WriteString(" AND name = ?")
		args = append(args, q.Operation)
	}
	if q.SpanKind != "" {
		where.WriteString(" AND toString(kind) = ?")
		args = append(args, q.SpanKind)
	}
	for _, tag := range slices.Sorted(maps.Keys(q.Tags)) {
		where.WriteString(" AND attrs[?] = ?")
		args = append(args, tag, q.Tags[tag])
	}
	matched := "SELECT trace_id,min(toUnixTimestamp64Nano(ts)) AS first_ns,max(toUnixTimestamp64Nano(ts) + toInt64(duration_ns)) AS last_ns FROM spans WHERE " + where.String() + " GROUP BY trace_id"
	sql := "SELECT m.trace_id,m.first_ns,m.last_ns,if(d.roots > 0,d.root_dur,d.any_dur) AS trace_dur FROM (" + matched + ") AS m INNER JOIN (SELECT trace_id,countIf(parent_id = '') AS roots,maxIf(duration_ns,parent_id = '') AS root_dur,max(duration_ns) AS any_dur FROM spans WHERE tenant = ? AND trace_id IN (SELECT trace_id FROM (" + matched + ")) GROUP BY trace_id) AS d ON m.trace_id = d.trace_id WHERE trace_dur >= ? AND trace_dur <= ? ORDER BY m.first_ns DESC,m.trace_id ASC"
	args2 := append(slices.Clone(args), q.Tenant)
	args2 = append(args2, args...)
	maximum := uint64(math.MaxInt64)
	if q.MaxDuration > 0 {
		maximum = uint64(q.MaxDuration)
	}
	minimum := uint64(0)
	if q.MinDuration > 0 {
		minimum = uint64(q.MinDuration)
	}
	args2 = append(args2, minimum, maximum)
	if q.Limit > 0 {
		sql += " LIMIT ?"
		args2 = append(args2, q.Limit)
	}
	sql += querySettings(b.opts)
	result := make([]spi.TraceIDWithTime, 0)
	err = b.read(ctx, "traces.find_trace_ids", sql, args2, func(rows chdriver.Rows, budget *queryBudget) error {
		for rows.Next() {
			if err := ctx.Err(); err != nil {
				return err
			}
			var item spi.TraceIDWithTime
			var duration uint64
			if err := rows.Scan(&item.TraceID, &item.StartNano, &item.EndNano, &duration); err != nil {
				return err
			}
			if err := budget.add(len(item.TraceID) + 32); err != nil {
				return err
			}
			result = append(result, item)
		}
		return nil
	})
	return result, err
}

func (s *traceStore) Services(ctx context.Context, tenant string, tr spi.TimeRange) ([]string, error) {
	b, err := queryBackend(ctx, s.host, "traces.services")
	if err != nil {
		return nil, err
	}
	if tenant == "" {
		return nil, inputError("traces.services", "tenant is required")
	}
	start, end, ok := nanoRange(tr.Start, tr.End)
	if !ok {
		return []string{}, nil
	}
	sql := "SELECT DISTINCT service FROM spans WHERE tenant = ? AND service != '' AND ts >= fromUnixTimestamp64Nano(?) AND ts < fromUnixTimestamp64Nano(?) ORDER BY service" + querySettings(b.opts)
	result := make([]string, 0)
	err = b.read(ctx, "traces.services", sql, []any{tenant, start, end}, func(rows chdriver.Rows, budget *queryBudget) error {
		for rows.Next() {
			if err := ctx.Err(); err != nil {
				return err
			}
			var service string
			if err := rows.Scan(&service); err != nil {
				return err
			}
			if err := budget.add(len(service)); err != nil {
				return err
			}
			result = append(result, service)
		}
		return nil
	})
	return result, err
}

func (s *traceStore) Operations(ctx context.Context, tenant, service, spanKind string, tr spi.TimeRange) ([]spi.Operation, error) {
	b, err := queryBackend(ctx, s.host, "traces.operations")
	if err != nil {
		return nil, err
	}
	if tenant == "" {
		return nil, inputError("traces.operations", "tenant is required")
	}
	start, end, ok := nanoRange(tr.Start, tr.End)
	if !ok {
		return []spi.Operation{}, nil
	}
	sql := "SELECT DISTINCT name,toString(kind) FROM spans WHERE tenant = ? AND service = ? AND ts >= fromUnixTimestamp64Nano(?) AND ts < fromUnixTimestamp64Nano(?)"
	args := []any{tenant, service, start, end}
	if spanKind != "" {
		sql += " AND toString(kind) = ?"
		args = append(args, spanKind)
	}
	sql += " ORDER BY name,toString(kind)" + querySettings(b.opts)
	result := make([]spi.Operation, 0)
	err = b.read(ctx, "traces.operations", sql, args, func(rows chdriver.Rows, budget *queryBudget) error {
		for rows.Next() {
			if err := ctx.Err(); err != nil {
				return err
			}
			var item spi.Operation
			if err := rows.Scan(&item.Name, &item.SpanKind); err != nil {
				return err
			}
			if err := budget.add(len(item.Name) + len(item.SpanKind)); err != nil {
				return err
			}
			result = append(result, item)
		}
		return nil
	})
	return result, err
}
