package rules

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestRuleFileAcceptance(t *testing.T) {
	for _, fx := range acRuleFixtures() {
		t.Run(fx.AC+"/"+fx.Name, func(t *testing.T) {
			dir := t.TempDir()
			writeRule(t, dir, "rule.yaml", fx.Body)
			loader, err := Load(t.Context(), dir)
			if fx.Accept {
				if err != nil || loader == nil {
					t.Fatalf("Load() loader=%v err=%v", loader, err)
				}
				return
			}
			if err == nil || loader != nil || !strings.Contains(err.Error(), fx.WantErr) {
				t.Fatalf("Load() loader=%v err=%v, want substring %q and no set", loader, err, fx.WantErr)
			}
		})
	}
}

func TestAC72KeepsCanonicalFields(t *testing.T) {
	set := mustLoad(t, fixtureNamed(t, "host").Body)
	if len(set.Groups) != 1 {
		t.Fatalf("groups = %#v", set.Groups)
	}
	group := set.Groups[0]
	if group.Name != "host" || group.Tenant != "" || group.Interval != 30*time.Second || group.Limit != 0 {
		t.Fatalf("group = %#v", group)
	}
	if len(group.Rules) != 2 {
		t.Fatalf("rules = %#v", group.Rules)
	}
	alert := group.Rules[0]
	if alert.Alert != "HostDiskAlmostFull" || alert.Record != "" {
		t.Fatalf("alert identity = %#v", alert)
	}
	if alert.Expr != "(1 - node_filesystem_avail_bytes / node_filesystem_size_bytes) > 0.85" {
		t.Fatalf("expr = %q", alert.Expr)
	}
	if alert.For != 10*time.Minute || alert.KeepFiringFor != 5*time.Minute {
		t.Fatalf("for = %s keep = %s", alert.For, alert.KeepFiringFor)
	}
	if len(alert.Labels) != 1 || alert.Labels["severity"] != "warning" {
		t.Fatalf("labels = %#v", alert.Labels)
	}
	if alert.Annotations["summary"] != "{{ $labels.instance }} 磁碟使用率 {{ $value | humanizePercentage }}" {
		t.Fatalf("summary = %q", alert.Annotations["summary"])
	}
	if alert.Annotations["runbook_url"] != "https://wiki/runbook/disk" {
		t.Fatalf("runbook = %q", alert.Annotations["runbook_url"])
	}
	record := group.Rules[1]
	if record.Record != "job:http_requests:rate5m" || record.Alert != "" {
		t.Fatalf("record = %#v", record)
	}
	if record.Expr != "sum by (job) (rate(http_requests_total[5m]))" {
		t.Fatalf("record expr = %q", record.Expr)
	}
	if record.For != 0 || record.KeepFiringFor != 0 || len(record.Annotations) != 0 || len(record.Labels) != 0 {
		t.Fatalf("recording rule kept extra fields: %#v", record)
	}
}

func TestAC76KeepsLabelValues(t *testing.T) {
	scalars := mustLoad(t, fixtureNamed(t, "scalars").Body)
	labels := scalars.Groups[0].Rules[0].Labels
	if labels["severity"] != "1" || labels["on"] != "true" || labels["n"] != "1.5" {
		t.Fatalf("labels = %#v", labels)
	}
	extension := mustLoad(t, fixtureNamed(t, "extension-label").Body)
	got := extension.Groups[0].Rules[0].Labels
	if len(got) != 1 || got["__prism_log_expr__"] != `{service="api"}` {
		t.Fatalf("labels = %#v", got)
	}
}

func TestAC77KeepsSameGroupNameAcrossFiles(t *testing.T) {
	dir := t.TempDir()
	writeRule(t, dir, "a.yml", fixtureNamed(t, "file-a").Body)
	writeRule(t, dir, "b.yaml", fixtureNamed(t, "file-b").Body)
	set, err := loadDir(t, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(set.Groups) != 2 || set.Groups[0].Name != "same" || set.Groups[1].Name != "same" {
		t.Fatalf("groups = %#v", set.Groups)
	}
	if set.Groups[0].Rules[0].Alert != "FromA" || set.Groups[1].Rules[0].Alert != "FromB" {
		t.Fatalf("groups = %#v", set.Groups)
	}
	if set.Groups[0].Tenant != "" || set.Groups[1].Tenant != "" {
		t.Fatalf("tenants = %q %q", set.Groups[0].Tenant, set.Groups[1].Tenant)
	}
}

func TestAC78SelectorIsNotLogQL(t *testing.T) {
	set := mustLoad(t, fixtureNamed(t, "selector").Body)
	if set.Groups[0].Rules[0].Expr != `{service="api"}` {
		t.Fatalf("expr = %q", set.Groups[0].Rules[0].Expr)
	}
}

func TestAC79KeepsTemplateText(t *testing.T) {
	set := mustLoad(t, fixtureNamed(t, "template").Body)
	if set.Groups[0].Rules[0].Annotations["summary"] != "{{ $labels.instance }}" {
		t.Fatalf("summary = %q", set.Groups[0].Rules[0].Annotations["summary"])
	}
}

func TestAC80KeepsDurations(t *testing.T) {
	interval := mustLoad(t, fixtureNamed(t, "interval-30s").Body)
	if interval.Groups[0].Interval != 30*time.Second {
		t.Fatalf("interval = %s", interval.Groups[0].Interval)
	}
	zero := mustLoad(t, fixtureNamed(t, "for-zero").Body)
	if zero.Groups[0].Rules[0].For != 0 {
		t.Fatalf("for = %s", zero.Groups[0].Rules[0].For)
	}
	kept := mustLoad(t, fixtureNamed(t, "for-and-keep").Body)
	rule := kept.Groups[0].Rules[0]
	if rule.For != 10*time.Minute || rule.KeepFiringFor != 5*time.Minute {
		t.Fatalf("for = %s keep = %s", rule.For, rule.KeepFiringFor)
	}
}

func TestAC81KeepsLimit(t *testing.T) {
	omitted := mustLoad(t, fixtureNamed(t, "limit-omit").Body)
	zero := mustLoad(t, fixtureNamed(t, "limit-zero").Body)
	negative := mustLoad(t, fixtureNamed(t, "limit-negative").Body)
	if omitted.Groups[0].Limit != 0 || zero.Groups[0].Limit != 0 || negative.Groups[0].Limit != -1 {
		t.Fatalf("limits = %d %d %d", omitted.Groups[0].Limit, zero.Groups[0].Limit, negative.Groups[0].Limit)
	}
}

func TestAC82KeepsQueryOffset(t *testing.T) {
	set := mustLoad(t, fixtureNamed(t, "query-offset").Body)
	if set.Groups[0].QueryOffset != time.Minute {
		t.Fatalf("query_offset = %s", set.Groups[0].QueryOffset)
	}
}

func TestAC83KeepsAlertNames(t *testing.T) {
	plain := mustLoad(t, fixtureNamed(t, "alert-1bad").Body)
	utf8 := mustLoad(t, fixtureNamed(t, "alert-utf8").Body)
	if plain.Groups[0].Rules[0].Alert != "1bad" || utf8.Groups[0].Rules[0].Alert != "磁碟滿" {
		t.Fatalf("names = %q %q", plain.Groups[0].Rules[0].Alert, utf8.Groups[0].Rules[0].Alert)
	}
}

func TestAC84CopiesMergedRule(t *testing.T) {
	set := mustLoad(t, fixtureNamed(t, "merge").Body)
	rules := set.Groups[0].Rules
	if len(rules) != 2 {
		t.Fatalf("rules = %#v", rules)
	}
	if rules[0].Alert != "First" || rules[0].Expr != "up" || rules[0].Labels["severity"] != "warning" {
		t.Fatalf("first = %#v", rules[0])
	}
	if rules[1].Alert != "Second" || rules[1].Expr != "up" || rules[1].Labels["severity"] != "warning" {
		t.Fatalf("second = %#v", rules[1])
	}
}

func TestAC85DirectoryScan(t *testing.T) {
	dir := t.TempDir()
	writeRule(t, dir, "a.yml", "groups:\n  - name: a\n    rules:\n      - alert: FromA\n        expr: up\n")
	writeRule(t, dir, "b.yaml", "groups:\n  - name: b\n    rules:\n      - alert: FromB\n        expr: up\n")
	writeRule(t, dir, "skip.txt", "groups:\n  - name: skip\n    rules:\n      - alert: Skip\n        expr: not-yaml\n")
	if err := os.Mkdir(filepath.Join(dir, "sub"), 0o700); err != nil {
		t.Fatal(err)
	}
	writeRule(t, filepath.Join(dir, "sub"), "nested.yml", "groups:\n  - name: nested\n    rules:\n      - alert: Nested\n        expr: up\n")
	set, err := loadDir(t, dir)
	if err != nil {
		t.Fatal(err)
	}
	var alerts []string
	for _, group := range set.Groups {
		alerts = append(alerts, group.Rules[0].Alert)
	}
	if !slices.Equal(alerts, []string{"FromA", "FromB"}) {
		t.Fatalf("alerts = %v", alerts)
	}

	tooMany := t.TempDir()
	for i := range maxRuleFiles + 1 {
		writeRule(t, tooMany, fmt.Sprintf("f%05d.txt", i), "")
	}
	if _, err := Load(t.Context(), tooMany); err == nil || !strings.Contains(err.Error(), "10000") {
		t.Fatalf("too many entries err = %v", err)
	}

	oversized := t.TempDir()
	payload := bytes.Repeat([]byte("a"), int(maxRuleFileBytes)+1)
	if err := os.WriteFile(filepath.Join(oversized, "big.yaml"), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = Load(t.Context(), oversized)
	if err == nil || !strings.Contains(err.Error(), "file exceeds 4194304 bytes") {
		t.Fatalf("oversized err = %v", err)
	}
}

func TestAC86ReloadKeepsPreviousSet(t *testing.T) {
	dir := t.TempDir()
	writeRule(t, dir, "a.yml", "groups:\n  - name: g\n    rules:\n      - alert: Old\n        expr: up\n      - alert: Old\n        expr: up == 1\n")
	loader, err := Load(t.Context(), dir)
	if err != nil {
		t.Fatal(err)
	}
	before := loader.Current()
	if before.Groups[0].Rules[0].Alert != "Old" || len(before.Warnings) != 1 || !strings.Contains(before.Warnings[0], "Metric: Old") {
		t.Fatalf("before = %#v", before)
	}
	writeRule(t, dir, "a.yml", "groups:\n  - name: g\n    rules:\n      - alert: New\n        expr: up\n")
	writeRule(t, dir, "b.yaml", "groups:\n  - name: extra\n    rules:\n      - alert: Extra\n        expr: up\n")
	if current := loader.Current(); current.Groups[0].Rules[0].Alert != "Old" || len(current.Groups) != 1 {
		t.Fatalf("set changed without reload: %#v", current)
	}
	if err := loader.Reload(t.Context()); err != nil {
		t.Fatal(err)
	}
	reloaded := loader.Current()
	if len(reloaded.Groups) != 2 || reloaded.Groups[0].Rules[0].Alert != "New" || reloaded.Groups[1].Rules[0].Alert != "Extra" {
		t.Fatalf("reloaded = %#v", reloaded)
	}
	if len(reloaded.Warnings) != 0 {
		t.Fatalf("warnings = %#v", reloaded.Warnings)
	}
	if err := os.Remove(filepath.Join(dir, "a.yml")); err != nil {
		t.Fatal(err)
	}
	if err := loader.Reload(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := loader.Current(); len(got.Groups) != 1 || got.Groups[0].Rules[0].Alert != "Extra" {
		t.Fatalf("after delete = %#v", got)
	}
	writeRule(t, dir, "c.yml", "groups:\n  - name: bad\n    rules:\n      - alert: Bad\n")
	if err := loader.Reload(t.Context()); err == nil {
		t.Fatal("invalid reload succeeded")
	}
	if got := loader.Current(); len(got.Groups) != 1 || got.Groups[0].Rules[0].Alert != "Extra" {
		t.Fatalf("failed reload replaced set: %#v", got)
	}
}

func TestAC87FixtureSetIsDeclared(t *testing.T) {
	// AC-87's promtool comparison is the integration test. This locks the file set in default CI.
	want := []string{"AC-72", "AC-73", "AC-74", "AC-75", "AC-76", "AC-77", "AC-78", "AC-79", "AC-80", "AC-81", "AC-82", "AC-83", "AC-84", "AC-88", "AC-90", "AC-91", "AC-93"}
	got := map[string]bool{}
	for _, fx := range acRuleFixtures() {
		if fx.ComparePromtool {
			got[fx.AC] = true
		}
		if fx.AC == "AC-89" && fx.ComparePromtool {
			t.Errorf("%s is compared with promtool", fx.Name)
		}
	}
	for _, ac := range want {
		if !got[ac] {
			t.Errorf("missing promtool fixture for %s", ac)
		}
	}
}

func TestAC88StoresLogExprAsAnnotation(t *testing.T) {
	set := mustLoad(t, fixtureNamed(t, "annotation").Body)
	rule := set.Groups[0].Rules[0]
	if rule.Expr != "vector(1)" || rule.For != 5*time.Minute {
		t.Fatalf("rule = %#v", rule)
	}
	if len(rule.Labels) != 1 || rule.Labels["severity"] != "critical" {
		t.Fatalf("labels = %#v", rule.Labels)
	}
	if _, ok := rule.Labels["prism_log_expr"]; ok {
		t.Fatalf("prism_log_expr leaked into labels: %#v", rule.Labels)
	}
	const want = "sum(count_over_time({service=\"api\", level=\"error\"}[5m])) > 100\n"
	if rule.Annotations["prism_log_expr"] != want {
		t.Fatalf("annotation = %q", rule.Annotations["prism_log_expr"])
	}
}

func TestAC89SingleDocumentMarkers(t *testing.T) {
	leading := mustLoad(t, fixtureNamed(t, "leading-document").Body)
	if leading.Groups[0].Rules[0].Alert != "A" {
		t.Fatalf("leading = %#v", leading)
	}
	dots := mustLoad(t, fixtureNamed(t, "trailing-dots").Body)
	if dots.Groups[0].Rules[0].Alert != "A" {
		t.Fatalf("dots = %#v", dots)
	}
	only := mustLoad(t, fixtureNamed(t, "only-document-start").Body)
	if len(only.Groups) != 0 {
		t.Fatalf("only --- groups = %#v", only.Groups)
	}
}

func TestAC90EmptySet(t *testing.T) {
	for _, name := range []string{"empty", "comment", "groups-empty", "groups-null", "rules-empty"} {
		t.Run(name, func(t *testing.T) {
			set := mustLoad(t, fixtureNamed(t, name).Body)
			if len(set.Groups) != 0 || len(set.Warnings) != 0 {
				t.Fatalf("set = %#v", set)
			}
		})
	}
}

func TestAC91DefaultsInterval(t *testing.T) {
	omitted := mustLoad(t, fixtureNamed(t, "interval-omit").Body)
	zero := mustLoad(t, fixtureNamed(t, "interval-zero").Body)
	if omitted.Groups[0].Interval != 30*time.Second || zero.Groups[0].Interval != 30*time.Second {
		t.Fatalf("intervals = %s %s", omitted.Groups[0].Interval, zero.Groups[0].Interval)
	}
}

func TestAC93WarnsOnDuplicateRules(t *testing.T) {
	alerts := mustLoad(t, fixtureNamed(t, "duplicate-alerts").Body)
	if len(alerts.Groups[0].Rules) != 2 || alerts.Groups[0].Rules[0].Expr != "up" || alerts.Groups[0].Rules[1].Expr != "up == 1" {
		t.Fatalf("rules = %#v", alerts.Groups[0].Rules)
	}
	if len(alerts.Warnings) != 1 || !strings.Contains(alerts.Warnings[0], "Metric: A") {
		t.Fatalf("warnings = %#v", alerts.Warnings)
	}
	records := mustLoad(t, fixtureNamed(t, "duplicate-records").Body)
	if len(records.Warnings) != 1 || !strings.Contains(records.Warnings[0], "Metric: job:x:rate") {
		t.Fatalf("warnings = %#v", records.Warnings)
	}
	different := mustLoad(t, fixtureNamed(t, "different-labels").Body)
	if len(different.Groups[0].Rules) != 2 || len(different.Warnings) != 0 {
		t.Fatalf("set = %#v", different)
	}
}

func TestLoadHonorsCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := Load(ctx, t.TempDir()); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
}

func fixtureNamed(t *testing.T, name string) ruleFixture {
	t.Helper()
	for _, fx := range acRuleFixtures() {
		if fx.Name == name {
			return fx
		}
	}
	t.Fatalf("fixture %s not found", name)
	return ruleFixture{}
}

func mustLoad(t *testing.T, body string) Set {
	t.Helper()
	set, err := loadBody(t, body)
	if err != nil {
		t.Fatal(err)
	}
	return set
}

func loadBody(t *testing.T, body string) (Set, error) {
	t.Helper()
	dir := t.TempDir()
	writeRule(t, dir, "rule.yaml", body)
	return loadDir(t, dir)
}

func loadDir(t *testing.T, dir string) (Set, error) {
	t.Helper()
	loader, err := Load(t.Context(), dir)
	if err != nil {
		return Set{}, err
	}
	return loader.Current(), nil
}

func writeRule(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}
