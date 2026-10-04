package security_test

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/compat/promapi"
	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/golang/snappy"
	"github.com/prometheus/prometheus/prompb"
)

func TestRemoteWriteTrustBoundary(t *testing.T) {
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
	const key = "public-remote-write-test-credential-not-for-production"
	receiver, err := promapi.NewWriteReceiver(pipeline, promapi.WriteOptions{Tenant: "trusted", APIKey: secret.String(key), MaxRequestBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(receiver.HTTPHandler())
	defer server.Close()
	defer receiver.Stop()
	request := &prompb.WriteRequest{Timeseries: []prompb.TimeSeries{{
		Labels:  []prompb.Label{{Name: "__name__", Value: "secure_remote_write"}, {Name: utm.LabelTenant, Value: "other"}},
		Samples: []prompb.Sample{{Timestamp: utm.TimeToMilli(time.Now()), Value: 7}},
	}}}
	wire, err := request.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	payload := snappy.Encode(nil, wire)
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
			status, body := exportRemoteWrite(t, ctx, server, payload, attack.header)
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
	status, body := exportRemoteWrite(t, ctx, server, payload, http.Header{"Authorization": {"Bearer " + key}})
	if status != http.StatusNoContent || len(body) != 0 {
		t.Fatalf("valid authenticated request status=%d body=%s", status, body)
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
			if row.Labels().Get(utm.LabelTenant) != "trusted" || row.Labels().Get(utm.LabelName) != "secure_remote_write" {
				t.Error("stored identity was overridden")
			}
			points := row.Samples()
			for points.Next() {
				_, value := points.At()
				if value != 7 {
					t.Errorf("stored value=%v", value)
				}
				count++
			}
			if err := points.Err(); err != nil {
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
			t.Fatalf("tenant=%s samples=%d", tenant, count)
		}
	}
}

func exportRemoteWrite(t *testing.T, ctx context.Context, server *httptest.Server, payload []byte, headers http.Header) (int, []byte) {
	t.Helper()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/prom/api/v1/write", bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	request.Header = headers.Clone()
	request.Header.Set("Content-Encoding", "snappy")
	request.Header.Set("Content-Type", "application/x-protobuf")
	request.Header.Set("X-Prometheus-Remote-Write-Version", "0.1.0")
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
		t.Fatal("unbounded remote-write response")
	}
	return response.StatusCode, body
}
