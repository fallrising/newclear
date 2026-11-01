package clickhouse

import (
	"context"
	"errors"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

func writeInputError(class spi.ErrClass, op string) error {
	return spi.Wrap(class, "clickhouse", op, errors.New("invalid telemetry input"))
}

func unsupported(ctx context.Context, host writeHost, op string) error {
	return host.run(ctx, op, func(context.Context) error {
		return spi.Wrap(spi.ErrUnsupported, "clickhouse", op, errors.New("read operation is not implemented"))
	})
}

type byteBudget struct{ used int }

func (b *byteBudget) add(size int) bool {
	if size < 0 || size > maxBatchBytes-b.used {
		return false
	}
	b.used += size
	return true
}

func (b *byteBudget) strings(values ...string) bool {
	for _, value := range values {
		if !b.add(len(value)) {
			return false
		}
	}
	return true
}

func (b *byteBudget) stringMap(values map[string]string) bool {
	if len(values) > maxFields {
		return false
	}
	for key, value := range values {
		if !b.strings(key, value) {
			return false
		}
	}
	return true
}

func (b *byteBudget) resource(r *utm.Resource) bool {
	if r == nil || r.Tenant == "" {
		return false
	}
	return b.strings(r.Tenant, r.Service, r.ServiceInstance, r.ServiceVersion, r.Namespace, r.Host, r.Cluster, r.Env) && b.stringMap(r.Attrs)
}

func (b *byteBudget) labels(ls utm.Labels, tenant string) bool {
	if ls.Len() > maxFields {
		return false
	}
	for _, label := range ls {
		if label.Name == utm.LabelTenant && label.Value != tenant {
			return false
		}
		if !b.strings(label.Name, label.Value) {
			return false
		}
	}
	return true
}

func labelsMap(ls utm.Labels) map[string]string {
	result := make(map[string]string, ls.Len())
	for _, label := range ls {
		result[label.Name] = label.Value
	}
	return result
}

func tenantLabelConflict(ls utm.Labels, tenant string) bool {
	for _, label := range ls {
		if label.Name == utm.LabelTenant && label.Value != tenant {
			return true
		}
	}
	return false
}

func validLabels(ls utm.Labels, tenant string) bool {
	for i, label := range ls {
		if label.Name == "" || (i > 0 && ls[i-1].Name >= label.Name) {
			return false
		}
	}
	return !tenantLabelConflict(ls, tenant)
}

func tenantAttrConflict(attrs map[string]string, tenant string) bool {
	value, present := attrs[utm.LabelTenant]
	return present && value != tenant
}

func validID(s string, digits int) bool {
	if s == "" {
		return true
	}
	switch digits {
	case 16:
		return utm.ValidSpanID(s)
	case 32:
		return utm.ValidTraceID(s)
	default:
		return false
	}
}

func sendRows(ctx context.Context, conn connection, query string, rows [][]any) (result error) {
	if len(rows) == 0 {
		return nil
	}
	batch, err := conn.PrepareBatch(ctx, query)
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, batch.Close()) }()
	for _, row := range rows {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := batch.Append(row...); err != nil {
			return err
		}
	}
	return batch.Send()
}

func timestampNano(ns int64) time.Time  { return utm.NanoToTime(ns) }
func timestampMilli(ms int64) time.Time { return utm.MilliToTime(ms) }

const maxTimestampSeconds int64 = 4_294_967_296

func validNano(ns int64) bool {
	t := timestampNano(ns)
	return !t.Before(time.Unix(0, 0)) && t.Unix() < maxTimestampSeconds
}

func validMilli(ms int64) bool {
	t := timestampMilli(ms)
	return !t.Before(time.Unix(0, 0)) && t.Unix() < maxTimestampSeconds
}

func checkCount(n int, op string) error {
	if n == 0 {
		return writeInputError(spi.ErrBadRequest, op)
	}
	if n > maxBatchRecords {
		return writeInputError(spi.ErrTooLarge, op)
	}
	return nil
}

func checkContext(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return nil
}
