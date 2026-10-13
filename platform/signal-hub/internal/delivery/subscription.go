// Package delivery validates subscriptions and builds secure outbound messages.
// It does not own configuration activation or durable queue state.
package delivery

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/netip"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/event"
	"github.com/fallrising/newclear/platform/signal-hub/internal/rules"
)

type Subscription struct {
	ID      string       `json:"id"`
	Filter  rules.Filter `json:"filter"`
	Channel Channel      `json:"channel"`
	Mode    string       `json:"mode"`
	Start   string       `json:"start"`
	Digest  *Digest      `json:"digest,omitempty"`
}
type Channel struct {
	Kind      string `json:"kind"`
	URL       string `json:"url,omitempty"`
	SecretRef string `json:"secret_ref,omitempty"`
	TokenRef  string `json:"token_ref,omitempty"`
}
type Digest struct {
	Every     string `json:"every"`
	At        string `json:"at"`
	Timezone  string `json:"timezone"`
	SkipEmpty bool   `json:"skip_empty"`
}

var identifier = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)
var typePattern = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+(\.\*)?$`)
var sourcePattern = regexp.MustCompile(`^[^*]+\*?$`)
var dataPath = regexp.MustCompile(`^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+){0,2}$`)
var fileRef = regexp.MustCompile(`^file:/[^\s]+$`)
var digestAt = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)
var httpsPattern = regexp.MustCompile(`^https://[^/?#@]+(/[^#]*)?$`)

// ValidURL enforces the HTTPS URI subset accepted by the subscription contract.
func ValidURL(raw string) bool {
	if !httpsPattern.MatchString(raw) || !event.ValidURI(raw, true) {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.Opaque != "" {
		return false
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil && ip.Is4In6() {
		return false
	}
	// A zone identifier is neither portable DNS nor a permitted tailnet literal.
	return !strings.Contains(u.Hostname(), "%")
}

// Parse validates the whole set without reading credentials or resolving DNS.
// Errors intentionally omit endpoint, path, and supplied JSON values.
func Parse(raw []json.RawMessage, allowlist []string) ([]Subscription, error) {
	allowed := make(map[string]bool, len(allowlist))
	for _, value := range allowlist {
		if !ValidURL(value) || allowed[value] {
			return nil, errors.New("invalid delivery allowlist")
		}
		allowed[value] = true
	}
	out := make([]Subscription, 0, len(raw))
	seen := map[string]bool{}
	for _, item := range raw {
		value, err := event.Decode(item)
		if err != nil {
			return nil, errors.New("invalid subscription JSON")
		}
		obj, ok := value.(map[string]any)
		if !ok || !hasMembers(obj, "id", "filter", "channel", "mode") {
			return nil, errors.New("missing subscription fields")
		}
		for _, value := range obj {
			if value == nil {
				return nil, errors.New("null subscription field")
			}
		}
		filter, ok := obj["filter"].(map[string]any)
		if !ok {
			return nil, errors.New("invalid subscription filter")
		}
		channel, ok := obj["channel"].(map[string]any)
		if !ok || !hasMembers(channel, "kind", "url") {
			return nil, errors.New("invalid delivery channel")
		}
		for _, value := range channel {
			if value == nil {
				return nil, errors.New("null channel field")
			}
		}
		for _, value := range filter {
			if value == nil {
				return nil, errors.New("null filter field")
			}
		}
		var sub Subscription
		decoder := json.NewDecoder(bytes.NewReader(item))
		decoder.DisallowUnknownFields()
		decoder.UseNumber()
		if err = decoder.Decode(&sub); err != nil {
			return nil, errors.New("invalid subscription fields")
		}
		if !identifier.MatchString(sub.ID) || seen[sub.ID] {
			return nil, errors.New("invalid or duplicate subscription id")
		}
		seen[sub.ID] = true
		if sub.Start == "" {
			if _, exists := obj["start"]; exists {
				return nil, errors.New("invalid subscription start")
			}
			sub.Start = "now"
		}
		if !slices.Contains([]string{"now", "earliest_hot"}, sub.Start) || !slices.Contains([]string{"immediate", "digest"}, sub.Mode) {
			return nil, errors.New("invalid subscription mode or start")
		}
		if !ValidURL(sub.Channel.URL) || !allowed[sub.Channel.URL] {
			return nil, errors.New("delivery URL is not exactly allowlisted")
		}
		switch sub.Channel.Kind {
		case "webhook":
			_, extra := channel["token_ref"]
			if !fileRef.MatchString(sub.Channel.SecretRef) || extra || sub.Mode != "immediate" {
				return nil, errors.New("invalid webhook channel")
			}
		case "ntfy":
			_, extra := channel["secret_ref"]
			if !fileRef.MatchString(sub.Channel.TokenRef) || extra {
				return nil, errors.New("invalid ntfy channel")
			}
		default:
			return nil, errors.New("invalid delivery channel kind")
		}
		if sub.Mode == "digest" {
			digest, ok := obj["digest"].(map[string]any)
			if !ok || !hasMembers(digest, "every", "at", "timezone", "skip_empty") || sub.Digest == nil {
				return nil, errors.New("missing digest fields")
			}
			if sub.Digest.Every != "24h" || !digestAt.MatchString(sub.Digest.At) || sub.Digest.Timezone == "" || sub.Digest.Timezone == "Local" {
				return nil, errors.New("invalid digest schedule")
			}
			if _, err := time.LoadLocation(sub.Digest.Timezone); err != nil {
				return nil, errors.New("invalid digest timezone")
			}
		} else if _, exists := obj["digest"]; exists {
			return nil, errors.New("immediate delivery forbids digest")
		}
		if err := validateFilter(sub.Filter, filter); err != nil {
			return nil, err
		}
		mayDLQ := len(sub.Filter.Types) == 0
		for _, pattern := range sub.Filter.Types {
			if pattern == "signalhub.delivery.dlq" || strings.HasSuffix(pattern, ".*") && strings.HasPrefix("signalhub.delivery.dlq", strings.TrimSuffix(pattern, "*")) {
				mayDLQ = true
			}
		}
		if mayDLQ && strings.HasPrefix(sub.ID, sub.Filter.SubjectPrefix) {
			return nil, errors.New("subscription can consume its own delivery failure")
		}
		out = append(out, sub)
	}
	return out, nil
}
func hasMembers(obj map[string]any, names ...string) bool {
	for _, name := range names {
		if obj[name] == nil {
			return false
		}
	}
	return true
}
func validateFilter(filter rules.Filter, raw map[string]any) error {
	for _, field := range []struct {
		name    string
		values  []string
		pattern *regexp.Regexp
	}{{"types", filter.Types, typePattern}, {"sources", filter.Sources, sourcePattern}} {
		if _, exists := raw[field.name]; exists && len(field.values) == 0 {
			return errors.New("empty subscription filter list")
		}
		seen := map[string]bool{}
		for _, value := range field.values {
			if !field.pattern.MatchString(value) || seen[value] {
				return errors.New("invalid subscription filter pattern")
			}
			seen[value] = true
		}
	}
	if _, exists := raw["severity_min"]; exists && event.SeverityRank(filter.SeverityMin) < 0 {
		return errors.New("invalid filter severity")
	}
	for key, value := range filter.Data {
		if !dataPath.MatchString(key) {
			return errors.New("invalid filter data path")
		}
		switch value.(type) {
		case nil, string, bool, json.Number:
		default:
			return errors.New("filter data requires scalar values")
		}
	}
	return nil
}

// Safe removes outbound endpoints and credential references before persistence.
func Safe(sub Subscription) Subscription {
	sub.Channel.URL = ""
	sub.Channel.SecretRef = ""
	sub.Channel.TokenRef = ""
	return sub
}
func Match(sub Subscription, e *event.Event) bool {
	return e != nil && (rules.Rule{Filter: sub.Filter}).Matches(e.Fields)
}
