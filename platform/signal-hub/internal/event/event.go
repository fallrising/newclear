// Package event validates the Signal Hub CloudEvents profile and produces JCS
// bytes for content identity. It performs no authorization or persistence.
package event

import (
	"crypto/sha256"
	"encoding/json"
	"net/netip"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cyberphone/json-canonicalization/go/src/webpki.org/jsoncanonicalizer"
)

const MaxDataBytes = 16384

type Event struct {
	Raw         []byte
	Canonical   []byte
	ContentHash [32]byte
	Fields      map[string]any
	Time        time.Time
}

type Error struct {
	Status        int
	Code, Message string
}

func (e *Error) Error() string { return e.Message }
func failure(status int, code, message string) *Error {
	return &Error{Status: status, Code: code, Message: message}
}

var attrName = regexp.MustCompile(`^[a-z0-9]+$`)
var eventType = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$`)
var dateTime = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([Zz]|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$`)
var cause = regexp.MustCompile(`^([^#%]|%25|%23)+#([^#%]|%25|%23)+$`)
var uriCharacters = regexp.MustCompile(`^[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*$`)
var scheme = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+.-]*$`)
var pathChars = regexp.MustCompile(`^[A-Za-z0-9._~:@!$&'()*+,;=%/-]*$`)
var queryChars = regexp.MustCompile(`^[A-Za-z0-9._~:@!$&'()*+,;=%/?-]*$`)
var userInfoChars = regexp.MustCompile(`^[A-Za-z0-9._~:!$&'()*+,;=%-]*$`)
var hostChars = regexp.MustCompile(`^[A-Za-z0-9._~!$&'()*+,;=%-]*$`)
var ipvFuture = regexp.MustCompile(`^[vV][0-9A-Fa-f]+\.[A-Za-z0-9._~:!$&'()*+,;=-]+$`)

// ValidURI implements the ASCII URI / URI-reference formats used by the M0
// profile. absolute requires a scheme; reference accepts relative references.
func ValidURI(s string, absolute bool) bool {
	if s == "" || !uriCharacters.MatchString(s) {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] == '%' {
			if i+2 >= len(s) {
				return false
			}
			if _, err := strconv.ParseUint(s[i+1:i+3], 16, 8); err != nil {
				return false
			}
			i += 2
		}
	}
	// Validate RFC 3986 components directly. HTTP URL parsers impose extra
	// restrictions on registered hostnames and IPvFuture literals.
	parts := strings.Split(s, "#")
	if len(parts) > 2 || len(parts) == 2 && !queryChars.MatchString(parts[1]) {
		return false
	}
	rest := parts[0]
	if i := strings.IndexByte(rest, '?'); i >= 0 {
		if !queryChars.MatchString(rest[i+1:]) {
			return false
		}
		rest = rest[:i]
	}
	hasScheme := false
	if colon := strings.IndexByte(rest, ':'); colon >= 0 {
		slash := strings.IndexByte(rest, '/')
		if slash < 0 || colon < slash {
			if !scheme.MatchString(rest[:colon]) {
				return false
			}
			hasScheme = true
			rest = rest[colon+1:]
		}
	}
	if strings.HasPrefix(rest, "//") {
		authority := strings.TrimPrefix(rest, "//")
		rest = ""
		if i := strings.IndexByte(authority, '/'); i >= 0 {
			rest = authority[i:]
			authority = authority[:i]
		}
		if at := strings.LastIndexByte(authority, '@'); at >= 0 {
			if !userInfoChars.MatchString(authority[:at]) {
				return false
			}
			authority = authority[at+1:]
		}
		if strings.HasPrefix(authority, "[") {
			end := strings.IndexByte(authority, ']')
			if end < 0 {
				return false
			}
			literal := authority[1:end]
			if ip, err := netip.ParseAddr(literal); (err != nil || !ip.Is6() || ip.Zone() != "") && !ipvFuture.MatchString(literal) {
				return false
			}
			authority = authority[end+1:]
			if authority != "" && !validPort(authority) {
				return false
			}
		} else {
			if colon := strings.LastIndexByte(authority, ':'); colon >= 0 {
				if !validPort(authority[colon:]) {
					return false
				}
				authority = authority[:colon]
			}
			if !hostChars.MatchString(authority) {
				return false
			}
		}
	}
	if !pathChars.MatchString(rest) {
		return false
	}
	return !absolute || hasScheme
}

func validPort(s string) bool {
	if !strings.HasPrefix(s, ":") {
		return false
	}
	for _, c := range s[1:] {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// ParseTime accepts the RFC 3339 date-time form, including lowercase t/z.
func ParseTime(s string) (time.Time, error) {
	if !dateTime.MatchString(s) || strings.HasPrefix(s, "0000-") {
		return time.Time{}, failure(400, "invalid_event", "time must be RFC 3339")
	}
	t, err := time.Parse(time.RFC3339Nano, strings.ToUpper(s))
	if err != nil {
		return time.Time{}, failure(400, "invalid_event", "time must be RFC 3339")
	}
	return t, nil
}

func Parse(raw []byte) (*Event, error) {
	value, err := Decode(raw)
	if err != nil {
		return nil, err
	}
	fields, ok := value.(map[string]any)
	if !ok {
		return nil, failure(400, "invalid_event", "event must be an object")
	}
	bad := func(message string) (*Event, error) { return nil, failure(400, "invalid_event", message) }
	for _, k := range []string{"specversion", "id", "source", "type", "time"} {
		if _, ok := fields[k].(string); !ok {
			return bad(k + " must be a string")
		}
	}
	if fields["specversion"] != "1.0" {
		return bad("specversion must be 1.0")
	}
	id := fields["id"].(string)
	if utf8.RuneCountInString(id) < 1 || utf8.RuneCountInString(id) > 128 {
		return bad("id length must be 1–128")
	}
	if !ValidURI(fields["source"].(string), false) {
		return bad("source must be a URI-reference")
	}
	if !eventType.MatchString(fields["type"].(string)) {
		return bad("invalid event type")
	}
	timestamp, err := ParseTime(fields["time"].(string))
	if err != nil {
		return nil, err
	}
	for k, v := range fields {
		if !attrName.MatchString(k) {
			return bad("invalid attribute name")
		}
		switch k {
		case "seq", "receivedat", "clockskew", "restored":
			return bad("hub metadata is reserved")
		case "specversion", "id", "source", "type", "time":
			continue
		case "data":
			if _, ok := v.(map[string]any); !ok {
				return bad("data must be an object")
			}
		case "subject", "datacontenttype", "dataschema", "severity", "summary", "originurl", "correlationid", "causationid":
			if v == nil {
				continue
			}
			s, ok := v.(string)
			if !ok {
				return bad(k + " must be a string or null")
			}
			switch k {
			case "datacontenttype":
				if s != "application/json" {
					return bad("unsupported datacontenttype")
				}
			case "dataschema", "originurl":
				if !ValidURI(s, true) {
					return bad(k + " must be a URI")
				}
			case "severity":
				if SeverityRank(s) < 0 {
					return bad("invalid severity")
				}
			case "summary":
				if utf8.RuneCountInString(s) > 280 || strings.ContainsAny(s, "\r\n") {
					return bad("summary must be one line of at most 280 characters")
				}
			case "correlationid":
				if utf8.RuneCountInString(s) > 128 {
					return bad("correlationid exceeds 128 characters")
				}
			case "causationid":
				if utf8.RuneCountInString(s) > 256 || !cause.MatchString(s) {
					return bad("invalid causationid")
				}
			}
		default:
			switch n := v.(type) {
			case nil, string, bool:
			case json.Number:
				if strings.ContainsAny(string(n), ".eE") {
					return bad("extension numbers must use an integer representation")
				}
				integer, err := strconv.ParseInt(string(n), 10, 32)
				if err != nil || integer < -2147483648 || integer > 2147483647 {
					return bad("extension integer exceeds signed 32-bit range")
				}
			default:
				return bad("extension must be string, boolean, signed 32-bit integer or null")
			}
		}
	}
	if data, ok := fields["data"]; ok {
		b, err := canonical(data)
		if err != nil {
			return bad("data cannot be canonicalized")
		}
		if len(b) > MaxDataBytes {
			return nil, failure(413, "payload_too_large", "data exceeds 16384 canonical UTF-8 bytes")
		}
	}
	normalized := make(map[string]any, len(fields))
	for k, v := range fields {
		if v != nil {
			normalized[k] = v
		}
	}
	b, err := canonical(normalized)
	if err != nil {
		return bad("event cannot be canonicalized")
	}
	return &Event{Raw: append([]byte(nil), raw...), Canonical: b, ContentHash: sha256.Sum256(b), Fields: fields, Time: timestamp}, nil
}

func canonical(v any) ([]byte, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return jsoncanonicalizer.Transform(b)
}

func SeverityRank(s string) int {
	switch s {
	case "debug":
		return 0
	case "info":
		return 1
	case "notice":
		return 2
	case "warning":
		return 3
	case "error":
		return 4
	case "critical":
		return 5
	}
	return -1
}
