CREATE TABLE IF NOT EXISTS spans (
 ts DateTime64(9) CODEC(Delta(8), ZSTD(1)), tenant LowCardinality(String), trace_id String CODEC(ZSTD(1)),
 span_id String CODEC(ZSTD(1)), parent_id String CODEC(ZSTD(1)), service LowCardinality(String), name LowCardinality(String),
 kind Enum8('unspecified'=0,'internal'=1,'server'=2,'client'=3,'producer'=4,'consumer'=5),
 duration_ns UInt64 CODEC(T64, ZSTD(1)), status_code Enum8('unset'=0,'ok'=1,'error'=2), status_msg String CODEC(ZSTD(1)),
 host LowCardinality(String), env LowCardinality(String), attrs Map(LowCardinality(String), String) CODEC(ZSTD(1)),
 res_attrs Map(LowCardinality(String), String) CODEC(ZSTD(1)), trace_state String,
 service_instance String, service_version String, namespace String, cluster String,
 events Nested(ts DateTime64(9), name String, attrs Map(String,String)),
 links Nested(trace_id String, span_id String, attrs Map(String,String)),
 INDEX idx_trace trace_id TYPE bloom_filter(0.01) GRANULARITY 1,
 INDEX idx_duration duration_ns TYPE minmax GRANULARITY 1,
 INDEX idx_attr_keys mapKeys(attrs) TYPE bloom_filter(0.01) GRANULARITY 1
) ENGINE = MergeTree PARTITION BY toDate(ts) ORDER BY (tenant, service, name, ts)
TTL toDateTime(ts, 'UTC') + INTERVAL {{ .TraceRetentionDays }} DAY
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
