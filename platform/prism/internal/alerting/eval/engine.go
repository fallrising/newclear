package eval

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"math"
	"sync"
	"time"

	"github.com/fallrising/newclear/platform/prism/internal/alerting/rules"
	"github.com/fallrising/newclear/platform/prism/internal/alerting/state"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/model/value"
	"github.com/prometheus/prometheus/promql"
	"github.com/prometheus/prometheus/promql/parser"
)

const (
	defaultLookback   = 5 * time.Minute
	defaultTimeout    = 30 * time.Second
	defaultFlush      = 60 * time.Second
	defaultMaxQuery   = 3
	defaultInterval   = 30 * time.Second
	maxGroups         = 10_000
	maxRules          = 10_000
	maxPublishSamples = 100_000
)

// FileGroup is one loaded group plus the file path shown by the rules API.
type FileGroup struct {
	File  string
	Group rules.Group
}

// Options configures an evaluation engine. Zero durations use the 07 defaults:
// lookback 5m, evaluation timeout 30s, state flush 60s, and 3 template queries.
type Options struct {
	Store              spi.MetricStore
	Tenant             string
	ExternalLabels     map[string]string
	Lookback           time.Duration
	EvalTimeout        time.Duration
	FlushInterval      time.Duration
	MaxTemplateQueries int
	State              state.Store
	Clock              Clock
	Logger             *slog.Logger
}

type queryFunc func(context.Context, string, time.Time) (promql.Vector, error)

// Engine evaluates rule groups. File rules keep Tenant empty.
type Engine struct {
	store       spi.MetricStore
	tenant      string
	external    map[string]string
	lookback    time.Duration
	evalTimeout time.Duration
	flushEvery  time.Duration
	maxQuery    int
	records     state.Store
	clock       Clock
	logger      *slog.Logger
	prom        *promql.Engine
	queryable   storeQueryable

	applyMu sync.Mutex
	mu      sync.Mutex
	groups  []*group
	running bool
	base    context.Context
	ctx     context.Context
	cancel  context.CancelFunc
	loops   sync.WaitGroup
	wake    chan struct{}
}

// New builds an engine. It does not start group loops; call Apply and Start.
func New(opts Options) (*Engine, error) {
	if opts.Store == nil {
		return nil, fmt.Errorf("metric store is required")
	}
	lookback := opts.Lookback
	if lookback <= 0 {
		lookback = defaultLookback
	}
	timeout := opts.EvalTimeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	flush := opts.FlushInterval
	if flush <= 0 {
		flush = defaultFlush
	}
	maxQuery := opts.MaxTemplateQueries
	if maxQuery <= 0 {
		maxQuery = defaultMaxQuery
	}
	clock := opts.Clock
	if clock == nil {
		clock = systemClock{}
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	engine := &Engine{
		store:       opts.Store,
		tenant:      opts.Tenant,
		external:    maps.Clone(opts.ExternalLabels),
		lookback:    lookback,
		evalTimeout: timeout,
		flushEvery:  flush,
		maxQuery:    maxQuery,
		records:     opts.State,
		clock:       clock,
		logger:      logger,
		queryable:   storeQueryable{store: opts.Store, tenant: opts.Tenant},
		wake:        make(chan struct{}),
	}
	engine.prom = promql.NewEngine(promql.EngineOpts{
		MaxSamples:               maxPublishSamples,
		Timeout:                  timeout,
		LookbackDelta:            lookback,
		EnableAtModifier:         true,
		EnableNegativeOffset:     true,
		NoStepSubqueryIntervalFn: func(int64) int64 { return int64(lookback / utm.MetricTimeUnit) },
	})
	return engine, nil
}

// Apply replaces the rule set. A parse error leaves the previous set in place.
// When the engine is already running, group loops restart and in-memory alert
// state is copied by file, group name, and rule name plus labels.
func (e *Engine) Apply(groups []FileGroup) error {
	next, err := e.build(groups)
	if err != nil {
		return err
	}
	e.applyMu.Lock()
	defer e.applyMu.Unlock()
	e.mu.Lock()
	running := e.running
	e.mu.Unlock()
	if running {
		e.stopLoops()
	}
	e.mu.Lock()
	e.install(next)
	if running {
		e.ctx, e.cancel = context.WithCancel(e.base)
		e.startLoopsLocked()
	}
	e.mu.Unlock()
	return nil
}

// Start restores alert_state, then runs one loop per group.
func (e *Engine) Start(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	e.applyMu.Lock()
	defer e.applyMu.Unlock()
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.running {
		return fmt.Errorf("eval engine already started")
	}
	if err := e.restore(ctx); err != nil {
		return err
	}
	e.base = ctx
	e.ctx, e.cancel = context.WithCancel(ctx)
	e.running = true
	e.startLoopsLocked()
	return nil
}

// Stop ends the loops and flushes alert_state.
func (e *Engine) Stop(ctx context.Context) error {
	e.applyMu.Lock()
	defer e.applyMu.Unlock()
	e.haltLocked()
	return e.flush(ctx)
}

// halt stops the loops without flushing. Tests use it for a crash.
func (e *Engine) halt() {
	e.applyMu.Lock()
	defer e.applyMu.Unlock()
	e.haltLocked()
}

func (e *Engine) haltLocked() {
	e.mu.Lock()
	if !e.running {
		e.mu.Unlock()
		return
	}
	e.running = false
	cancel := e.cancel
	e.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	e.loops.Wait()
}

func (e *Engine) stopLoops() {
	e.mu.Lock()
	cancel := e.cancel
	e.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	e.loops.Wait()
}

func (e *Engine) startLoopsLocked() {
	for _, g := range e.groups {
		e.loops.Go(func() { g.run(e.ctx) })
	}
	if e.records != nil {
		e.loops.Go(func() { e.flushLoop(e.ctx) })
	}
}

func (e *Engine) flushLoop(ctx context.Context) {
	next := e.clock.Now().Add(e.flushEvery)
	for {
		if err := e.clock.WaitUntil(ctx, next); err != nil {
			return
		}
		if err := e.flush(ctx); err != nil && !errors.Is(err, context.Canceled) {
			e.logger.Warn("alert_state flush failed", "err", err)
		}
		next = next.Add(e.flushEvery)
	}
}

func (e *Engine) flush(ctx context.Context) error {
	if e.records == nil {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	e.mu.Lock()
	rows := e.snapshotRows()
	tenant := e.tenant
	e.mu.Unlock()
	return e.records.Save(ctx, tenant, rows)
}

func (e *Engine) snapshotRows() []state.Row {
	var rows []state.Row
	for _, g := range e.groups {
		for _, rule := range g.rules {
			ar, ok := rule.(*alertingRule)
			if !ok {
				continue
			}
			rows = append(rows, ar.rows()...)
		}
	}
	return rows
}

func (e *Engine) restore(ctx context.Context) error {
	if e.records == nil {
		return nil
	}
	rows, err := e.records.Load(ctx, e.tenant)
	if err != nil {
		return err
	}
	used := make(map[int64]struct{}, len(rows))
	for _, g := range e.groups {
		for _, rule := range g.rules {
			ar, ok := rule.(*alertingRule)
			if !ok {
				continue
			}
			ar.restore(rows, used)
		}
	}
	return nil
}

func (e *Engine) install(next []*group) {
	old := make(map[string]*group, len(e.groups))
	for _, g := range e.groups {
		old[g.key] = g
	}
	seen := make(map[string]struct{}, len(next))
	var stale []labels.Labels
	for _, g := range next {
		seen[g.key] = struct{}{}
		prev, ok := old[g.key]
		if !ok {
			continue
		}
		stale = append(stale, g.copyFrom(prev)...)
	}
	for key, prev := range old {
		if _, ok := seen[key]; ok {
			continue
		}
		stale = append(stale, prev.series()...)
	}
	e.groups = next
	e.writeStale(stale)
}

func (e *Engine) writeStale(series []labels.Labels) {
	if len(series) == 0 || e.store == nil {
		return
	}
	ts := utm.TimeToMilli(e.clock.Now())
	points := make([]utm.MetricPoint, 0, len(series))
	for _, ls := range series {
		points = append(points, metricPoint(ls, ts, math.Float64frombits(value.StaleNaN)))
	}
	ctx, cancel := context.WithTimeout(context.Background(), e.evalTimeout)
	defer cancel()
	if err := e.store.Write(ctx, points); err != nil {
		e.logger.Warn("stale alert series failed", "err", err)
	}
}

func (e *Engine) publish(ctx context.Context, prev map[string]labels.Labels, samples promql.Vector, sampleTS int64) (map[string]labels.Labels, error) {
	next := make(map[string]labels.Labels, len(samples))
	points := make([]utm.MetricPoint, 0, len(samples)+len(prev))
	for _, sample := range samples {
		stored := storeLabels(sample.Metric, e.tenant)
		next[stored.String()] = stored
		points = append(points, metricPoint(stored, sample.T, sample.F))
	}
	for key, ls := range prev {
		if _, ok := next[key]; ok {
			continue
		}
		points = append(points, metricPoint(ls, sampleTS, math.Float64frombits(value.StaleNaN)))
	}
	if len(points) == 0 {
		return next, nil
	}
	if len(points) > maxPublishSamples {
		return prev, fmt.Errorf("rule publish exceeds %d samples", maxPublishSamples)
	}
	if err := e.store.Write(ctx, points); err != nil {
		return prev, err
	}
	return next, nil
}

func (e *Engine) query(ctx context.Context, expr string, ts time.Time) (promql.Vector, error) {
	qctx, cancel := context.WithTimeout(ctx, e.evalTimeout)
	defer cancel()
	query, err := e.prom.NewInstantQuery(qctx, e.queryable, nil, expr, ts)
	if err != nil {
		return nil, err
	}
	result := query.Exec(qctx)
	if result.Err != nil {
		query.Close()
		return nil, result.Err
	}
	out, err := vectorFromResult(result.Value)
	query.Close()
	return out, err
}

func vectorFromResult(value parser.Value) (promql.Vector, error) {
	switch value := value.(type) {
	case promql.Vector:
		return copyVector(value), nil
	case *promql.Vector:
		if value == nil {
			return nil, nil
		}
		return copyVector(*value), nil
	case promql.Scalar:
		return promql.Vector{{Metric: labels.EmptyLabels(), T: value.T, F: value.V}}, nil
	case *promql.Scalar:
		if value == nil {
			return nil, nil
		}
		return promql.Vector{{Metric: labels.EmptyLabels(), T: value.T, F: value.V}}, nil
	default:
		return nil, fmt.Errorf("rule result is not a vector or scalar")
	}
}

func copyVector(in promql.Vector) promql.Vector {
	if len(in) == 0 {
		return nil
	}
	out := make(promql.Vector, len(in))
	lb := labels.NewBuilder(labels.EmptyLabels())
	for i, sample := range in {
		lb.Reset(sample.Metric)
		out[i] = promql.Sample{Metric: lb.Labels(), T: sample.T, F: sample.F}
	}
	return out
}

func storeLabels(ls labels.Labels, tenant string) labels.Labels {
	b := labels.NewBuilder(ls)
	if tenant == "" {
		b.Del(utm.LabelTenant)
		return b.Labels()
	}
	b.Set(utm.LabelTenant, tenant)
	return b.Labels()
}

func metricPoint(ls labels.Labels, ts int64, v float64) utm.MetricPoint {
	return utm.MetricPoint{Name: ls.Get(labels.MetricName), Labels: ls, TS: ts, Value: v, Type: utm.TypeGauge}
}

type ruleInput struct {
	name        string
	expr        string
	labels      map[string]string
	annotations map[string]string
	hold        time.Duration
	keep        time.Duration
	alert       bool
}

type group struct {
	engine   *Engine
	key      string
	file     string
	name     string
	interval time.Duration
	offset   time.Duration
	limit    int
	rules    []rule
	next     time.Time
	last     time.Time
	evalDur  time.Duration
	order    []string
	mu       sync.Mutex
}

type rule interface {
	ruleName() string
	identity() string
	eval(ctx context.Context, ts time.Time) error
	series() []labels.Labels
}

func (e *Engine) build(groups []FileGroup) ([]*group, error) {
	if len(groups) > maxGroups {
		return nil, fmt.Errorf("too many rule groups")
	}
	out := make([]*group, 0, len(groups))
	for _, fileGroup := range groups {
		src := fileGroup.Group
		interval := src.Interval
		if interval == 0 {
			interval = defaultInterval
		}
		if interval < 0 || src.QueryOffset < 0 {
			return nil, fmt.Errorf("group %q has a negative interval or query_offset", src.Name)
		}
		if len(src.Rules) > maxRules {
			return nil, fmt.Errorf("group %q has too many rules", src.Name)
		}
		g := &group{
			engine:   e,
			key:      fileGroup.File + "\x00" + src.Name,
			file:     fileGroup.File,
			name:     src.Name,
			interval: interval,
			offset:   src.QueryOffset,
			limit:    src.Limit,
		}
		for _, item := range src.Rules {
			if item.Alert == "" && item.Record == "" {
				return nil, fmt.Errorf("group %q has a rule with no name", src.Name)
			}
			if item.Alert != "" && item.Record != "" {
				return nil, fmt.Errorf("rule %q sets both alert and record", item.Alert)
			}
			name := item.Alert
			if name == "" {
				name = item.Record
			}
			if _, err := parser.ParseExpr(item.Expr); err != nil {
				return nil, fmt.Errorf("parse rule %q: %w", name, err)
			}
			input := ruleInput{
				name:        name,
				expr:        item.Expr,
				labels:      item.Labels,
				annotations: item.Annotations,
				hold:        item.For,
				keep:        item.KeepFiringFor,
				alert:       item.Alert != "",
			}
			if input.alert {
				g.rules = append(g.rules, newAlerting(e, g, input))
			} else {
				g.rules = append(g.rules, newRecording(e, g, input))
			}
		}
		g.next = g.firstSlot(e.clock.Now())
		out = append(out, g)
	}
	return out, nil
}

func (g *group) run(ctx context.Context) {
	for {
		g.mu.Lock()
		next := g.next
		g.mu.Unlock()
		if err := g.engine.clock.WaitUntil(ctx, next); err != nil {
			return
		}
		g.mu.Lock()
		scheduled := g.next
		interval := g.interval
		g.mu.Unlock()
		now := g.engine.clock.Now()
		slot := scheduled
		if now.After(scheduled) {
			missed := now.Sub(scheduled) / interval
			slot = scheduled.Add(missed * interval)
		}
		if err := g.evaluate(ctx, slot); err != nil {
			return
		}
		g.mu.Lock()
		g.next = slot.Add(interval)
		g.mu.Unlock()
		g.engine.notify()
	}
}

func (g *group) evaluate(ctx context.Context, slot time.Time) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	started := time.Now()
	order := make([]string, 0, len(g.rules))
	for _, rule := range g.rules {
		if err := ctx.Err(); err != nil {
			return err
		}
		order = append(order, rule.ruleName())
		if err := rule.eval(ctx, slot); err != nil && !errors.Is(err, context.Canceled) {
			g.engine.logger.Warn("evaluating rule failed", "group", g.name, "rule", rule.ruleName(), "err", err)
		}
	}
	g.mu.Lock()
	g.last = slot
	g.evalDur = time.Since(started)
	g.order = order
	g.mu.Unlock()
	return nil
}

func (g *group) firstSlot(now time.Time) time.Time {
	return g.slotted(now).Add(g.interval)
}

func (g *group) slotted(now time.Time) time.Time {
	// AC-94 does not lock the hash. The offset is a whole number of
	// milliseconds so a slot is a fixed point: slotted(slot) == slot.
	// Truncating an unaligned nanosecond offset walks the next restart
	// back onto the slot that just ran.
	step := g.interval.Truncate(time.Millisecond)
	if step <= 0 {
		step = time.Millisecond
	}
	offset := time.Duration(g.hash()%uint64(step/time.Millisecond)) * time.Millisecond
	now = now.UTC().Truncate(time.Millisecond)
	start := now.UnixNano()
	off := int64(offset)
	iv := int64(step)
	adj := start - off
	if adj < 0 {
		mod := adj % iv
		if mod != 0 {
			adj -= iv + mod
		}
	} else {
		adj -= adj % iv
	}
	return time.Unix(0, adj+off).UTC()
}

func (g *group) hash() uint64 {
	return labels.New(
		labels.Label{Name: "file", Value: g.file},
		labels.Label{Name: "name", Value: g.name},
	).Hash()
}

func (g *group) copyFrom(prev *group) []labels.Labels {
	used := make([]bool, len(prev.rules))
	var stale []labels.Labels
	for _, rule := range g.rules {
		matched := false
		for i, old := range prev.rules {
			if used[i] || old.identity() != rule.identity() {
				continue
			}
			used[i] = true
			matched = true
			switch dst := rule.(type) {
			case *alertingRule:
				src, ok := old.(*alertingRule)
				if !ok {
					stale = append(stale, old.series()...)
					break
				}
				dst.takeAlerts(src)
			case *recordingRule:
				src, ok := old.(*recordingRule)
				if !ok {
					stale = append(stale, old.series()...)
					break
				}
				dst.setSeries(src.takeSeries())
			}
			break
		}
		if !matched {
			continue
		}
	}
	for i, old := range prev.rules {
		if used[i] {
			continue
		}
		stale = append(stale, old.series()...)
	}
	return stale
}

func (g *group) series() []labels.Labels {
	var out []labels.Labels
	for _, rule := range g.rules {
		out = append(out, rule.series()...)
	}
	return out
}

func (e *Engine) notify() {
	e.mu.Lock()
	ch := e.wake
	e.wake = make(chan struct{})
	e.mu.Unlock()
	close(ch)
}

func (e *Engine) waitGroup(ctx context.Context, name string, after time.Time) (time.Time, error) {
	for {
		e.mu.Lock()
		last, ok := e.groupLast(name)
		ch := e.wake
		e.mu.Unlock()
		if ok && last.After(after) {
			return last, nil
		}
		select {
		case <-ctx.Done():
			return time.Time{}, ctx.Err()
		case <-ch:
		}
	}
}

func (e *Engine) groupLast(name string) (time.Time, bool) {
	for _, g := range e.groups {
		if g.name != name {
			continue
		}
		g.mu.Lock()
		last := g.last
		g.mu.Unlock()
		return last, true
	}
	return time.Time{}, false
}

func (e *Engine) groupSlot(name string) (next, last time.Time, ok bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, g := range e.groups {
		if g.name != name {
			continue
		}
		g.mu.Lock()
		next, last = g.next, g.last
		g.mu.Unlock()
		return next, last, true
	}
	return time.Time{}, time.Time{}, false
}

func (e *Engine) groupNames() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	names := make([]string, len(e.groups))
	for i, g := range e.groups {
		names[i] = g.name
	}
	return names
}

func (e *Engine) evalOrder(name string) []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, g := range e.groups {
		if g.name != name {
			continue
		}
		g.mu.Lock()
		order := append([]string(nil), g.order...)
		g.mu.Unlock()
		return order
	}
	return nil
}

func (e *Engine) templateQueries(groupName, ruleName string) int {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, g := range e.groups {
		if g.name != groupName {
			continue
		}
		for _, rule := range g.rules {
			if rule.ruleName() != ruleName {
				continue
			}
			switch item := rule.(type) {
			case *alertingRule:
				_, _, _, _, n := item.snapshotBase()
				return n
			default:
				return 0
			}
		}
	}
	return 0
}
