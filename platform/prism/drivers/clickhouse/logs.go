package clickhouse

import (
	"context"
	"errors"
	"math"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

type logStore struct {
	host   writeHost
	gate   chan struct{}
	seq    uint64
	seeded bool
}

func newLogStore(host writeHost) spi.LogStore {
	return &logStore{host: host, gate: make(chan struct{}, 1)}
}

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
		select {
		case s.gate <- struct{}{}:
			defer func() { <-s.gate }()
		case <-ctx.Done():
			return ctx.Err()
		}
		if !s.seeded {
			if err := s.seed(ctx); err != nil {
				return err
			}
		}
		if uint64(len(rows)) > math.MaxUint64-s.seq {
			return writeInputError(spi.ErrTooLarge, "logs.write")
		}
		for i := range rows {
			s.seq++
			rows[i] = append(rows[i], s.seq)
		}
		return sendRows(ctx, s.host.connection(), "INSERT INTO logs (ts,observed_ts,tenant,cluster,host,service,env,severity,severity_text,body,trace_id,span_id,labels,attrs,res_attrs,service_instance,service_version,namespace,write_seq)", rows)
	})
}

func (s *logStore) seed(ctx context.Context) (result error) {
	var opts options
	if b, ok := s.host.(*backend); ok {
		opts = b.opts
	}
	rows, err := s.host.connection().Query(ctx, "SELECT max(write_seq) FROM logs LIMIT 1"+querySettings(opts))
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, rows.Close()) }()
	if !rows.Next() {
		return errors.New("missing log sequence seed")
	}
	if err := rows.Scan(&s.seq); err != nil {
		return err
	}
	if rows.Next() {
		return errors.New("duplicate log sequence seed")
	}
	if err := rows.Err(); err != nil {
		return err
	}
	s.seeded = true
	return nil
}
