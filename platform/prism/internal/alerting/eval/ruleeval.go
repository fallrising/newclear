package eval

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/alerting/state"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/common/model"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/model/timestamp"
	"github.com/prometheus/prometheus/promql"
	"github.com/prometheus/prometheus/template"
)

const (
	alertMetric      = "ALERTS"
	alertStateMetric = "ALERTS_FOR_STATE"
	alertStateLabel  = "alertstate"
	templatePrefix   = "<error expanding template: "
)

type phase uint8

const (
	phasePending phase = 1
	phaseFiring  phase = 2
)

func (p phase) String() string {
	switch p {
	case phasePending:
		return "pending"
	case phaseFiring:
		return "firing"
	default:
		return "inactive"
	}
}

func (p phase) code() int16 {
	switch p {
	case phasePending:
		return state.Pending
	case phaseFiring:
		return state.Firing
	default:
		return 0
	}
}

type alert struct {
	labels      labels.Labels
	annotations labels.Labels
	phase       phase
	activeAt    time.Time
	firedAt     time.Time
	keepSince   time.Time
	value       float64
}

func (a *alert) clone() *alert {
	if a == nil {
		return nil
	}
	cp := *a
	return &cp
}

type ruleBase struct {
	mu       sync.Mutex
	name     string
	expr     string
	labels   map[string]string
	raw      labels.Labels
	health   string
	lastErr  error
	lastEval time.Time
	evalDur  time.Duration
	previous map[string]labels.Labels
	queries  int
	kindName string
}

func (r *ruleBase) ruleName() string { return r.name }

func (r *ruleBase) identity() string {
	return r.kindName + "\x00" + r.name + "\x00" + r.raw.String()
}

func (r *ruleBase) snapshotBase() (string, string, time.Time, float64, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	msg := ""
	if r.lastErr != nil {
		msg = r.lastErr.Error()
	}
	return r.health, msg, r.lastEval, r.evalDur.Seconds(), r.queries
}

func (r *ruleBase) series() []labels.Labels {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]labels.Labels, 0, len(r.previous))
	for _, ls := range r.previous {
		out = append(out, ls)
	}
	return out
}

func (r *ruleBase) takeSeries() map[string]labels.Labels {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := r.previous
	r.previous = nil
	if out == nil {
		return map[string]labels.Labels{}
	}
	return out
}

func (r *ruleBase) setSeries(series map[string]labels.Labels) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.previous = series
}

type alertingRule struct {
	ruleBase
	hold        time.Duration
	keep        time.Duration
	annotations map[string]string
	active      map[uint64]*alert
	external    map[string]string
	offset      time.Duration
	limit       int
	maxQuery    int
	query       queryFunc
	parent      *Engine
}

func newAlerting(parent *Engine, g *group, rule ruleInput) *alertingRule {
	raw := labels.FromMap(rule.labels)
	return &alertingRule{
		ruleBase: ruleBase{
			name:     rule.name,
			expr:     rule.expr,
			labels:   maps.Clone(rule.labels),
			raw:      raw,
			health:   "unknown",
			kindName: "alert",
		},
		hold:        rule.hold,
		keep:        rule.keep,
		annotations: maps.Clone(rule.annotations),
		active:      map[uint64]*alert{},
		external:    maps.Clone(parent.external),
		offset:      g.offset,
		limit:       g.limit,
		maxQuery:    parent.maxQuery,
		query:       parent.query,
		parent:      parent,
	}
}

func (r *alertingRule) eval(ctx context.Context, ts time.Time) error {
	r.mu.Lock()
	prev := cloneAlertMap(r.active)
	r.mu.Unlock()
	started := time.Now()
	next, samples, queries, commit, err := r.compute(ctx, ts, prev)
	r.mu.Lock()
	r.queries = queries
	r.lastEval = ts
	r.evalDur = time.Since(started)
	if commit {
		r.active = next
	}
	if err != nil {
		r.health = "err"
		r.lastErr = err
		r.mu.Unlock()
		return err
	}
	r.health = "ok"
	r.lastErr = nil
	previous := r.previous
	r.mu.Unlock()
	stored, werr := r.parent.publish(ctx, previous, samples, utm.TimeToMilli(ts.Add(-r.offset)))
	r.mu.Lock()
	defer r.mu.Unlock()
	if werr != nil {
		r.health = "err"
		r.lastErr = werr
		return werr
	}
	r.previous = stored
	return nil
}

func (r *alertingRule) compute(ctx context.Context, ts time.Time, prev map[uint64]*alert) (map[uint64]*alert, promql.Vector, int, bool, error) {
	res, err := r.query(ctx, r.expr, ts.Add(-r.offset))
	if err != nil {
		return prev, nil, 0, false, err
	}
	var queries int
	expandQuery := func(qctx context.Context, expr string, at time.Time) (promql.Vector, error) {
		if queries >= r.maxQuery {
			return nil, fmt.Errorf("rules.max_template_queries exceeded")
		}
		queries++
		return r.query(qctx, expr, at)
	}
	next := map[uint64]*alert{}
	resultFP := map[uint64]struct{}{}
	for _, smpl := range res {
		lbs, annotations, expandErr := r.expand(ctx, smpl, ts, expandQuery)
		if expandErr != nil {
			return prev, nil, queries, false, expandErr
		}
		fp := utm.Fingerprint(lbs)
		if _, ok := next[fp]; ok {
			return prev, nil, queries, false, fmt.Errorf("vector contains metrics with the same labelset after applying alert labels")
		}
		resultFP[fp] = struct{}{}
		next[fp] = &alert{
			labels:      lbs,
			annotations: annotations,
			activeAt:    ts,
			phase:       phasePending,
			value:       smpl.F,
		}
	}
	for fp, fresh := range next {
		if old, ok := prev[fp]; ok && old.phase != 0 {
			old.value = fresh.value
			old.annotations = fresh.annotations
			next[fp] = old
			continue
		}
	}
	var samples promql.Vector
	activeCount := 0
	for fp, a := range prev {
		if _, ok := resultFP[fp]; ok {
			continue
		}
		var keepFiring bool
		if a.phase == phaseFiring && r.keep > 0 {
			if a.keepSince.IsZero() {
				a.keepSince = ts
			}
			if ts.Sub(a.keepSince) < r.keep {
				keepFiring = true
			}
		}
		if !keepFiring {
			continue
		}
		next[fp] = a
	}
	for fp, a := range next {
		if _, ok := resultFP[fp]; ok {
			a.keepSince = time.Time{}
		}
		if a.phase == phasePending && ts.Sub(a.activeAt) >= r.hold {
			a.phase = phaseFiring
			if a.firedAt.IsZero() {
				a.firedAt = ts
			}
		}
		activeCount++
		samples = append(samples, r.sample(a, ts))
		samples = append(samples, r.forStateSample(a, ts))
	}
	if r.limit > 0 && activeCount > r.limit {
		return map[uint64]*alert{}, nil, queries, true, fmt.Errorf("exceeded limit of %d with %d alerts", r.limit, activeCount)
	}
	return next, samples, queries, true, nil
}

func (r *alertingRule) expand(ctx context.Context, smpl promql.Sample, ts time.Time, query queryFunc) (labels.Labels, labels.Labels, error) {
	defs := "{{$labels := .Labels}}{{$externalLabels := .ExternalLabels}}{{$externalURL := .ExternalURL}}{{$value := .Value}}"
	data := template.AlertTemplateData(smpl.Metric.Map(), r.external, "", smpl)
	expand := func(text string) (string, error) {
		if !strings.Contains(text, "{{") {
			return text, nil
		}
		tmpl := template.NewTemplateExpander(ctx, defs+text, "__alert_"+r.name, data, model.Time(timestamp.FromTime(ts)), template.QueryFunc(query), nil, nil)
		result, err := tmpl.Expand()
		if err != nil {
			return templatePrefix + err.Error() + ">", nil
		}
		return result, nil
	}
	lb := labels.NewBuilder(smpl.Metric)
	lb.Del(labels.MetricName)
	lb.Del(utm.LabelTenant)
	for _, key := range sortedKeys(r.labels) {
		value, err := expand(r.labels[key])
		if err != nil {
			return labels.EmptyLabels(), labels.EmptyLabels(), err
		}
		lb.Set(key, value)
	}
	lb.Set(labels.AlertName, r.name)
	var ann []labels.Label
	for _, key := range sortedKeys(r.annotations) {
		value, err := expand(r.annotations[key])
		if err != nil {
			return labels.EmptyLabels(), labels.EmptyLabels(), err
		}
		ann = append(ann, labels.Label{Name: key, Value: value})
	}
	return lb.Labels(), labels.New(ann...), nil
}

// sample starts from the raw rule labels, then overlays the expanded alert
// labels. Builder.Set drops a label whose expansion is empty, so that key is
// absent on the alert object while ALERTS keeps the unexpanded template text.
func (r *alertingRule) sample(a *alert, ts time.Time) promql.Sample {
	lb := labels.NewBuilder(r.raw)
	a.labels.Range(func(l labels.Label) {
		lb.Set(l.Name, l.Value)
	})
	lb.Set(labels.MetricName, alertMetric)
	lb.Set(labels.AlertName, r.name)
	lb.Set(alertStateLabel, a.phase.String())
	return promql.Sample{Metric: lb.Labels(), T: utm.TimeToMilli(ts.Add(-r.offset)), F: 1}
}

func (r *alertingRule) forStateSample(a *alert, ts time.Time) promql.Sample {
	lb := labels.NewBuilder(r.raw)
	a.labels.Range(func(l labels.Label) {
		lb.Set(l.Name, l.Value)
	})
	lb.Set(labels.MetricName, alertStateMetric)
	lb.Set(labels.AlertName, r.name)
	lb.Del(alertStateLabel)
	return promql.Sample{Metric: lb.Labels(), T: utm.TimeToMilli(ts.Add(-r.offset)), F: float64(a.activeAt.Unix())}
}

func (r *alertingRule) restore(rows []state.Row, used map[int64]struct{}) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, row := range rows {
		if _, ok := used[row.Fingerprint]; ok {
			continue
		}
		if !r.accepts(row) {
			continue
		}
		phase, ok := phaseFromCode(row.State)
		if !ok {
			continue
		}
		item := &alert{
			labels:   labels.FromMap(row.Labels),
			phase:    phase,
			activeAt: row.ActiveAt.UTC(),
		}
		if row.FiredAt != nil {
			item.firedAt = row.FiredAt.UTC()
		}
		r.active[utm.Fingerprint(item.labels)] = item
		used[row.Fingerprint] = struct{}{}
	}
}

func (r *alertingRule) accepts(row state.Row) bool {
	if row.Labels["alertname"] != r.name {
		return false
	}
	for key, value := range r.labels {
		if strings.Contains(value, "{{") {
			continue
		}
		if row.Labels[key] != value {
			return false
		}
	}
	return int64(utm.Fingerprint(labels.FromMap(row.Labels))) == row.Fingerprint
}

func (r *alertingRule) takeAlerts(from *alertingRule) {
	from.mu.Lock()
	active := cloneAlertMap(from.active)
	series := from.previous
	from.previous = nil
	from.mu.Unlock()
	r.mu.Lock()
	r.active = active
	r.previous = series
	r.mu.Unlock()
}

func (r *alertingRule) rows() []state.Row {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]state.Row, 0, len(r.active))
	for _, a := range r.active {
		if a.phase != phasePending && a.phase != phaseFiring {
			continue
		}
		row := state.Row{
			Fingerprint: int64(utm.Fingerprint(a.labels)),
			Labels:      a.labels.Map(),
			State:       a.phase.code(),
			ActiveAt:    a.activeAt.UTC(),
		}
		if !a.firedAt.IsZero() {
			fired := a.firedAt.UTC()
			row.FiredAt = &fired
		}
		out = append(out, row)
	}
	return out
}

func (r *alertingRule) state() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	max := "inactive"
	for _, a := range r.active {
		if a.phase == phaseFiring {
			return "firing"
		}
		if a.phase == phasePending {
			max = "pending"
		}
	}
	return max
}

func (r *alertingRule) alerts() []*alert {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]*alert, 0, len(r.active))
	for _, a := range r.active {
		out = append(out, a.clone())
	}
	return out
}

type recordingRule struct {
	ruleBase
	offset time.Duration
	limit  int
	query  queryFunc
	parent *Engine
}

func newRecording(parent *Engine, g *group, rule ruleInput) *recordingRule {
	return &recordingRule{
		ruleBase: ruleBase{
			name:     rule.name,
			expr:     rule.expr,
			labels:   maps.Clone(rule.labels),
			raw:      labels.FromMap(rule.labels),
			health:   "unknown",
			kindName: "record",
		},
		offset: g.offset,
		limit:  g.limit,
		query:  parent.query,
		parent: parent,
	}
}

func (r *recordingRule) eval(ctx context.Context, ts time.Time) error {
	started := time.Now()
	vector, err := r.query(ctx, r.expr, ts.Add(-r.offset))
	r.mu.Lock()
	r.lastEval = ts
	r.evalDur = time.Since(started)
	if err != nil {
		r.health = "err"
		r.lastErr = err
		r.mu.Unlock()
		return err
	}
	lb := labels.NewBuilder(labels.EmptyLabels())
	for i := range vector {
		lb.Reset(vector[i].Metric)
		lb.Del(utm.LabelTenant)
		lb.Set(labels.MetricName, r.name)
		for _, key := range sortedKeys(r.labels) {
			lb.Set(key, r.labels[key])
		}
		vector[i].Metric = lb.Labels()
	}
	if vector.ContainsSameLabelset() {
		err = fmt.Errorf("vector contains metrics with the same labelset after applying rule labels")
		r.health = "err"
		r.lastErr = err
		r.mu.Unlock()
		return err
	}
	if r.limit > 0 && len(vector) > r.limit {
		err = fmt.Errorf("exceeded limit of %d with %d series", r.limit, len(vector))
		r.health = "err"
		r.lastErr = err
		r.mu.Unlock()
		return err
	}
	r.health = "ok"
	r.lastErr = nil
	previous := r.previous
	r.mu.Unlock()
	stored, werr := r.parent.publish(ctx, previous, vector, utm.TimeToMilli(ts.Add(-r.offset)))
	r.mu.Lock()
	defer r.mu.Unlock()
	if werr != nil {
		r.health = "err"
		r.lastErr = werr
		return werr
	}
	r.previous = stored
	return nil
}

func cloneAlertMap(in map[uint64]*alert) map[uint64]*alert {
	out := make(map[uint64]*alert, len(in))
	for fp, a := range in {
		out[fp] = a.clone()
	}
	return out
}

func phaseFromCode(code int16) (phase, bool) {
	switch code {
	case state.Pending:
		return phasePending, true
	case state.Firing:
		return phaseFiring, true
	default:
		return 0, false
	}
}

func sortedKeys(m map[string]string) []string {
	if len(m) == 0 {
		return nil
	}
	return slices.Sorted(maps.Keys(m))
}
