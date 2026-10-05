//go:build integration

package clickhouse_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	chdriver "github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	_ "github.com/fallrising/newclear/platform/prism/drivers/clickhouse"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

// These tests use native SQL only to create isolated databases and inspect
// persisted state. The writes and migrations exercise the registered SPI.
type fixture struct {
	t      *testing.T
	ctx    context.Context
	admin  chdriver.Conn
	reader chdriver.Conn
	dsn    string
	db     string
}

// Runner probes the published native endpoint before starting the full suite.
func TestClickHouseFixtureReady(t *testing.T) {
	dsn := os.Getenv("PRISM_CLICKHOUSE_TEST_DSN")
	if dsn == "" {
		t.Fatal("PRISM_CLICKHOUSE_TEST_DSN is required")
	}
	options, err := clickhouse.ParseDSN(dsn)
	if err != nil {
		t.Fatal("invalid fixture DSN")
	}
	if !loopbackOptions(options) {
		t.Fatal("fixture must use one native loopback address")
	}
	conn, err := clickhouse.Open(options)
	if err != nil {
		t.Fatal("open fixture:", err)
	}
	defer func() {
		if err := conn.Close(); err != nil {
			t.Errorf("close readiness connection: %v", err)
		}
	}()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err != nil {
		t.Fatal("native fixture is not ready")
	}
}

func loopbackOptions(options *clickhouse.Options) bool {
	if len(options.Addr) != 1 {
		return false
	}
	host, _, err := net.SplitHostPort(options.Addr[0])
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return host == "localhost" || ip != nil && ip.IsLoopback()
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	dsn := os.Getenv("PRISM_CLICKHOUSE_TEST_DSN")
	if dsn == "" {
		t.Fatal("PRISM_CLICKHOUSE_TEST_DSN is required for selected ClickHouse integration tests")
	}
	options, err := clickhouse.ParseDSN(dsn)
	if err != nil || !loopbackOptions(options) {
		t.Fatal("PRISM_CLICKHOUSE_TEST_DSN must be a valid native loopback DSN")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 150*time.Second)
	t.Cleanup(cancel)
	admin, err := clickhouse.Open(options)
	if err != nil {
		t.Fatal("open test fixture:", err)
	}
	t.Cleanup(func() {
		if err := admin.Close(); err != nil {
			t.Errorf("close admin: %v", err)
		}
	})
	if err := admin.Ping(ctx); err != nil {
		t.Fatal("ping test fixture:", err)
	}
	db := "prism_test_" + strings.ReplaceAll(strings.ToLower(fmt.Sprintf("%x", time.Now().UnixNano())), "-", "")
	if err := admin.Exec(ctx, "CREATE DATABASE "+db); err != nil {
		t.Fatal("create isolated database:", err)
	}
	t.Cleanup(func() {
		cleanupCtx, stop := context.WithTimeout(context.WithoutCancel(t.Context()), 30*time.Second)
		defer stop()
		if err := admin.Exec(cleanupCtx, "DROP DATABASE IF EXISTS "+db+" SYNC"); err != nil {
			t.Errorf("drop isolated database: %v", err)
		}
	})
	readOptions := *options
	readOptions.Auth.Database = db
	reader, err := clickhouse.Open(&readOptions)
	if err != nil {
		t.Fatal("open test reader:", err)
	}
	t.Cleanup(func() {
		if err := reader.Close(); err != nil {
			t.Errorf("close reader: %v", err)
		}
	})
	// Only the database path changes. Credentials are never logged or printed.
	base := strings.SplitN(dsn, "?", 2)
	path := strings.LastIndex(base[0], "/")
	if path < 0 {
		t.Fatal("invalid fixture database path")
	}
	dbDSN := base[0][:path+1] + db
	if len(base) == 2 {
		dbDSN += "?" + base[1]
	}
	return &fixture{t: t, ctx: ctx, admin: admin, reader: reader, dsn: dbDSN, db: db}
}

func (f *fixture) backend(opts map[string]string) spi.Backend {
	f.t.Helper()
	b, err := spi.Open(f.ctx, "clickhouse", spi.Config{DSN: f.dsn, Options: opts})
	if err != nil {
		f.t.Fatalf("SPI.Open clickhouse: %v", err)
	}
	f.t.Cleanup(func() {
		if err := b.Close(); err != nil {
			f.t.Errorf("close backend: %v", err)
		}
	})
	return b
}

func (f *fixture) migrated(opts map[string]string) spi.Backend {
	f.t.Helper()
	b := f.backend(opts)
	if err := b.Migrate(f.ctx); err != nil {
		f.t.Fatalf("Migrate: %v", err)
	}
	return b
}

func (f *fixture) count(query string, args ...any) uint64 {
	f.t.Helper()
	var got uint64
	if err := f.reader.QueryRow(f.ctx, query, args...).Scan(&got); err != nil {
		f.t.Fatalf("count query: %v", err)
	}
	return got
}

func eventually(t *testing.T, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("timed out waiting for persisted ClickHouse rows")
}

func TestClickHouseMigrations(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0"})
	rows, err := f.reader.Query(f.ctx, "SELECT version, name, checksum FROM prism_schema_migrations ORDER BY version")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := rows.Close(); err != nil {
			t.Errorf("close migration rows: %v", err)
		}
	}()
	var versions []uint32
	for rows.Next() {
		var version uint32
		var name, checksum string
		if err := rows.Scan(&version, &name, &checksum); err != nil {
			t.Fatal(err)
		}
		files, err := filepath.Glob(filepath.Join("migrations", fmt.Sprintf("%03d_*.sql", version)))
		if err != nil || len(files) != 1 {
			t.Fatalf("missing migration template for %d", version)
		}
		data, err := os.ReadFile(files[0])
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(data)
		if name != filepath.Base(files[0]) || checksum != hex.EncodeToString(digest[:]) {
			t.Fatalf("receipt %d is not the unrendered template digest", version)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(versions, []uint32{1, 2, 3, 4, 5, 6, 7, 8}) {
		t.Fatalf("migration versions: %v", versions)
	}
	if err := b.Migrate(f.ctx); err != nil {
		t.Fatal("idempotent Migrate:", err)
	}
	if n := f.count("SELECT count() FROM prism_schema_migrations"); n != 8 {
		t.Fatalf("repeat migration receipts = %d", n)
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	changed := f.backend(map[string]string{"async_insert": "0", "retention_logs_days": "21"})
	if err := changed.Migrate(f.ctx); err != nil {
		t.Fatal("TTL reconciliation:", err)
	}
	if n := f.count("SELECT count() FROM prism_schema_migrations"); n != 8 {
		t.Fatalf("TTL reconciliation changed receipts: %d", n)
	}
	var ddl string
	if err := f.reader.QueryRow(f.ctx, "SHOW CREATE TABLE logs").Scan(&ddl); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(ddl, "toIntervalDay(21)") {
		t.Fatalf("log TTL did not change: %s", ddl)
	}
}

func TestClickHouseMigrationDrift(t *testing.T) {
	for _, test := range []struct {
		name               string
		version            uint32
		filename, checksum string
	}{
		{"checksum", 1, "001_init_logs.sql", "invalid-checksum"},
		{"future", 99, "099_future.sql", "unknown"},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newFixture(t)
			b := f.migrated(map[string]string{"async_insert": "0"})
			if err := f.reader.Exec(f.ctx, "INSERT INTO prism_schema_migrations (version,name,checksum) VALUES (?,?,?)", test.version, test.filename, test.checksum); err != nil {
				t.Fatal(err)
			}
			var before string
			if err := f.reader.QueryRow(f.ctx, "SHOW CREATE TABLE logs").Scan(&before); err != nil {
				t.Fatal(err)
			}
			err := b.Migrate(f.ctx)
			if err == nil || strings.Contains(err.Error(), f.dsn) || !strings.Contains(err.Error(), "schema migration drift") {
				t.Fatalf("expected sanitized drift error, got %v", err)
			}
			var after string
			if err := f.reader.QueryRow(f.ctx, "SHOW CREATE TABLE logs").Scan(&after); err != nil {
				t.Fatal(err)
			}
			if before != after {
				t.Fatal("drift changed DDL or TTL")
			}
			if n := f.count("SELECT count() FROM prism_schema_migrations"); n != 9 {
				t.Fatalf("drift emitted receipt: %d", n)
			}
		})
	}
}

func TestClickHouseWrites(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0"})
	metricLabels := labels.FromStrings("__name__", "requests_total", "__tenant__", "tenant-a", "job", "api")
	base := utm.TimeToMilli(time.Date(2026, 10, 5, 12, 0, 0, 123000000, time.UTC))
	points := []utm.MetricPoint{{Name: "requests_total", Labels: metricLabels, TS: base, Value: 1.25, Type: utm.TypeCounter}, {Name: "requests_total", Labels: metricLabels, TS: base + 4, Value: 2.5, Type: utm.TypeCounter}}
	if err := b.Metrics().Write(f.ctx, points); err != nil {
		t.Fatal("metrics write:", err)
	}
	if err := b.Metrics().Write(f.ctx, []utm.MetricPoint{{Name: "requests_total", Labels: metricLabels, TS: base - 7, Value: 0.5}}); err != nil {
		t.Fatal("metric cache extension:", err)
	}
	otherLabels := labels.FromStrings("__name__", "requests_total", "__tenant__", "tenant-b", "job", "api")
	if err := b.Metrics().Write(f.ctx, []utm.MetricPoint{{Name: "requests_total", Labels: otherLabels, TS: base, Value: 9}}); err != nil {
		t.Fatal("tenant metric write:", err)
	}
	event := utm.MilliToNano(base) + 12345
	resource := &utm.Resource{Tenant: "tenant-a", Service: "api", ServiceInstance: "instance-1", ServiceVersion: "v1", Namespace: "payments", Host: "node-1", Cluster: "east", Env: "test", Attrs: map[string]string{"cloud.region": "east-1"}}
	log := utm.LogRecord{Resource: resource, TS: event, ObservedTS: event + 23, Severity: utm.SevWarn, SeverityText: "WARN", Body: "integration log", Labels: labels.FromStrings("stream", "app"), Attrs: map[string]string{"request.id": "r1"}}
	if err := b.Logs().Write(f.ctx, []utm.LogRecord{log}); err != nil {
		t.Fatal("log write:", err)
	}
	emptyLog := utm.LogRecord{Resource: resource, TS: event + 100, ObservedTS: event + 100, Body: "empty maps"}
	if err := b.Logs().Write(f.ctx, []utm.LogRecord{emptyLog}); err != nil {
		t.Fatal("empty-map log write:", err)
	}
	trace := "0123456789abcdef0123456789abcdef"
	parentID, childID := "0123456789abcdef", "fedcba9876543210"
	parent := utm.Span{Resource: resource, TraceID: trace, SpanID: parentID, TraceState: "vendor=state", Name: "root", Kind: utm.KindServer, StartNano: event, EndNano: event + 1007, StatusCode: utm.StatusOK, Attrs: map[string]string{"http.method": "GET"}, Events: []utm.SpanEvent{{TS: event + 101, Name: "lookup", Attrs: map[string]string{"phase": "read"}}}, Links: []utm.SpanLink{{TraceID: trace, SpanID: childID, Attrs: map[string]string{"cause": "retry"}}}}
	childResource := resource.Clone()
	childResource.Service = "worker"
	child := utm.Span{Resource: childResource, TraceID: trace, SpanID: childID, ParentSpanID: parentID, Name: "child", Kind: utm.KindClient, StartNano: event + 10, EndNano: event + 100, StatusCode: utm.StatusError, StatusMsg: "failed"}
	// The same parent ID in another trace or tenant must remain unresolved.
	wrongTrace := child
	wrongTrace.TraceID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	wrongTrace.SpanID = "1111111111111111"
	wrongTenant := child
	wrongTenant.Resource = childResource.Clone()
	wrongTenant.Resource.Tenant = "tenant-b"
	wrongTenant.SpanID = "2222222222222222"
	if err := b.Traces().Write(f.ctx, []utm.Span{parent, child, wrongTrace, wrongTenant}); err != nil {
		t.Fatal("spans write:", err)
	}

	eventually(t, func() bool {
		return f.count("SELECT count() FROM metric_samples") == 4 && f.count("SELECT count() FROM spans") == 4
	})
	var fingerprint uint64
	var first, last int64
	var seriesLabels map[string]string
	if err := f.reader.QueryRow(f.ctx, "SELECT any(fingerprint), min(toUnixTimestamp64Milli(first_seen)), max(toUnixTimestamp64Milli(last_seen)), any(labels) FROM metric_series WHERE tenant='tenant-a' AND metric='requests_total'").Scan(&fingerprint, &first, &last, &seriesLabels); err != nil {
		t.Fatal(err)
	}
	if fingerprint != utm.Fingerprint(metricLabels) || first != base-7 || last != base+4 || seriesLabels["job"] != "api" {
		t.Fatalf("series mismatch fp=%d first=%d last=%d labels=%v", fingerprint, first, last, seriesLabels)
	}
	if n := f.count("SELECT count() FROM metric_series WHERE tenant='tenant-a'"); n != 2 {
		t.Fatalf("cache extension metadata rows=%d", n)
	}
	if n := f.count("SELECT count() FROM metric_series WHERE tenant='tenant-b'"); n != 1 {
		t.Fatalf("tenant-b series rows=%d", n)
	}
	if n := f.count("SELECT count() FROM metric_samples WHERE tenant='tenant-a' AND fingerprint=?", utm.Fingerprint(metricLabels)); n != 3 {
		t.Fatalf("tenant-a sample rows=%d", n)
	}
	if n := f.count("SELECT count() FROM metric_samples WHERE tenant='tenant-b' AND fingerprint=? AND value=9", utm.Fingerprint(otherLabels)); n != 1 {
		t.Fatalf("tenant-b sample rows=%d", n)
	}
	var sampleValue float64
	if err := f.reader.QueryRow(f.ctx, "SELECT value FROM metric_samples WHERE tenant='tenant-a' AND toUnixTimestamp64Milli(ts)=?", base+4).Scan(&sampleValue); err != nil || sampleValue != 2.5 {
		t.Fatalf("sample value=%v err=%v", sampleValue, err)
	}
	var logTS, observed int64
	var tenant, service, cluster, host, env, severity, severityText, body, traceID, spanID, instance, version, namespace string
	var logLabels, attrs, resAttrs map[string]string
	if err := f.reader.QueryRow(f.ctx, "SELECT toUnixTimestamp64Nano(ts),toUnixTimestamp64Nano(observed_ts),tenant,service,cluster,host,env,toString(severity),severity_text,body,trace_id,span_id,labels,attrs,res_attrs,service_instance,service_version,namespace FROM logs WHERE tenant='tenant-a' AND body='integration log'").Scan(&logTS, &observed, &tenant, &service, &cluster, &host, &env, &severity, &severityText, &body, &traceID, &spanID, &logLabels, &attrs, &resAttrs, &instance, &version, &namespace); err != nil {
		t.Fatal(err)
	}
	if logTS != event || observed != event+23 || tenant != "tenant-a" || service != "api" || cluster != "east" || host != "node-1" || env != "test" || severity != "warn" || severityText != "WARN" || body != log.Body || traceID != "" || spanID != "" || !reflect.DeepEqual(logLabels, map[string]string{"stream": "app"}) || !reflect.DeepEqual(attrs, log.Attrs) || !reflect.DeepEqual(resAttrs, resource.Attrs) || instance != "instance-1" || version != "v1" || namespace != "payments" {
		t.Fatal("log persisted fields mismatch")
	}
	if n := f.count("SELECT count() FROM logs WHERE tenant='tenant-b'"); n != 0 {
		t.Fatalf("cross-tenant log rows=%d", n)
	}
	var emptyLabels, emptyAttrs map[string]string
	if err := f.reader.QueryRow(f.ctx, "SELECT labels, attrs FROM logs WHERE body='empty maps'").Scan(&emptyLabels, &emptyAttrs); err != nil || len(emptyLabels) != 0 || len(emptyAttrs) != 0 {
		t.Fatalf("empty log maps labels=%v attrs=%v err=%v", emptyLabels, emptyAttrs, err)
	}
	var start int64
	var duration uint64
	var state, status, statusMsg, spanTenant, spanTrace, spanIDRead, spanParent, spanService, spanName, spanKind, spanHost, spanEnv, spanInstance, spanVersion, spanNamespace, spanCluster string
	var spanAttrs, spanResAttrs map[string]string
	var eventTS []time.Time
	var eventNames, linkTraces, linkSpans []string
	var eventAttrs, linkAttrs []map[string]string
	if err := f.reader.QueryRow(f.ctx, "SELECT toUnixTimestamp64Nano(ts),duration_ns,trace_state,toString(status_code),status_msg,tenant,trace_id,span_id,parent_id,service,name,toString(kind),host,env,service_instance,service_version,namespace,cluster,attrs,res_attrs,events.ts,events.name,events.attrs,links.trace_id,links.span_id,links.attrs FROM spans WHERE tenant='tenant-a' AND span_id=?", parentID).Scan(&start, &duration, &state, &status, &statusMsg, &spanTenant, &spanTrace, &spanIDRead, &spanParent, &spanService, &spanName, &spanKind, &spanHost, &spanEnv, &spanInstance, &spanVersion, &spanNamespace, &spanCluster, &spanAttrs, &spanResAttrs, &eventTS, &eventNames, &eventAttrs, &linkTraces, &linkSpans, &linkAttrs); err != nil {
		t.Fatal(err)
	}
	if start != event || duration != 1007 || state != "vendor=state" || status != "ok" || statusMsg != "" || spanTenant != "tenant-a" || spanTrace != trace || spanIDRead != parentID || spanParent != "" || spanService != "api" || spanName != "root" || spanKind != "server" || spanHost != "node-1" || spanEnv != "test" || spanInstance != "instance-1" || spanVersion != "v1" || spanNamespace != "payments" || spanCluster != "east" || !reflect.DeepEqual(spanAttrs, parent.Attrs) || !reflect.DeepEqual(spanResAttrs, resource.Attrs) || len(eventTS) != 1 || utm.TimeToNano(eventTS[0]) != event+101 || !reflect.DeepEqual(eventNames, []string{"lookup"}) || eventAttrs[0]["phase"] != "read" || !reflect.DeepEqual(linkTraces, []string{trace}) || !reflect.DeepEqual(linkSpans, []string{childID}) || linkAttrs[0]["cause"] != "retry" {
		t.Fatal("span persisted fields mismatch")
	}
	var childStatus, childMessage string
	if err := f.reader.QueryRow(f.ctx, "SELECT toString(status_code),status_msg FROM spans WHERE tenant='tenant-a' AND span_id=?", childID).Scan(&childStatus, &childMessage); err != nil || childStatus != "error" || childMessage != "failed" {
		t.Fatalf("child status=%q message=%q err=%v", childStatus, childMessage, err)
	}
	if n := f.count("SELECT sum(calls) FROM service_deps_1h WHERE tenant='tenant-a' AND parent='api' AND child='worker'"); n != 1 {
		t.Fatalf("local dependency calls=%d", n)
	}
	if n := f.count("SELECT sum(errors) FROM service_deps_1h WHERE tenant='tenant-a' AND parent='api' AND child='worker'"); n != 1 {
		t.Fatalf("local dependency errors=%d", n)
	}
	if n := f.count("SELECT count() FROM pending_links WHERE tenant='tenant-a' AND trace_id=? AND parent_span_id=?", wrongTrace.TraceID, parentID); n != 1 {
		t.Fatalf("wrong-trace pending=%d", n)
	}
	if n := f.count("SELECT count() FROM pending_links WHERE tenant='tenant-b' AND trace_id=? AND parent_span_id=?", trace, parentID); n != 1 {
		t.Fatalf("wrong-tenant pending=%d", n)
	}
	if n := f.count("SELECT count() FROM service_deps_1h WHERE tenant='tenant-b'"); n != 0 {
		t.Fatalf("cross-tenant dependency rows=%d", n)
	}
}

func TestClickHouseMaterializedLabelsString(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0"})
	var kind string
	if err := f.reader.QueryRow(f.ctx, "SELECT default_kind FROM system.columns WHERE database=? AND table='metric_series' AND name='labels_str'", f.db).Scan(&kind); err != nil {
		t.Fatal(err)
	}
	if kind != "MATERIALIZED" {
		t.Fatalf("labels_str default kind=%q; want MATERIALIZED", kind)
	}
	const name = "labels_special_total"
	const special = "line\nquote\"slash\\snowman☃\x00\x01"
	metricLabels := labels.FromStrings("__name__", name, "__tenant__", "tenant-a", "alpha", special, "zulu", "ß/✅")
	point := utm.MetricPoint{Name: name, Labels: metricLabels, TS: utm.TimeToMilli(time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)), Value: 1}
	if err := b.Metrics().Write(f.ctx, []utm.MetricPoint{point}); err != nil {
		t.Fatal("write special labels:", err)
	}
	var storedHex string
	if err := f.reader.QueryRow(f.ctx, "SELECT hex(labels_str) FROM metric_series WHERE fingerprint=?", utm.Fingerprint(metricLabels)).Scan(&storedHex); err != nil {
		t.Fatal("read materialized label bytes:", err)
	}
	expected := strings.Join([]string{"__name__\x00" + name, "__tenant__\x00tenant-a", "alpha\x00" + special, "zulu\x00ß/✅"}, "\x01")
	if storedHex != strings.ToUpper(hex.EncodeToString([]byte(expected))) {
		t.Fatalf("materialized label bytes differ: got %q, want %q", storedHex, strings.ToUpper(hex.EncodeToString([]byte(expected))))
	}
}

func TestClickHouseMetricUTF8Identity(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0"})
	when := utm.TimeToMilli(time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC))
	invalid := "\xff"
	for _, test := range []struct {
		name  string
		point utm.MetricPoint
	}{
		{"metric name", utm.MetricPoint{Name: "bad" + invalid, Labels: labels.FromStrings("__name__", "bad"+invalid, "__tenant__", "tenant-a"), TS: when, Value: 1}},
		{"label name", utm.MetricPoint{Name: "valid_total", Labels: labels.FromStrings("__name__", "valid_total", "__tenant__", "tenant-a", "bad"+invalid, "x"), TS: when, Value: 1}},
		{"label value", utm.MetricPoint{Name: "valid_total", Labels: labels.FromStrings("__name__", "valid_total", "__tenant__", "tenant-a", "job", "bad"+invalid), TS: when, Value: 1}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := b.Metrics().Write(f.ctx, []utm.MetricPoint{test.point}); spi.Classify(err) != spi.ErrBadRequest {
				t.Fatalf("invalid UTF-8 identity: expected BadRequest, got %v", err)
			}
			if got := f.count("SELECT count() FROM metric_samples"); got != 0 {
				t.Fatalf("invalid identity persisted %d samples", got)
			}
			if got := f.count("SELECT count() FROM metric_series"); got != 0 {
				t.Fatalf("invalid identity persisted %d metadata rows", got)
			}
		})
	}
	valid := labels.FromStrings("__name__", "valid_total", "__tenant__", "tenant-a", "job", "café東京")
	if err := b.Metrics().Write(f.ctx, []utm.MetricPoint{{Name: "valid_total", Labels: valid, TS: when, Value: 2}}); err != nil {
		t.Fatal("write valid UTF-8 identity:", err)
	}
	var read map[string]string
	if err := f.reader.QueryRow(f.ctx, "SELECT labels FROM metric_series WHERE fingerprint=?", utm.Fingerprint(valid)).Scan(&read); err != nil || read["job"] != "café東京" {
		t.Fatalf("valid UTF-8 identity did not round-trip: labels=%v err=%v", read, err)
	}
}

func TestClickHouseRetentionWriteBoundary(t *testing.T) {
	cutoff := time.Date(2106, 2, 7, 6, 28, 16, 0, time.UTC)
	options := map[string]string{"async_insert": "0", "retention_metrics_days": "2", "retention_logs_days": "3", "retention_traces_days": "4", "retention_red_days": "5"}
	for _, test := range []struct {
		name   string
		days   int
		tick   time.Duration
		tables []string
	}{
		{"metrics", 2, time.Millisecond, []string{"metric_samples"}},
		{"logs", 3, time.Nanosecond, []string{"logs"}},
		{"traces", 5, time.Nanosecond, []string{"spans", "trace_index", "service_red_1m", "service_ops", "pending_links"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newFixture(t)
			b := f.migrated(options)
			safe := cutoff.AddDate(0, 0, -test.days).Add(-test.tick)
			write := func(at time.Time) error {
				switch test.name {
				case "metrics":
					return b.Metrics().Write(f.ctx, []utm.MetricPoint{{Name: "boundary_total", Labels: labels.FromStrings("__name__", "boundary_total", "__tenant__", "tenant-a"), TS: utm.TimeToMilli(at), Value: 1}})
				case "logs":
					return b.Logs().Write(f.ctx, []utm.LogRecord{{Resource: &utm.Resource{Tenant: "tenant-a", Service: "api"}, TS: utm.TimeToNano(at), ObservedTS: utm.TimeToNano(at), Body: "boundary"}})
				default:
					return b.Traces().Write(f.ctx, []utm.Span{{Resource: &utm.Resource{Tenant: "tenant-a", Service: "api"}, TraceID: "1234567890abcdef1234567890abcdef", SpanID: "1234567890abcdef", ParentSpanID: "fedcba0987654321", Name: "boundary", Kind: utm.KindServer, StartNano: utm.TimeToNano(at), EndNano: utm.TimeToNano(at)}})
				}
			}
			if err := write(safe); err != nil {
				t.Fatal("safe retention source rejected:", err)
			}
			for _, table := range test.tables {
				if err := f.reader.Exec(f.ctx, "OPTIMIZE TABLE "+table+" FINAL"); err != nil {
					t.Fatalf("optimize %s: %v", table, err)
				}
				if got := f.count("SELECT count() FROM " + table); got != 1 {
					t.Fatalf("safe source lost from %s after OPTIMIZE FINAL: rows=%d", table, got)
				}
			}
			if err := write(safe.Add(test.tick)); spi.Classify(err) != spi.ErrBadRequest {
				t.Fatalf("next tick should be BadRequest, got %v", err)
			}
			for _, table := range test.tables {
				if got := f.count("SELECT count() FROM " + table); got != 1 {
					t.Fatalf("invalid next tick changed %s: rows=%d", table, got)
				}
			}
		})
	}
}

func TestClickHouseMigrationRejectsUnsafeExistingTTLSource(t *testing.T) {
	cutoff := time.Date(2106, 2, 7, 6, 28, 16, 0, time.UTC)
	options := map[string]string{"async_insert": "0", "retention_metrics_days": "31", "retention_logs_days": "15", "retention_traces_days": "8", "retention_red_days": "91"}
	tables := []struct {
		name, source string
		days         int
	}{
		{"metric_samples", "ts", 31},
		{"logs", "ts", 15},
		{"spans", "ts", 8},
		{"trace_index", "start_ts", 8},
		{"service_red_1m", "minute", 91},
		{"service_deps_1h", "hour", 91},
		{"service_ops", "day", 91},
		{"pending_links", "ts", 1},
	}
	for _, test := range tables {
		t.Run(test.name, func(t *testing.T) {
			f := newFixture(t)
			initial := f.migrated(map[string]string{"async_insert": "0"})
			if err := initial.Close(); err != nil {
				t.Fatal("close initial backend:", err)
			}
			if test.name == "pending_links" {
				// Its one-day TTL is fixed, so prevent a background TTL merge
				// from deleting the boundary row before Migrate inspects it.
				if err := f.reader.Exec(f.ctx, "SYSTEM STOP TTL MERGES "+f.db+"."+test.name); err != nil {
					t.Fatal("stop owned table TTL merges:", err)
				}
			}
			source := cutoff.AddDate(0, 0, -test.days)
			if err := f.reader.Exec(f.ctx, "INSERT INTO "+test.name+" ("+test.source+") VALUES (?)", source); err != nil {
				t.Fatalf("seed unsafe source in %s: %v", test.name, err)
			}
			if got := f.count("SELECT count() FROM " + test.name); got != 1 {
				t.Fatalf("unsafe source absent in %s: rows=%d", test.name, got)
			}
			before := make(map[string]string, len(tables))
			for _, table := range tables {
				var ddl string
				if err := f.reader.QueryRow(f.ctx, "SHOW CREATE TABLE "+table.name).Scan(&ddl); err != nil {
					t.Fatalf("read %s DDL before Migrate: %v", table.name, err)
				}
				before[table.name] = ddl
			}
			b := f.backend(options)
			if err := b.Migrate(f.ctx); spi.Classify(err) != spi.ErrBadRequest {
				t.Fatalf("unsafe %s source: expected BadRequest, got %v", test.name, err)
			}
			for _, table := range tables {
				var after string
				if err := f.reader.QueryRow(f.ctx, "SHOW CREATE TABLE "+table.name).Scan(&after); err != nil {
					t.Fatalf("read %s DDL after Migrate: %v", table.name, err)
				}
				if before[table.name] != after {
					t.Fatalf("unsafe %s source changed %s DDL", test.name, table.name)
				}
			}
		})
	}
}

func TestClickHouseTelemetryInsertServerLimit(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0", "max_execution_time": "7"})
	point := utm.MetricPoint{Name: "server_limit_total", Labels: labels.FromStrings("__name__", "server_limit_total", "__tenant__", "tenant-a"), TS: utm.TimeToMilli(time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)), Value: 1}
	if err := b.Metrics().Write(f.ctx, []utm.MetricPoint{point}); err != nil {
		t.Fatal("telemetry write:", err)
	}
	if got := f.count("SELECT count() FROM metric_samples"); got != 1 {
		t.Fatalf("telemetry sample rows=%d", got)
	}
	var lastLimit string
	var lastErr error
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if err := f.admin.Exec(f.ctx, "SYSTEM FLUSH LOGS"); err != nil {
			t.Fatal("flush server query log:", err)
		}
		lastErr = f.admin.QueryRow(f.ctx, "SELECT Settings['max_execution_time'] FROM system.query_log WHERE current_database=? AND type='QueryFinish' AND query LIKE 'INSERT INTO metric_samples%' ORDER BY event_time_microseconds DESC LIMIT 1", f.db).Scan(&lastLimit)
		if lastErr == nil && lastLimit == "7" {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("server observed telemetry max_execution_time=%q, query err=%v; want 7", lastLimit, lastErr)
}

func TestClickHouseReorderedLogColumnsFailClosed(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0", "max_open_conns": "1"})
	if err := f.reader.Exec(f.ctx, "ALTER TABLE logs MODIFY COLUMN host LowCardinality(String) AFTER service"); err != nil {
		t.Fatal("reorder owned logs table:", err)
	}
	var hostPosition, servicePosition uint64
	if err := f.reader.QueryRow(f.ctx, "SELECT position FROM system.columns WHERE database=? AND table='logs' AND name='host'", f.db).Scan(&hostPosition); err != nil {
		t.Fatal("host column position:", err)
	}
	if err := f.reader.QueryRow(f.ctx, "SELECT position FROM system.columns WHERE database=? AND table='logs' AND name='service'", f.db).Scan(&servicePosition); err != nil {
		t.Fatal("service column position:", err)
	}
	if hostPosition <= servicePosition {
		t.Fatalf("logs column reorder did not take effect: host=%d service=%d", hostPosition, servicePosition)
	}
	log := utm.LogRecord{Resource: &utm.Resource{Tenant: "tenant-a", Service: "api", Host: "node-1"}, TS: utm.TimeToNano(time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)), ObservedTS: utm.TimeToNano(time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)), Body: "reordered-column probe"}
	if err := b.Logs().Write(f.ctx, []utm.LogRecord{log}); spi.Classify(err) != spi.ErrInternal {
		t.Fatalf("reordered same-typed columns: expected Internal, got %v", err)
	}
	if got := f.count("SELECT count() FROM logs"); got != 0 {
		t.Fatalf("reordered-column write persisted %d log rows", got)
	}
	point := utm.MetricPoint{Name: "batch_release_total", Labels: labels.FromStrings("__name__", "batch_release_total", "__tenant__", "tenant-a"), TS: utm.TimeToMilli(time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)), Value: 1}
	if err := b.Metrics().Write(f.ctx, []utm.MetricPoint{point}); err != nil {
		t.Fatal("backend did not recover after rejected batch:", err)
	}
	if got := f.count("SELECT count() FROM metric_samples"); got != 1 {
		t.Fatalf("post-rejection metric rows=%d", got)
	}
	closed := make(chan error, 1)
	go func() { closed <- b.Close() }()
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal("close backend after rejected batch:", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("backend Close blocked after rejected batch")
	}
	if err := f.reader.Ping(f.ctx); err != nil {
		t.Fatal("reader ping after backend close:", err)
	}
}

func TestClickHouseUnsupportedReads(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(map[string]string{"async_insert": "0"})
	if err := b.Capabilities().Validate(); err != nil {
		t.Fatal(err)
	}
	caps := b.Capabilities()
	if caps.Retention.Enforced || caps.Metrics.NativePromQL || caps.Traces.Dependencies {
		t.Fatalf("overstated capabilities: %+v", caps)
	}
	if _, ok := b.Metrics().(spi.NativeMetricQuerier); ok {
		t.Fatal("optional metric query interface exposed")
	}
	if _, ok := b.Metrics().(spi.MetadataStore); ok {
		t.Fatal("optional metadata interface exposed")
	}
	if _, ok := b.Metrics().(spi.SeriesDeleter); ok {
		t.Fatal("optional delete interface exposed")
	}
	if _, ok := b.Logs().(spi.NativeLogQuerier); ok {
		t.Fatal("optional log query interface exposed")
	}
	if _, ok := b.Traces().(spi.DependencyQuerier); ok {
		t.Fatal("optional dependency interface exposed")
	}
	checks := []error{}
	_, err := b.Metrics().Select(f.ctx, spi.SeriesQuery{Tenant: "tenant-a"})
	checks = append(checks, err)
	_, err = b.Metrics().LabelNames(f.ctx, spi.LabelQuery{Tenant: "tenant-a"})
	checks = append(checks, err)
	_, err = b.Metrics().LabelValues(f.ctx, "job", spi.LabelQuery{Tenant: "tenant-a"})
	checks = append(checks, err)
	_, err = b.Logs().Search(f.ctx, spi.LogQuery{Tenant: "tenant-a"})
	checks = append(checks, err)
	_, err = b.Logs().LabelNames(f.ctx, spi.LabelQuery{Tenant: "tenant-a"})
	checks = append(checks, err)
	_, err = b.Logs().LabelValues(f.ctx, "job", spi.LabelQuery{Tenant: "tenant-a"})
	checks = append(checks, err)
	_, err = b.Traces().GetTrace(f.ctx, "tenant-a", "trace")
	checks = append(checks, err)
	_, err = b.Traces().FindTraceIDs(f.ctx, spi.TraceQuery{Tenant: "tenant-a"})
	checks = append(checks, err)
	_, err = b.Traces().Services(f.ctx, "tenant-a", spi.TimeRange{})
	checks = append(checks, err)
	_, err = b.Traces().Operations(f.ctx, "tenant-a", "api", "server", spi.TimeRange{})
	checks = append(checks, err)
	if err := f.ctx.Err(); err != nil {
		t.Fatalf("fixture context canceled before read checks: %v", err)
	}
	for i, err := range checks {
		if spi.Classify(err) != spi.ErrUnsupported {
			t.Fatalf("read %d: expected Unsupported, got %v", i, err)
		}
	}
}

func TestClickHouseDefaultAsyncInsert(t *testing.T) {
	f := newFixture(t)
	b := f.migrated(nil) // Native default async_insert=1, wait_for_async_insert=0.
	point := utm.MetricPoint{Name: "async_probe_total", Labels: labels.FromStrings("__name__", "async_probe_total", "__tenant__", "tenant-a"), TS: utm.TimeToMilli(time.Now().UTC()), Value: 1}
	if err := b.Metrics().Write(f.ctx, []utm.MetricPoint{point}); err != nil {
		t.Fatal("default async write:", err)
	}
	// This test checks what the server observed. It makes no durability claim
	// from a successful asynchronous client acknowledgement.
	eventually(t, func() bool {
		if err := f.admin.Exec(f.ctx, "SYSTEM FLUSH LOGS"); err != nil {
			t.Fatal("flush server query log:", err)
		}
		var async, wait string
		err := f.admin.QueryRow(f.ctx, "SELECT Settings['async_insert'], Settings['wait_for_async_insert'] FROM system.query_log WHERE current_database=? AND type='QueryFinish' AND query LIKE 'INSERT INTO metric_samples%' ORDER BY event_time_microseconds DESC LIMIT 1", f.db).Scan(&async, &wait)
		if err != nil || async != "1" || wait != "0" {
			return false
		}
		var flushed uint64
		if err := f.admin.QueryRow(f.ctx, "SELECT count() FROM system.asynchronous_insert_log WHERE database=? AND table='metric_samples' AND status='Ok' AND rows=1", f.db).Scan(&flushed); err != nil {
			return false
		}
		return flushed == 1
	})
}
