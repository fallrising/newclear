package clickhouse

import (
	"context"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

type logStore struct{ host writeHost }

func newLogStore(host writeHost) spi.LogStore { return &logStore{host: host} }

func (s *logStore) Write(ctx context.Context, records []utm.LogRecord) error {
	return s.host.run(ctx, "logs.write", func(ctx context.Context) error {
		if err := checkCount(len(records), "logs.write"); err != nil {
			return err
		}
		budget := byteBudget{}
		rows := make([][]any, 0, len(records))
		for _, r := range records {
			if err := checkContext(ctx); err != nil {
				return err
			}
			if r.Resource == nil || r.Resource.Tenant == "" || !validNano(r.TS) || !retentionSafe(timestampNano(r.TS), s.host.retentionDays(spi.SignalLogs)) || !validNano(r.ObservedTS) || !validID(r.TraceID, 32) || !validID(r.SpanID, 16) || r.Severity > utm.SevFatal {
				return writeInputError(spi.ErrBadRequest, "logs.write")
			}
			if !validLabels(r.Labels, r.Resource.Tenant) || tenantAttrConflict(r.Attrs, r.Resource.Tenant) || tenantAttrConflict(r.Resource.Attrs, r.Resource.Tenant) {
				return writeInputError(spi.ErrBadRequest, "logs.write")
			}
			if !budget.add(17) || !budget.resource(r.Resource) || !budget.labels(r.Labels, r.Resource.Tenant) || !budget.stringMap(r.Attrs) || !budget.strings(r.SeverityText, r.Body, r.TraceID, r.SpanID) {
				return writeInputError(spi.ErrTooLarge, "logs.write")
			}
			res := r.Resource
			rows = append(rows, []any{timestampNano(r.TS), timestampNano(r.ObservedTS), res.Tenant, res.Cluster, res.Host, res.Service, res.Env,
				r.Severity.String(), r.SeverityText, r.Body, r.TraceID, r.SpanID, labelsMap(r.Labels), r.Attrs,
				res.Attrs, res.ServiceInstance, res.ServiceVersion, res.Namespace})
		}
		return sendRows(ctx, s.host.connection(), "INSERT INTO logs (ts,observed_ts,tenant,cluster,host,service,env,severity,severity_text,body,trace_id,span_id,labels,attrs,res_attrs,service_instance,service_version,namespace)", rows)
	})
}

func (s *logStore) Search(ctx context.Context, _ spi.LogQuery) (spi.LogIterator, error) {
	return nil, unsupported(ctx, s.host, "logs.search")
}
func (s *logStore) LabelNames(ctx context.Context, _ spi.LabelQuery) ([]string, error) {
	return nil, unsupported(ctx, s.host, "logs.label_names")
}
func (s *logStore) LabelValues(ctx context.Context, _ string, _ spi.LabelQuery) ([]string, error) {
	return nil, unsupported(ctx, s.host, "logs.label_values")
}
