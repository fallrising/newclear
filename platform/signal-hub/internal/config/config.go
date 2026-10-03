// Package config loads the M1 executable subset of the M0 configuration.
// Input is strict JSON (also a YAML 1.2 subset). YAML syntax and nonempty rules
// or subscriptions are deliberately rejected until their runtime milestones.
package config

import (
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"regexp"
	"strings"

	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
)

type Source struct {
	Name             string   `json:"name"`
	SourcePrefix     string   `json:"source_prefix"`
	AllowedTypes     []string `json:"allowed_types"`
	TokenRef         string   `json:"token_ref"`
	ExpectedInterval string   `json:"expected_interval,omitempty"`
	RetentionDays    int      `json:"retention_days,omitempty"`
}

type Config struct {
	Sources          []Source          `json:"sources"`
	Rules            []json.RawMessage `json:"rules"`
	Subscriptions    []json.RawMessage `json:"subscriptions"`
	WebhookAllowlist []string          `json:"webhook_allowlist"`
}

var namePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)
var typePattern = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+(\.\*)?$`)
var intervalPattern = regexp.MustCompile(`^[1-9][0-9]*(s|m|h|d)$`)
var tokenRefPattern = regexp.MustCompile(`^file:/[^\s]+$`)
var webhookPattern = regexp.MustCompile(`^https://[^/?#@]+(/[^#]*)?$`)

func ValidTokenRef(s string) bool { return tokenRefPattern.MatchString(s) }

func Load(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("cannot read configuration: %w", err)
	}
	return Parse(b)
}

func Parse(raw []byte) (*Config, error) {
	v, err := event.Decode(raw)
	if err != nil {
		return nil, fmt.Errorf("configuration must be strict JSON (M1 YAML subset): %w", err)
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("configuration must be an object")
	}
	for k := range m {
		switch k {
		case "sources", "rules", "subscriptions", "webhook_allowlist":
		default:
			return nil, fmt.Errorf("unknown configuration field")
		}
	}
	arrays := map[string][]any{}
	for _, k := range []string{"sources", "rules", "subscriptions", "webhook_allowlist"} {
		a, ok := m[k].([]any)
		if !ok {
			return nil, fmt.Errorf("configuration %s must be an array", k)
		}
		arrays[k] = a
	}
	if len(arrays["rules"]) != 0 || len(arrays["subscriptions"]) != 0 {
		return nil, fmt.Errorf("M1 does not execute rules or subscriptions; both arrays must be empty")
	}
	c := &Config{Sources: []Source{}, Rules: []json.RawMessage{}, Subscriptions: []json.RawMessage{}, WebhookAllowlist: []string{}}
	seen := map[string]bool{}
	for _, entry := range arrays["sources"] {
		row, ok := entry.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("source must be an object")
		}
		s, err := parseSource(row)
		if err != nil {
			return nil, err
		}
		if seen[s.Name] {
			return nil, fmt.Errorf("duplicate source name")
		}
		seen[s.Name] = true
		c.Sources = append(c.Sources, s)
	}
	seen = map[string]bool{}
	for _, entry := range arrays["webhook_allowlist"] {
		s, ok := entry.(string)
		if !ok || !webhookPattern.MatchString(s) || !event.ValidURI(s, true) {
			return nil, fmt.Errorf("invalid webhook allowlist URL")
		}
		if seen[s] {
			return nil, fmt.Errorf("duplicate webhook allowlist URL")
		}
		seen[s] = true
		c.WebhookAllowlist = append(c.WebhookAllowlist, s)
	}
	return c, nil
}

func parseSource(m map[string]any) (Source, error) {
	var s Source
	for k := range m {
		switch k {
		case "name", "source_prefix", "allowed_types", "expected_interval", "retention_days", "token_ref":
		default:
			return s, fmt.Errorf("unknown source field")
		}
	}
	for _, k := range []string{"name", "source_prefix", "token_ref"} {
		if _, ok := m[k].(string); !ok {
			return s, fmt.Errorf("source %s must be a string", k)
		}
	}
	s.Name = m["name"].(string)
	s.SourcePrefix = m["source_prefix"].(string)
	s.TokenRef = m["token_ref"].(string)
	if !namePattern.MatchString(s.Name) {
		return s, fmt.Errorf("invalid source name")
	}
	if !event.ValidURI(s.SourcePrefix, false) {
		return s, fmt.Errorf("invalid source prefix")
	}
	if !ValidTokenRef(s.TokenRef) {
		return s, fmt.Errorf("invalid source token reference")
	}
	types, ok := m["allowed_types"].([]any)
	if !ok || len(types) == 0 {
		return s, fmt.Errorf("allowed_types must be a nonempty array")
	}
	seen := map[string]bool{}
	for _, v := range types {
		p, ok := v.(string)
		if !ok || !typePattern.MatchString(p) {
			return s, fmt.Errorf("invalid allowed type pattern")
		}
		if seen[p] {
			return s, fmt.Errorf("duplicate allowed type")
		}
		seen[p] = true
		prefix := strings.TrimSuffix(p, "*")
		if strings.HasPrefix(prefix, "signalhub.") || (strings.HasSuffix(p, "*") && strings.HasPrefix("signalhub.", prefix)) {
			return s, fmt.Errorf("source allows reserved event types")
		}
		s.AllowedTypes = append(s.AllowedTypes, p)
	}
	if v, exists := m["expected_interval"]; exists {
		str, ok := v.(string)
		if !ok || !intervalPattern.MatchString(str) {
			return s, fmt.Errorf("invalid expected interval")
		}
		s.ExpectedInterval = str
	}
	if v, exists := m["retention_days"]; exists {
		n, ok := v.(json.Number)
		if !ok {
			return s, fmt.Errorf("invalid retention days")
		}
		r, ok := new(big.Rat).SetString(string(n))
		if !ok || !r.IsInt() || !r.Num().IsInt64() || r.Num().Sign() < 1 {
			return s, fmt.Errorf("retention days must be a positive integer")
		}
		i := r.Num().Int64()
		if int64(int(i)) != i {
			return s, fmt.Errorf("retention days is too large")
		}
		s.RetentionDays = int(i)
	}
	return s, nil
}
