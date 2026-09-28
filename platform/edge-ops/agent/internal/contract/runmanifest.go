package contract

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"sort"
)

// TS twin: backend/src/domain/contract/runManifest.ts (SDD 05 §4).
const (
	RunManifestMaxBytes       = 32 * 1024
	ApprovalMaxBytes          = 4 * 1024
	RunSigningDomain          = "EDGEOPS-RUN-V1\n"
	MaxApprovalWindowSeconds  = 24 * 3600
	ProfileUnprivilegedDiag   = "unprivileged-diagnostic"
	ProfilePrivileged         = "privileged"
	maxParameters             = 32
	maxParameterStringUTF8Len = 1024
)

var (
	runFields = []string{
		"schema_version", "workspace_id", "job_id", "attempt_id", "node_id", "enrollment_generation",
		"recipe_version", "artifact_sha256", "parameters", "execution_profile", "policy_digest",
		"timeout_seconds", "not_before", "expires_at", "nonce",
	}
	approvalFields = []string{"schema_version", "key_id", "manifest_sha256", "signature"}
	paramKey       = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
	recipeVersion  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}@[1-9][0-9]{0,8}$`)
	keyID          = idPattern("key")
	wsID           = idPattern("ws")
	jobID          = idPattern("job")
	attemptID      = idPattern("attempt")
	nodeID         = idPattern("node")
)

// RunManifest is the validated view; parameter values are string, int64 or bool.
type RunManifest struct {
	WorkspaceID          string
	JobID                string
	AttemptID            string
	NodeID               string
	EnrollmentGeneration int64
	RecipeVersion        string
	ArtifactSHA256       string
	Parameters           map[string]any
	ExecutionProfile     string
	PolicyDigest         string
	TimeoutSeconds       int64
	NotBefore            int64
	ExpiresAt            int64
	Nonce                string
}

type RunApproval struct {
	KeyID          string
	ManifestSHA256 string
	Signature      []byte
}

// RunBinding is what the executor knows locally about itself and the time.
type RunBinding struct {
	NodeID               string
	EnrollmentGeneration int64
	Now                  int64
}

func ParseRunManifest(b []byte) (*RunManifest, error) {
	v, err := ParseStrictJSON(b, RunManifestMaxBytes)
	if err != nil {
		return nil, err
	}
	doc, err := checkShape(v, "edgeops.run", 1, runFields)
	if err != nil {
		return nil, err
	}
	m := &RunManifest{}
	steps := []func() error{
		func() (e error) { m.WorkspaceID, e = str(doc, "workspace_id", wsID); return },
		func() (e error) { m.JobID, e = str(doc, "job_id", jobID); return },
		func() (e error) { m.AttemptID, e = str(doc, "attempt_id", attemptID); return },
		func() (e error) { m.NodeID, e = str(doc, "node_id", nodeID); return },
		func() (e error) {
			m.EnrollmentGeneration, e = intField(doc, "enrollment_generation", 1, 2147483647)
			return
		},
		func() (e error) { m.RecipeVersion, e = str(doc, "recipe_version", recipeVersion); return },
		func() (e error) { m.ArtifactSHA256, e = str(doc, "artifact_sha256", hex64); return },
		func() (e error) { m.Parameters, e = parameters(doc); return },
		func() (e error) {
			m.ExecutionProfile, e = oneOf(doc, "execution_profile", ProfileUnprivilegedDiag, ProfilePrivileged)
			return
		},
		func() (e error) { m.PolicyDigest, e = str(doc, "policy_digest", hex64); return },
		func() (e error) { m.TimeoutSeconds, e = intField(doc, "timeout_seconds", 1, 86400); return },
		func() (e error) { m.NotBefore, e = timeField(doc, "not_before"); return },
		func() (e error) { m.ExpiresAt, e = timeField(doc, "expires_at"); return },
		func() (e error) { m.Nonce, e = str(doc, "nonce", b64urlNonce); return },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return nil, err
		}
	}
	if m.ExpiresAt <= m.NotBefore || m.ExpiresAt-m.NotBefore > MaxApprovalWindowSeconds {
		return nil, errf("invalid_field", "expires_at", "must be after not_before and within 24h of it")
	}
	return m, nil
}

func parameters(doc map[string]any) (map[string]any, error) {
	obj, ok := doc["parameters"].(map[string]any)
	if !ok {
		return nil, errf("invalid_field", "parameters", "must be an object")
	}
	if len(obj) > maxParameters {
		return nil, errf("invalid_field", "parameters", "at most %d parameters", maxParameters)
	}
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make(map[string]any, len(obj))
	for _, k := range keys {
		field := "parameters." + k
		if !paramKey.MatchString(k) {
			return nil, errf("invalid_field", field, "invalid parameter name")
		}
		switch p := obj[k].(type) {
		case string:
			if len(p) > maxParameterStringUTF8Len {
				return nil, errf("invalid_field", field, "string longer than %d bytes", maxParameterStringUTF8Len)
			}
		case int64, bool:
		default:
			return nil, errf("invalid_field", field, "must be string, integer or boolean")
		}
		out[k] = obj[k]
	}
	return out, nil
}

func ParseRunApproval(b []byte) (*RunApproval, error) {
	v, err := ParseStrictJSON(b, ApprovalMaxBytes)
	if err != nil {
		return nil, err
	}
	doc, err := checkShape(v, "edgeops.approval", 1, approvalFields)
	if err != nil {
		return nil, err
	}
	a := &RunApproval{}
	if a.KeyID, err = str(doc, "key_id", keyID); err != nil {
		return nil, err
	}
	if a.ManifestSHA256, err = str(doc, "manifest_sha256", hex64); err != nil {
		return nil, err
	}
	sig, err := str(doc, "signature", signature64)
	if err != nil {
		return nil, err
	}
	raw, ok := decodeB64URL(sig)
	if !ok || len(raw) != 64 {
		return nil, errf("invalid_field", "signature", "must be 64 bytes base64url")
	}
	a.Signature = raw
	return a, nil
}

// RunSigningMessage is the exact byte string an approver signs.
func RunSigningMessage(manifest []byte) []byte {
	d := sha256.Sum256(manifest)
	return append([]byte(RunSigningDomain), d[:]...)
}

// VerifyRunApproval checks an approval over the stored manifest bytes (never re-serialized),
// then the manifest's binding to this node, generation and time.
func VerifyRunApproval(manifest, approval []byte, trusted map[string][]byte, b RunBinding) (*RunManifest, error) {
	a, err := ParseRunApproval(approval)
	if err != nil {
		return nil, err
	}
	m, err := ParseRunManifest(manifest)
	if err != nil {
		return nil, err
	}
	d := sha256.Sum256(manifest)
	if hex.EncodeToString(d[:]) != a.ManifestSHA256 {
		return nil, errf("digest_mismatch", "manifest_sha256", "approval does not cover these manifest bytes")
	}
	key, ok := trusted[a.KeyID]
	if !ok {
		return nil, errf("untrusted_key", "key_id", "approval key is not pinned")
	}
	if !ed25519Verify(key, a.Signature, RunSigningMessage(manifest)) {
		return nil, errf("bad_signature", "signature", "approval signature does not verify")
	}
	if err := CheckRunBinding(m, b); err != nil {
		return nil, err
	}
	return m, nil
}

func CheckRunBinding(m *RunManifest, b RunBinding) error {
	switch {
	case m.NodeID != b.NodeID:
		return errf("node_mismatch", "node_id", "manifest targets another node")
	case m.EnrollmentGeneration != b.EnrollmentGeneration:
		return errf("generation_mismatch", "enrollment_generation", "manifest targets another generation")
	case b.Now < m.NotBefore:
		return errf("not_yet_valid", "not_before", "approval not yet valid")
	case b.Now >= m.ExpiresAt:
		return errf("expired", "expires_at", "approval expired")
	}
	return nil
}
