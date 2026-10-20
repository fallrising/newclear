package eval

import (
	"context"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/prometheus/promql"
)

// rulesError is returned for a rejected rules query parameter.
// promapi maps RulesStatus onto the Prometheus error envelope.
type rulesError struct {
	status int
	kind   string
	msg    string
}

func (e *rulesError) Error() string { return e.msg }

func (e *rulesError) RulesStatus() (int, string, string) {
	return e.status, e.kind, e.msg
}

func badRulesParam(name, detail string) error {
	return &rulesError{
		status: http.StatusBadRequest,
		kind:   "bad_data",
		msg:    fmt.Sprintf("invalid parameter %q: %s", name, detail),
	}
}

type rulesData struct {
	Groups []*groupJSON `json:"groups"`
}

type alertsData struct {
	Alerts []*alertJSON `json:"alerts"`
}

type groupJSON struct {
	Name           string    `json:"name"`
	File           string    `json:"file"`
	Rules          []any     `json:"rules"`
	Interval       float64   `json:"interval"`
	Limit          int       `json:"limit"`
	EvaluationTime float64   `json:"evaluationTime"`
	LastEvaluation time.Time `json:"lastEvaluation"`
}

type alertingJSON struct {
	State          string            `json:"state"`
	Name           string            `json:"name"`
	Query          string            `json:"query"`
	Duration       float64           `json:"duration"`
	KeepFiringFor  float64           `json:"keepFiringFor"`
	Labels         map[string]string `json:"labels"`
	Annotations    map[string]string `json:"annotations"`
	Alerts         *[]*alertJSON     `json:"alerts"`
	Health         string            `json:"health"`
	LastError      string            `json:"lastError,omitempty"`
	EvaluationTime float64           `json:"evaluationTime"`
	LastEvaluation time.Time         `json:"lastEvaluation"`
	Type           string            `json:"type"`
}

type recordingJSON struct {
	Name           string            `json:"name"`
	Query          string            `json:"query"`
	Labels         map[string]string `json:"labels,omitempty"`
	Health         string            `json:"health"`
	LastError      string            `json:"lastError,omitempty"`
	EvaluationTime float64           `json:"evaluationTime"`
	LastEvaluation time.Time         `json:"lastEvaluation"`
	Type           string            `json:"type"`
}

type alertJSON struct {
	Labels          map[string]string `json:"labels"`
	Annotations     map[string]string `json:"annotations"`
	State           string            `json:"state"`
	ActiveAt        time.Time         `json:"activeAt"`
	KeepFiringSince *time.Time        `json:"keepFiringSince,omitempty"`
	Value           string            `json:"value"`
}

// Rules returns the /api/v1/rules data object. type=alert and type=record filter
// rules. Any other type is the Prometheus 2.53.0 bad_data error.
func (e *Engine) Rules(ctx context.Context, q url.Values) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if q == nil {
		q = url.Values{}
	}
	typ := strings.ToLower(q.Get("type"))
	if typ != "" && typ != "alert" && typ != "record" {
		return nil, badRulesParam("type", fmt.Sprintf("not supported value %q", typ))
	}
	exclude, err := parseExcludeAlerts(q.Get("exclude_alerts"))
	if err != nil {
		return nil, err
	}
	names := valueSet(q["rule_name[]"])
	files := valueSet(q["file[]"])
	wantAlert := typ == "" || typ == "alert"
	wantRecord := typ == "" || typ == "record"

	e.mu.Lock()
	defer e.mu.Unlock()
	groups := make([]*groupJSON, 0, len(e.groups))
	for _, g := range e.groups {
		if len(files) > 0 {
			if _, ok := files[g.file]; !ok {
				continue
			}
		}
		g.mu.Lock()
		view := &groupJSON{
			Name:           g.name,
			File:           g.file,
			Interval:       g.interval.Seconds(),
			Limit:          g.limit,
			EvaluationTime: g.evalDur.Seconds(),
			LastEvaluation: g.last.UTC(),
			Rules:          []any{},
		}
		rules := g.rules
		g.mu.Unlock()
		for _, rule := range rules {
			if len(names) > 0 {
				if _, ok := names[rule.ruleName()]; !ok {
					continue
				}
			}
			switch item := rule.(type) {
			case *alertingRule:
				if wantAlert {
					view.Rules = append(view.Rules, alertingView(item, exclude))
				}
			case *recordingRule:
				if wantRecord {
					view.Rules = append(view.Rules, recordingView(item))
				}
			}
		}
		if len(view.Rules) == 0 {
			continue
		}
		groups = append(groups, view)
	}
	return &rulesData{Groups: groups}, nil
}

// Alerts returns pending and firing alerts for /api/v1/alerts.
func (e *Engine) Alerts(ctx context.Context) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	out := []*alertJSON{}
	for _, g := range e.groups {
		for _, rule := range g.rules {
			ar, ok := rule.(*alertingRule)
			if !ok {
				continue
			}
			for _, a := range ar.alerts() {
				if a.phase != phasePending && a.phase != phaseFiring {
					continue
				}
				out = append(out, alertView(a))
			}
		}
	}
	return &alertsData{Alerts: out}, nil
}

// Instant evaluates expr at ts against the series this engine has written.
// File rules use the empty tenant, which the HTTP query API does not accept.
func (e *Engine) Instant(ctx context.Context, expr string, ts time.Time) (promql.Vector, error) {
	return e.query(ctx, expr, ts)
}

func parseExcludeAlerts(raw string) (bool, error) {
	if raw == "" {
		return false, nil
	}
	value, err := strconv.ParseBool(strings.ToLower(raw))
	if err != nil {
		return false, badRulesParam("exclude_alerts", "error converting exclude_alerts: "+err.Error())
	}
	return value, nil
}

func valueSet(vals []string) map[string]struct{} {
	if len(vals) == 0 {
		return nil
	}
	set := make(map[string]struct{}, len(vals))
	for _, v := range vals {
		set[v] = struct{}{}
	}
	return set
}

func alertingView(r *alertingRule, exclude bool) alertingJSON {
	health, lastErr, last, evalSeconds, _ := r.snapshotBase()
	var alerts *[]*alertJSON
	if !exclude {
		items := r.alerts()
		out := make([]*alertJSON, 0, len(items))
		for _, a := range items {
			if a.phase != phasePending && a.phase != phaseFiring {
				continue
			}
			out = append(out, alertView(a))
		}
		alerts = &out
	}
	return alertingJSON{
		State:          r.state(),
		Name:           r.name,
		Query:          r.expr,
		Duration:       r.hold.Seconds(),
		KeepFiringFor:  r.keep.Seconds(),
		Labels:         cloneOrEmpty(r.labels),
		Annotations:    cloneOrEmpty(r.annotations),
		Alerts:         alerts,
		Health:         health,
		LastError:      lastErr,
		EvaluationTime: evalSeconds,
		LastEvaluation: last.UTC(),
		Type:           "alerting",
	}
}

func recordingView(r *recordingRule) recordingJSON {
	health, lastErr, last, evalSeconds, _ := r.snapshotBase()
	return recordingJSON{
		Name:           r.name,
		Query:          r.expr,
		Labels:         recordingLabels(r.labels),
		Health:         health,
		LastError:      lastErr,
		EvaluationTime: evalSeconds,
		LastEvaluation: last.UTC(),
		Type:           "recording",
	}
}

func alertView(a *alert) *alertJSON {
	item := &alertJSON{
		Labels:      cloneOrEmpty(a.labels.Map()),
		Annotations: cloneOrEmpty(a.annotations.Map()),
		State:       a.phase.String(),
		ActiveAt:    a.activeAt.UTC(),
		Value:       strconv.FormatFloat(a.value, 'e', -1, 64),
	}
	if !a.keepSince.IsZero() {
		item.KeepFiringSince = new(a.keepSince.UTC())
	}
	return item
}

func cloneOrEmpty(m map[string]string) map[string]string {
	if len(m) == 0 {
		return map[string]string{}
	}
	return maps.Clone(m)
}

func recordingLabels(m map[string]string) map[string]string {
	if len(m) == 0 {
		return nil
	}
	return maps.Clone(m)
}
