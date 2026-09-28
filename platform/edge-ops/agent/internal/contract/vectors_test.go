package contract

// AC-CON-01 (Go side): the same contracts/vectors files the TS tests use. For signed vectors
// Go also re-signs from the public test seed labels and requires byte-identical signatures,
// which proves the two implementations agree on the exact signed bytes.

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const seedPrefix = "edgeops-test-vector-seed:"

type expect struct {
	OK        bool    `json:"ok"`
	Code      string  `json:"code"`
	Field     *string `json:"field"`
	TokenHash string  `json:"token_hash"`
}

func load(t *testing.T, name string, into any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "vectors", name))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, into); err != nil {
		t.Fatal(err)
	}
}

func check(t *testing.T, name string, err error, want expect) {
	t.Helper()
	if want.OK {
		if err != nil {
			t.Errorf("%s: want ok, got %v", name, err)
		}
		return
	}
	var ce *Error
	if !errors.As(err, &ce) {
		t.Errorf("%s: want %s, got %v", name, want.Code, err)
		return
	}
	if ce.Code != want.Code {
		t.Errorf("%s: code = %s, want %s (%v)", name, ce.Code, want.Code, ce)
	}
	if want.Field != nil && ce.Field != *want.Field {
		t.Errorf("%s: field = %q, want %q", name, ce.Field, *want.Field)
	}
}

func seedKey(label string) ed25519.PrivateKey {
	s := sha256.Sum256([]byte(seedPrefix + label))
	return ed25519.NewKeyFromSeed(s[:])
}

func b64(s string) []byte {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return b
}

func utc(s string) int64 {
	t, ok := ParseUTCSeconds(s)
	if !ok {
		panic("bad time " + s)
	}
	return t
}

func TestStrictJSONVectors(t *testing.T) {
	var v struct {
		MaxBytes int `json:"max_bytes"`
		Cases    []struct {
			Name     string  `json:"name"`
			Input    *string `json:"input"`
			InputHex *string `json:"input_hex"`
			MaxBytes int     `json:"max_bytes"`
			Expect   expect  `json:"expect"`
		} `json:"cases"`
	}
	load(t, "strict-json.json", &v)
	for _, c := range v.Cases {
		var in []byte
		if c.InputHex != nil {
			in, _ = hex.DecodeString(*c.InputHex)
		} else {
			in = []byte(*c.Input)
		}
		max := v.MaxBytes
		if c.MaxBytes != 0 {
			max = c.MaxBytes
		}
		_, err := ParseStrictJSON(in, max)
		check(t, c.Name, err, c.Expect)
	}
}

func TestTelemetryVectors(t *testing.T) {
	var v struct {
		Base  json.RawMessage `json:"base"`
		Cases []struct {
			Name   string                     `json:"name"`
			Input  *string                    `json:"input"`
			Set    map[string]json.RawMessage `json:"set"`
			Delete []string                   `json:"delete"`
			Expect expect                     `json:"expect"`
		} `json:"cases"`
	}
	load(t, "telemetry.json", &v)
	for _, c := range v.Cases {
		body := []byte{}
		if c.Input != nil {
			body = []byte(*c.Input)
		} else {
			var doc map[string]any
			d := json.NewDecoder(bytes.NewReader(v.Base))
			d.UseNumber()
			if err := d.Decode(&doc); err != nil {
				t.Fatal(err)
			}
			walk := func(path string) (map[string]any, string) {
				parts := strings.Split(path, ".")
				o := doc
				for _, p := range parts[:len(parts)-1] {
					o = o[p].(map[string]any)
				}
				return o, parts[len(parts)-1]
			}
			for path, raw := range c.Set {
				o, k := walk(path)
				o[k] = raw
			}
			for _, path := range c.Delete {
				o, k := walk(path)
				delete(o, k)
			}
			var err error
			if body, err = json.Marshal(doc); err != nil {
				t.Fatal(err)
			}
		}
		_, err := ParseTelemetryReport(body)
		check(t, c.Name, err, c.Expect)
	}
}

func TestRunApprovalVectors(t *testing.T) {
	var v struct {
		TrustedKeys map[string]string `json:"trusted_keys"`
		Cases       []struct {
			Name     string `json:"name"`
			Manifest string `json:"manifest_text"`
			Approval string `json:"approval_text"`
			Signer   string `json:"signer_seed_label"`
			Variant  string `json:"signing_variant"`
			Binding  struct {
				NodeID     string `json:"node_id"`
				Generation int64  `json:"enrollment_generation"`
				Now        string `json:"now"`
			} `json:"binding"`
			Expect expect `json:"expect"`
		} `json:"cases"`
	}
	load(t, "run-approval.json", &v)
	trusted := map[string][]byte{}
	for id, k := range v.TrustedKeys {
		trusted[id] = b64(k)
	}
	if !bytes.Equal(trusted["key_owner_1"], seedKey("approval-owner-1").Public().(ed25519.PublicKey)) {
		t.Fatal("pinned test key does not match its seed label")
	}
	for _, c := range v.Cases {
		_, err := VerifyRunApproval([]byte(c.Manifest), []byte(c.Approval), trusted,
			RunBinding{NodeID: c.Binding.NodeID, EnrollmentGeneration: c.Binding.Generation, Now: utc(c.Binding.Now)})
		check(t, c.Name, err, c.Expect)

		// Independent Go signature over the digest the approval claims must equal the TS one.
		var a map[string]string
		if c.Variant != "standard" || json.Unmarshal([]byte(c.Approval), &a) != nil || a["signature"] == "" || len(a["signature"]) != 86 {
			continue
		}
		digest, _ := hex.DecodeString(a["manifest_sha256"])
		msg := append([]byte(RunSigningDomain), digest...)
		if got := base64.RawURLEncoding.EncodeToString(ed25519.Sign(seedKey(c.Signer), msg)); got != a["signature"] {
			t.Errorf("%s: Go signature differs from vector", c.Name)
		}
	}
}

func TestRequestSigningVectors(t *testing.T) {
	var v struct {
		Credentials map[string]string `json:"credentials"`
		Cases       []struct {
			Name    string `json:"name"`
			Request struct {
				Method  string            `json:"method"`
				Path    string            `json:"path"`
				Query   string            `json:"query"`
				Headers map[string]string `json:"headers"`
				Body    string            `json:"body_text"`
			} `json:"request"`
			ExpectedPurpose string `json:"expected_purpose"`
			Now             string `json:"now"`
			Signer          string `json:"signer_seed_label"`
			Canonical       string `json:"canonical_text"`
			Expect          expect `json:"expect"`
		} `json:"cases"`
	}
	load(t, "request-signing.json", &v)
	for _, c := range v.Cases {
		r := c.Request
		err := VerifyRequest(SignedRequest{Method: r.Method, Path: r.Path, Query: r.Query, Headers: r.Headers, Body: []byte(r.Body)},
			c.ExpectedPurpose, utc(c.Now), func(id string) []byte {
				if k, ok := v.Credentials[id]; ok {
					return b64(k)
				}
				return nil
			})
		check(t, c.Name, err, c.Expect)

		if got := base64.RawURLEncoding.EncodeToString(ed25519.Sign(seedKey(c.Signer), []byte(c.Canonical))); got != r.Headers[HeaderSignature] {
			t.Errorf("%s: Go signature over canonical_text differs from vector", c.Name)
		}
		if c.Expect.OK {
			h := r.Headers
			sum := sha256.Sum256([]byte(r.Body))
			own := CanonicalRequest(CanonicalFields{h[HeaderPurpose], h[HeaderCredential], r.Method, r.Path, r.Query,
				h[HeaderRequestID], h[HeaderSentAt], h[HeaderNonce], hex.EncodeToString(sum[:])})
			if own != c.Canonical {
				t.Errorf("%s: Go canonical string differs:\n%q\n%q", c.Name, own, c.Canonical)
			}
		}
	}
}

func TestEnrollVectors(t *testing.T) {
	var v struct {
		Cases []struct {
			Name    string `json:"name"`
			Request string `json:"request_text"`
			Expect  expect `json:"expect"`
		} `json:"cases"`
	}
	load(t, "enroll-proof.json", &v)
	for _, c := range v.Cases {
		hash, err := VerifyEnrollRequest([]byte(c.Request))
		check(t, c.Name, err, c.Expect)
		if err == nil && c.Expect.TokenHash != "" && hash != c.Expect.TokenHash {
			t.Errorf("%s: token hash = %s, want %s", c.Name, hash, c.Expect.TokenHash)
		}
	}
}
