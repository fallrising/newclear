package contract

import (
	"crypto/ed25519"
	"encoding/base64"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"time"
)

var (
	hex64       = regexp.MustCompile(`^[0-9a-f]{64}$`)
	b64urlNonce = regexp.MustCompile(`^[A-Za-z0-9_-]{22,64}$`)
	utcSeconds  = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$`)
	signature64 = regexp.MustCompile(`^[A-Za-z0-9_-]{86}$`)
	agentVer    = regexp.MustCompile(`^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,6}(-[0-9A-Za-z.-]{1,32})?$`)
)

func idPattern(prefix string) *regexp.Regexp {
	return regexp.MustCompile(`^` + prefix + `_[a-z0-9][a-z0-9_-]{0,62}$`)
}

// checkShape verifies schema_version, then unknown keys, then missing keys — the TS order.
func checkShape(doc any, family string, supportedMajor int, fields []string) (map[string]any, error) {
	obj, ok := doc.(map[string]any)
	if !ok {
		return nil, errf("invalid_document", "$", "document must be a JSON object")
	}
	version, present := obj["schema_version"]
	if !present {
		return nil, errf("missing_field", "schema_version", "required")
	}
	re := regexp.MustCompile(`^` + regexp.QuoteMeta(family) + `\.v([1-9][0-9]{0,3})$`)
	vs, _ := version.(string)
	m := re.FindStringSubmatch(vs)
	if m == nil {
		return nil, errf("invalid_field", "schema_version", "must be %s.v%d", family, supportedMajor)
	}
	if major, _ := strconv.Atoi(m[1]); major != supportedMajor {
		return nil, errf("unsupported_version", "schema_version", "unsupported major %s", m[1])
	}
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !slices.Contains(fields, k) {
			return nil, errf("unknown_field", k, "field is not part of the contract")
		}
	}
	for _, f := range fields {
		if _, ok := obj[f]; !ok {
			return nil, errf("missing_field", f, "required")
		}
	}
	return obj, nil
}

func str(doc map[string]any, field string, re *regexp.Regexp) (string, error) {
	v, ok := doc[field].(string)
	if !ok || !re.MatchString(v) {
		return "", errf("invalid_field", field, "must match %s", re.String())
	}
	return v, nil
}

func intField(doc map[string]any, field string, min, max int64) (int64, error) {
	v, ok := doc[field].(int64)
	if !ok || v < min || v > max {
		return 0, errf("invalid_field", field, "must be an integer in [%d, %d]", min, max)
	}
	return v, nil
}

func oneOf(doc map[string]any, field string, values ...string) (string, error) {
	v, ok := doc[field].(string)
	if !ok || !slices.Contains(values, v) {
		return "", errf("invalid_field", field, "must be one of %v", values)
	}
	return v, nil
}

// ParseUTCSeconds parses YYYY-MM-DDTHH:MM:SSZ into Unix seconds; ok is false for impossible values.
func ParseUTCSeconds(v string) (int64, bool) {
	m := utcSeconds.FindStringSubmatch(v)
	if m == nil {
		return 0, false
	}
	n := make([]int, 6)
	for i := range n {
		n[i], _ = strconv.Atoi(m[i+1])
	}
	y, mo, d, h, mi, s := n[0], n[1], n[2], n[3], n[4], n[5]
	if y < 2000 || mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59 {
		return 0, false
	}
	t := time.Date(y, time.Month(mo), d, h, mi, s, 0, time.UTC)
	if t.Year() != y || int(t.Month()) != mo || t.Day() != d {
		return 0, false
	}
	return t.Unix(), true
}

func timeField(doc map[string]any, field string) (int64, error) {
	s, _ := doc[field].(string)
	t, ok := ParseUTCSeconds(s)
	if !ok {
		return 0, errf("invalid_field", field, "must be UTC RFC 3339 YYYY-MM-DDTHH:MM:SSZ")
	}
	return t, nil
}

// decodeB64URL is strict unpadded base64url (no padding, canonical trailing bits).
func decodeB64URL(s string) ([]byte, bool) {
	b, err := base64.RawURLEncoding.Strict().DecodeString(s)
	return b, err == nil
}

func ed25519Verify(pub, sig, msg []byte) bool {
	if len(pub) != ed25519.PublicKeySize || len(sig) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(ed25519.PublicKey(pub), msg, sig)
}
