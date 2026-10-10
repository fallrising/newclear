CREATE TABLE IF NOT EXISTS service_ops (
 day DateTime, tenant LowCardinality(String), service LowCardinality(String),
 name LowCardinality(String), kind LowCardinality(String), cnt SimpleAggregateFunction(sum, UInt64)
) ENGINE = AggregatingMergeTree PARTITION BY toYYYYMM(day)
ORDER BY (tenant, service, name, kind, day) TTL toDateTime(day, 'UTC') + INTERVAL {{ .REDRetentionDays }} DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_service_ops TO service_ops AS
SELECT toDate(ts) AS day, tenant, service, name, toString(kind) AS kind, count() AS cnt
FROM spans GROUP BY day, tenant, service, name, kind;
