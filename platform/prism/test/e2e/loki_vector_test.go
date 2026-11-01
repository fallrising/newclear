//go:build integration

package e2e_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/compat/lokiapi"
	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

// Vector's real Loki sink owns the request encoding. This catches protocol
// mistakes that a hand-built fixture shared with the receiver would miss.
func TestVectorLokiPush(t *testing.T) {
	binary := os.Getenv("VECTOR_BINARY")
	if binary == "" {
		t.Fatal("set VECTOR_BINARY to Vector v0.45.0; see test/e2e/README.md")
	}
	for _, compression := range []string{"none", "gzip"} {
		t.Run(compression, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
			defer cancel()
			backend, err := spi.Open(ctx, "memory", spi.Config{})
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if err := backend.Close(); err != nil {
					t.Error(err)
				}
			}()
			options := ingest.DefaultOptions()
			options.MaxTenants = 1
			options.Logs.FlushInterval = time.Hour
			pipeline, err := ingest.New(ctx, backend, options)
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if err := pipeline.Close(ctx); err != nil {
					t.Error(err)
				}
			}()
			const key = "public-vector-test-credential-not-for-production"
			receiver, err := lokiapi.NewPushReceiver(pipeline, lokiapi.PushOptions{Tenant: "vector", APIKey: secret.String(key), MaxRequestBytes: 1 << 20})
			if err != nil {
				t.Fatal(err)
			}
			handler := receiver.HTTPHandler()
			var requests atomic.Int64
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				if r.URL.Path != "/loki/api/v1/push" || r.Header.Get("Content-Type") != "application/json" {
					t.Error("Vector did not use the JSON push endpoint")
				}
				if (compression == "gzip") != (r.Header.Get("Content-Encoding") == "gzip") {
					t.Error("Vector wire compression differs from requested mode")
				}
				handler.ServeHTTP(w, r)
			}))
			defer server.Close()
			defer receiver.Stop()
			directory := t.TempDir()
			config := fmt.Sprintf(`data_dir = %q
[sources.fixture]
type = "stdin"
decoding.codec = "json"
[sinks.prism]
type = "loki"
inputs = ["fixture"]
endpoint = %q
compression = %q
tenant_id = "vector"
healthcheck.enabled = false
encoding.codec = "text"
auth.strategy = "bearer"
auth.token = %q
batch.max_events = 2
batch.timeout_secs = 0.1
request.concurrency = 1
request.retry_attempts = 2
buffer.type = "memory"
buffer.max_events = 10
[sinks.prism.labels]
service = "vector-fixture"
host = "vector-host"
level = "info"
[sinks.prism.structured_metadata]
trace_id = "0102030405060708090a0b0c0d0e0f10"
span_id = "0102030405060708"
origin = "vector"
`, directory, server.URL, compression, key)
			configPath := filepath.Join(directory, "vector.toml")
			if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
				t.Fatal(err)
			}
			logs := new(boundedProcessLog)
			command := exec.CommandContext(ctx, binary, "--config", configPath) //nolint:gosec // Explicit administrator-selected integration binary; no shell.
			command.Stdin = strings.NewReader("{\"message\":\"vector-loki-first\"}\n{\"message\":\"vector-loki-second\"}\n")
			command.Stdout, command.Stderr = logs, logs
			if err := command.Run(); err != nil {
				t.Fatalf("Vector push failed: %v\n%s", err, strings.ReplaceAll(logs.String(), key, "[REDACTED]"))
			}
			receiver.Stop()
			server.Close()
			if err := pipeline.Close(ctx); err != nil {
				t.Fatal(err)
			}
			if requests.Load() == 0 || strings.Contains(logs.String(), key) {
				t.Fatal("Vector sent no requests or exposed its credential")
			}
			for _, tenant := range []string{"vector", "other"} {
				query := spi.LogQuery{Tenant: tenant, Start: utm.TimeToNano(time.Now().Add(-time.Minute)), End: utm.TimeToNano(time.Now().Add(time.Minute)), Limit: 10, Direction: spi.Forward}
				rows, err := backend.Logs().Search(ctx, query)
				if err != nil {
					t.Fatal(err)
				}
				bodies := make(map[string]int)
				for rows.Next() {
					row := rows.At()
					if tenant != "vector" || row.Resource == nil || row.Resource.Tenant != "vector" || row.Resource.Service != "vector-fixture" || row.Resource.Host != "vector-host" || row.Labels.Has(utm.LabelTenant) {
						t.Error("stored Vector identity differs or escaped its tenant")
					}
					if row.TraceID != "0102030405060708090a0b0c0d0e0f10" || row.SpanID != "0102030405060708" || row.Attrs["origin"] != "vector" {
						t.Error("Vector structured metadata was not retained")
					}
					bodies[row.Body]++
				}
				if err := rows.Err(); err != nil {
					t.Error(err)
				}
				if err := rows.Close(); err != nil {
					t.Error(err)
				}
				if tenant == "vector" && (len(bodies) != 2 || bodies["vector-loki-first"] != 1 || bodies["vector-loki-second"] != 1) {
					t.Fatalf("unexpected persisted Vector bodies: %v", bodies)
				}
				if tenant == "other" && len(bodies) != 0 {
					t.Fatal("Vector logs visible to another tenant")
				}
			}
			t.Logf("real Vector %s JSON push: two logs, resource/metadata, tenant isolation and clean process exit", compression)
		})
	}
}
