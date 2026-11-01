// Package adapter converts supported third-party webhook payloads into
// CloudEvents envelopes without performing any ingest or network operations.
package adapter

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
)

// Parse converts an Alertmanager webhook v4 document into one CloudEvent JSON
// document per alert. A malformed webhook envelope fails the whole request;
// an invalid alert is represented by an invalid event document so callers can
// report that alert's failure while processing the remaining alerts.
func Parse(body []byte) ([][]byte, error) {
	if _, err := event.Decode(body); err != nil {
		return nil, err
	}
	var envelope map[string]json.RawMessage
	if err := decodeSingleJSON(body, &envelope); err != nil || envelope == nil {
		return nil, errors.New("invalid Alertmanager webhook")
	}

	version, okVersion := rawString(envelope["version"])
	receiver, okReceiver := rawString(envelope["receiver"])
	status, okStatus := rawString(envelope["status"])
	groupKey, okGroupKey := rawString(envelope["groupKey"])
	var alerts []json.RawMessage
	if !okVersion || version != "4" || !okReceiver || receiver == "" || !okStatus || !validStatus(status) || !okGroupKey ||
		!validOptionalEnvelopeFields(envelope) || json.Unmarshal(envelope["alerts"], &alerts) != nil || alerts == nil || len(alerts) > 100 {
		return nil, errors.New("invalid Alertmanager webhook")
	}

	out := make([][]byte, len(alerts))
	for i, raw := range alerts {
		alert, valid := decodeAlert(raw)
		if !valid {
			out[i] = []byte(`{}`)
			continue
		}
		eventJSON, err := mapAlert(receiver, groupKey, alert)
		if err != nil {
			out[i] = []byte(`{}`)
			continue
		}
		// The event decoder is the authoritative CloudEvents contract check.
		// Its error text is intentionally not surfaced to avoid echoing payloads.
		if _, err := event.Decode(eventJSON); err != nil {
			out[i] = []byte(`{}`)
			continue
		}
		out[i] = eventJSON
	}
	return out, nil
}

type alertPayload struct {
	Status      string            `json:"status"`
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	StartsAt    string            `json:"startsAt"`
	EndsAt      string            `json:"endsAt"`
	Generator   string            `json:"generatorURL"`
	Fingerprint string            `json:"fingerprint"`
}

func decodeAlert(raw json.RawMessage) (alertPayload, bool) {
	var fields map[string]json.RawMessage
	if err := decodeSingleJSON(raw, &fields); err != nil || fields == nil {
		return alertPayload{}, false
	}
	allowed := map[string]bool{"status": true, "labels": true, "annotations": true, "startsAt": true, "endsAt": true, "generatorURL": true, "fingerprint": true}
	for name := range fields {
		if !allowed[name] {
			return alertPayload{}, false
		}
	}
	var a alertPayload
	if !hasAll(fields, "status", "labels", "annotations", "startsAt", "endsAt", "generatorURL", "fingerprint") ||
		json.Unmarshal(raw, &a) != nil || !validStatus(a.Status) || !validStringMap(fields["labels"]) || !validStringMap(fields["annotations"]) || a.Fingerprint == "" {
		return alertPayload{}, false
	}
	_, startsOK := parseDateTime(a.StartsAt)
	_, endsOK := parseDateTime(a.EndsAt)
	if !startsOK || !endsOK || !validURI(a.Generator) {
		return alertPayload{}, false
	}
	return a, true
}

func mapAlert(receiver, groupKey string, a alertPayload) ([]byte, error) {
	alertname := a.Labels["alertname"]
	status := a.Status
	timeValue := a.StartsAt
	typeValue := "alertmanager.alert.firing"
	if status == "resolved" {
		timeValue = a.EndsAt
		typeValue = "alertmanager.alert.resolved"
	}
	severity := a.Labels["severity"]
	if !validSeverity(severity) {
		severity = "warning"
	}
	summary := a.Annotations["summary"]
	if summary == "" {
		summary = alertname
	}
	data := map[string]any{
		"labels":      a.Labels,
		"annotations": a.Annotations,
		"groupKey":    groupKey,
	}
	ce := map[string]any{
		"specversion": "1.0",
		"id":          a.Fingerprint + ":" + a.StartsAt + ":" + a.Status,
		"source":      "urn:signalhub:alertmanager:" + receiver,
		"type":        typeValue,
		"time":        timeValue,
		"severity":    severity,
		"summary":     summary,
		"originurl":   a.Generator,
		"data":        data,
	}
	if alertname != "" {
		ce["subject"] = alertname
	}
	return json.Marshal(ce)
}

func decodeSingleJSON(raw []byte, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := dec.Decode(dst); err != nil {
		return err
	}
	var trailing any
	if err := dec.Decode(&trailing); err == nil {
		return errors.New("multiple JSON values")
	} else if !errors.Is(err, io.EOF) {
		return err
	}
	return nil
}

func hasAll(fields map[string]json.RawMessage, keys ...string) bool {
	for _, key := range keys {
		if _, ok := fields[key]; !ok {
			return false
		}
	}
	return true
}

func validStringMap(raw json.RawMessage) bool {
	var values map[string]json.RawMessage
	if len(raw) == 0 || json.Unmarshal(raw, &values) != nil || values == nil {
		return false
	}
	for _, value := range values {
		var s string
		if json.Unmarshal(value, &s) != nil || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return false
		}
	}
	return true
}

func rawString(raw json.RawMessage) (string, bool) {
	var value string
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || json.Unmarshal(raw, &value) != nil {
		return "", false
	}
	return value, true
}

func validOptionalEnvelopeFields(fields map[string]json.RawMessage) bool {
	for _, name := range []string{"groupLabels", "commonLabels", "commonAnnotations"} {
		if raw, ok := fields[name]; ok && !validStringMap(raw) {
			return false
		}
	}
	if raw, ok := fields["externalURL"]; ok {
		value, valid := rawString(raw)
		if !valid || !validURI(value) {
			return false
		}
	}
	if raw, ok := fields["truncatedAlerts"]; ok {
		var number json.Number
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		if dec.Decode(&number) != nil {
			return false
		}
		rational, valid := new(big.Rat).SetString(number.String())
		if !valid || rational.Sign() < 0 || rational.Denom().Cmp(big.NewInt(1)) != 0 {
			return false
		}
	}
	return true
}

func validStatus(s string) bool { return s == "firing" || s == "resolved" }

func validSeverity(s string) bool {
	switch s {
	case "debug", "info", "notice", "warning", "error", "critical":
		return true
	default:
		return false
	}
}

func parseDateTime(s string) (time.Time, bool) {
	t, err := event.ParseTime(s)
	return t, err == nil
}

func validURI(s string) bool { return event.ValidURI(s, true) }
