package security_test

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	_ "github.com/fallrising/newclear/platform/prism/drivers/memory"
	"github.com/fallrising/newclear/platform/prism/internal/compat/otlp"
	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"go.uber.org/goleak"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

// These current-milestone trust-boundary checks do not claim the future full
// multi-tenant control-plane/security acceptance suite.
func TestOTLPWriteIdentityBeforeStateAndReservedTenantLabels(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
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
	pipeline, err := ingest.New(ctx, backend, options)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := pipeline.Close(ctx); err != nil {
			t.Error(err)
		}
	}()
	const key = "public-security-test-credential-not-for-production"
	receiver, err := otlp.New(pipeline, otlp.Options{Tenant: "trusted", APIKey: secret.String(key), MaxRequestBytes: 1 << 20, MaxRecvMsgSize: 1 << 20, MaxConcurrentRequests: 2})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(receiver.HTTPHandler())
	defer server.Close()
	for _, signal := range []string{"metrics", "logs", "traces"} {
		for _, attack := range []struct {
			name   string
			header http.Header
			status int
		}{
			{"missing credential", http.Header{"X-Scope-Orgid": {"trusted"}}, http.StatusUnauthorized},
			{"forged credential", http.Header{"Authorization": {"Bearer forged"}, "X-Scope-Orgid": {"trusted"}}, http.StatusUnauthorized},
			{"duplicate credential", http.Header{"Authorization": {"Bearer " + key, "Bearer " + key}}, http.StatusUnauthorized},
			{"cross tenant", http.Header{"Authorization": {"Bearer " + key}, "X-Scope-Orgid": {"other"}}, http.StatusBadRequest},
			{"conflicting selectors", http.Header{"Authorization": {"Bearer " + key}, "X-Scope-Orgid": {"trusted"}, "X-Prism-Tenant": {"other"}}, http.StatusBadRequest},
			{"duplicate selector", http.Header{"Authorization": {"Bearer " + key}, "X-Prism-Tenant": {"trusted", "trusted"}}, http.StatusBadRequest},
		} {
			t.Run(signal+"/"+attack.name, func(t *testing.T) {
				status, response := exportJSON(t, ctx, server.Client(), server.URL+"/v1/"+signal, []byte("{}"), attack.header)
				if status != attack.status {
					t.Fatalf("status=%d want=%d response=%s", status, attack.status, response)
				}
				if bytes.Contains(response, []byte(key)) || bytes.Contains(response, []byte("forged")) {
					t.Fatal("error reflected credential")
				}
				if pipeline.Snapshot().Tenants != 0 {
					t.Fatal("unauthorized request created tenant state")
				}
			})
		}
	}
	// A valid key with user-controlled reserved labels cannot change identity.
	timestamp := utm.TimeToNano(time.Now())
	payload := fmt.Sprintf(`{"resourceMetrics":[{"resource":{"attributes":[{"key":"__tenant","value":{"stringValue":"other"}}]},"scopeMetrics":[{"metrics":[{"name":"secure_metric","gauge":{"dataPoints":[{"timeUnixNano":"%d","asDouble":5,"attributes":[{"key":"__tenant","value":{"stringValue":"other"}}]}]}}]}]}]}`, timestamp)
	status, response := exportJSON(t, ctx, server.Client(), server.URL+"/v1/metrics", []byte(payload), http.Header{"Authorization": {"Bearer " + key}, "X-Scope-Orgid": {"trusted"}})
	if status != http.StatusOK {
		t.Fatalf("authorized export status=%d response=%s", status, response)
	}
	if err := pipeline.Close(ctx); err != nil {
		t.Fatal(err)
	}
	for _, tenant := range []string{"trusted", "other"} {
		set, err := backend.Metrics().Select(ctx, spi.SeriesQuery{Tenant: tenant, Start: utm.TimeToMilli(time.Now().Add(-time.Minute)), End: utm.TimeToMilli(time.Now().Add(time.Minute))})
		if err != nil {
			t.Fatal(err)
		}
		count := 0
		for set.Next() {
			row := set.At()
			if row.Labels().Get(utm.LabelTenant) != "trusted" {
				t.Error("reserved tenant label was overwritten")
			}
			samples := row.Samples()
			for samples.Next() {
				_, value := samples.At()
				if value != 5 {
					t.Errorf("value=%v", value)
				}
				count++
			}
			if err := samples.Err(); err != nil {
				t.Error(err)
			}
		}
		if err := set.Err(); err != nil {
			t.Error(err)
		}
		if err := set.Close(); err != nil {
			t.Error(err)
		}
		if (tenant == "trusted" && count != 1) || (tenant == "other" && count != 0) {
			t.Fatalf("tenant=%s count=%d", tenant, count)
		}
	}
}

func exportJSON(t *testing.T, ctx context.Context, client *http.Client, url string, payload []byte, headers http.Header) (int, []byte) {
	t.Helper()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	request.Header = headers.Clone()
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := response.Body.Close(); err != nil {
			t.Error(err)
		}
	}()
	body, err := io.ReadAll(io.LimitReader(response.Body, 8193))
	if err != nil {
		t.Fatal(err)
	}
	if len(body) > 8192 {
		t.Fatal("unbounded response")
	}
	if response.StatusCode != http.StatusOK && !strings.HasPrefix(response.Header.Get("Content-Type"), "application/json") {
		t.Fatal("error did not use OTLP JSON status")
	}
	return response.StatusCode, body
}
