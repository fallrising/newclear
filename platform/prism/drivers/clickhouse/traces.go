package clickhouse

import (
	"context"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

type traceStore struct{ host writeHost }

func newTraceStore(host writeHost) spi.TraceStore { return &traceStore{host: host} }

type spanKey struct{ tenant, trace, span string }
type depKey struct {
	tenant, parent, child string
	hour                  time.Time
}
type depValue struct{ calls, errors uint64 }

func (s *traceStore) Write(ctx context.Context, spans []utm.Span) error {
	return s.host.run(ctx, "traces.write", func(ctx context.Context) error {
		if err := checkCount(len(spans), "traces.write"); err != nil {
			return err
		}
		budget := byteBudget{}
		rows := make([][]any, 0, len(spans))
		parents := make(map[spanKey]string, len(spans))
		for _, span := range spans {
			if err := checkContext(ctx); err != nil {
				return err
			}
			if span.Resource == nil || span.Resource.Tenant == "" || span.TraceID == "" || span.SpanID == "" || !validID(span.TraceID, 32) || !validID(span.SpanID, 16) || !validID(span.ParentSpanID, 16) || !validNano(span.StartNano) || !retentionSafe(timestampNano(span.StartNano), s.host.retentionDays(spi.SignalTraces)) || !validNano(span.EndNano) || span.EndNano < span.StartNano || span.Kind > utm.KindConsumer || span.StatusCode > utm.StatusError {
				return writeInputError(spi.ErrBadRequest, "traces.write")
			}
			if tenantAttrConflict(span.Attrs, span.Resource.Tenant) || tenantAttrConflict(span.Resource.Attrs, span.Resource.Tenant) {
				return writeInputError(spi.ErrBadRequest, "traces.write")
			}
			if len(span.Events) > maxNested || len(span.Links) > maxNested {
				return writeInputError(spi.ErrTooLarge, "traces.write")
			}
			if !budget.add(18) || !budget.resource(span.Resource) || !budget.stringMap(span.Attrs) || !budget.strings(span.TraceID, span.SpanID, span.ParentSpanID, span.TraceState, span.Name, span.StatusMsg) {
				return writeInputError(spi.ErrTooLarge, "traces.write")
			}
			eventTS := make([]time.Time, 0, len(span.Events))
			eventNames := make([]string, 0, len(span.Events))
			eventAttrs := make([]map[string]string, 0, len(span.Events))
			for _, event := range span.Events {
				if !validNano(event.TS) {
					return writeInputError(spi.ErrBadRequest, "traces.write")
				}
				if !budget.add(8) || !budget.strings(event.Name) || !budget.stringMap(event.Attrs) {
					return writeInputError(spi.ErrTooLarge, "traces.write")
				}
				eventTS = append(eventTS, timestampNano(event.TS))
				eventNames = append(eventNames, event.Name)
				eventAttrs = append(eventAttrs, event.Attrs)
			}
			linkTrace := make([]string, 0, len(span.Links))
			linkSpan := make([]string, 0, len(span.Links))
			linkAttrs := make([]map[string]string, 0, len(span.Links))
			for _, link := range span.Links {
				if link.TraceID == "" || link.SpanID == "" || !validID(link.TraceID, 32) || !validID(link.SpanID, 16) {
					return writeInputError(spi.ErrBadRequest, "traces.write")
				}
				if !budget.strings(link.TraceID, link.SpanID) || !budget.stringMap(link.Attrs) {
					return writeInputError(spi.ErrTooLarge, "traces.write")
				}
				linkTrace = append(linkTrace, link.TraceID)
				linkSpan = append(linkSpan, link.SpanID)
				linkAttrs = append(linkAttrs, link.Attrs)
			}
			res := span.Resource
			// Both timestamps were checked as nonnegative and ordered above.
			duration := uint64(span.EndNano - span.StartNano) // #nosec G115 -- validated nonnegative duration
			rows = append(rows, []any{timestampNano(span.StartNano), res.Tenant, span.TraceID, span.SpanID, span.ParentSpanID, res.Service, span.Name, span.Kind.String(), duration, span.StatusCode.String(), span.StatusMsg, res.Host, res.Env, span.Attrs, res.Attrs, span.TraceState, res.ServiceInstance, res.ServiceVersion, res.Namespace, res.Cluster, eventTS, eventNames, eventAttrs, linkTrace, linkSpan, linkAttrs})
			key := spanKey{res.Tenant, span.TraceID, span.SpanID}
			if old, ok := parents[key]; ok && old != res.Service {
				return writeInputError(spi.ErrBadRequest, "traces.write")
			}
			parents[key] = res.Service
		}
		deps := make(map[depKey]depValue)
		pending := make([][]any, 0)
		for _, span := range spans {
			if err := checkContext(ctx); err != nil {
				return err
			}
			if span.ParentSpanID == "" {
				continue
			}
			res := span.Resource
			parent, ok := parents[spanKey{res.Tenant, span.TraceID, span.ParentSpanID}]
			if !ok {
				value := uint8(0)
				if span.StatusCode == utm.StatusError {
					value = 1
				}
				pending = append(pending, []any{timestampNano(span.StartNano), res.Tenant, span.TraceID, span.ParentSpanID, res.Service, value})
				continue
			}
			if parent == res.Service {
				continue
			}
			key := depKey{res.Tenant, parent, res.Service, timestampNano(span.StartNano).Truncate(time.Hour)}
			value := deps[key]
			value.calls++
			if span.StatusCode == utm.StatusError {
				value.errors++
			}
			deps[key] = value
		}
		depRows := make([][]any, 0, len(deps))
		for key, value := range deps {
			depRows = append(depRows, []any{key.hour, key.tenant, key.parent, key.child, value.calls, value.errors})
		}
		conn := s.host.connection()
		if err := sendRows(ctx, conn, "INSERT INTO spans (ts,tenant,trace_id,span_id,parent_id,service,name,kind,duration_ns,status_code,status_msg,host,env,attrs,res_attrs,trace_state,service_instance,service_version,namespace,cluster,events.ts,events.name,events.attrs,links.trace_id,links.span_id,links.attrs)", rows); err != nil {
			return err
		}
		if err := sendRows(ctx, conn, "INSERT INTO service_deps_1h (hour,tenant,parent,child,calls,errors)", depRows); err != nil {
			return err
		}
		return sendRows(ctx, conn, "INSERT INTO pending_links (ts,tenant,trace_id,parent_span_id,child_service,is_error)", pending)
	})
}
