package contract

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
)

// TS twin: backend/src/domain/contract/requestAuth.ts (edgeops-req-v1, SDD 05 §2).
const (
	RequestSigningDomain = "EDGEOPS-REQ-V1"
	ClockSkewSeconds     = 120

	HeaderVersion       = "edgeops-version"
	HeaderPurpose       = "edgeops-purpose"
	HeaderCredential    = "edgeops-credential"
	HeaderRequestID     = "edgeops-request-id"
	HeaderSentAt        = "edgeops-sent-at"
	HeaderNonce         = "edgeops-nonce"
	HeaderContentSHA256 = "edgeops-content-sha256"
	HeaderSignature     = "edgeops-signature"
)

var (
	requiredHeaders = []string{HeaderPurpose, HeaderCredential, HeaderRequestID, HeaderSentAt, HeaderNonce, HeaderContentSHA256, HeaderSignature}
	headerRules     = map[string]*regexp.Regexp{
		HeaderPurpose:       regexp.MustCompile(`^(telemetry|logs|jobs)$`),
		HeaderCredential:    idPattern("cred"),
		HeaderRequestID:     idPattern("req"),
		HeaderSentAt:        regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`),
		HeaderNonce:         b64urlNonce,
		HeaderContentSHA256: hex64,
		HeaderSignature:     signature64,
	}
	agentPath  = regexp.MustCompile(`^/agent/v1(/[A-Za-z0-9_-]{1,64}){1,8}$`)
	queryKey   = regexp.MustCompile(`^[a-z0-9_]{1,64}$`)
	queryValue = regexp.MustCompile(`^[A-Za-z0-9_.~-]{0,256}$`)
)

// CanonicalFields are the signed request fields, in signing order.
type CanonicalFields struct {
	Purpose, CredentialID, Method, Path, Query, RequestID, SentAt, Nonce, BodySHA256 string
}

func CanonicalRequest(f CanonicalFields) string {
	return strings.Join([]string{
		RequestSigningDomain, f.Purpose, f.CredentialID, f.Method, f.Path, f.Query,
		f.RequestID, f.SentAt, f.Nonce, f.BodySHA256,
	}, "\n")
}

// IsCanonicalQuery reports whether q is already canonical; verifiers reject, never normalise.
func IsCanonicalQuery(q string) bool {
	if q == "" {
		return true
	}
	prev := ""
	for _, pair := range strings.Split(q, "&") {
		k, v, ok := strings.Cut(pair, "=")
		if !ok || !queryKey.MatchString(k) || !queryValue.MatchString(v) || k <= prev {
			return false
		}
		prev = k
	}
	return true
}

// SignedRequest carries the raw request pieces; header names are lower-case.
type SignedRequest struct {
	Method  string
	Path    string
	Query   string
	Headers map[string]string
	Body    []byte
}

// VerifyRequest mirrors the TS verifier check-for-check so both sides fail with the same code.
func VerifyRequest(r SignedRequest, expectedPurpose string, now int64, lookup func(credentialID string) []byte) error {
	h := r.Headers
	v, ok := h[HeaderVersion]
	if !ok {
		return errf("missing_header", HeaderVersion, "required")
	}
	if v != "1" {
		return errf("bad_version", HeaderVersion, "unsupported signature version")
	}
	for _, name := range requiredHeaders {
		if _, ok := h[name]; !ok {
			return errf("missing_header", name, "required")
		}
	}
	for _, name := range requiredHeaders {
		if !headerRules[name].MatchString(h[name]) {
			return errf("invalid_header", name, "malformed")
		}
	}
	sentAt, ok := ParseUTCSeconds(h[HeaderSentAt])
	if !ok {
		return errf("invalid_header", HeaderSentAt, "malformed")
	}
	if h[HeaderPurpose] != expectedPurpose {
		return errf("purpose_mismatch", HeaderPurpose, "credential purpose not allowed here")
	}
	if r.Method != "GET" && r.Method != "POST" {
		return errf("method_not_allowed", "method", "unsupported method")
	}
	if !agentPath.MatchString(r.Path) {
		return errf("non_canonical_path", "path", "path is not canonical")
	}
	if !IsCanonicalQuery(r.Query) {
		return errf("non_canonical_query", "query", "query is not canonical")
	}
	sum := sha256.Sum256(r.Body)
	bodySHA := hex.EncodeToString(sum[:])
	if bodySHA != h[HeaderContentSHA256] {
		return errf("body_digest_mismatch", HeaderContentSHA256, "body digest mismatch")
	}
	if d := now - sentAt; d > ClockSkewSeconds || d < -ClockSkewSeconds {
		return errf("clock_skew", HeaderSentAt, "outside ±120s")
	}
	key := lookup(h[HeaderCredential])
	if key == nil {
		return errf("unknown_credential", HeaderCredential, "credential is not active")
	}
	sig, ok := decodeB64URL(h[HeaderSignature])
	msg := CanonicalRequest(CanonicalFields{
		Purpose: h[HeaderPurpose], CredentialID: h[HeaderCredential], Method: r.Method, Path: r.Path,
		Query: r.Query, RequestID: h[HeaderRequestID], SentAt: h[HeaderSentAt], Nonce: h[HeaderNonce], BodySHA256: bodySHA,
	})
	if !ok || !ed25519Verify(key, sig, []byte(msg)) {
		return errf("bad_signature", HeaderSignature, "signature does not verify")
	}
	return nil
}
