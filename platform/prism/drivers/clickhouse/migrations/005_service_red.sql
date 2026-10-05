CREATE TABLE IF NOT EXISTS service_red_1m (
 minute DateTime, tenant LowCardinality(String), service LowCardinality(String),
 name LowCardinality(String), kind LowCardinality(String),
 requests SimpleAggregateFunction(sum, UInt64), errors SimpleAggregateFunction(sum, UInt64),
 lat AggregateFunction(quantiles(0.5, 0.9, 0.95, 0.99), UInt64), lat_sum SimpleAggregateFunction(sum, UInt64)
) ENGINE = AggregatingMergeTree PARTITION BY toYYYYMM(minute)
ORDER BY (tenant, service, name, kind, minute) TTL toDateTime(minute, 'UTC') + INTERVAL {{ .REDRetentionDays }} DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_service_red_1m TO service_red_1m AS
SELECT toStartOfMinute(ts) AS minute, tenant, service, name, toString(kind) AS kind,
 count() AS requests, countIf(status_code = 'error') AS errors,
 quantilesState(0.5, 0.9, 0.95, 0.99)(duration_ns) AS lat, sum(duration_ns) AS lat_sum
FROM spans WHERE kind IN ('server', 'consumer') GROUP BY minute, tenant, service, name, kind;
