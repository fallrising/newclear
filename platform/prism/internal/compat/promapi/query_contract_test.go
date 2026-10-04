package promapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/config"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/prometheus/prometheus/model/labels"
)

type contractBackend struct {
	spi.Backend
	store spi.MetricStore
	caps  spi.Capabilities
}

func (b contractBackend) Metrics() spi.MetricStore       { return b.store }
func (b contractBackend) Capabilities() spi.Capabilities { return b.caps }

type contractStore struct {
	spi.MetricStore
	selectCalls atomic.Int32
}

func (s *contractStore) Select(context.Context, spi.SeriesQuery) (spi.SeriesSet, error) {
	s.selectCalls.Add(1)
	return spi.SliceSeriesSet(nil), nil
}

type contractNativeStore struct {
	*contractStore
	instantCalls atomic.Int32
	rangeCalls   atomic.Int32
	err          error
}

func (s *contractNativeStore) QueryInstant(context.Context, string, string, time.Time, time.Duration) (*spi.PromResult, error) {
	s.instantCalls.Add(1)
	if s.err != nil {
		return nil, s.err
	}
	return &spi.PromResult{ResultType: "vector", Vector: []spi.VectorSample{{Labels: labels.FromStrings("__name__", "up"), Value: 42}}}, nil
}

func (s *contractNativeStore) QueryRange(context.Context, string, string, time.Time, time.Time, time.Duration, time.Duration) (*spi.PromResult, error) {
	s.rangeCalls.Add(1)
	if s.err != nil {
		return nil, s.err
	}
	return &spi.PromResult{ResultType: "matrix"}, nil
}

func contractHandler(t *testing.T, store spi.MetricStore, caps spi.Capabilities, forceFallback bool) *QueryHandler {
	t.Helper()
	settings := config.Default().Query
	settings.ForceFallback = forceFallback
	h, err := NewQueryHandler(contractBackend{store: store, caps: caps}, QueryOptions{Tenant: "default", AllowAnonymousRead: true, Config: settings})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		shutdown, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := h.Close(shutdown); err != nil {
			t.Error(err)
		}
	})
	return h
}

func contractResponse(t *testing.T, h *QueryHandler, method, target, body, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequestWithContext(t.Context(), method, target, strings.NewReader(body))
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	response := httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(response, request)
	return response
}

func TestContractFormMethodsAndInputBounds(t *testing.T) {
	h := contractHandler(t, &contractStore{}, spi.Capabilities{}, false)
	for _, test := range []struct {
		name, method, target, body, contentType string
		status                                  int
		fragment                                string
		allow                                   string
	}{
		{"form POST", http.MethodPost, "/prom/api/v1/query", "query=vector%282%29", "application/x-www-form-urlencoded", http.StatusOK, `"resultType":"vector"`, ""},
		{"form charset", http.MethodPost, "/prom/api/v1/query", "query=vector%282%29", "application/x-www-form-urlencoded; charset=utf-8", http.StatusOK, `"resultType":"vector"`, ""},
		{"duplicate URL and form scalar", http.MethodPost, "/prom/api/v1/query?query=vector(1)", "query=vector%282%29", "application/x-www-form-urlencoded", http.StatusBadRequest, `"errorType":"bad_data"`, ""},
		{"duplicate form scalar", http.MethodPost, "/prom/api/v1/query", "query=vector(1)&query=vector(2)", "application/x-www-form-urlencoded", http.StatusBadRequest, `"errorType":"bad_data"`, ""},
		{"wrong form content type", http.MethodPost, "/prom/api/v1/query", "query=vector(1)", "application/json", http.StatusBadRequest, `"errorType":"bad_data"`, ""},
		{"unsupported option", http.MethodGet, "/prom/api/v1/query?query=vector(1)&dedup=true", "", "", http.StatusBadRequest, `"errorType":"bad_data"`, ""},
		{"wrong method", http.MethodPut, "/prom/api/v1/query", "", "", http.StatusMethodNotAllowed, `"status":"error"`, "GET, POST"},
		{"unknown route", http.MethodGet, "/prom/api/v1/not-a-route", "", "", http.StatusNotFound, `"errorType":"not_found"`, ""},
		{"oversize URL", http.MethodGet, "/prom/api/v1/query?query=" + strings.Repeat("a", maxQueryInput), "", "", http.StatusBadRequest, `"errorType":"bad_data"`, ""},
		{"oversize form", http.MethodPost, "/prom/api/v1/query", "query=" + strings.Repeat("a", maxQueryInput), "application/x-www-form-urlencoded", http.StatusBadRequest, `"errorType":"bad_data"`, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := contractResponse(t, h, test.method, test.target, test.body, test.contentType)
			if response.Code != test.status || !strings.Contains(response.Body.String(), test.fragment) {
				t.Fatalf("status=%d body=%q, want status=%d and %q", response.Code, response.Body.String()[:min(response.Body.Len(), 256)], test.status, test.fragment)
			}
			if test.status != http.StatusOK && response.Header().Get("X-Prism-Error-Class") == "" {
				t.Fatal("error response omitted class")
			}
			if test.allow != "" && response.Header().Get("Allow") != test.allow {
				t.Fatalf("Allow=%q want=%q", response.Header().Get("Allow"), test.allow)
			}
		})
	}
}

func TestContractNativeCapabilityAndNoRetry(t *testing.T) {
	for _, test := range []struct {
		name, path                string
		capability, forceFallback bool
		nativeError               error
		wantStatus                int
		wantNative, wantSelect    int32
	}{
		{"capability absent", "/prom/api/v1/query?query=up", false, false, nil, http.StatusOK, 0, 1},
		{"native enabled", "/prom/api/v1/query?query=up", true, false, nil, http.StatusOK, 1, 0},
		{"force fallback", "/prom/api/v1/query?query=up", true, true, nil, http.StatusOK, 0, 1},
		{"native error no fallback", "/prom/api/v1/query?query=up", true, false, spi.Wrap(spi.ErrUnavailable, "default", "native", errors.New("backend unavailable")), http.StatusServiceUnavailable, 1, 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := &contractNativeStore{contractStore: &contractStore{}, err: test.nativeError}
			caps := spi.Capabilities{Signals: []spi.Signal{spi.SignalMetrics}, Metrics: spi.MetricCaps{NativePromQL: test.capability}}
			h := contractHandler(t, store, caps, test.forceFallback)
			response := contractResponse(t, h, http.MethodGet, test.path, "", "")
			if response.Code != test.wantStatus {
				t.Fatalf("status=%d body=%s want=%d", response.Code, response.Body.String(), test.wantStatus)
			}
			if got := store.instantCalls.Load(); got != test.wantNative {
				t.Fatalf("native calls=%d want=%d", got, test.wantNative)
			}
			if got := store.selectCalls.Load(); got != test.wantSelect {
				t.Fatalf("fallback Select calls=%d want=%d", got, test.wantSelect)
			}
			if test.nativeError != nil && strings.Contains(response.Body.String(), "backend unavailable") {
				t.Fatal("native backend error leaked into HTTP response")
			}
		})
	}
}

func TestContractDeclaredCapabilityNeedsNativeInterface(t *testing.T) {
	store := &contractStore{}
	caps := spi.Capabilities{Signals: []spi.Signal{spi.SignalMetrics}, Metrics: spi.MetricCaps{NativePromQL: true}}
	h := contractHandler(t, store, caps, false)
	response := contractResponse(t, h, http.MethodGet, "/prom/api/v1/query?query=up", "", "")
	if response.Code != http.StatusOK || store.selectCalls.Load() == 0 {
		t.Fatalf("capability without native interface status=%d fallback calls=%d body=%s", response.Code, store.selectCalls.Load(), response.Body.String())
	}
}

func TestContractNativeRangeDispatch(t *testing.T) {
	store := &contractNativeStore{contractStore: &contractStore{}}
	caps := spi.Capabilities{Signals: []spi.Signal{spi.SignalMetrics}, Metrics: spi.MetricCaps{NativePromQL: true}}
	h := contractHandler(t, store, caps, false)
	now := time.Now().UTC()
	target := fmt.Sprintf("/prom/api/v1/query_range?query=up&start=%d&end=%d&step=15", now.Add(-time.Minute).Unix(), now.Unix())
	response := contractResponse(t, h, http.MethodGet, target, "", "")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"resultType":"matrix"`) || store.rangeCalls.Load() != 1 || store.selectCalls.Load() != 0 {
		t.Fatalf("native range status=%d native=%d fallback=%d body=%s", response.Code, store.rangeCalls.Load(), store.selectCalls.Load(), response.Body.String())
	}
}
