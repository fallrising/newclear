package api

import (
	"net/http"
	"testing"
)

func TestDeployOverlaysImageBeforeRawValidation(t *testing.T) {
	for _, placeholder := range []any{"", nil, 123} {
		t.Run("overlay", func(t *testing.T) {
			e := newTest(t)
			e.register(t, "node-1")
			doc := map[string]any{"apiVersion": "fleet.catalog/v1", "kind": "Service", "metadata": map[string]any{"name": "hello"}, "spec": map[string]any{"node": "node-1", "image": placeholder, "expose": map[string]any{"mode": "public", "port": 8080}}}
			rr := e.do(t, http.MethodPost, "/api/v1/deploy", "fleet-api.example.com", e.op, "", map[string]any{"fleet": doc, "image": "example:sha123"})
			if rr.Code != http.StatusCreated {
				t.Fatalf("overlay rejected: %d %s", rr.Code, rr.Body.String())
			}
		})
	}
}
