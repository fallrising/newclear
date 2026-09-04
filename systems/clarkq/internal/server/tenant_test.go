package server

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/fallrising/clarkQ/internal/config"
)

func TestTenantQuotaQueues(t *testing.T) {
	s, err := New(config.Config{
		MaxQueues:         100,
		MaxDepth:          1000,
		MaxMessageBytes:   1024,
		TenantQuotas:      true,
		TenantMaxQueues:   1,
		TenantMaxMessages: 10,
		TenantHeader:      "X-Tenant-ID",
	})
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/a", bytes.NewBufferString(`{"body":"1"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-ID", "t1")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("first=%d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v1/queue/b", bytes.NewBufferString(`{"body":"1"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-ID", "t1")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("quota status=%d body=%s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v1/queue/b", bytes.NewBufferString(`{"body":"1"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-ID", "t2")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("t2=%d %s", rec.Code, rec.Body.String())
	}
}

func TestTenantQueueOwnership(t *testing.T) {
	s, err := New(config.Config{
		MaxQueues:       100,
		MaxDepth:        1000,
		MaxMessageBytes: 1024,
		TenantQuotas:    true,
		TenantHeader:    "X-Tenant-ID",
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/queue/shared", bytes.NewBufferString(`{"body":"1"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-ID", "alpha")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("alpha=%d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/api/v1/queue/shared", bytes.NewBufferString(`{"body":"2"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-ID", "beta")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d want 403 body=%s", rec.Code, rec.Body.String())
	}
}

func TestLeaseVoteEndpoint(t *testing.T) {
	s, err := New(config.Config{
		MaxQueues:           10,
		MaxDepth:            100,
		MaxMessageBytes:     1024,
		ClusterAdvertiseURL: "http://n1:8080",
		ClusterNodes:        []string{"http://n1:8080", "http://n2:8080"},
		ClusterSecret:       "tok",
		LeaseEnabled:        true,
		LeaseTTL:            5 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	body := `{"queue":"jobs","owner":"http://n2:8080","term":1,"epoch":1,"ttl_ms":5000}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/internal/lease/vote", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-ClarkQ-Cluster-Token", "tok")
	req.Header.Set("X-ClarkQ-CatchUp", "1")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"granted":true`)) {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}
