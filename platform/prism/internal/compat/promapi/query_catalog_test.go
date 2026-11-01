package promapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/config"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

type catalogProbeSet struct {
	found      bool
	warnings   []string
	iterErr    error
	closeErr   error
	closeCalls int
	closed     bool
}

func (s *catalogProbeSet) Next() bool     { return s.found }
func (s *catalogProbeSet) At() spi.Series { return nil }
func (s *catalogProbeSet) Err() error     { return s.iterErr }
func (s *catalogProbeSet) Warnings() []string {
	if s.closed {
		return nil
	}
	return s.warnings
}
func (s *catalogProbeSet) Close() error {
	s.closeCalls++
	s.closed = true
	return s.closeErr
}

type catalogProbeStore struct {
	queryStore
	sets  []*catalogProbeSet
	calls int
}

func (s *catalogProbeStore) Select(context.Context, spi.SeriesQuery) (spi.SeriesSet, error) {
	set := s.sets[s.calls]
	s.calls++
	return set, nil
}

func TestLabelCatalogProbeWarnings(t *testing.T) {
	secret := "raw-secret-token"
	for _, tc := range []struct {
		name      string
		sets      []*catalogProbeSet
		selectors int
		wantClass spi.ErrClass
		wantWarn  bool
		wantCalls int
	}{
		{"empty set warning", []*catalogProbeSet{{warnings: []string{secret}}}, 1, "", true, 1},
		{"partial set warning", []*catalogProbeSet{{found: true, warnings: []string{secret}}}, 1, "", true, 1},
		{"multiple selectors one warning", []*catalogProbeSet{{warnings: []string{secret}}, {warnings: []string{secret}}}, 2, "", true, 2},
		{"exact count boundary", []*catalogProbeSet{{warnings: make([]string, maxQueryWarnings)}}, 1, "", true, 1},
		{"count overflow", []*catalogProbeSet{{warnings: make([]string, maxQueryWarnings+1)}}, 1, spi.ErrTooLarge, false, 1},
		{"count overflow across selectors", []*catalogProbeSet{{warnings: make([]string, 20)}, {warnings: make([]string, 13)}}, 2, spi.ErrTooLarge, false, 2},
		{"exact per warning boundary", []*catalogProbeSet{{warnings: []string{strings.Repeat("a", 4096)}}}, 1, "", true, 1},
		{"per warning overflow", []*catalogProbeSet{{warnings: []string{strings.Repeat("a", 4097)}}}, 1, spi.ErrTooLarge, false, 1},
		{"exact total boundary", []*catalogProbeSet{{warnings: []string{strings.Repeat("a", 4096), strings.Repeat("b", 4096), strings.Repeat("c", 4096), strings.Repeat("d", 4096)}}}, 1, "", true, 1},
		{"total overflow", []*catalogProbeSet{{warnings: []string{strings.Repeat("a", 4096), strings.Repeat("b", 4096), strings.Repeat("c", 4096), strings.Repeat("d", 4096), "e"}}}, 1, spi.ErrTooLarge, false, 1},
		{"total overflow across selectors", []*catalogProbeSet{{warnings: []string{strings.Repeat("a", 4096), strings.Repeat("b", 4096)}}, {warnings: []string{strings.Repeat("c", 4096), strings.Repeat("d", 4096), "e"}}}, 2, spi.ErrTooLarge, false, 2},
		{"iterator error", []*catalogProbeSet{{iterErr: spi.Wrap(spi.ErrUnavailable, "fake", "select", errors.New("iterator failed")), warnings: []string{secret}}}, 1, spi.ErrUnavailable, false, 1},
		{"iterator error precedes close error", []*catalogProbeSet{{iterErr: spi.Wrap(spi.ErrUnavailable, "fake", "select", errors.New("iterator failed")), closeErr: spi.Wrap(spi.ErrTimeout, "fake", "close", errors.New("close failed"))}}, 1, spi.ErrUnavailable, false, 1},
		{"close error", []*catalogProbeSet{{closeErr: spi.Wrap(spi.ErrUnavailable, "fake", "close", errors.New("close failed")), warnings: []string{secret}}}, 1, spi.ErrUnavailable, false, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &catalogProbeStore{sets: tc.sets}
			h, err := NewQueryHandler(queryBackend{store: store}, QueryOptions{Tenant: "default", AllowAnonymousRead: true, Config: config.Default().Query})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = h.Close(t.Context()) })
			selectors := make([][]spi.Matcher, tc.selectors)
			result, warnings, err := h.labelCatalog(t.Context(), "", selectors, time.Now().Add(-time.Hour), time.Now(), 0)
			if got := spi.Classify(err); err != nil && got != tc.wantClass || err == nil && tc.wantClass != "" {
				t.Fatalf("error class = %s, err = %v, want %s", got, err, tc.wantClass)
			}
			if tc.wantWarn {
				if len(warnings) != 1 || warnings[0] != "catalog completed with backend warnings" {
					t.Fatalf("warnings = %q", warnings)
				}
				if strings.Contains(warnings[0], secret) {
					t.Fatal("raw backend warning exposed")
				}
				if result == nil {
					t.Fatal("successful catalog returned no data")
				}
			} else if len(warnings) != 0 {
				t.Fatalf("unexpected warnings = %q", warnings)
			}
			if store.calls != tc.wantCalls {
				t.Fatalf("Select calls = %d, want %d", store.calls, tc.wantCalls)
			}
			for _, set := range tc.sets {
				if set.closeCalls != 1 {
					t.Fatalf("Close calls = %d, want 1", set.closeCalls)
				}
			}
		})
	}
}

func TestLabelCatalogProbeWarningHTTP(t *testing.T) {
	store := &catalogProbeStore{sets: []*catalogProbeSet{{warnings: []string{"raw-secret-token"}}}}
	h, err := NewQueryHandler(queryBackend{store: store}, QueryOptions{Tenant: "default", AllowAnonymousRead: true, Config: config.Default().Query})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Close(t.Context()) })
	w := httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/prom/api/v1/labels", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"warnings":["catalog completed with backend warnings"]`) || strings.Contains(w.Body.String(), "raw-secret-token") {
		t.Fatalf("catalog response: %d %s", w.Code, w.Body.String())
	}
	if store.sets[0].closeCalls != 1 {
		t.Fatalf("Close calls = %d", store.sets[0].closeCalls)
	}
}
