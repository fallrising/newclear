// Package telemetry defines Prism's self-telemetry contract.
package telemetry

import "slices"

// MetricType is the Prometheus metric type used by a definition.
type MetricType string

const (
	// MetricTypeCounter is a monotonically increasing counter.
	MetricTypeCounter MetricType = "counter"
	// MetricTypeGauge is a value that may increase or decrease.
	MetricTypeGauge MetricType = "gauge"
	// MetricTypeHistogram samples observations into buckets.
	MetricTypeHistogram MetricType = "histogram"
)

// CardinalityGroup associates a metric with its cardinality budget.
type CardinalityGroup string

const (
	CardinalityIngest       CardinalityGroup = "ingest"
	CardinalityStorage      CardinalityGroup = "storage"
	CardinalityQuery        CardinalityGroup = "query"
	CardinalityRules        CardinalityGroup = "rules"
	CardinalityNotification CardinalityGroup = "notification"
	CardinalityAgent        CardinalityGroup = "agent"
	CardinalityControlPlane CardinalityGroup = "control_plane"
	CardinalityRuntime      CardinalityGroup = "runtime"
)

const (
	// DetailedRulesGate enables labels that grow with the number of rules.
	DetailedRulesGate = "telemetry.detailed_rules"
	// DetailedAgentGate enables labels that grow with the number of tailed files.
	DetailedAgentGate = "agent.detailed_metrics"
)

// Definition describes one metric family in the self-telemetry contract.
// DetailGate is non-empty when population of the high-cardinality dimension
// must remain disabled unless the named setting is enabled.
type Definition struct {
	Name             string
	Type             MetricType
	Labels           []string
	Help             string
	CardinalityGroup CardinalityGroup
	DetailGate       string
}

// CardinalityBudget documents how a metric group is bounded. These entries
// mirror docs/sdd/20-SELF-TELEMETRY-REGISTRY.md section 10 and extend the table
// to the control-plane and runtime families so every definition is covered.
type CardinalityBudget struct {
	Group          CardinalityGroup
	Estimate       string
	LimitMechanism string
}

type bucketProfile uint8

const (
	noBuckets bucketProfile = iota
	durationBuckets
	countBuckets
	byteBuckets
)

type metricDefinition struct {
	Definition
	buckets bucketProfile
}

var metricDefinitions = []metricDefinition{
	// Ingest.
	counter("prism_ingest_received_total", "Number of telemetry items received before validation.", CardinalityIngest, "signal", "tenant", "protocol"),
	counter("prism_ingest_received_bytes_total", "Number of decompressed telemetry bytes received.", CardinalityIngest, "signal", "tenant", "protocol"),
	counter("prism_ingest_accepted_total", "Number of telemetry items accepted into the batcher.", CardinalityIngest, "signal", "tenant"),
	counter("prism_ingest_rejected_total", "Number of telemetry items synchronously rejected.", CardinalityIngest, "signal", "tenant", "reason"),
	counter("prism_ingest_dropped_total", "Number of accepted telemetry items later dropped.", CardinalityIngest, "signal", "tenant", "reason"),
	counter("prism_ingest_normalized_total", "Number of telemetry normalization actions applied.", CardinalityIngest, "signal", "action"),
	counter("prism_ingest_high_cardinality_total", "Number of high-cardinality alarms triggered.", CardinalityIngest, "tenant", "metric", "label"),
	gauge("prism_ingest_active_series", "Estimated number of active series.", CardinalityIngest, "tenant"),
	gauge("prism_ingest_queue_depth", "Current ingest queue depth.", CardinalityIngest, "signal", "priority"),
	gauge("prism_ingest_queue_capacity", "Configured ingest queue capacity.", CardinalityIngest, "signal", "priority"),
	histogram("prism_ingest_batch_size", "Number of telemetry items in flushed batches.", CardinalityIngest, countBuckets, "signal"),
	histogram("prism_ingest_flush_duration_seconds", "Time spent flushing a batch to storage.", CardinalityIngest, durationBuckets, "signal"),
	gauge("prism_ingest_delta_series", "Number of series held by the delta-to-cumulative converter.", CardinalityIngest),
	histogram("prism_ingest_request_duration_seconds", "End-to-end ingest receiver request duration.", CardinalityIngest, durationBuckets, "protocol", "status"),

	// Storage.
	histogram("prism_storage_write_duration_seconds", "Storage write operation duration.", CardinalityStorage, durationBuckets, "driver", "signal", "status"),
	counter("prism_storage_write_items_total", "Number of telemetry items written to storage.", CardinalityStorage, "driver", "signal"),
	histogram("prism_storage_query_duration_seconds", "Storage query operation duration.", CardinalityStorage, durationBuckets, "driver", "signal", "path", "status"),
	histogram("prism_storage_query_series_returned", "Number of series returned by storage queries.", CardinalityStorage, countBuckets, "driver", "signal"),
	histogram("prism_storage_query_bytes_scanned", "Number of bytes scanned by storage queries when reported by the driver.", CardinalityStorage, byteBuckets, "driver", "signal"),
	counter("prism_storage_errors_total", "Number of classified storage errors.", CardinalityStorage, "driver", "op", "class"),
	counter("prism_storage_retries_total", "Number of storage operation retries.", CardinalityStorage, "driver", "op", "class"),
	gauge("prism_storage_up", "Whether the storage driver is reachable.", CardinalityStorage, "driver"),
	histogram("prism_storage_ping_duration_seconds", "Storage health-check duration.", CardinalityStorage, durationBuckets, "driver"),
	gauge("prism_disk_pressure_level", "Current storage disk pressure level from zero through four.", CardinalityStorage),
	gauge("prism_disk_free_ratio", "Ratio of free storage disk space.", CardinalityStorage, "backend"),

	// Query.
	counter("prism_query_requests_total", "Number of northbound query requests.", CardinalityQuery, "api", "type", "status"),
	histogram("prism_query_duration_seconds", "Northbound query request duration.", CardinalityQuery, durationBuckets, "api", "type"),
	counter("prism_query_fallback_total", "Number of queries routed through fallback execution.", CardinalityQuery, "signal", "reason"),
	gauge("prism_query_concurrent", "Number of queries currently executing.", CardinalityQuery),
	counter("prism_query_rejected_total", "Number of queries rejected by resource protection.", CardinalityQuery, "reason"),
	counter("prism_query_samples_scanned_total", "Number of samples scanned by query execution.", CardinalityQuery, "api"),
	counter("prism_logql_parse_errors_total", "Number of LogQL parse errors.", CardinalityQuery, "kind"),
	counter("prism_logql_unsupported_total", "Number of attempted uses of unsupported LogQL features.", CardinalityQuery, "feature"),

	// Ruler and alerting.
	gauge("prism_rule_group_last_eval_timestamp_seconds", "Unix timestamp of the last rule-group evaluation.", CardinalityRules, "group", "tenant"),
	histogram("prism_rule_group_eval_duration_seconds", "Rule-group evaluation duration.", CardinalityRules, durationBuckets, "group", "tenant"),
	detailedHistogram("prism_rule_eval_duration_seconds", "Individual rule evaluation duration.", CardinalityRules, durationBuckets, DetailedRulesGate, "group", "rule"),
	detailedCounter("prism_rule_eval_failures_total", "Number of failed individual rule evaluations.", CardinalityRules, DetailedRulesGate, "group", "rule", "reason"),
	gauge("prism_rule_group_interval_seconds", "Configured rule-group evaluation interval.", CardinalityRules, "group"),
	gauge("prism_rules_loaded", "Number of loaded rules.", CardinalityRules, "kind", "source"),
	gauge("prism_alerts_state", "Number of alerts in each active state.", CardinalityRules, "state", "tenant"),
	counter("prism_alerts_transitions_total", "Number of alert state transitions.", CardinalityRules, "from", "to", "tenant"),
	gauge("prism_dispatch_group_count", "Number of active alert dispatcher groups.", CardinalityRules),
	gauge("prism_silences_active", "Number of active alert silences.", CardinalityRules, "tenant"),
	gauge("prism_inhibitions_active", "Number of active alert inhibitions.", CardinalityRules, "tenant"),

	// Notification.
	counter("prism_notification_sent_total", "Number of notification delivery attempts by outcome.", CardinalityNotification, "channel", "receiver", "status"),
	histogram("prism_notification_latency_seconds", "Notification delivery latency.", CardinalityNotification, durationBuckets, "channel"),
	counter("prism_notification_retry_total", "Number of notification delivery retries.", CardinalityNotification, "channel"),
	counter("prism_notification_dead_total", "Number of notifications that exhausted all retries.", CardinalityNotification, "channel", "receiver"),
	gauge("prism_notification_queue_depth", "Number of queued notifications by status.", CardinalityNotification, "status"),
	gauge("prism_notification_oldest_pending_seconds", "Age of the oldest pending notification.", CardinalityNotification),

	// Agent.
	gauge("prism_agent_up", "Whether the Prism agent process is running.", CardinalityAgent),
	gauge("prism_agent_build_info", "Prism agent build information.", CardinalityAgent, "version", "go_version"),
	counter("prism_agent_input_records_total", "Number of records produced by agent inputs.", CardinalityAgent, "input", "name"),
	counter("prism_agent_input_errors_total", "Number of agent input errors.", CardinalityAgent, "input", "name", "reason"),
	gauge("prism_agent_filelog_open_files", "Number of files currently open by a file-log input.", CardinalityAgent, "name"),
	detailedGauge("prism_agent_filelog_offset_bytes", "Current byte offset of a tailed file.", CardinalityAgent, DetailedAgentGate, "name", "path"),
	gauge("prism_agent_wal_bytes", "Number of bytes currently held in the agent WAL.", CardinalityAgent),
	gauge("prism_agent_wal_segments", "Number of segments currently held in the agent WAL.", CardinalityAgent),
	gauge("prism_agent_wal_oldest_age_seconds", "Age of the oldest record in the agent WAL.", CardinalityAgent),
	counter("prism_agent_wal_dropped_bytes_total", "Number of bytes dropped from the agent WAL.", CardinalityAgent, "reason"),
	counter("prism_agent_wal_corrupt_records_total", "Number of corrupt agent WAL records encountered.", CardinalityAgent),
	counter("prism_agent_export_batches_total", "Number of agent export batches by outcome.", CardinalityAgent, "status"),
	counter("prism_agent_export_rejected_total", "Number of agent export batches rejected by gRPC status code.", CardinalityAgent, "code"),
	histogram("prism_agent_export_duration_seconds", "Agent export request duration.", CardinalityAgent, durationBuckets),
	gauge("prism_agent_config_version", "Currently applied agent configuration version.", CardinalityAgent),
	counter("prism_agent_config_errors_total", "Number of agent configuration errors.", CardinalityAgent, "reason"),

	// Control plane.
	counter("prism_console_requests_total", "Number of control-plane HTTP requests.", CardinalityControlPlane, "route", "method", "status"),
	histogram("prism_console_request_duration_seconds", "Control-plane HTTP request duration.", CardinalityControlPlane, durationBuckets, "route", "method"),
	counter("prism_auth_attempts_total", "Number of authentication attempts by kind and result.", CardinalityControlPlane, "kind", "result"),
	counter("prism_apikey_cache_hits_total", "Number of API-key cache hits.", CardinalityControlPlane),
	counter("prism_apikey_cache_misses_total", "Number of API-key cache misses.", CardinalityControlPlane),
	gauge("prism_agents_registered", "Number of registered agents by tenant and status.", CardinalityControlPlane, "tenant", "status"),
	histogram("prism_db_query_duration_seconds", "PostgreSQL query duration.", CardinalityControlPlane, durationBuckets, "op"),
	gauge("prism_db_pool_connections", "Number of PostgreSQL pool connections by state.", CardinalityControlPlane, "state"),

	// Runtime.
	gauge("prism_build_info", "Prism build information.", CardinalityRuntime, "version", "revision", "go_version", "driver"),
	gauge("prism_start_time_seconds", "Unix timestamp at which the process started.", CardinalityRuntime),
	gauge("prism_config_reload_success_timestamp_seconds", "Unix timestamp of the last successful configuration reload.", CardinalityRuntime),
	counter("prism_config_reload_failures_total", "Number of failed configuration reloads.", CardinalityRuntime),
}

var cardinalityBudgets = []CardinalityBudget{
	{Group: CardinalityIngest, Estimate: "tenants x 3 signals x 12 rejection reasons (about 360 series at 10 tenants)", LimitMechanism: "tenant count and accepted label domains are controlled"},
	{Group: CardinalityStorage, Estimate: "fewer than 100 series", LimitMechanism: "drivers, signals, operations, paths, statuses, and error classes use bounded domains"},
	{Group: CardinalityQuery, Estimate: "fewer than 50 series", LimitMechanism: "APIs, query types, statuses, reasons, and supported features use bounded domains"},
	{Group: CardinalityRules, Estimate: "grows with configured groups and rules", LimitMechanism: "per-rule population requires telemetry.detailed_rules"},
	{Group: CardinalityNotification, Estimate: "configured receivers x 6 channel kinds", LimitMechanism: "receiver count is administratively controlled"},
	{Group: CardinalityAgent, Estimate: "grows with configured inputs and tailed files", LimitMechanism: "the path label requires agent.detailed_metrics"},
	{Group: CardinalityControlPlane, Estimate: "configured tenants plus a bounded route and operation set", LimitMechanism: "tenant count is controlled and routes are recorded as patterns"},
	{Group: CardinalityRuntime, Estimate: "fewer than 10 series per process", LimitMechanism: "build and process labels are constant for the process lifetime"},
}

// Definitions returns a detached copy of all registered metric definitions.
func Definitions() []Definition {
	result := make([]Definition, len(metricDefinitions))
	for i, definition := range metricDefinitions {
		result[i] = definition.Definition
		result[i].Labels = slices.Clone(definition.Labels)
	}
	return result
}

// CardinalityBudgets returns a copy of the cardinality budget table.
func CardinalityBudgets() []CardinalityBudget {
	return slices.Clone(cardinalityBudgets)
}

func counter(name, help string, group CardinalityGroup, labels ...string) metricDefinition {
	return metricDefinition{Definition: Definition{Name: name, Type: MetricTypeCounter, Labels: labels, Help: help, CardinalityGroup: group}}
}

func detailedCounter(name, help string, group CardinalityGroup, gate string, labels ...string) metricDefinition {
	definition := counter(name, help, group, labels...)
	definition.DetailGate = gate
	return definition
}

func gauge(name, help string, group CardinalityGroup, labels ...string) metricDefinition {
	return metricDefinition{Definition: Definition{Name: name, Type: MetricTypeGauge, Labels: labels, Help: help, CardinalityGroup: group}}
}

func detailedGauge(name, help string, group CardinalityGroup, gate string, labels ...string) metricDefinition {
	definition := gauge(name, help, group, labels...)
	definition.DetailGate = gate
	return definition
}

func histogram(name, help string, group CardinalityGroup, buckets bucketProfile, labels ...string) metricDefinition {
	return metricDefinition{
		Definition: Definition{Name: name, Type: MetricTypeHistogram, Labels: labels, Help: help, CardinalityGroup: group},
		buckets:    buckets,
	}
}

func detailedHistogram(name, help string, group CardinalityGroup, buckets bucketProfile, gate string, labels ...string) metricDefinition {
	definition := histogram(name, help, group, buckets, labels...)
	definition.DetailGate = gate
	return definition
}
