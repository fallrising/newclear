package eval

import (
	"context"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"encoding/json/v2"

	_ "github.com/fallrising/newclear/platform/prism/drivers/memory"
	"github.com/fallrising/newclear/platform/prism/internal/alerting/rules"
	"github.com/fallrising/newclear/platform/prism/internal/alerting/state"
	"github.com/fallrising/newclear/platform/prism/internal/compat/promapi"
	"github.com/fallrising/newclear/platform/prism/internal/config"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/promql"
)

const twoSeries = `label_replace(vector(1), "k", "a", "__name__", ".*") or label_replace(vector(1), "k", "b", "__name__", ".*")`

var origin = time.Date(2026, 10, 20, 8, 0, 0, 123000000, time.UTC)

type rig struct {
	t       *testing.T
	clock   *ManualClock
	store   spi.MetricStore
	eng     *Engine
	records state.Store
	flush   time.Duration
}

func newRig(t *testing.T, records state.Store, flush time.Duration) *rig {
	t.Helper()
	if flush <= 0 {
		flush = time.Hour
	}
	if records == nil {
		records = state.NewMem()
	}
	backend, err := spi.Open(t.Context(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := backend.Close(); err != nil {
			t.Error(err)
		}
	})
	r := &rig{
		t:       t,
		clock:   NewManualClock(origin),
		store:   backend.Metrics(),
		records: records,
		flush:   flush,
	}
	r.reopen()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = r.eng.Stop(ctx)
	})
	return r
}

func (r *rig) reopen() {
	r.t.Helper()
	eng, err := New(Options{
		Store:          r.store,
		ExternalLabels: map[string]string{"cluster": "prod"},
		FlushInterval:  r.flush,
		State:          r.records,
		Clock:          r.clock,
		Logger:         slog.New(slog.DiscardHandler),
	})
	if err != nil {
		r.t.Fatal(err)
	}
	r.eng = eng
}

func (r *rig) apply(groups []FileGroup) error {
	r.t.Helper()
	return r.eng.Apply(groups)
}

func (r *rig) mustApply(groups []FileGroup) {
	r.t.Helper()
	if err := r.apply(groups); err != nil {
		r.t.Fatal(err)
	}
}

func (r *rig) start(groups []FileGroup) {
	r.t.Helper()
	r.mustApply(groups)
	if err := r.eng.Start(r.t.Context()); err != nil {
		r.t.Fatal(err)
	}
}

func (r *rig) stop() {
	r.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := r.eng.Stop(ctx); err != nil {
		r.t.Fatal(err)
	}
}

func (r *rig) step(name string) time.Time {
	r.t.Helper()
	next, last, ok := r.eng.groupSlot(name)
	if !ok {
		r.t.Fatalf("group %s is not loaded", name)
	}
	if next.After(r.clock.Now()) {
		r.clock.Advance(next.Sub(r.clock.Now()))
	}
	ctx, cancel := context.WithTimeout(r.t.Context(), 10*time.Second)
	defer cancel()
	got, err := r.eng.waitGroup(ctx, name, last)
	if err != nil {
		r.t.Fatal(err)
	}
	return got
}

func (r *rig) stepOrdered(names ...string) {
	r.t.Helper()
	if len(names) == 0 {
		names = r.eng.groupNames()
	}
	slices.SortFunc(names, func(a, b string) int {
		na, _, _ := r.eng.groupSlot(a)
		nb, _, _ := r.eng.groupSlot(b)
		return na.Compare(nb)
	})
	for _, name := range names {
		r.step(name)
	}
}

func (r *rig) advanceTo(name string, to time.Time) time.Time {
	r.t.Helper()
	_, last, ok := r.eng.groupSlot(name)
	if !ok {
		r.t.Fatalf("group %s is not loaded", name)
	}
	if to.After(r.clock.Now()) {
		r.clock.Advance(to.Sub(r.clock.Now()))
	}
	ctx, cancel := context.WithTimeout(r.t.Context(), 10*time.Second)
	defer cancel()
	got, err := r.eng.waitGroup(ctx, name, last)
	if err != nil {
		r.t.Fatal(err)
	}
	return got
}

func (r *rig) instant(expr string, ts time.Time) promql.Vector {
	r.t.Helper()
	vec, err := r.eng.Instant(r.t.Context(), expr, ts)
	if err != nil {
		r.t.Fatalf("instant %s: %v", expr, err)
	}
	return vec
}

func (r *rig) rules(q url.Values) map[string]any {
	r.t.Helper()
	data, err := r.eng.Rules(r.t.Context(), q)
	if err != nil {
		r.t.Fatal(err)
	}
	return asMap(r.t, data)
}

func (r *rig) rule(group, name string) map[string]any {
	r.t.Helper()
	return findRule(r.t, groupList(r.t, r.rules(nil)), group, name)
}

func (r *rig) alertAPI() []any {
	r.t.Helper()
	data, err := r.eng.Alerts(r.t.Context())
	if err != nil {
		r.t.Fatal(err)
	}
	body := asMap(r.t, data)
	alerts, ok := body["alerts"].([]any)
	if !ok {
		r.t.Fatalf("alerts = %#v", body["alerts"])
	}
	return alerts
}

func fg(file, name string, interval, offset time.Duration, limit int, rs ...rules.Rule) FileGroup {
	return FileGroup{File: file, Group: rules.Group{Name: name, Interval: interval, QueryOffset: offset, Limit: limit, Rules: rs}}
}

func al(name, expr string, hold, keep time.Duration, lbl, ann map[string]string) rules.Rule {
	return rules.Rule{Alert: name, Expr: expr, For: hold, KeepFiringFor: keep, Labels: lbl, Annotations: ann}
}

func rec(name, expr string, lbl map[string]string) rules.Rule {
	return rules.Rule{Record: name, Expr: expr, Labels: lbl}
}

func loadYAML(t *testing.T, name, body string) []FileGroup {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	loader, err := rules.Load(t.Context(), dir)
	if err != nil {
		t.Fatal(err)
	}
	set := loader.Current()
	out := make([]FileGroup, len(set.Groups))
	for i, g := range set.Groups {
		out[i] = FileGroup{File: name, Group: g}
	}
	return out
}

func asMap(t *testing.T, v any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func groupList(t *testing.T, data map[string]any) []any {
	t.Helper()
	groups, ok := data["groups"].([]any)
	if !ok {
		t.Fatalf("groups = %#v", data["groups"])
	}
	return groups
}

func findGroup(t *testing.T, groups []any, name string) map[string]any {
	t.Helper()
	for _, raw := range groups {
		g := raw.(map[string]any)
		if g["name"] == name {
			return g
		}
	}
	t.Fatalf("group %s not found", name)
	return nil
}

func findRule(t *testing.T, groups []any, group, name string) map[string]any {
	t.Helper()
	g := findGroup(t, groups, group)
	for _, raw := range g["rules"].([]any) {
		rule := raw.(map[string]any)
		if rule["name"] == name {
			return rule
		}
	}
	t.Fatalf("rule %s/%s not found", group, name)
	return nil
}

func alertList(t *testing.T, rule map[string]any) []any {
	t.Helper()
	alerts, ok := rule["alerts"].([]any)
	if !ok {
		t.Fatalf("alerts = %#v", rule["alerts"])
	}
	return alerts
}

func num(t *testing.T, v any) float64 {
	t.Helper()
	f, ok := v.(float64)
	if !ok {
		t.Fatalf("number = %#v", v)
	}
	return f
}

func parseAt(t *testing.T, v any) time.Time {
	t.Helper()
	s, ok := v.(string)
	if !ok {
		t.Fatalf("time = %#v", v)
	}
	ts, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t.Fatal(err)
	}
	return ts
}

func noKey(t *testing.T, m map[string]any, key string) {
	t.Helper()
	if _, ok := m[key]; ok {
		t.Fatalf("key %s present: %#v", key, m[key])
	}
}

func keySet(t *testing.T, m map[string]any, want ...string) {
	t.Helper()
	got := slices.Sorted(maps.Keys(m))
	if !slices.Equal(got, want) {
		t.Fatalf("keys = %v, want %v", got, want)
	}
}

func findSample(vec promql.Vector, want map[string]string) (promql.Sample, bool) {
	for _, sample := range vec {
		match := true
		for k, v := range want {
			if sample.Metric.Get(k) != v {
				match = false
				break
			}
		}
		if match {
			return sample, true
		}
	}
	return promql.Sample{}, false
}

func namedAlerts(vec promql.Vector, name string) []promql.Sample {
	var out []promql.Sample
	for _, sample := range vec {
		if sample.Metric.Get(labels.MetricName) == "ALERTS" && sample.Metric.Get(labels.AlertName) == name {
			out = append(out, sample)
		}
	}
	return out
}

// AC-94 Given 載入器存好的 group interval。When 評估迴圈跑起來。
// Then 用那個間隔。省略與 0s 是 30 秒。兩個 10 秒 group 的第一次評估不在同一刻，也不是啟動當下。
// 尚未評估時 health 是 unknown。組內依序。
func TestAC94IntervalAndHealth(t *testing.T) {
	loaded := loadYAML(t, "rules.yml", `
groups:
- name: omitted
  rules:
  - alert: First
    expr: vector(1)
  - alert: Second
    expr: vector(1)
- name: zero
  interval: 0s
  rules:
  - alert: Zero
    expr: vector(1)
`)
	if loaded[0].Group.Interval != 30*time.Second || loaded[1].Group.Interval != 30*time.Second {
		t.Fatalf("loader intervals = %s %s", loaded[0].Group.Interval, loaded[1].Group.Interval)
	}
	r := newRig(t, nil, 0)
	r.start(loaded)
	if r.rule("omitted", "First")["health"] != "unknown" {
		t.Fatalf("health before eval = %v", r.rule("omitted", "First")["health"])
	}
	if num(t, findGroup(t, groupList(t, r.rules(nil)), "omitted")["interval"]) != 30 || num(t, findGroup(t, groupList(t, r.rules(nil)), "zero")["interval"]) != 30 {
		t.Fatal("API interval is not 30")
	}
	first := r.step("omitted")
	second := r.step("omitted")
	if second.Sub(first) != 30*time.Second {
		t.Fatalf("evaluation spacing = %s", second.Sub(first))
	}
	if !first.After(origin) {
		t.Fatalf("first evaluation %s is not after start %s", first, origin)
	}
	if order := r.eng.evalOrder("omitted"); !slices.Equal(order, []string{"First", "Second"}) {
		t.Fatalf("eval order = %v", order)
	}

	spread := newRig(t, nil, 0)
	groups := []FileGroup{
		fg("east.yml", "east", 10*time.Second, 0, 0, al("E", "vector(1)", 0, 0, nil, nil)),
		fg("west.yml", "west", 10*time.Second, 0, 0, al("W", "vector(1)", 0, 0, nil, nil)),
	}
	spread.mustApply(groups)
	eastNext, _, _ := spread.eng.groupSlot("east")
	westNext, _, _ := spread.eng.groupSlot("west")
	if !eastNext.After(origin) || !westNext.After(origin) || eastNext.Equal(westNext) {
		t.Fatalf("first slots east %s west %s origin %s", eastNext, westNext, origin)
	}
	if eastNext.Sub(origin) > 10*time.Second || westNext.Sub(origin) > 10*time.Second {
		t.Fatalf("first slots are past one interval: %s %s", eastNext.Sub(origin), westNext.Sub(origin))
	}
	spread.start(groups)
	if spread.rule("east", "E")["health"] != "unknown" || spread.rule("west", "W")["health"] != "unknown" {
		t.Fatal("health changed before the first slot")
	}
	spread.stepOrdered("east", "west")
	_, eastLast, _ := spread.eng.groupSlot("east")
	_, westLast, _ := spread.eng.groupSlot("west")
	if !eastLast.Equal(eastNext) || !westLast.Equal(westNext) {
		t.Fatalf("last east %s want %s, west %s want %s", eastLast, eastNext, westLast, westNext)
	}
}

// AC-95 Given query_offset 30s。When 評估。Then 樣本時間戳比 lastEvaluation 早 30 秒。
// activeAt 不減 offset。group 沒有 query_offset。只改 offset 後 activeAt 不變。
func TestAC95QueryOffset(t *testing.T) {
	r := newRig(t, nil, 0)
	r.start([]FileGroup{fg("off.yml", "off", time.Second, 30*time.Second, 0,
		rec("ts:stamp", "timestamp(vector(1))", nil),
		al("Off", "vector(1)", 0, 0, nil, nil),
	)})
	last := r.step("off")
	wantTS := utm.TimeToMilli(last.Add(-30 * time.Second))
	wantF := utm.MilliToSecFloat(wantTS)
	// Instant vectors force Sample.T to the query time (Prometheus 2.53.0
	// engine). timestamp() is the series timestamp §11.2 measured.
	sample, ok := findSample(r.instant("timestamp(ts:stamp)", last), nil)
	if !ok || sample.F != wantF {
		t.Fatalf("recording timestamp = %#v, want %v", sample, wantF)
	}
	alertTS, ok := findSample(r.instant(`timestamp(ALERTS{alertname="Off"})`, last), nil)
	if !ok || alertTS.F != wantF {
		t.Fatalf("ALERTS timestamp = %#v, want %v", alertTS, wantF)
	}
	alertSample, ok := findSample(r.instant(`ALERTS{alertname="Off"}`, last), nil)
	if !ok || alertSample.F != 1 {
		t.Fatalf("ALERTS sample = %#v", alertSample)
	}
	item := alertList(t, r.rule("off", "Off"))[0].(map[string]any)
	activeAt := parseAt(t, item["activeAt"])
	if !activeAt.Equal(last) || activeAt.Equal(last.Add(-30*time.Second)) {
		t.Fatalf("activeAt %s last %s", activeAt, last)
	}
	noKey(t, findGroup(t, groupList(t, r.rules(nil)), "off"), "query_offset")

	r.mustApply([]FileGroup{fg("off.yml", "off", time.Second, 10*time.Second, 0,
		rec("ts:stamp", "timestamp(vector(1))", nil),
		al("Off", "vector(1)", 0, 0, nil, nil),
	)})
	r.step("off")
	again := parseAt(t, alertList(t, r.rule("off", "Off"))[0].(map[string]any)["activeAt"])
	if !again.Equal(activeAt) {
		t.Fatalf("activeAt changed from %s to %s", activeAt, again)
	}
}

// AC-96 Given recording rule 寫在 alerting rule 前面。When 同一次評估。Then alert 看得到這次寫入的值。
func TestAC96RecordingVisibleToLaterAlert(t *testing.T) {
	r := newRig(t, nil, 0)
	r.start([]FileGroup{fg("seq.yml", "seq", time.Second, 0, 0,
		rec("job:x:rate", "vector(1)", nil),
		al("Seen", "job:x:rate == 1", 0, 0, nil, nil),
	)})
	last := r.step("seq")
	rule := r.rule("seq", "Seen")
	if rule["state"] != "firing" || alertList(t, rule)[0].(map[string]any)["value"] != "1e+00" {
		t.Fatalf("alert = %#v", rule)
	}
	if !parseAt(t, rule["lastEvaluation"]).Equal(last) || !parseAt(t, r.rule("seq", "job:x:rate")["lastEvaluation"]).Equal(last) {
		t.Fatal("recording and alert were not evaluated at the same slot")
	}
	names := r.rules(nil)["groups"].([]any)[0].(map[string]any)["rules"].([]any)
	if names[0].(map[string]any)["name"] != "job:x:rate" || names[1].(map[string]any)["name"] != "Seen" {
		t.Fatalf("rule order = %#v", names)
	}
}

// AC-97 Given 沒寫 for，或 for 0s。When 第一次評估完成。Then firing，duration 0，keepFiringFor 0，value 1e+00。
// ALERTS alertstate=firing 值 1。ALERTS_FOR_STATE 沒有 alertstate，值是 activeAt 的 Unix 秒。
// external label 不在系列上，模板看得到。
func TestAC97FiresWithoutFor(t *testing.T) {
	r := newRig(t, nil, 0)
	ann := map[string]string{"note": "{{ $externalLabels.cluster }}"}
	r.start([]FileGroup{fg("a.yml", "g", time.Second, 0, 0,
		al("Plain", "vector(1)", 0, 0, nil, ann),
		al("Zero", "vector(1)", 0, 0, nil, ann),
	)})
	last := r.step("g")
	for _, name := range []string{"Plain", "Zero"} {
		rule := r.rule("g", name)
		if rule["state"] != "firing" || num(t, rule["duration"]) != 0 || num(t, rule["keepFiringFor"]) != 0 {
			t.Fatalf("%s = %#v", name, rule)
		}
		item := alertList(t, rule)[0].(map[string]any)
		if item["value"] != "1e+00" || item["state"] != "firing" {
			t.Fatalf("%s alert = %#v", name, item)
		}
		if item["annotations"].(map[string]any)["note"] != "prod" {
			t.Fatalf("annotation = %#v", item["annotations"])
		}
		activeAt := parseAt(t, item["activeAt"])
		series := r.instant(`ALERTS{alertname="`+name+`"}`, last)
		sample, ok := findSample(series, map[string]string{labels.AlertName: name})
		if !ok || sample.F != 1 || sample.Metric.Get("alertstate") != "firing" || sample.Metric.Get("cluster") != "" {
			t.Fatalf("ALERTS %s = %#v", name, series)
		}
		forState := r.instant(`ALERTS_FOR_STATE{alertname="`+name+`"}`, last)
		stateSample, ok := findSample(forState, map[string]string{labels.AlertName: name})
		if !ok || stateSample.Metric.Has("alertstate") || stateSample.F != float64(activeAt.Unix()) || stateSample.Metric.Get("cluster") != "" {
			t.Fatalf("ALERTS_FOR_STATE %s = %#v want %v", name, forState, float64(activeAt.Unix()))
		}
	}
}

// AC-98 Given for 3s，條件一直成立。When 連續評估。Then 先 pending，滿 for 後 firing，activeAt 不變。
// 規則 state 在只有 pending 時是 pending。/api/v1/alerts 包含 pending。
func TestAC98PendingThenFiring(t *testing.T) {
	r := newRig(t, nil, 0)
	r.start([]FileGroup{fg("a.yml", "g", time.Second, 0, 0, al("Hold", "vector(1)", 3*time.Second, 0, nil, nil))})
	var activeAt time.Time
	for i, want := range []string{"pending", "pending", "pending", "firing"} {
		r.step("g")
		rule := r.rule("g", "Hold")
		if rule["state"] != want || num(t, rule["duration"]) != 3 {
			t.Fatalf("step %d state %v duration %v", i, rule["state"], rule["duration"])
		}
		item := alertList(t, rule)[0].(map[string]any)
		if item["state"] != want {
			t.Fatalf("step %d alert %v", i, item["state"])
		}
		got := parseAt(t, item["activeAt"])
		if i == 0 {
			activeAt = got
		} else if !got.Equal(activeAt) {
			t.Fatalf("activeAt changed to %s", got)
		}
		if !alertsContain(t, r.alertAPI(), "Hold", want) {
			t.Fatalf("alerts API missing %s", want)
		}
	}
}

// AC-99 Given 告警還在 pending。When 條件不再成立。Then 從兩個 API 消失，規則 state 變成 inactive。
// instant query 的 ALERTS 與 ALERTS_FOR_STATE 是空的。沒有 inactive 或 resolved 告警物件。
func TestAC99PendingDropsImmediately(t *testing.T) {
	r := newRig(t, nil, 0)
	r.start([]FileGroup{fg("a.yml", "g", time.Second, 0, 0, al("Pend", "vector(1)", 8*time.Second, 0, nil, nil))})
	r.step("g")
	if r.rule("g", "Pend")["state"] != "pending" {
		t.Fatal("expected pending")
	}
	r.mustApply([]FileGroup{fg("a.yml", "g", time.Second, 0, 0, al("Pend", "vector(1) == 0", 8*time.Second, 0, nil, nil))})
	last := r.step("g")
	rule := r.rule("g", "Pend")
	if rule["state"] != "inactive" || len(alertList(t, rule)) != 0 || len(r.alertAPI()) != 0 {
		t.Fatalf("after drop: %#v alerts API %d", rule, len(r.alertAPI()))
	}
	if len(r.instant(`ALERTS{alertname="Pend"}`, last)) != 0 || len(r.instant(`ALERTS_FOR_STATE{alertname="Pend"}`, last)) != 0 {
		t.Fatal("series still present")
	}
}

// AC-100 Given for 0s 且 keep_firing_for 4s。When 條件還在。Then 沒有 keepFiringSince，keepFiringFor 是 4。
// When 條件消失但還沒滿 4 秒。Then 仍 firing 並帶 keepFiringSince，activeAt 不變。
// When 已滿 keep_firing_for。Then 離開 API，state inactive，ALERTS 為空。沒有 resolved。
func TestAC100KeepFiringFor(t *testing.T) {
	r := newRig(t, nil, 0)
	r.start([]FileGroup{fg("a.yml", "g", time.Second, 0, 0, al("Keep", "vector(1)", 0, 4*time.Second, nil, nil))})
	r.step("g")
	rule := r.rule("g", "Keep")
	if rule["state"] != "firing" || num(t, rule["keepFiringFor"]) != 4 {
		t.Fatalf("while condition holds: %#v", rule)
	}
	item := alertList(t, rule)[0].(map[string]any)
	noKey(t, item, "keepFiringSince")
	activeAt := parseAt(t, item["activeAt"])

	r.mustApply([]FileGroup{fg("a.yml", "g", time.Second, 0, 0, al("Keep", "vector(1) == 0", 0, 4*time.Second, nil, nil))})
	var keepSince time.Time
	var previousDelta time.Duration
	left := false
	for range 8 {
		last := r.step("g")
		rule = r.rule("g", "Keep")
		if rule["state"] == "inactive" {
			if keepSince.IsZero() || last.Sub(keepSince) < 4*time.Second || previousDelta >= 4*time.Second {
				t.Fatalf("left at %s keep %s previous delta %s", last, keepSince, previousDelta)
			}
			left = true
			if len(alertList(t, rule)) != 0 || len(r.alertAPI()) != 0 || len(r.instant(`ALERTS{alertname="Keep"}`, last)) != 0 {
				t.Fatal("alert still visible after keep_firing_for")
			}
			break
		}
		if rule["state"] != "firing" {
			t.Fatalf("state %v", rule["state"])
		}
		item = alertList(t, rule)[0].(map[string]any)
		if item["state"] == "resolved" || item["state"] == "inactive" {
			t.Fatalf("alert state %v", item["state"])
		}
		if !parseAt(t, item["activeAt"]).Equal(activeAt) {
			t.Fatal("activeAt changed during keep_firing_for")
		}
		raw, ok := item["keepFiringSince"]
		if !ok {
			t.Fatal("missing keepFiringSince after the condition dropped")
		}
		keepSince = parseAt(t, raw)
		previousDelta = last.Sub(keepSince)
		if previousDelta >= 4*time.Second {
			t.Fatalf("still firing %s after keepFiringSince", previousDelta)
		}
	}
	if !left {
		t.Fatal("alert did not leave")
	}
}

// AC-101 Given limit 0 或 -1，一次產生兩條序列。When 評估。Then 兩筆都在，health ok，沒有 lastError。
// API limit 仍是 0 或 -1。同一次評估的 activeAt 相同。
func TestAC101UnlimitedLimit(t *testing.T) {
	r := newRig(t, nil, 0)
	r.start([]FileGroup{
		fg("a.yml", "zero", time.Second, 0, 0, al("Z", twoSeries, 0, 0, nil, nil)),
		fg("b.yml", "neg", time.Second, 0, -1, al("N", twoSeries, 0, 0, nil, nil)),
	})
	r.stepOrdered("zero", "neg")
	for _, tc := range []struct {
		group string
		limit float64
	}{{"zero", 0}, {"neg", -1}} {
		g := findGroup(t, groupList(t, r.rules(nil)), tc.group)
		if num(t, g["limit"]) != tc.limit {
			t.Fatalf("%s limit = %v", tc.group, g["limit"])
		}
		rule := findRule(t, groupList(t, r.rules(nil)), tc.group, map[string]string{"zero": "Z", "neg": "N"}[tc.group])
		if rule["health"] != "ok" || rule["state"] != "firing" {
			t.Fatalf("%s = %#v", tc.group, rule)
		}
		noKey(t, rule, "lastError")
		alerts := alertList(t, rule)
		if len(alerts) != 2 {
			t.Fatalf("%s alerts = %d", tc.group, len(alerts))
		}
		if parseAt(t, alerts[0].(map[string]any)["activeAt"]) != parseAt(t, alerts[1].(map[string]any)["activeAt"]) {
			t.Fatal("activeAt differs inside one evaluation")
		}
	}
}

// AC-102 Given limit 1，一次產生兩條序列。When 評估。Then 清掉該規則的 API 告警，不留前 N 筆，也不清掉其他規則。
// alerting lastError 是 exceeded limit of 1 with 2 alerts。recording 是 exceeded limit of 1 with 2 series。
// 已 firing 後把 limit 改成 1：API 變空，3 秒後 ALERTS 仍是兩條、值 1。之後只剩一條則新告警、health ok、lastError 消失。
func TestAC102LimitExceeded(t *testing.T) {
	const alertErr = "exceeded limit of 1 with 2 alerts"
	const seriesErr = "exceeded limit of 1 with 2 series"
	r := newRig(t, nil, 0)
	r.start([]FileGroup{fg("a.yml", "g", time.Second, 0, 1,
		al("Limited", twoSeries, 0, 0, nil, nil),
		al("Other", "vector(1)", 0, 0, nil, nil),
		rec("job:lim:rate", twoSeries, nil),
	)})
	last := r.step("g")
	limited := r.rule("g", "Limited")
	if limited["health"] != "err" || limited["lastError"] != alertErr || limited["state"] != "inactive" || len(alertList(t, limited)) != 0 {
		t.Fatalf("limited = %#v", limited)
	}
	other := r.rule("g", "Other")
	if other["state"] != "firing" || other["health"] != "ok" {
		t.Fatalf("other = %#v", other)
	}
	recorded := r.rule("g", "job:lim:rate")
	if recorded["health"] != "err" || recorded["lastError"] != seriesErr {
		t.Fatalf("recording = %#v", recorded)
	}
	if len(r.instant("job:lim:rate", last)) != 0 {
		t.Fatal("recording series was written")
	}

	again := newRig(t, nil, 0)
	again.start([]FileGroup{fg("a.yml", "g", time.Second, 0, 0, al("Limited", twoSeries, 0, 0, nil, nil))})
	again.step("g")
	if n := len(namedAlerts(again.instant("ALERTS", again.clock.Now()), "Limited")); n != 2 {
		t.Fatalf("ALERTS before limit change = %d", n)
	}
	again.mustApply([]FileGroup{fg("a.yml", "g", time.Second, 0, 1, al("Limited", twoSeries, 0, 0, nil, nil))})
	again.step("g")
	limited = again.rule("g", "Limited")
	if limited["state"] != "inactive" || limited["lastError"] != alertErr || len(alertList(t, limited)) != 0 {
		t.Fatalf("after limit 1: %#v", limited)
	}
	_, previous, _ := again.eng.groupSlot("g")
	again.clock.Advance(3 * time.Second)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	if _, err := again.eng.waitGroup(ctx, "g", previous); err != nil {
		t.Fatal(err)
	}
	left := namedAlerts(again.instant("ALERTS", again.clock.Now()), "Limited")
	if len(left) != 2 {
		t.Fatalf("ALERTS 3s later = %d", len(left))
	}
	for _, sample := range left {
		if sample.F != 1 {
			t.Fatalf("ALERTS value = %v", sample.F)
		}
	}
	again.mustApply([]FileGroup{fg("a.yml", "g", time.Second, 0, 1, al("Limited", "vector(1)", 0, 0, nil, nil))})
	again.step("g")
	limited = again.rule("g", "Limited")
	if limited["health"] != "ok" || limited["state"] != "firing" || len(alertList(t, limited)) != 1 {
		t.Fatalf("recovered = %#v", limited)
	}
	noKey(t, limited, "lastError")
}

// AC-103 Given 告警已 firing。When expr 改成會失敗的查詢。Then health err，lastError 是實測那句，
// state 仍 firing，activeAt 與 value 不變，ALERTS 仍回 1。空向量不是錯誤。quantile(2, vector(1)) 是 +Inf。
func TestAC103QueryFailureKeepsFiring(t *testing.T) {
	const wantErr = `invalid destination label name in label_replace(): 9bad`
	r := newRig(t, nil, 0)
	r.start([]FileGroup{fg("a.yml", "g", time.Second, 0, 0, al("Bad", "vector(1)", 0, 0, nil, nil))})
	r.step("g")
	before := alertList(t, r.rule("g", "Bad"))[0].(map[string]any)
	activeAt := parseAt(t, before["activeAt"])
	r.mustApply([]FileGroup{fg("a.yml", "g", time.Second, 0, 0, al("Bad", `label_replace(vector(1), "9bad", "x", "a", ".*")`, 0, 0, nil, nil))})
	last := r.step("g")
	rule := r.rule("g", "Bad")
	if rule["health"] != "err" || rule["lastError"] != wantErr || rule["state"] != "firing" {
		t.Fatalf("after query failure: %#v", rule)
	}
	item := alertList(t, rule)[0].(map[string]any)
	if !parseAt(t, item["activeAt"]).Equal(activeAt) || item["value"] != "1e+00" {
		t.Fatalf("alert changed: %#v", item)
	}
	series := namedAlerts(r.instant("ALERTS", last), "Bad")
	if len(series) != 1 || series[0].F != 1 {
		t.Fatalf("ALERTS = %#v", series)
	}

	empty := newRig(t, nil, 0)
	empty.start([]FileGroup{fg("a.yml", "g", time.Second, 0, 0, al("None", "vector(1) == 0", 0, 0, nil, nil))})
	empty.step("g")
	none := empty.rule("g", "None")
	if none["health"] != "ok" || none["state"] != "inactive" || len(alertList(t, none)) != 0 {
		t.Fatalf("empty vector = %#v", none)
	}
	noKey(t, none, "lastError")

	inf := newRig(t, nil, 0)
	inf.start([]FileGroup{fg("a.yml", "g", time.Second, 0, 0, al("Inf", "quantile(2, vector(1))", 0, 0, nil, nil))})
	inf.step("g")
	got := inf.rule("g", "Inf")
	if got["health"] != "ok" || got["state"] != "firing" || alertList(t, got)[0].(map[string]any)["value"] != "+Inf" {
		t.Fatalf("+Inf = %#v", got)
	}
}

// AC-104 Given 套上規則 labels 之後有兩筆相同標籤集合。When 評估。Then 對應的 lastError，沒有告警、沒有系列。
func TestAC104DuplicateLabelset(t *testing.T) {
	expr := `vector(0) or label_replace(vector(0), "test", "x", "", "")`
	r := newRig(t, nil, 0)
	r.start([]FileGroup{fg("a.yml", "g", time.Second, 0, 0,
		al("Dup", expr, 0, 0, map[string]string{"test": "test"}, nil),
		rec("job:dup:rate", expr, map[string]string{"test": "test"}),
	)})
	last := r.step("g")
	alert := r.rule("g", "Dup")
	if alert["health"] != "err" || alert["lastError"] != "vector contains metrics with the same labelset after applying alert labels" || len(alertList(t, alert)) != 0 {
		t.Fatalf("alert = %#v", alert)
	}
	recorded := r.rule("g", "job:dup:rate")
	if recorded["health"] != "err" || recorded["lastError"] != "vector contains metrics with the same labelset after applying rule labels" {
		t.Fatalf("recording = %#v", recorded)
	}
	if len(r.instant("job:dup:rate", last)) != 0 {
		t.Fatal("duplicate recording wrote a series")
	}
}

// AC-105 Given annotation 與 label 使用 Go template。When 評估成功。Then rules API 留原始模板，告警物件用展開後的字串。
// 模板失敗仍 firing、health ok，annotation 以前綴開頭，沒有 __template_error__。
// Prism 的第四次 query 不執行，欄位含 max_template_queries。
func TestAC105Templates(t *testing.T) {
	r := newRig(t, nil, 0)
	r.start([]FileGroup{fg("a.yml", "g", time.Second, 0, 0,
		al("Good", `label_replace(vector(1), "job", "lab", "__name__", ".*")`, 0, 0,
			map[string]string{"severity": "page", "job": "{{ $labels.job }}"},
			map[string]string{
				"summary": "{{ $value }}",
				"human":   "{{ humanize $value }}",
				"copied":  "{{ $labels.job }}",
				"missing": "{{ $labels.nope }}",
				"fromsev": "{{ $labels.severity }}",
			}),
		al("Nope", "vector(1)", 0, 0, nil, map[string]string{"bad": "{{ .Nope }}"}),
		al("Bogus", "vector(1)", 0, 0, nil, map[string]string{"bad": `{{ query "bogus{" }}`}),
		al("Cap", "vector(1)", 0, 0, nil, map[string]string{"bad": `{{ query "vector(1)" }}{{ query "vector(2)" }}{{ query "vector(3)" }}{{ query "vector(4)" }}`}),
	)})
	r.step("g")
	rule := r.rule("g", "Good")
	rawLabels := rule["labels"].(map[string]any)
	rawAnn := rule["annotations"].(map[string]any)
	if rawLabels["severity"] != "page" || rawLabels["job"] != "{{ $labels.job }}" || rawAnn["summary"] != "{{ $value }}" {
		t.Fatalf("raw templates = %#v %#v", rawLabels, rawAnn)
	}
	item := alertList(t, rule)[0].(map[string]any)
	if item["value"] != "1e+00" {
		t.Fatalf("value = %v", item["value"])
	}
	ann := item["annotations"].(map[string]any)
	if ann["summary"] != "1" || ann["human"] != "1" || ann["copied"] != "lab" || ann["missing"] != "" || ann["fromsev"] != "" {
		t.Fatalf("expanded = %#v", ann)
	}
	lbl := item["labels"].(map[string]any)
	if lbl["severity"] != "page" || lbl["job"] != "lab" {
		t.Fatalf("alert labels = %#v", lbl)
	}
	for _, name := range []string{"Nope", "Bogus", "Cap"} {
		got := r.rule("g", name)
		if got["state"] != "firing" || got["health"] != "ok" {
			t.Fatalf("%s = %#v", name, got)
		}
		noTemplateError(t, got)
		noTemplateError(t, alertList(t, got)[0].(map[string]any))
	}
	nope := alertList(t, r.rule("g", "Nope"))[0].(map[string]any)["annotations"].(map[string]any)["bad"].(string)
	bogus := alertList(t, r.rule("g", "Bogus"))[0].(map[string]any)["annotations"].(map[string]any)["bad"].(string)
	cap := alertList(t, r.rule("g", "Cap"))[0].(map[string]any)["annotations"].(map[string]any)["bad"].(string)
	const prefix = "<error expanding template: "
	if !strings.HasPrefix(nope, prefix) || !strings.Contains(nope, "can't evaluate field Nope") {
		t.Fatalf("nope annotation = %q", nope)
	}
	if !strings.HasPrefix(bogus, prefix) || !strings.Contains(bogus, "unexpected end of input inside braces") {
		t.Fatalf("bogus annotation = %q", bogus)
	}
	if !strings.HasPrefix(cap, prefix) || !strings.Contains(cap, "max_template_queries") {
		t.Fatalf("cap annotation = %q", cap)
	}
	if n := r.eng.templateQueries("g", "Cap"); n != 3 {
		t.Fatalf("template queries = %d", n)
	}
}

func noTemplateError(t *testing.T, m map[string]any) {
	t.Helper()
	for _, key := range []string{"labels", "annotations"} {
		obj, _ := m[key].(map[string]any)
		if _, ok := obj["__template_error__"]; ok {
			t.Fatalf("__template_error__ in %s", key)
		}
	}
}

// AC-106 Given expr 是 vector(1)，annotation prism_log_expr 是不含未閉合 {{ 的 LogQL。
// When 評估。Then firing，值 1e+00，annotation 保留結尾換行，不進 labels。
func TestAC106LogExprNotExecuted(t *testing.T) {
	loaded := loadYAML(t, "log.yml", `
groups:
- name: log
  interval: 1s
  rules:
  - alert: Log
    expr: vector(1)
    annotations:
      prism_log_expr: |
        {job="lab"}
`)
	want := "{job=\"lab\"}\n"
	if loaded[0].Group.Rules[0].Annotations["prism_log_expr"] != want {
		t.Fatalf("loader annotation = %q", loaded[0].Group.Rules[0].Annotations["prism_log_expr"])
	}
	r := newRig(t, nil, 0)
	r.start(loaded)
	r.step("log")
	rule := r.rule("log", "Log")
	if rule["state"] != "firing" {
		t.Fatalf("state = %v", rule["state"])
	}
	item := alertList(t, rule)[0].(map[string]any)
	if item["value"] != "1e+00" {
		t.Fatalf("value = %v", item["value"])
	}
	if item["annotations"].(map[string]any)["prism_log_expr"] != want {
		t.Fatalf("annotation = %q", item["annotations"].(map[string]any)["prism_log_expr"])
	}
	if _, ok := item["labels"].(map[string]any)["prism_log_expr"]; ok {
		t.Fatal("prism_log_expr is a label")
	}
}

// AC-107 Given 評估已跑過。When GET /prom/api/v1/rules 與 /alerts。Then 信封、欄位、篩選與實測錯誤 body。
func TestAC107RulesAndAlertsAPI(t *testing.T) {
	r := newRig(t, nil, 0)
	r.start([]FileGroup{
		fg("a.yml", "mix", time.Second, 0, -1,
			al("NoFor", "vector(1)", 0, 0, nil, nil),
			al("Pend", "vector(1)", time.Hour, 0, nil, nil),
			rec("rec", "vector(1)", nil),
			rec("rec2", "vector(2)", map[string]string{"job": "lab"}),
			al("Inf", "quantile(2, vector(1))", 0, 0, nil, nil),
			al("Empty", "vector(1) == 0", 0, 0, nil, nil),
		),
		fg("b.yml", "other", time.Second, 0, 0, al("Other", "vector(1)", 0, 0, nil, nil)),
	})
	r.stepOrdered("mix", "other")

	backend, err := spi.Open(t.Context(), "memory", spi.Config{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	h, err := promapi.NewQueryHandler(backend, promapi.QueryOptions{Tenant: "default", AllowAnonymousRead: true, Config: config.Default().Query})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { h.Stop() })
	h.SetRules(r.eng)

	code, body, raw := httpJSON(t, h, "/prom/api/v1/rules")
	if code != http.StatusOK || body["status"] != "success" {
		t.Fatalf("rules status %d %s", code, raw)
	}
	data := body["data"].(map[string]any)
	groups := groupList(t, data)
	mix := findGroup(t, groups, "mix")
	keySet(t, mix, "evaluationTime", "file", "interval", "lastEvaluation", "limit", "name", "rules")
	if mix["file"] != "a.yml" || num(t, mix["interval"]) != 1 || num(t, mix["limit"]) != -1 {
		t.Fatalf("group = %#v", mix)
	}
	noFor := findRule(t, groups, "mix", "NoFor")
	keySet(t, noFor, "alerts", "annotations", "duration", "evaluationTime", "health", "keepFiringFor", "labels", "lastEvaluation", "name", "query", "state", "type")
	if noFor["type"] != "alerting" || noFor["state"] != "firing" || noFor["query"] != "vector(1)" || num(t, noFor["duration"]) != 0 || num(t, noFor["keepFiringFor"]) != 0 || noFor["health"] != "ok" {
		t.Fatalf("NoFor = %#v", noFor)
	}
	noKey(t, noFor, "lastError")
	if len(noFor["labels"].(map[string]any)) != 0 || len(noFor["annotations"].(map[string]any)) != 0 {
		t.Fatal("empty labels or annotations were omitted")
	}
	fired := alertList(t, noFor)[0].(map[string]any)
	keySet(t, fired, "activeAt", "annotations", "labels", "state", "value")
	if fired["value"] != "1e+00" || fired["state"] != "firing" {
		t.Fatalf("fired = %#v", fired)
	}
	activeText := fired["activeAt"].(string)
	if !strings.Contains(activeText, ".") || !strings.HasSuffix(activeText, "Z") {
		t.Fatalf("activeAt = %s", activeText)
	}
	pend := findRule(t, groups, "mix", "Pend")
	if pend["state"] != "pending" || alertList(t, pend)[0].(map[string]any)["state"] != "pending" || num(t, pend["duration"]) != 3600 {
		t.Fatalf("Pend = %#v", pend)
	}
	empty := findRule(t, groups, "mix", "Empty")
	if empty["state"] != "inactive" || len(alertList(t, empty)) != 0 || empty["health"] != "ok" {
		t.Fatalf("Empty = %#v", empty)
	}
	inf := findRule(t, groups, "mix", "Inf")
	if alertList(t, inf)[0].(map[string]any)["value"] != "+Inf" || inf["health"] != "ok" {
		t.Fatalf("Inf = %#v", inf)
	}
	recRule := findRule(t, groups, "mix", "rec")
	keySet(t, recRule, "evaluationTime", "health", "lastEvaluation", "name", "query", "type")
	if recRule["type"] != "recording" {
		t.Fatal(recRule["type"])
	}
	rec2 := findRule(t, groups, "mix", "rec2")
	if rec2["labels"].(map[string]any)["job"] != "lab" {
		t.Fatalf("rec2 = %#v", rec2)
	}

	_, alertOnly, _ := httpJSON(t, h, "/prom/api/v1/rules?type=alert")
	for _, g := range groupList(t, alertOnly["data"].(map[string]any)) {
		for _, rawRule := range g.(map[string]any)["rules"].([]any) {
			if rawRule.(map[string]any)["type"] != "alerting" {
				t.Fatalf("type=alert kept %#v", rawRule)
			}
		}
	}
	_, recordOnly, _ := httpJSON(t, h, "/prom/api/v1/rules?type=record")
	recordGroups := groupList(t, recordOnly["data"].(map[string]any))
	if len(recordGroups) != 1 || recordGroups[0].(map[string]any)["name"] != "mix" {
		t.Fatalf("type=record groups = %#v", recordGroups)
	}
	for _, rawRule := range recordGroups[0].(map[string]any)["rules"].([]any) {
		if rawRule.(map[string]any)["type"] != "recording" {
			t.Fatalf("type=record kept %#v", rawRule)
		}
	}
	status, _, typeRaw := httpJSON(t, h, "/prom/api/v1/rules?type=alerting")
	wantErr := `{"status":"error","errorType":"bad_data","error":"invalid parameter \"type\": not supported value \"alerting\""}`
	if status != http.StatusBadRequest || string(typeRaw) != wantErr {
		t.Fatalf("type=alerting %d %s", status, typeRaw)
	}
	_, excluded, excludedRaw := httpJSON(t, h, "/prom/api/v1/rules?exclude_alerts=true")
	if !strings.Contains(string(excludedRaw), `"alerts":null`) {
		t.Fatalf("exclude_alerts body = %s", excludedRaw)
	}
	excludedRule := findRule(t, groupList(t, excluded["data"].(map[string]any)), "mix", "NoFor")
	if excludedRule["alerts"] != nil {
		t.Fatalf("alerts = %#v", excludedRule["alerts"])
	}
	_, named, _ := httpJSON(t, h, "/prom/api/v1/rules?rule_name[]=NoFor")
	namedGroups := groupList(t, named["data"].(map[string]any))
	if len(namedGroups) != 1 || len(namedGroups[0].(map[string]any)["rules"].([]any)) != 1 || namedGroups[0].(map[string]any)["rules"].([]any)[0].(map[string]any)["name"] != "NoFor" {
		t.Fatalf("rule_name filter = %#v", namedGroups)
	}
	_, filed, _ := httpJSON(t, h, "/prom/api/v1/rules?file[]=b.yml")
	filedGroups := groupList(t, filed["data"].(map[string]any))
	if len(filedGroups) != 1 || filedGroups[0].(map[string]any)["file"] != "b.yml" {
		t.Fatalf("file filter = %#v", filedGroups)
	}

	alertCode, alertBody, _ := httpJSON(t, h, "/prom/api/v1/alerts")
	if alertCode != http.StatusOK || alertBody["status"] != "success" {
		t.Fatalf("alerts %d %#v", alertCode, alertBody)
	}
	apiAlerts := alertBody["data"].(map[string]any)["alerts"].([]any)
	seen := map[string]string{}
	for _, raw := range apiAlerts {
		item := raw.(map[string]any)
		if item["state"] != "pending" && item["state"] != "firing" {
			t.Fatalf("alert state %v", item["state"])
		}
		seen[item["labels"].(map[string]any)["alertname"].(string)] = item["state"].(string)
	}
	if seen["NoFor"] != "firing" || seen["Pend"] != "pending" || seen["Other"] != "firing" || seen["Inf"] != "firing" {
		t.Fatalf("alerts = %#v", seen)
	}
	if _, ok := seen["Empty"]; ok {
		t.Fatal("inactive alert was returned")
	}

	post := httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(post, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/prom/api/v1/rules", nil))
	if post.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST = %d", post.Code)
	}
	locked, err := promapi.NewQueryHandler(backend, promapi.QueryOptions{
		Tenant: "default",
		APIKey: secret.String(strings.Repeat("k", 32)),
		Config: config.Default().Query,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { locked.Stop() })
	denied := httptest.NewRecorder()
	locked.HTTPHandler().ServeHTTP(denied, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/prom/api/v1/rules", nil))
	if denied.Code != http.StatusUnauthorized {
		t.Fatalf("auth = %d", denied.Code)
	}
}

func httpJSON(t *testing.T, h *promapi.QueryHandler, path string) (int, map[string]any, []byte) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.HTTPHandler().ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil))
	var body map[string]any
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil && rec.Code == http.StatusOK {
			t.Fatal(err)
		}
	}
	return rec.Code, body, rec.Body.Bytes()
}

func alertsContain(t *testing.T, alerts []any, name, state string) bool {
	t.Helper()
	for _, raw := range alerts {
		item := raw.(map[string]any)
		if item["labels"].(map[string]any)["alertname"] == name && item["state"] == state {
			return true
		}
	}
	return false
}

// AC-108 Given SIGHUP 成功，檔名與 group 名稱沒變。When 只改 expr、for、interval 或 query_offset。
// Then activeAt 保留。When 改名稱或 labels。Then activeAt 重算，舊 ALERTS 為空。
// When group 被刪掉。Then 告警離開 API，ALERTS 為空。失敗的載入留在上一份。
func TestAC108ReloadKeepsMatchingAlerts(t *testing.T) {
	r := newRig(t, nil, 0)
	base := []FileGroup{fg("a.yml", "g", time.Second, 0, 0, al("KeepAt", "vector(1)", 0, 0, map[string]string{"team": "sre"}, map[string]string{"v": "{{ $value }}"}))}
	r.start(base)
	r.step("g")
	activeAt := parseAt(t, alertList(t, r.rule("g", "KeepAt"))[0].(map[string]any)["activeAt"])

	r.mustApply([]FileGroup{fg("a.yml", "g", time.Second, 0, 0, al("KeepAt", "vector(2)", 0, 0, map[string]string{"team": "sre"}, map[string]string{"v": "{{ $value }}"}))})
	r.step("g")
	item := alertList(t, r.rule("g", "KeepAt"))[0].(map[string]any)
	if !parseAt(t, item["activeAt"]).Equal(activeAt) || item["value"] != "2e+00" || item["annotations"].(map[string]any)["v"] != "2" {
		t.Fatalf("after expr change %#v", item)
	}

	r.mustApply([]FileGroup{fg("a.yml", "g", time.Second, 0, 0, al("KeepAt", "vector(2)", time.Hour, 0, map[string]string{"team": "sre"}, map[string]string{"v": "{{ $value }}"}))})
	r.step("g")
	rule := r.rule("g", "KeepAt")
	if rule["state"] != "firing" || num(t, rule["duration"]) != 3600 || !parseAt(t, alertList(t, rule)[0].(map[string]any)["activeAt"]).Equal(activeAt) {
		t.Fatalf("after for change %#v", rule)
	}

	r.mustApply([]FileGroup{fg("a.yml", "g", 5*time.Second, 0, 0, al("KeepAt", "vector(2)", time.Hour, 0, map[string]string{"team": "sre"}, map[string]string{"v": "{{ $value }}"}))})
	if num(t, findGroup(t, groupList(t, r.rules(nil)), "g")["interval"]) != 5 {
		t.Fatal("interval did not change before the next evaluation")
	}
	if !parseAt(t, alertList(t, r.rule("g", "KeepAt"))[0].(map[string]any)["activeAt"]).Equal(activeAt) {
		t.Fatal("activeAt changed with interval")
	}
	r.step("g")
	if !parseAt(t, alertList(t, r.rule("g", "KeepAt"))[0].(map[string]any)["activeAt"]).Equal(activeAt) {
		t.Fatal("activeAt changed after the 5s evaluation")
	}

	r.mustApply([]FileGroup{fg("a.yml", "g", 5*time.Second, 10*time.Second, 0, al("KeepAt", "vector(2)", time.Hour, 0, map[string]string{"team": "sre"}, map[string]string{"v": "{{ $value }}"}))})
	r.step("g")
	if !parseAt(t, alertList(t, r.rule("g", "KeepAt"))[0].(map[string]any)["activeAt"]).Equal(activeAt) {
		t.Fatal("activeAt changed with query_offset")
	}

	r.mustApply([]FileGroup{fg("a.yml", "g", 5*time.Second, 0, 0, al("KeepAt", "vector(2)", time.Hour, 0, map[string]string{"team": "other"}, map[string]string{"v": "{{ $value }}"}))})
	if len(r.instant(`ALERTS{team="sre"}`, r.clock.Now())) != 0 {
		t.Fatal("old team series still queryable")
	}
	r.step("g")
	relabeled := parseAt(t, alertList(t, r.rule("g", "KeepAt"))[0].(map[string]any)["activeAt"])
	if relabeled.Equal(activeAt) {
		t.Fatal("label change kept activeAt")
	}
	if len(r.instant(`ALERTS{team="sre"}`, r.clock.Now())) != 0 {
		t.Fatal("old team series returned after evaluation")
	}

	r.mustApply([]FileGroup{fg("a.yml", "g", 5*time.Second, 0, 0, al("Renamed", "vector(2)", time.Hour, 0, map[string]string{"team": "other"}, map[string]string{"v": "{{ $value }}"}))})
	r.step("g")
	if _, err := r.eng.Rules(t.Context(), nil); err != nil {
		t.Fatal(err)
	}
	groups := groupList(t, r.rules(nil))
	// for is 1h, so the new identity is pending after this one evaluation.
	// AC-108 requires a fresh activeAt and an empty old series, not firing.
	if findRule(t, groups, "g", "Renamed")["state"] != "pending" {
		t.Fatal("renamed alert is not pending")
	}
	renamedAt := parseAt(t, alertList(t, findRule(t, groups, "g", "Renamed"))[0].(map[string]any)["activeAt"])
	if renamedAt.Equal(relabeled) {
		t.Fatal("rename kept activeAt")
	}
	if len(r.instant(`ALERTS{alertname="KeepAt"}`, r.clock.Now())) != 0 {
		t.Fatal("old alertname series still queryable")
	}

	if err := r.apply([]FileGroup{fg("a.yml", "g", 5*time.Second, 0, 0, al("Renamed", "vector(", time.Hour, 0, map[string]string{"team": "other"}, nil))}); err == nil {
		t.Fatal("invalid rule was applied")
	}
	if !parseAt(t, alertList(t, r.rule("g", "Renamed"))[0].(map[string]any)["activeAt"]).Equal(renamedAt) {
		t.Fatal("failed reload changed the previous alert")
	}

	r.mustApply(nil)
	if len(groupList(t, r.rules(nil))) != 0 || len(r.alertAPI()) != 0 || len(r.instant("ALERTS", r.clock.Now())) != 0 {
		t.Fatal("deleted group is still visible")
	}
}

type restoreHooks struct {
	afterPending func(t *testing.T, st state.Store, activeAt time.Time)
	afterFiring  func(t *testing.T, st state.Store, activeAt time.Time)
	afterGone    func(t *testing.T, st state.Store)
}

// AC-109 Given for 5m 的告警已經 pending 或 firing，而且 alert_state 已有它的列。
// When 重啟。Then activeAt 接回去。pending 仍 pending，firing 仍 firing。
// tenant_id 是空字串。不寫 0。不再 pending 或 firing 時刪掉該列。崩潰可以丟掉還沒刷出的列。
func TestAC109Restore(t *testing.T) {
	mem := state.NewMem()
	runAC109(t, mem, restoreHooks{
		afterPending: func(t *testing.T, st state.Store, activeAt time.Time) {
			assertRow(t, st, "", state.Pending, activeAt, false)
			if rows := mustLoad(t, st, "default"); len(rows) != 0 {
				t.Fatalf("default tenant = %#v", rows)
			}
		},
		afterFiring: func(t *testing.T, st state.Store, activeAt time.Time) {
			assertRow(t, st, "", state.Firing, activeAt, true)
		},
		afterGone: func(t *testing.T, st state.Store) {
			if rows := mustLoad(t, st, ""); len(rows) != 0 {
				t.Fatalf("rows left = %#v", rows)
			}
		},
	})
}

func TestAC109CrashDropsUnflushed(t *testing.T) {
	mem := state.NewMem()
	r := newRig(t, mem, time.Hour)
	groups := []FileGroup{fg("hold.yml", "hold", time.Minute, 0, 0, al("Hold", "vector(1)", 5*time.Minute, 0, nil, nil))}
	r.start(groups)
	r.step("hold")
	first := parseAt(t, alertList(t, r.rule("hold", "Hold"))[0].(map[string]any)["activeAt"])
	r.eng.halt()
	if rows := mustLoad(t, mem, ""); len(rows) != 0 {
		t.Fatalf("crash flushed %#v", rows)
	}
	r.reopen()
	r.start(groups)
	r.step("hold")
	second := parseAt(t, alertList(t, r.rule("hold", "Hold"))[0].(map[string]any)["activeAt"])
	if second.Equal(first) {
		t.Fatal("unflushed activeAt was restored")
	}
}

func runAC109(t *testing.T, st state.Store, hooks restoreHooks) {
	t.Helper()
	r := newRig(t, st, time.Hour)
	groups := []FileGroup{fg("hold.yml", "hold", time.Minute, 0, 0, al("Hold", "vector(1)", 5*time.Minute, 0, nil, nil))}
	r.start(groups)
	last := r.step("hold")
	rule := r.rule("hold", "Hold")
	if rule["state"] != "pending" {
		t.Fatalf("first state = %v", rule["state"])
	}
	activeAt := parseAt(t, alertList(t, rule)[0].(map[string]any)["activeAt"])
	if !activeAt.Equal(last) {
		t.Fatalf("activeAt %s last %s", activeAt, last)
	}
	r.stop()
	if hooks.afterPending != nil {
		hooks.afterPending(t, st, activeAt)
	}

	r.reopen()
	r.start(groups)
	r.step("hold")
	rule = r.rule("hold", "Hold")
	if rule["state"] != "pending" || !parseAt(t, alertList(t, rule)[0].(map[string]any)["activeAt"]).Equal(activeAt) {
		t.Fatalf("restored pending = %#v", rule)
	}
	r.advanceTo("hold", activeAt.Add(5*time.Minute))
	rule = r.rule("hold", "Hold")
	if rule["state"] != "firing" || !parseAt(t, alertList(t, rule)[0].(map[string]any)["activeAt"]).Equal(activeAt) {
		t.Fatalf("firing = %#v", rule)
	}
	r.stop()
	if hooks.afterFiring != nil {
		hooks.afterFiring(t, st, activeAt)
	}

	r.reopen()
	r.start(groups)
	r.step("hold")
	rule = r.rule("hold", "Hold")
	if rule["state"] != "firing" || !parseAt(t, alertList(t, rule)[0].(map[string]any)["activeAt"]).Equal(activeAt) {
		t.Fatalf("restored firing = %#v", rule)
	}
	r.mustApply([]FileGroup{fg("hold.yml", "hold", time.Minute, 0, 0, al("Hold", "vector(1) == 0", 5*time.Minute, 0, nil, nil))})
	r.step("hold")
	rule = r.rule("hold", "Hold")
	if rule["state"] != "inactive" || len(alertList(t, rule)) != 0 {
		t.Fatalf("gone = %#v", rule)
	}
	r.stop()
	if hooks.afterGone != nil {
		hooks.afterGone(t, st)
	}
}

func mustLoad(t *testing.T, st state.Store, tenant string) []state.Row {
	t.Helper()
	rows, err := st.Load(t.Context(), tenant)
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func assertRow(t *testing.T, st state.Store, tenant string, code int16, activeAt time.Time, fired bool) {
	t.Helper()
	rows := mustLoad(t, st, tenant)
	if len(rows) != 1 {
		t.Fatalf("rows = %#v", rows)
	}
	row := rows[0]
	if row.State != code || row.State == 0 || !row.ActiveAt.Equal(activeAt) || (row.FiredAt != nil) != fired {
		t.Fatalf("row = %#v want state %d fired %v", row, code, fired)
	}
	if row.Labels["alertname"] != "Hold" {
		t.Fatalf("labels = %#v", row.Labels)
	}
	if row.Fingerprint != signedFingerprint(labels.FromMap(row.Labels)) {
		t.Fatalf("fingerprint %d", row.Fingerprint)
	}
}
