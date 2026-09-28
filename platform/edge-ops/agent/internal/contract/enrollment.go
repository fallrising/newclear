package contract

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
)

// TS twin: backend/src/domain/contract/enrollment.ts (SDD 05 §2).
const (
	EnrollMaxBytes      = 4 * 1024
	EnrollSigningDomain = "EDGEOPS-ENROLL-V1\n"
)

var (
	enrollFields = []string{"schema_version", "enrollment_token", "public_key", "proof", "agent_version", "os", "arch"}
	enrollToken  = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	enrollPubKey = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
)

// EnrollSigningMessage binds a node public key to one enrollment token.
func EnrollSigningMessage(token string, publicKey []byte) []byte {
	d := sha256.Sum256([]byte(token))
	msg := append([]byte(EnrollSigningDomain), d[:]...)
	return append(msg, publicKey...)
}

// EnrollmentTokenHash is the server-side lookup key; the raw token is never stored.
func EnrollmentTokenHash(token string) string {
	d := sha256.Sum256([]byte(token))
	return hex.EncodeToString(d[:])
}

// VerifyEnrollRequest validates an enroll body and its proof of key possession.
func VerifyEnrollRequest(b []byte) (tokenHash string, err error) {
	v, err := ParseStrictJSON(b, EnrollMaxBytes)
	if err != nil {
		return "", err
	}
	doc, err := checkShape(v, "edgeops.enroll", 1, enrollFields)
	if err != nil {
		return "", err
	}
	token, err := str(doc, "enrollment_token", enrollToken)
	if err != nil {
		return "", err
	}
	pubB64, err := str(doc, "public_key", enrollPubKey)
	if err != nil {
		return "", err
	}
	proofB64, err := str(doc, "proof", signature64)
	if err != nil {
		return "", err
	}
	if _, err := str(doc, "agent_version", agentVer); err != nil {
		return "", err
	}
	if _, err := oneOf(doc, "os", "linux"); err != nil {
		return "", err
	}
	if _, err := oneOf(doc, "arch", "amd64", "arm64"); err != nil {
		return "", err
	}
	pub, ok := decodeB64URL(pubB64)
	if !ok || len(pub) != 32 {
		return "", errf("invalid_field", "public_key", "must be 32 bytes")
	}
	if _, ok := decodeB64URL(token); !ok {
		return "", errf("invalid_field", "enrollment_token", "non-canonical base64url")
	}
	proof, ok := decodeB64URL(proofB64)
	if !ok || !ed25519Verify(pub, proof, EnrollSigningMessage(token, pub)) {
		return "", errf("bad_signature", "proof", "proof of key possession does not verify")
	}
	return EnrollmentTokenHash(token), nil
}
