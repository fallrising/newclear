package telemetry

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type expectedDefinition struct {
	metricType MetricType
	labels     []string
}

func TestDefinitionsMatchSDDSectionsOneThroughSeven(t *testing.T) {
	expected := expectedDefinitions()
	definitions := Definitions()
	if len(definitions) != len(expected) {
		t.Fatalf("Definitions() returned %d metrics, want %d", len(definitions), len(expected))
	}

	seen := make(map[string]struct{}, len(definitions))
	for _, definition := range definitions {
		want, ok := expected[definition.Name]
		if !ok {
			t.Errorf("unexpected metric definition %q", definition.Name)
			continue
		}
		if _, duplicate := seen[definition.Name]; duplicate {
			t.Errorf("duplicate metric definition %q", definition.Name)
		}
		seen[definition.Name] = struct{}{}
		if definition.Type != want.metricType {
			t.Errorf("metric %q type = %q, want %q", definition.Name, definition.Type, want.metricType)
		}
		if !slices.Equal(definition.Labels, want.labels) {
			t.Errorf("metric %q labels = %v, want %v", definition.Name, definition.Labels, want.labels)
		}
		if definition.Help == "" {
			t.Errorf("metric %q has empty help text", definition.Name)
		}
	}
	for name := range expected {
		if _, ok := seen[name]; !ok {
			t.Errorf("missing metric definition %q", name)
		}
	}
}

func TestMetricsHandlerContainsEveryRegisteredMetric(t *testing.T) {
	prometheusRegistry := prometheus.NewRegistry()
	registry, err := Register(prometheusRegistry)
	if err != nil {
		t.Fatal(err)
	}

	// client_golang does not expose a labeled metric family until its first
	// label set is populated. Create a zero-valued representative child only
	// after registration so this test verifies the complete wire contract.
	for _, definition := range Definitions() {
		populateRepresentativeSeries(t, registry, definition)
	}

	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/metrics", nil)
	response := httptest.NewRecorder()
	promhttp.HandlerFor(prometheusRegistry, promhttp.HandlerOpts{EnableOpenMetrics: true}).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("GET /metrics status = %d, want %d; body = %s", response.Code, http.StatusOK, response.Body.String())
	}

	helpNames := metricNamesWithPrefix(response.Body.String(), "# HELP ")
	typeNames := metricNamesWithPrefix(response.Body.String(), "# TYPE ")
	for name := range expectedDefinitions() {
		if !helpNames[name] {
			t.Errorf("GET /metrics is missing HELP for %q", name)
		}
		if !typeNames[name] {
			t.Errorf("GET /metrics is missing TYPE for %q", name)
		}
	}
}

func TestCardinalityBudgetCoversEveryMetricAndLabel(t *testing.T) {
	wantGroups := map[CardinalityGroup]struct{}{
		CardinalityIngest: {}, CardinalityStorage: {}, CardinalityQuery: {}, CardinalityRules: {},
		CardinalityNotification: {}, CardinalityAgent: {}, CardinalityControlPlane: {}, CardinalityRuntime: {},
	}
	budgets := CardinalityBudgets()
	if len(budgets) != len(wantGroups) {
		t.Fatalf("CardinalityBudgets() returned %d groups, want %d", len(budgets), len(wantGroups))
	}
	coveredGroups := make(map[CardinalityGroup]bool, len(budgets))
	for _, budget := range budgets {
		if _, ok := wantGroups[budget.Group]; !ok {
			t.Errorf("unexpected cardinality budget group %q", budget.Group)
		}
		if coveredGroups[budget.Group] {
			t.Errorf("duplicate cardinality budget group %q", budget.Group)
		}
		coveredGroups[budget.Group] = true
		if budget.Estimate == "" || budget.LimitMechanism == "" {
			t.Errorf("cardinality budget group %q lacks an estimate or limit mechanism", budget.Group)
		}
	}

	allowedLabels := map[string]struct{}{
		"action": {}, "api": {}, "backend": {}, "channel": {}, "class": {}, "code": {},
		"driver": {}, "feature": {}, "from": {}, "go_version": {}, "group": {}, "input": {},
		"kind": {}, "label": {}, "method": {}, "metric": {}, "name": {}, "op": {}, "path": {},
		"priority": {}, "protocol": {}, "reason": {}, "receiver": {}, "result": {}, "revision": {},
		"route": {}, "rule": {}, "signal": {}, "source": {}, "state": {}, "status": {}, "tenant": {},
		"to": {}, "type": {}, "version": {},
	}
	usedGroups := make(map[CardinalityGroup]bool, len(coveredGroups))
	for _, definition := range Definitions() {
		if !coveredGroups[definition.CardinalityGroup] {
			t.Errorf("metric %q has no cardinality budget for group %q", definition.Name, definition.CardinalityGroup)
		}
		usedGroups[definition.CardinalityGroup] = true
		for _, label := range definition.Labels {
			if _, ok := allowedLabels[label]; !ok {
				t.Errorf("metric %q label %q has no reviewed cardinality policy", definition.Name, label)
			}
		}
	}
	for group := range wantGroups {
		if !usedGroups[group] {
			t.Errorf("cardinality budget group %q has no metrics", group)
		}
	}

	wantDetailGates := map[string]string{
		"prism_rule_eval_duration_seconds": DetailedRulesGate,
		"prism_rule_eval_failures_total":   DetailedRulesGate,
		"prism_agent_filelog_offset_bytes": DetailedAgentGate,
	}
	for _, definition := range Definitions() {
		wantGate := wantDetailGates[definition.Name]
		if definition.DetailGate != wantGate {
			t.Errorf("metric %q detail gate = %q, want %q", definition.Name, definition.DetailGate, wantGate)
		}
	}
}

func TestRegisterRejectsNilAndDuplicateRegisterers(t *testing.T) {
	if _, err := Register(nil); err == nil {
		t.Fatal("Register(nil) error = nil")
	}

	prometheusRegistry := prometheus.NewRegistry()
	first, err := Register(prometheusRegistry)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Register(prometheusRegistry); err == nil {
		t.Fatal("second Register() error = nil")
	}
	if len(first.Names()) != len(expectedDefinitions()) {
		t.Fatalf("first registry retained %d collectors after duplicate registration, want %d", len(first.Names()), len(expectedDefinitions()))
	}
}

func populateRepresentativeSeries(t *testing.T, registry *Registry, definition Definition) {
	t.Helper()
	labelValues := make([]string, len(definition.Labels))
	for i, label := range definition.Labels {
		labelValues[i] = "test_" + label
	}
	collector, ok := registry.Collector(definition.Name)
	if !ok {
		t.Fatalf("collector %q is not registered", definition.Name)
	}
	switch metric := collector.(type) {
	case prometheus.Counter:
		metric.Add(0)
	case *prometheus.CounterVec:
		child, err := metric.GetMetricWithLabelValues(labelValues...)
		if err != nil {
			t.Fatalf("initialize counter %q: %v", definition.Name, err)
		}
		child.Add(0)
	case prometheus.Gauge:
		metric.Set(0)
	case *prometheus.GaugeVec:
		child, err := metric.GetMetricWithLabelValues(labelValues...)
		if err != nil {
			t.Fatalf("initialize gauge %q: %v", definition.Name, err)
		}
		child.Set(0)
	case prometheus.Histogram:
		metric.Observe(0)
	case *prometheus.HistogramVec:
		child, err := metric.GetMetricWithLabelValues(labelValues...)
		if err != nil {
			t.Fatalf("initialize histogram %q: %v", definition.Name, err)
		}
		child.Observe(0)
	default:
		t.Fatalf("collector %q has unsupported type %T", definition.Name, collector)
	}
}

func metricNamesWithPrefix(body, prefix string) map[string]bool {
	result := make(map[string]bool)
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		name, _, found := strings.Cut(strings.TrimPrefix(line, prefix), " ")
		if found {
			result[name] = true
		}
	}
	return result
}

func expectedDefinitions() map[string]expectedDefinition {
	return map[string]expectedDefinition{
		"prism_ingest_received_total":                   {MetricTypeCounter, []string{"signal", "tenant", "protocol"}},
		"prism_ingest_received_bytes_total":             {MetricTypeCounter, []string{"signal", "tenant", "protocol"}},
		"prism_ingest_accepted_total":                   {MetricTypeCounter, []string{"signal", "tenant"}},
		"prism_ingest_rejected_total":                   {MetricTypeCounter, []string{"signal", "tenant", "reason"}},
		"prism_ingest_dropped_total":                    {MetricTypeCounter, []string{"signal", "tenant", "reason"}},
		"prism_ingest_normalized_total":                 {MetricTypeCounter, []string{"signal", "action"}},
		"prism_ingest_high_cardinality_total":           {MetricTypeCounter, []string{"tenant", "metric", "label"}},
		"prism_ingest_active_series":                    {MetricTypeGauge, []string{"tenant"}},
		"prism_ingest_queue_depth":                      {MetricTypeGauge, []string{"signal", "priority"}},
		"prism_ingest_queue_capacity":                   {MetricTypeGauge, []string{"signal", "priority"}},
		"prism_ingest_batch_size":                       {MetricTypeHistogram, []string{"signal"}},
		"prism_ingest_flush_duration_seconds":           {MetricTypeHistogram, []string{"signal"}},
		"prism_ingest_delta_series":                     {MetricTypeGauge, nil},
		"prism_ingest_request_duration_seconds":         {MetricTypeHistogram, []string{"protocol", "status"}},
		"prism_storage_write_duration_seconds":          {MetricTypeHistogram, []string{"driver", "signal", "status"}},
		"prism_storage_write_items_total":               {MetricTypeCounter, []string{"driver", "signal"}},
		"prism_storage_query_duration_seconds":          {MetricTypeHistogram, []string{"driver", "signal", "path", "status"}},
		"prism_storage_query_series_returned":           {MetricTypeHistogram, []string{"driver", "signal"}},
		"prism_storage_query_bytes_scanned":             {MetricTypeHistogram, []string{"driver", "signal"}},
		"prism_storage_errors_total":                    {MetricTypeCounter, []string{"driver", "op", "class"}},
		"prism_storage_retries_total":                   {MetricTypeCounter, []string{"driver", "op", "class"}},
		"prism_storage_up":                              {MetricTypeGauge, []string{"driver"}},
		"prism_storage_ping_duration_seconds":           {MetricTypeHistogram, []string{"driver"}},
		"prism_disk_pressure_level":                     {MetricTypeGauge, nil},
		"prism_disk_free_ratio":                         {MetricTypeGauge, []string{"backend"}},
		"prism_query_requests_total":                    {MetricTypeCounter, []string{"api", "type", "status"}},
		"prism_query_duration_seconds":                  {MetricTypeHistogram, []string{"api", "type"}},
		"prism_query_fallback_total":                    {MetricTypeCounter, []string{"signal", "reason"}},
		"prism_query_concurrent":                        {MetricTypeGauge, nil},
		"prism_query_rejected_total":                    {MetricTypeCounter, []string{"reason"}},
		"prism_query_samples_scanned_total":             {MetricTypeCounter, []string{"api"}},
		"prism_logql_parse_errors_total":                {MetricTypeCounter, []string{"kind"}},
		"prism_logql_unsupported_total":                 {MetricTypeCounter, []string{"feature"}},
		"prism_rule_group_last_eval_timestamp_seconds":  {MetricTypeGauge, []string{"group", "tenant"}},
		"prism_rule_group_eval_duration_seconds":        {MetricTypeHistogram, []string{"group", "tenant"}},
		"prism_rule_eval_duration_seconds":              {MetricTypeHistogram, []string{"group", "rule"}},
		"prism_rule_eval_failures_total":                {MetricTypeCounter, []string{"group", "rule", "reason"}},
		"prism_rule_group_interval_seconds":             {MetricTypeGauge, []string{"group"}},
		"prism_rules_loaded":                            {MetricTypeGauge, []string{"kind", "source"}},
		"prism_alerts_state":                            {MetricTypeGauge, []string{"state", "tenant"}},
		"prism_alerts_transitions_total":                {MetricTypeCounter, []string{"from", "to", "tenant"}},
		"prism_dispatch_group_count":                    {MetricTypeGauge, nil},
		"prism_silences_active":                         {MetricTypeGauge, []string{"tenant"}},
		"prism_inhibitions_active":                      {MetricTypeGauge, []string{"tenant"}},
		"prism_notification_sent_total":                 {MetricTypeCounter, []string{"channel", "receiver", "status"}},
		"prism_notification_latency_seconds":            {MetricTypeHistogram, []string{"channel"}},
		"prism_notification_retry_total":                {MetricTypeCounter, []string{"channel"}},
		"prism_notification_dead_total":                 {MetricTypeCounter, []string{"channel", "receiver"}},
		"prism_notification_queue_depth":                {MetricTypeGauge, []string{"status"}},
		"prism_notification_oldest_pending_seconds":     {MetricTypeGauge, nil},
		"prism_agent_up":                                {MetricTypeGauge, nil},
		"prism_agent_build_info":                        {MetricTypeGauge, []string{"version", "go_version"}},
		"prism_agent_input_records_total":               {MetricTypeCounter, []string{"input", "name"}},
		"prism_agent_input_errors_total":                {MetricTypeCounter, []string{"input", "name", "reason"}},
		"prism_agent_filelog_open_files":                {MetricTypeGauge, []string{"name"}},
		"prism_agent_filelog_offset_bytes":              {MetricTypeGauge, []string{"name", "path"}},
		"prism_agent_wal_bytes":                         {MetricTypeGauge, nil},
		"prism_agent_wal_segments":                      {MetricTypeGauge, nil},
		"prism_agent_wal_oldest_age_seconds":            {MetricTypeGauge, nil},
		"prism_agent_wal_dropped_bytes_total":           {MetricTypeCounter, []string{"reason"}},
		"prism_agent_wal_corrupt_records_total":         {MetricTypeCounter, nil},
		"prism_agent_export_batches_total":              {MetricTypeCounter, []string{"status"}},
		"prism_agent_export_rejected_total":             {MetricTypeCounter, []string{"code"}},
		"prism_agent_export_duration_seconds":           {MetricTypeHistogram, nil},
		"prism_agent_config_version":                    {MetricTypeGauge, nil},
		"prism_agent_config_errors_total":               {MetricTypeCounter, []string{"reason"}},
		"prism_console_requests_total":                  {MetricTypeCounter, []string{"route", "method", "status"}},
		"prism_console_request_duration_seconds":        {MetricTypeHistogram, []string{"route", "method"}},
		"prism_auth_attempts_total":                     {MetricTypeCounter, []string{"kind", "result"}},
		"prism_apikey_cache_hits_total":                 {MetricTypeCounter, nil},
		"prism_apikey_cache_misses_total":               {MetricTypeCounter, nil},
		"prism_agents_registered":                       {MetricTypeGauge, []string{"tenant", "status"}},
		"prism_db_query_duration_seconds":               {MetricTypeHistogram, []string{"op"}},
		"prism_db_pool_connections":                     {MetricTypeGauge, []string{"state"}},
		"prism_build_info":                              {MetricTypeGauge, []string{"version", "revision", "go_version", "driver"}},
		"prism_start_time_seconds":                      {MetricTypeGauge, nil},
		"prism_config_reload_success_timestamp_seconds": {MetricTypeGauge, nil},
		"prism_config_reload_failures_total":            {MetricTypeCounter, nil},
	}
}
