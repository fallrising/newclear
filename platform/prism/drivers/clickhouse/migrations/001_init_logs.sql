CREATE TABLE IF NOT EXISTS logs (
 ts DateTime64(9) CODEC(Delta(8), ZSTD(1)), observed_ts DateTime64(9) CODEC(Delta(8), ZSTD(1)),
 tenant LowCardinality(String), cluster LowCardinality(String), host LowCardinality(String),
 service LowCardinality(String), env LowCardinality(String),
 severity Enum8('unknown'=0,'trace'=1,'debug'=2,'info'=3,'warn'=4,'error'=5,'fatal'=6),
 severity_text LowCardinality(String), body String CODEC(ZSTD(3)), trace_id String CODEC(ZSTD(1)), span_id String CODEC(ZSTD(1)),
 labels Map(LowCardinality(String), String) CODEC(ZSTD(1)), attrs Map(LowCardinality(String), String) CODEC(ZSTD(1)),
 res_attrs Map(LowCardinality(String), String) CODEC(ZSTD(1)), service_instance String, service_version String, namespace String,
 INDEX idx_body_tokens body TYPE tokenbf_v1(30720, 3, 0) GRANULARITY 1,
 INDEX idx_trace trace_id TYPE bloom_filter(0.01) GRANULARITY 1,
 INDEX idx_label_keys mapKeys(labels) TYPE bloom_filter(0.01) GRANULARITY 1,
 INDEX idx_label_vals mapValues(labels) TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = MergeTree PARTITION BY toDate(ts) ORDER BY (tenant, service, severity, host, ts)
TTL toDateTime(ts, 'UTC') + INTERVAL {{ .LogRetentionDays }} DAY
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
