CREATE TABLE IF NOT EXISTS metric_series (
 fingerprint UInt64, tenant LowCardinality(String), metric LowCardinality(String),
 labels Map(LowCardinality(String), String),
 first_seen SimpleAggregateFunction(min, DateTime64(3)), last_seen SimpleAggregateFunction(max, DateTime64(3))
) ENGINE = AggregatingMergeTree PARTITION BY toYYYYMM(first_seen) ORDER BY (tenant, metric, fingerprint);

CREATE TABLE IF NOT EXISTS metric_samples (
 ts DateTime64(3) CODEC(DoubleDelta, ZSTD(1)), fingerprint UInt64 CODEC(ZSTD(1)),
 tenant LowCardinality(String), metric LowCardinality(String), value Float64 CODEC(Gorilla, ZSTD(1))
) ENGINE = MergeTree PARTITION BY toDate(ts) ORDER BY (tenant, metric, fingerprint, ts)
TTL toDateTime(ts, 'UTC') + INTERVAL {{ .MetricRetentionDays }} DAY SETTINGS ttl_only_drop_parts = 1;
