CREATE TABLE IF NOT EXISTS service_deps_1h (
 hour DateTime, tenant LowCardinality(String), parent LowCardinality(String), child LowCardinality(String),
 calls SimpleAggregateFunction(sum, UInt64), errors SimpleAggregateFunction(sum, UInt64)
) ENGINE = AggregatingMergeTree PARTITION BY toYYYYMM(hour) ORDER BY (tenant, hour, parent, child)
TTL toDateTime(hour, 'UTC') + INTERVAL {{ .REDRetentionDays }} DAY;

CREATE TABLE IF NOT EXISTS pending_links (
 ts DateTime64(9), tenant LowCardinality(String), trace_id String, parent_span_id String,
 child_service LowCardinality(String), is_error UInt8
) ENGINE = MergeTree PARTITION BY toDate(ts) ORDER BY (tenant, ts)
TTL toDateTime(ts, 'UTC') + INTERVAL 1 DAY;
