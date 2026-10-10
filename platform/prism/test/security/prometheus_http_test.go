package security_test

import (
	"context"
	"encoding/json/v2"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/prometheus/model/labels"

	"github.com/fallrising/newclear/platform/prism/internal/compat/promapi"
	"github.com/fallrising/newclear/platform/prism/internal/config"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
)

func TestPrometheusHTTPTrustBoundary(t *testing.T) {
	backend, err := spi.Open(t.Context(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := backend.Close(); err != nil {
			t.Error(err)
		}
	})
	stamp := utm.TimeToMilli(time.Now().Add(-time.Second))
	for tenant, value := range map[string]float64{"trusted": 7, "other": 991} {
		if err := backend.Metrics().Write(t.Context(), []utm.MetricPoint{{
			Labels: labels.FromStrings("__name__", "http_secure_metric", "__tenant__", tenant, "job", "api"),
			TS:     stamp, Value: value,
		}}); err != nil {
			t.Fatal(err)
		}
	}
	const key = "public-http-query-test-key-not-for-production"
	for _, anonymous := range []bool{false, true} {
		t.Run(map[bool]string{false: "authenticated", true: "anonymous"}[anonymous], func(t *testing.T) {
			handler, err := promapi.NewQueryHandler(backend, promapi.QueryOptions{
				Tenant: "trusted", APIKey: secret.String(key), AllowAnonymousRead: anonymous, Config: config.Default().Query,
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), time.Second)
				defer cancel()
				if err := handler.Close(ctx); err != nil {
					t.Error(err)
				}
			})
			request := func(expr string, mutate func(*http.Request)) *httptest.ResponseRecorder {
				t.Helper()
				r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/prom/api/v1/query?query="+url.QueryEscape(expr), nil)
				if !anonymous {
					r.Header.Set("Authorization", "Bearer "+key)
				}
				if mutate != nil {
					mutate(r)
				}
				w := httptest.NewRecorder()
				handler.HTTPHandler().ServeHTTP(w, r)
				if strings.Contains(w.Body.String(), key) {
					t.Fatal("response exposed credential")
				}
				return w
			}
			good := request("http_secure_metric", nil)
			if good.Code != http.StatusOK {
				t.Fatalf("valid query status=%d body=%s", good.Code, good.Body.String())
			}
			var envelope struct {
				Status string
				Data   struct {
					ResultType string
					Result     []struct {
						Metric map[string]string
						Value  []any
					}
				}
			}
			if err := json.Unmarshal(good.Body.Bytes(), &envelope, json.MatchCaseInsensitiveNames(true)); err != nil {
				t.Fatal(err)
			}
			if envelope.Status != "success" || envelope.Data.ResultType != "vector" || len(envelope.Data.Result) != 1 || len(envelope.Data.Result[0].Value) != 2 || envelope.Data.Result[0].Value[1] != "7" {
				t.Fatalf("trusted query returned unexpected data: %s", good.Body.String())
			}
			if _, ok := envelope.Data.Result[0].Metric[utm.LabelTenant]; ok {
				t.Fatal("stored internal tenant label exposed")
			}
			for _, expr := range []string{
				`http_secure_metric{__tenant__="other"}`,
				`sum by (__tenant__) (http_secure_metric)`,
				`http_secure_metric + on(__tenant__) http_secure_metric`,
				`label_replace(http_secure_metric,"__tenant__","other","job",".*")`,
				`label_join(http_secure_metric,"__tenant__",",","job")`,
				`label_replace(http_secure_metric,"leak","$1","__tenant__","(.*)")`,
				`label_join(http_secure_metric,"leak",",","__tenant__")`,
				`label_replace(http_secure_metric,"leak","$1",(("__tenant__")),"(.*)")`,
				`label_replace(http_secure_metric,("__tenant__"),"x","job",".*")`,
				`label_join(http_secure_metric,"leak",",",("__tenant__"))`,
				`count_values(("__tenant__"),http_secure_metric)`,
				`max_over_time(http_secure_metric{__tenant__=~".*"}[2s:1s])`,
			} {
				w := request(expr, nil)
				if w.Code != http.StatusBadRequest || w.Header().Get("X-Prism-Error-Class") == "" {
					t.Errorf("reserved AST accepted: status=%d expr=%s", w.Code, expr)
				}
			}
			for _, mutate := range []func(*http.Request){
				func(r *http.Request) { r.Header.Set("X-Scope-OrgID", "other") },
				func(r *http.Request) { r.Header.Set("X-Prism-Tenant", "other") },
				func(r *http.Request) { r.Header["X-Scope-OrgID"] = []string{"trusted", "other"} },
				func(r *http.Request) { r.Header.Set("Authorization", "Bearer invalid") },
				func(r *http.Request) { r.Header["Authorization"] = []string{"Bearer " + key, "Bearer invalid"} },
			} {
				w := request("http_secure_metric", mutate)
				if w.Code < 400 || w.Header().Get("X-Prism-Error-Class") == "" {
					t.Errorf("spoofed identity accepted: status=%d", w.Code)
				}
			}
			if !anonymous && request("http_secure_metric", func(r *http.Request) { r.Header.Del("Authorization") }).Code != http.StatusUnauthorized {
				t.Fatal("missing read credentials accepted")
			}
			for _, path := range []string{"/labels", "/label/__name__/values", "/series?match%5B%5D=http_secure_metric"} {
				r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/prom/api/v1"+path, nil)
				r.Header.Set("Authorization", "Bearer "+key)
				w := httptest.NewRecorder()
				handler.HTTPHandler().ServeHTTP(w, r)
				if w.Code != http.StatusOK || strings.Contains(w.Body.String(), "__tenant__") || strings.Contains(w.Body.String(), "991") {
					t.Fatalf("catalog trust boundary: %d %s", w.Code, w.Body.String())
				}
				if path == "/labels" && !strings.Contains(w.Body.String(), "__name__") {
					t.Fatal("metric-name label missing from HTTP labels")
				}
			}
			handler.Stop()
			if request("http_secure_metric", nil).Code != http.StatusServiceUnavailable {
				t.Fatal("stopped handler admitted request")
			}
		})
	}
	// A query handler owns its requests, not the shared backend.
	if err := backend.Ping(t.Context()); err != nil {
		t.Fatalf("handler closed borrowed backend: %v", err)
	}
}
