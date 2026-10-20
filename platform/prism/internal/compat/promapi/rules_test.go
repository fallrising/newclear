package promapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/fallrising/newclear/platform/prism/internal/config"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

type stubRules struct {
	rules  any
	alerts any
	err    error
}

func (s stubRules) Rules(context.Context, url.Values) (any, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.rules, nil
}

func (s stubRules) Alerts(context.Context) (any, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.alerts, nil
}

type stubStatusError struct{ msg string }

func (e *stubStatusError) Error() string { return e.msg }

func (e *stubStatusError) RulesStatus() (int, string, string) {
	return http.StatusBadRequest, "bad_data", e.msg
}

func TestRulesRoute(t *testing.T) {
	backend := queryBackend{store: queryStore{}, caps: spi.Capabilities{Signals: []spi.Signal{spi.SignalMetrics}}}
	h, err := NewQueryHandler(backend, QueryOptions{Tenant: "default", AllowAnonymousRead: true, Config: config.Default().Query})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { h.Stop() })

	empty := httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(empty, httptest.NewRequest(http.MethodGet, "/prom/api/v1/rules", nil))
	if empty.Code != http.StatusOK || !strings.Contains(empty.Body.String(), `"groups":[]`) {
		t.Fatalf("nil source rules: %d %s", empty.Code, empty.Body.String())
	}
	emptyAlerts := httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(emptyAlerts, httptest.NewRequest(http.MethodGet, "/prom/api/v1/alerts", nil))
	if emptyAlerts.Code != http.StatusOK || !strings.Contains(emptyAlerts.Body.String(), `"alerts":[]`) {
		t.Fatalf("nil source alerts: %d %s", emptyAlerts.Code, emptyAlerts.Body.String())
	}

	post := httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(post, httptest.NewRequest(http.MethodPost, "/prom/api/v1/rules", nil))
	if post.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST rules = %d", post.Code)
	}

	msg := `invalid parameter "type": not supported value "alerting"`
	h.SetRules(stubRules{err: &stubStatusError{msg: msg}})
	bad := httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(bad, httptest.NewRequest(http.MethodGet, "/prom/api/v1/rules?type=alerting", nil))
	want := `{"status":"error","errorType":"bad_data","error":"invalid parameter \"type\": not supported value \"alerting\""}`
	if bad.Code != http.StatusBadRequest || bad.Body.String() != want {
		t.Fatalf("type error = %d %s", bad.Code, bad.Body.String())
	}

	locked, err := NewQueryHandler(backend, QueryOptions{
		Tenant: "default",
		APIKey: secret.String(strings.Repeat("k", 32)),
		Config: config.Default().Query,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { locked.Stop() })
	denied := httptest.NewRecorder()
	locked.HTTPHandler().ServeHTTP(denied, httptest.NewRequest(http.MethodGet, "/prom/api/v1/alerts", nil))
	if denied.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated alerts = %d %s", denied.Code, denied.Body.String())
	}
}

func FuzzRulesQuery(f *testing.F) {
	f.Add("/prom/api/v1/rules?type=alert")
	f.Add("/prom/api/v1/rules?type=alerting")
	f.Add("/prom/api/v1/rules?exclude_alerts=true")
	f.Add("/prom/api/v1/rules?exclude_alerts=maybe")
	f.Add("/prom/api/v1/alerts")
	f.Add("/prom/api/v1/rules?rule_name[]=A&file[]=a.yml")
	f.Fuzz(func(t *testing.T, raw string) {
		if len(raw) > 4096 {
			t.Skip()
		}
		req, err := http.NewRequest(http.MethodGet, raw, nil)
		if err != nil {
			return
		}
		h, err := NewQueryHandler(queryBackend{store: queryStore{}}, QueryOptions{Tenant: "default", AllowAnonymousRead: true, Config: config.Default().Query})
		if err != nil {
			t.Fatal(err)
		}
		defer h.Stop()
		h.SetRules(stubRules{
			rules:  map[string]any{"groups": []any{}},
			alerts: map[string]any{"alerts": []any{}},
		})
		h.HTTPHandler().ServeHTTP(httptest.NewRecorder(), req)
	})
}
