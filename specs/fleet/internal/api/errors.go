package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/fallrising/fleet-catalog/internal/fleetfile"
	"github.com/fallrising/fleet-catalog/internal/store"
)

type envelope struct {
	Error errBody `json:"error"`
}

type errBody struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details"`
}

func writeError(w http.ResponseWriter, status int, code, msg string, details map[string]any) {
	if details == nil {
		details = map[string]any{}
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(envelope{Error: errBody{Code: code, Message: msg, Details: details}})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func mapStoreErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, store.ErrNameConflict):
		writeError(w, http.StatusConflict, "name_conflict", "name already exists", nil)
	case errors.Is(err, store.ErrTombstonePending):
		writeError(w, http.StatusConflict, "tombstone_pending", "service is tombstoning", nil)
	case errors.Is(err, store.ErrPortExhausted):
		writeError(w, http.StatusConflict, "port_exhausted", "host port range exhausted", nil)
	case errors.Is(err, store.ErrAgentLeaseHeld):
		writeError(w, http.StatusConflict, "agent_lease_held", err.Error(), nil)
	case errors.Is(err, store.ErrNodeHasWorkloads):
		writeError(w, http.StatusConflict, "name_conflict", "node still has services or tombstones", nil)
	case errors.Is(err, store.ErrReserved):
		writeError(w, http.StatusBadRequest, "name_reserved", "reserved name", nil)
	case errors.Is(err, store.ErrUnauthorized), errors.Is(err, store.ErrTokenExpired):
		writeError(w, http.StatusUnauthorized, "unauthorized", "unauthorized", nil)
	case errors.Is(err, store.ErrForbidden), errors.Is(err, store.ErrNodeScope):
		writeError(w, http.StatusForbidden, "forbidden", err.Error(), nil)
	default:
		writeError(w, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

func writeFleetErr(w http.ResponseWriter, err error) {
	var fe *fleetfile.Error
	if errors.As(err, &fe) {
		details := map[string]any{}
		if len(fe.Fields) > 0 {
			fields := make([]map[string]string, 0, len(fe.Fields))
			for _, f := range fe.Fields {
				fields = append(fields, map[string]string{"path": f.Path, "code": f.Code})
			}
			details["fields"] = fields
		}
		code := fe.Code
		if code == "" {
			code = "validation_failed"
		}
		status := http.StatusBadRequest
		writeError(w, status, code, fe.Message, details)
		return
	}
	writeError(w, http.StatusBadRequest, "validation_failed", err.Error(), nil)
}
