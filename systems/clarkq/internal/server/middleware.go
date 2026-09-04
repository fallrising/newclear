package server

import (
	"net/http"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// Handler returns the root handler, optionally wrapped with OpenTelemetry HTTP instrumentation.
func (s *Server) Handler() http.Handler {
	h := http.Handler(s.mux)
	if s.cfg.OTELEndpoint != "" {
		h = otelhttp.NewHandler(h, "clarkq",
			otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
				return r.Method + " " + r.URL.Path
			}),
		)
	}
	return h
}
