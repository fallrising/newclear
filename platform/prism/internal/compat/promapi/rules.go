package promapi

import (
	"context"
	"encoding/json/v2"
	"errors"
	"net/http"
	"net/url"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

// RulesSource serves GET /prom/api/v1/rules and GET /prom/api/v1/alerts.
// The data values are the Prometheus data objects, without the status envelope.
type RulesSource interface {
	Rules(ctx context.Context, q url.Values) (any, error)
	Alerts(ctx context.Context) (any, error)
}

// rulesStatus is implemented by eval's parameter error. The concrete type stays
// in eval so this package does not import it.
type rulesStatus interface {
	RulesStatus() (status int, errorType, message string)
}

// SetRules attaches the rules and alerts source. A nil source serves empty lists.
func (h *QueryHandler) SetRules(src RulesSource) {
	h.mu.Lock()
	h.rules = src
	h.mu.Unlock()
}

func (h *QueryHandler) rulesSource() RulesSource {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rules
}

func (h *QueryHandler) serveRules(ctx context.Context, w http.ResponseWriter, q url.Values) {
	src := h.rulesSource()
	if src == nil {
		h.writeSuccess(w, struct {
			Groups []struct{} `json:"groups"`
		}{Groups: []struct{}{}})
		return
	}
	data, err := src.Rules(ctx, q)
	if err != nil {
		h.writeRulesError(w, err)
		return
	}
	h.writeSuccess(w, data)
}

func (h *QueryHandler) serveAlerts(ctx context.Context, w http.ResponseWriter) {
	src := h.rulesSource()
	if src == nil {
		h.writeSuccess(w, struct {
			Alerts []struct{} `json:"alerts"`
		}{Alerts: []struct{}{}})
		return
	}
	data, err := src.Alerts(ctx)
	if err != nil {
		h.writeRulesError(w, err)
		return
	}
	h.writeSuccess(w, data)
}

func (h *QueryHandler) writeRulesError(w http.ResponseWriter, err error) {
	var status rulesStatus
	if errors.As(err, &status) {
		code, _, msg := status.RulesStatus()
		h.errorResponseStatus(w, code, spi.ErrBadRequest, msg, false)
		return
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		h.errorResponse(w, spi.ErrTimeout, "query canceled or timed out", false)
		return
	}
	h.errorResponse(w, spi.Classify(err), "rules query failed", false)
}

func (h *QueryHandler) writeSuccess(w http.ResponseWriter, data any) {
	envelope := struct {
		Status string `json:"status"`
		Data   any    `json:"data"`
	}{Status: "success", Data: data}
	encoded, err := json.Marshal(envelope)
	if err != nil || len(encoded) > maxQueryResponse {
		h.errorResponse(w, spi.ErrTooLarge, "response too large", false)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(encoded)
}
