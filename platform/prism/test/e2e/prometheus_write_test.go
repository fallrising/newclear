//go:build integration

package e2e_test

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/compat/promapi"
	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

// This exercises the actual Prometheus scrape/WAL/remote-write sender, not a
// hand-encoded request that could share a protocol mistake with the receiver.
func TestPrometheusRemoteWrite(t *testing.T) {
	binary := os.Getenv("PROMETHEUS_BINARY")
	if binary == "" {
		t.Fatal("set PROMETHEUS_BINARY to Prometheus v2.53.0; see test/e2e/README.md")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
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
	options.Metrics.FlushInterval = 10 * time.Millisecond
	pipeline, err := ingest.New(ctx, backend, options)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := pipeline.Close(ctx); err != nil {
			t.Error(err)
		}
	}()
	const key = "public-prometheus-test-credential-not-for-production"
	receiver, err := promapi.NewWriteReceiver(pipeline, promapi.WriteOptions{
		Tenant: "prometheus", APIKey: secret.String(key), MaxRequestBytes: 16 << 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(receiver.HTTPHandler())
	defer server.Close()
	defer receiver.Stop()
	exporter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		_, _ = fmt.Fprint(w, "# TYPE prism_write_fixture gauge\nprism_write_fixture 42.5\n")
	}))
	defer exporter.Close()
	directory := t.TempDir()
	credential := filepath.Join(directory, "credential")
	if err := os.WriteFile(credential, []byte(key), 0o600); err != nil {
		t.Fatal(err)
	}
	configuration := fmt.Sprintf(`global:
  scrape_interval: 100ms
  scrape_timeout: 100ms
scrape_configs:
  - job_name: fixture
    static_configs:
      - targets: [%q]
remote_write:
  - url: %q
    authorization:
      credentials_file: %q
    queue_config:
      min_shards: 1
      max_shards: 1
      capacity: 100
      max_samples_per_send: 10
      batch_send_deadline: 100ms
      min_backoff: 10ms
      max_backoff: 100ms
      retry_on_http_429: true
`, strings.TrimPrefix(exporter.URL, "http://"), server.URL+"/prom/api/v1/write", credential)
	configPath := filepath.Join(directory, "prometheus.yml")
	if err := os.WriteFile(configPath, []byte(configuration), 0o600); err != nil {
		t.Fatal(err)
	}
	logs := new(boundedProcessLog)
	command := exec.CommandContext(ctx, binary, "--config.file="+configPath, "--storage.tsdb.path="+filepath.Join(directory, "data"), "--web.listen-address=127.0.0.1:0", "--log.level=warn") //nolint:gosec // Explicit administrator-selected integration binary, never a shell.
	command.Stdout, command.Stderr = logs, logs
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan error, 1)
	go func() { exited <- command.Wait() }()
	joined := false
	defer func() {
		if !joined {
			_ = command.Process.Kill()
			<-exited
		}
	}()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		up, fixture := storedPrometheusValues(t, ctx, backend, "prometheus")
		if up && fixture {
			break
		}
		select {
		case err := <-exited:
			joined = true
			t.Fatalf("Prometheus exited before persistence: %v\n%s", err, logs.String())
		case <-ctx.Done():
			t.Fatalf("Prometheus remote-write persistence timed out: %v\n%s", ctx.Err(), logs.String())
		case <-ticker.C:
		}
	}
	if err := command.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-exited:
		joined = true
		if err != nil {
			t.Fatalf("Prometheus shutdown: %v\n%s", err, logs.String())
		}
	case <-ctx.Done():
		t.Fatal("Prometheus shutdown exceeded integration deadline")
	}
	receiver.Stop()
	server.Close()
	if err := pipeline.Close(ctx); err != nil {
		t.Fatal(err)
	}
	up, fixture := storedPrometheusValues(t, ctx, backend, "prometheus")
	if !up || !fixture {
		t.Fatal("expected persisted up=1 and prism_write_fixture=42.5")
	}
	storedPrometheusValues(t, ctx, backend, "other")
	if strings.Contains(logs.String(), key) {
		t.Fatal("Prometheus process output exposed the test credential")
	}
	t.Log("real Prometheus scrape → remote_write → memory: up=1, fixture=42.5, other tenant empty; clean process shutdown")
}

func storedPrometheusValues(t *testing.T, ctx context.Context, backend spi.Backend, tenant string) (bool, bool) {
	t.Helper()
	now := time.Now()
	set, err := backend.Metrics().Select(ctx, spi.SeriesQuery{Tenant: tenant, Start: utm.TimeToMilli(now.Add(-time.Minute)), End: utm.TimeToMilli(now.Add(time.Minute))})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := set.Close(); err != nil {
			t.Error(err)
		}
	}()
	var up, fixture bool
	for set.Next() {
		row := set.At()
		if tenant == "other" || row.Labels().Get(utm.LabelTenant) != tenant {
			t.Fatal("remote-write samples escaped authenticated tenant")
		}
		iterator := row.Samples()
		for iterator.Next() {
			_, value := iterator.At()
			switch row.Labels().Get(utm.LabelName) {
			case "up":
				up = up || value == 1
			case "prism_write_fixture":
				fixture = fixture || value == 42.5
			}
		}
		if err := iterator.Err(); err != nil {
			t.Fatal(err)
		}
	}
	if err := set.Err(); err != nil {
		t.Fatal(err)
	}
	return up, fixture
}

type boundedProcessLog struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (b *boundedProcessLog) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if remaining := (64 << 10) - b.buffer.Len(); remaining > 0 {
		_, _ = b.buffer.Write(p[:min(len(p), remaining)])
	}
	return len(p), nil
}

func (b *boundedProcessLog) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buffer.String()
}
