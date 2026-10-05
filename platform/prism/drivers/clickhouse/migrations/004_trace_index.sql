CREATE TABLE IF NOT EXISTS trace_index (
 trace_id String, tenant LowCardinality(String),
 start_ts SimpleAggregateFunction(min, DateTime64(9)), end_ts SimpleAggregateFunction(max, DateTime64(9)),
 services SimpleAggregateFunction(groupUniqArrayArray, Array(String)),
 span_count SimpleAggregateFunction(sum, UInt64), error_count SimpleAggregateFunction(sum, UInt64),
 duration_ns SimpleAggregateFunction(max, UInt64)
) ENGINE = AggregatingMergeTree PARTITION BY toDate(start_ts) ORDER BY (tenant, trace_id)
TTL toDateTime(start_ts, 'UTC') + INTERVAL {{ .TraceRetentionDays }} DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_trace_index TO trace_index AS
SELECT trace_id, tenant, min(ts) AS start_ts, max(ts) AS end_ts,
 groupUniqArray(service) AS services, count() AS span_count,
 countIf(status_code = 'error') AS error_count, max(duration_ns) AS duration_ns
FROM spans GROUP BY tenant, trace_id;
