package event

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

const base = `{"specversion":"1.0","id":"a","source":"urn:example:release","type":"release.deploy.succeeded","time":"2026-10-03T10:00:00Z"}`

func withField(field string) []byte { return []byte(strings.TrimSuffix(base, "}") + "," + field + "}") }

func TestCanonicalM0Vectors(t *testing.T) {
	raw, err := os.ReadFile("../../contracts/canonical-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors []struct{ Name, Input, Canonical, SHA256 string }
	if err = json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, v := range vectors {
		t.Run(v.Name, func(t *testing.T) {
			e, err := Parse([]byte(v.Input))
			if err != nil {
				t.Fatal(err)
			}
			if string(e.Canonical) != v.Canonical || hex.EncodeToString(e.ContentHash[:]) != v.SHA256 {
				t.Fatalf("JCS mismatch: %s", e.Canonical)
			}
			if string(e.Raw) != v.Input {
				t.Fatal("raw event changed")
			}
		})
	}
}

func TestEventM0Fixtures(t *testing.T) {
	raw, err := os.ReadFile("../../contracts/fixtures.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name, Schema string
		Valid        bool
		Instance     json.RawMessage
	}
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		if c.Schema != "event" {
			continue
		}
		t.Run(c.Name, func(t *testing.T) {
			_, err := Parse(c.Instance)
			if (err == nil) != c.Valid {
				t.Fatalf("valid=%v error=%v", c.Valid, err)
			}
		})
	}
}

func TestStrictJSON(t *testing.T) {
	bad := []string{`{"x":1,"x":2}`, `{"x":{"a":1,"\u0061":2}}`, `{"x":"\ud800"}`, `{"x":"\udfff"}`, `{"\ud800":0}`, `{"x":"\ud800\u0041"}`, `{"x":NaN}`, `{"x":Infinity}`, `{"x":9007199254740992}`, `{"x":-9007199254740992}`, `{"x":1e400}`, `{} {}`, `{"x":"` + string([]byte{0xff}) + `"}`, strings.Repeat("[", 66) + "0" + strings.Repeat("]", 66)}
	for _, raw := range bad {
		if _, err := Decode([]byte(raw)); err == nil {
			t.Errorf("accepted malformed JSON: %q", raw)
		}
	}
	for _, raw := range []string{`{"x":"\ud83d\ude00"}`, `{"x":"\\ud800"}`, `{"x":9007199254740991}`, `{"x":-9007199254740991}`, `{"x":-0.0}`, `{"x":1e-7}`} {
		if _, err := Decode([]byte(raw)); err != nil {
			t.Errorf("rejected valid JSON %q: %v", raw, err)
		}
	}
	value, err := Decode([]byte(`{"n":1.0}`))
	if err != nil {
		t.Fatal(err)
	}
	if value.(map[string]any)["n"] != json.Number("1.0") {
		t.Fatal("numeric representation lost")
	}
}

func TestOptionalNullNormalization(t *testing.T) {
	original, err := Parse([]byte(base))
	if err != nil {
		t.Fatal(err)
	}
	null, err := Parse(withField(`"subject":null,"custom":null`))
	if err != nil {
		t.Fatal(err)
	}
	if original.ContentHash != null.ContentHash {
		t.Fatal("null attributes changed identity")
	}
	if _, ok := null.Fields["subject"]; !ok {
		t.Fatal("raw optional null was removed")
	}
	explicit, err := Parse(withField(`"severity":"info"`))
	if err != nil {
		t.Fatal(err)
	}
	if explicit.ContentHash == original.ContentHash {
		t.Fatal("default severity was incorrectly synthesized")
	}
	for _, field := range []string{`"data":null`, `"seq":null`, `"receivedat":null`, `"clockskew":null`, `"restored":null`, `"attempt":1.0`, `"attempt":1e0`} {
		if _, err := Parse(withField(field)); err == nil {
			t.Errorf("accepted %s", field)
		}
	}
}

func TestDataSizeUsesCanonicalUTF8(t *testing.T) {
	// {"x":""} costs eight bytes; each non-ASCII letter costs two UTF-8 bytes.
	for _, tc := range []struct {
		n      int
		status int
	}{{8188, 0}, {8189, 413}} {
		raw := withField(`"data":{"x":"` + strings.Repeat("é", tc.n) + `"}`)
		e, err := Parse(raw)
		if tc.status == 0 {
			if err != nil {
				t.Fatal(err)
			}
			if e.ContentHash != sha256.Sum256(e.Canonical) {
				t.Fatal("hash mismatch")
			}
		} else if got, ok := err.(*Error); !ok || got.Status != tc.status || got.Code != "payload_too_large" {
			t.Fatalf("expected 413, got %v", err)
		}
	}
	raw := withField(`"data":{"x":"` + strings.Repeat(`\u0061`, 16376) + `"}`)
	if _, err := Parse(raw); err != nil {
		t.Fatalf("wire representation incorrectly used for size: %v", err)
	}
}

func TestFormatAndTypes(t *testing.T) {
	for _, field := range []string{`"summary":"first\nsecond"`, `"originurl":"relative/path"`, `"dataschema":"https://a.example.invalid/%xx"`, `"attempt":2147483648`, `"data_base64":"a"`, `"causationid":"a#b#c"`} {
		if _, err := Parse(withField(field)); err == nil {
			t.Errorf("accepted invalid field %s", field)
		}
	}
	for _, uri := range []string{"urn:example:a", "https://example.invalid/path?q=a#b", "/relative/path", "../relative"} {
		if !ValidURI(uri, false) {
			t.Errorf("rejected URI reference %q", uri)
		}
	}
	for _, uri := range []string{"https://example.invalid/has space", "https://example.invalid/%aa%", "bad%xx", "https://例.example.invalid"} {
		if ValidURI(uri, false) {
			t.Errorf("accepted invalid URI %q", uri)
		}
	}
	for _, timestamp := range []string{"2026-10-03t10:00:00z", "2026-10-03T10:00:00.123456789Z"} {
		if _, err := ParseTime(timestamp); err != nil {
			t.Fatal(err)
		}
	}
	for _, timestamp := range []string{"2026-10-03T10:00:00+24:00", "2026-10-03T10:00:60Z", "2026-10-03T10:00:00,1Z"} {
		if _, err := ParseTime(timestamp); err == nil {
			t.Errorf("accepted invalid time %s", timestamp)
		}
	}
}

func TestJSONNestingBoundary(t *testing.T) {
	for _, depth := range []int{64, 65} {
		for _, leaf := range []string{"", "0"} {
			raw := strings.Repeat("[", depth) + leaf + strings.Repeat("]", depth)
			_, err := Decode([]byte(raw))
			if depth == 64 && err != nil {
				t.Errorf("64 arrays with leaf %q: %v", leaf, err)
			}
			if depth == 65 {
				e, ok := err.(*Error)
				if !ok || e.Status != 400 || e.Code != "invalid_json" {
					t.Errorf("65 arrays with leaf %q: expected invalid_json, got %v", leaf, err)
				}
			}
		}
		for _, scalar := range []bool{false, true} {
			raw := strings.Repeat(`{"x":`, depth-1) + `{}` + strings.Repeat("}", depth-1)
			if scalar {
				raw = strings.Repeat(`{"x":`, depth) + "0" + strings.Repeat("}", depth)
			}
			_, err := Decode([]byte(raw))
			if depth == 64 && err != nil {
				t.Errorf("64 objects (scalar=%v): %v", scalar, err)
			}
			if depth == 65 {
				e, ok := err.(*Error)
				if !ok || e.Status != 400 || e.Code != "invalid_json" {
					t.Errorf("65 objects (scalar=%v): expected invalid_json, got %v", scalar, err)
				}
			}
		}
	}
}

func TestTimePreservesArbitraryFractionInEvent(t *testing.T) {
	timestamp := "2026-10-03T10:00:00.1234567890123456789Z"
	raw := strings.Replace(base, "2026-10-03T10:00:00Z", timestamp, 1)
	e, err := Parse([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if e.Fields["time"] != timestamp || !strings.Contains(string(e.Canonical), timestamp) {
		t.Fatal("event timestamp lost fractional precision")
	}
}

// These cases are also checked against the pinned M0 jsonschema.FormatChecker.
func TestM0FormatParity(t *testing.T) {
	raw, err := os.ReadFile("testdata/format-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Format, Value string
		Valid         bool
	}
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Format+"/"+c.Value, func(t *testing.T) {
			var valid bool
			switch c.Format {
			case "uri":
				valid = ValidURI(c.Value, true)
			case "uri-reference":
				valid = ValidURI(c.Value, false)
			case "date-time":
				_, err := ParseTime(c.Value)
				valid = err == nil
			default:
				t.Fatalf("unknown format %s", c.Format)
			}
			if valid != c.Valid {
				t.Fatalf("valid=%v, expected %v", valid, c.Valid)
			}
		})
	}
}

func TestEventURIAndYearFormatParity(t *testing.T) {
	for _, uri := range []string{"http://exa%6dple.invalid/x", "http://[v1.ab]/x"} {
		for _, field := range []string{"originurl", "dataschema"} {
			if _, err := Parse(withField(`"` + field + `":"` + uri + `"`)); err != nil {
				t.Errorf("%s %s: %v", field, uri, err)
			}
		}
	}
	raw := strings.Replace(base, "2026-10-03T10:00:00Z", "0000-01-01T00:00:00Z", 1)
	_, err := Parse([]byte(raw))
	e, ok := err.(*Error)
	if !ok || e.Status != 400 || e.Code != "invalid_event" {
		t.Fatalf("year zero expected invalid_event, got %v", err)
	}
}
