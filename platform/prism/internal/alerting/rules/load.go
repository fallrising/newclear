package rules

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/prometheus/common/model"
	"github.com/prometheus/prometheus/model/rulefmt"
	"gopkg.in/yaml.v3"
)

const (
	// maxRuleFiles and maxRuleFileBytes match internal/config. AC-85 reuses those ceilings.
	maxRuleFiles           = 10_000
	maxRuleFileBytes int64 = 4 << 20

	// defaultInterval is the Prism group interval when the file omits interval or sets 0s.
	// Prometheus stores its own evaluation_interval there (15s in the P2-06 measurement). AC-91.
	defaultInterval = 30 * time.Second
)

// Rule is one alerting or recording rule, in file order.
type Rule struct {
	Alert         string
	Record        string
	Expr          string
	For           time.Duration
	KeepFiringFor time.Duration
	Labels        map[string]string
	Annotations   map[string]string
}

// Group is one rule group loaded from a file. Tenant is empty for file rules.
type Group struct {
	Name        string
	Tenant      string
	Interval    time.Duration
	QueryOffset time.Duration
	Limit       int
	Rules       []Rule
}

// Set is the in-memory rule collection.
type Set struct {
	Groups   []Group
	Warnings []string
}

// Loader reads rules.path and keeps the last successful set across reloads.
type Loader struct {
	mu   sync.RWMutex
	path string
	set  Set
}

// Load reads every rule file in path. A failure returns no loader and no partial set.
func Load(ctx context.Context, path string) (*Loader, error) {
	set, err := readDirectory(ctx, path)
	if err != nil {
		return nil, err
	}
	return &Loader{path: path, set: set}, nil
}

// Reload reads the directory again. On any error the previous set is left in place.
func (l *Loader) Reload(ctx context.Context) error {
	set, err := readDirectory(ctx, l.path)
	if err != nil {
		return err
	}
	l.mu.Lock()
	l.set = set
	l.mu.Unlock()
	return nil
}

// Current returns a copy of the last successful set.
func (l *Loader) Current() Set {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return cloneSet(l.set)
}

func readDirectory(ctx context.Context, path string) (Set, error) {
	entries, err := readRuleEntries(ctx, path)
	if err != nil {
		return Set{}, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".yml") && !strings.HasSuffix(name, ".yaml") {
			continue
		}
		names = append(names, name)
	}
	slices.Sort(names)

	var groups []Group
	var warnings []string
	var errs []error
	for _, name := range names {
		if err := ctx.Err(); err != nil {
			return Set{}, err
		}
		content, readErr := readBounded(ctx, filepath.Join(path, name), maxRuleFileBytes)
		if readErr != nil {
			errs = append(errs, fmt.Errorf("read rule file %q: %w", name, readErr))
			continue
		}
		fileGroups, fileWarnings, parseErr := parseRuleFile(content)
		if parseErr != nil {
			errs = append(errs, fmt.Errorf("parse rule file %q: %w", name, parseErr))
			continue
		}
		groups = append(groups, fileGroups...)
		warnings = append(warnings, fileWarnings...)
	}
	if err := errors.Join(errs...); err != nil {
		return Set{}, err
	}
	return Set{Groups: groups, Warnings: warnings}, nil
}

func parseRuleFile(content []byte) ([]Group, []string, error) {
	count, err := yamlDocumentCount(content)
	if err != nil {
		return nil, nil, err
	}
	// rulefmt.Parse keeps the first document and ignores the rest. AC-89 rejects that.
	if count > 1 {
		return nil, nil, errors.New("more than one YAML document")
	}
	parsed, errs := rulefmt.Parse(content)
	if err := errors.Join(errs...); err != nil {
		return nil, nil, err
	}
	if parsed == nil {
		return nil, nil, nil
	}
	groups := make([]Group, 0, len(parsed.Groups))
	var fileRules []Rule
	for _, group := range parsed.Groups {
		rules := convertRules(group.Rules)
		if len(rules) == 0 {
			continue
		}
		groups = append(groups, Group{
			Name:        group.Name,
			Interval:    groupInterval(group.Interval),
			QueryOffset: groupOffset(group.QueryOffset),
			Limit:       group.Limit,
			Rules:       rules,
		})
		fileRules = append(fileRules, rules...)
	}
	return groups, duplicateWarnings(fileRules), nil
}

func convertRules(nodes []rulefmt.RuleNode) []Rule {
	if len(nodes) == 0 {
		return nil
	}
	rules := make([]Rule, len(nodes))
	for i, node := range nodes {
		rules[i] = Rule{
			Alert:         node.Alert.Value,
			Record:        node.Record.Value,
			Expr:          node.Expr.Value,
			For:           time.Duration(node.For),
			KeepFiringFor: time.Duration(node.KeepFiringFor),
			Labels:        maps.Clone(node.Labels),
			Annotations:   maps.Clone(node.Annotations),
		}
	}
	return rules
}

func groupInterval(value model.Duration) time.Duration {
	if value == 0 {
		return defaultInterval
	}
	return time.Duration(value)
}

func groupOffset(value *model.Duration) time.Duration {
	if value == nil {
		return 0
	}
	return time.Duration(*value)
}

type duplicateKey struct {
	metric string
	labels string
}

func duplicateWarnings(rules []Rule) []string {
	if len(rules) < 2 {
		return nil
	}
	seen := make(map[duplicateKey]struct{}, len(rules))
	var warnings []string
	for _, rule := range rules {
		key := duplicateKey{metric: ruleMetric(rule), labels: labelKey(rule.Labels)}
		if _, ok := seen[key]; !ok {
			seen[key] = struct{}{}
			continue
		}
		warning := "duplicate rule(s) found.\nMetric: " + key.metric
		if !slices.Contains(warnings, warning) {
			warnings = append(warnings, warning)
		}
	}
	return warnings
}

func ruleMetric(rule Rule) string {
	if rule.Alert != "" {
		return rule.Alert
	}
	return rule.Record
}

func labelKey(labels map[string]string) string {
	if len(labels) == 0 {
		return ""
	}
	keys := slices.Sorted(maps.Keys(labels))
	var builder strings.Builder
	for _, key := range keys {
		builder.WriteString(key)
		builder.WriteByte(0)
		builder.WriteString(labels[key])
		builder.WriteByte(0)
	}
	return builder.String()
}

func yamlDocumentCount(content []byte) (int, error) {
	decoder := yaml.NewDecoder(bytes.NewReader(content))
	count := 0
	for {
		var node yaml.Node
		err := decoder.Decode(&node)
		if errors.Is(err, io.EOF) {
			return count, nil
		}
		if err != nil {
			return 0, err
		}
		count++
	}
}

func readRuleEntries(ctx context.Context, path string) ([]os.DirEntry, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	directory, err := os.Open(path) //nolint:gosec // Administrator-selected rules path, scanned with an entry bound.
	if err != nil {
		return nil, err
	}
	entries, readErr := directory.ReadDir(maxRuleFiles + 1)
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		_ = directory.Close()
		return nil, readErr
	}
	if closeErr := directory.Close(); closeErr != nil {
		return nil, closeErr
	}
	if len(entries) > maxRuleFiles {
		return nil, fmt.Errorf("rules.path contains more than %d entries", maxRuleFiles)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return entries, nil
}

func readBounded(ctx context.Context, path string, limit int64) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	file, err := os.Open(path) //nolint:gosec // Administrator-selected rule file; the read is bounded.
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }()
	content, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(content)) > limit {
		return nil, fmt.Errorf("file exceeds %d bytes", limit)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return content, nil
}

func cloneSet(in Set) Set {
	out := Set{
		Groups:   slices.Clone(in.Groups),
		Warnings: slices.Clone(in.Warnings),
	}
	for i := range out.Groups {
		out.Groups[i].Rules = slices.Clone(in.Groups[i].Rules)
		for j := range out.Groups[i].Rules {
			out.Groups[i].Rules[j].Labels = maps.Clone(in.Groups[i].Rules[j].Labels)
			out.Groups[i].Rules[j].Annotations = maps.Clone(in.Groups[i].Rules[j].Annotations)
		}
	}
	return out
}
