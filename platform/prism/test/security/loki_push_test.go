package security_test

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/compat/lokiapi"
	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

func TestLokiPushTrustBoundary(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
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
	const key = "public-loki-push-test-credential-not-for-production"
	receiver, err := lokiapi.NewPushReceiver(pipeline, lokiapi.PushOptions{Tenant: "trusted", APIKey: secret.String(key), MaxRequestBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(receiver.HTTPHandler())
	defer server.Close()
	defer receiver.Stop()
	payload := fmt.Appendf(nil, `{"streams":[{"stream":{"service":"secure-loki","__tenant__":"other"},"values":[["%d","secure-loki-line",{"__tenant__":"other","trace_id":"0102030405060708090a0b0c0d0e0f10"}]]}]}`, utm.TimeToNano(time.Now()))

	for _, attack := range []struct {
		name   string
		header http.Header
		want   int
	}{
		{"missing key", http.Header{"X-Scope-Orgid": {"trusted"}}, http.StatusUnauthorized},
		{"forged key", http.Header{"Authorization": {"Bearer forged"}}, http.StatusUnauthorized},
		{"duplicate key", http.Header{"Authorization": {"Bearer " + key, "Bearer " + key}}, http.StatusUnauthorized},
		{"cross tenant", http.Header{"Authorization": {"Bearer " + key}, "X-Scope-Orgid": {"other"}}, http.StatusBadRequest},
		{"conflicting selectors", http.Header{"Authorization": {"Bearer " + key}, "X-Scope-Orgid": {"trusted"}, "X-Prism-Tenant": {"other"}}, http.StatusBadRequest},
		{"duplicate selector", http.Header{"Authorization": {"Bearer " + key}, "X-Prism-Tenant": {"trusted", "trusted"}}, http.StatusBadRequest},
	} {
		t.Run(attack.name, func(t *testing.T) {
			status, body := exportLokiPush(t, ctx, server, payload, attack.header)
			if status != attack.want {
				t.Fatalf("status=%d want=%d body=%s", status, attack.want, body)
			}
			if bytes.Contains(body, []byte(key)) || bytes.Contains(body, []byte("forged")) {
				t.Fatal("credential reflected in error")
			}
			if pipeline.Snapshot().Tenants != 0 {
				t.Fatal("rejected identity created pipeline tenant state")
			}
		})
	}
	status, body := exportLokiPush(t, ctx, server, payload, http.Header{"Authorization": {"Bearer " + key}})
	if status != http.StatusNoContent || len(body) != 0 {
		t.Fatalf("valid authenticated request status=%d body=%s", status, body)
	}
	if err := pipeline.Close(ctx); err != nil {
		t.Fatal(err)
	}
	for _, tenant := range []string{"trusted", "other"} {
		set, err := backend.Logs().Search(ctx, spi.LogQuery{Tenant: tenant, Start: utm.TimeToNano(time.Now().Add(-time.Minute)), End: utm.TimeToNano(time.Now().Add(time.Minute)), Limit: 10, Direction: spi.Forward})
		if err != nil {
			t.Fatal(err)
		}
		count := 0
		for set.Next() {
			row := set.At()
			if row.Resource == nil || row.Resource.Tenant != "trusted" || row.Labels.Has(utm.LabelTenant) || row.Body != "secure-loki-line" || row.TraceID != "0102030405060708090a0b0c0d0e0f10" {
				t.Error("Loki log identity or content changed")
			}
			count++
		}
		if err := set.Err(); err != nil {
			t.Error(err)
		}
		if err := set.Close(); err != nil {
			t.Error(err)
		}
		if (tenant == "trusted" && count != 1) || (tenant == "other" && count != 0) {
			t.Fatalf("tenant=%s logs=%d", tenant, count)
		}
	}
}

func exportLokiPush(t *testing.T, ctx context.Context, server *httptest.Server, payload []byte, headers http.Header) (int, []byte) {
	t.Helper()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/loki/api/v1/push", bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	request.Header = headers.Clone()
	request.Header.Set("Content-Type", "application/json")
	response, err := server.Client().Do(request)
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
		t.Fatal("unbounded Loki push response")
	}
	return response.StatusCode, body
}
