package port

import (
	"bytes"
	"context"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"errors"
	"slices"
	"strings"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const PolicyProfilesLimit = 262144

type PolicyProfileMaterial struct {
	Schema           int                        `json:"schema_version"`
	ProjectID        domain.ProjectID           `json:"project_id"`
	RecipeDigest     string                     `json:"recipe_digest"`
	ApprovalRequired bool                       `json:"approval_required"`
	IntegrationBase  RunInputIntegrationBase    `json:"integration_base"`
	Rules            []RunInputVerificationRule `json:"verification_rules"`
}

type PolicyProfile struct {
	data   []byte
	digest domain.Digest
}

// PolicyProfile owns its canonical bytes. All exposed material is decoded afresh.
func (p PolicyProfile) CanonicalJSON() []byte { return bytes.Clone(p.data) }
func (p PolicyProfile) Digest() domain.Digest { return p.digest }
func (p PolicyProfile) Material() PolicyProfileMaterial {
	var m PolicyProfileMaterial
	_ = json.Unmarshal(p.data, &m)
	return m
}

func NewPolicyProfile(m PolicyProfileMaterial) (PolicyProfile, error) {
	bad := func() (PolicyProfile, error) { return PolicyProfile{}, errors.New("invalid project completion policy") }
	if m.Schema != 1 || !validInputID(string(m.ProjectID)) || !validInitialDigest(m.RecipeDigest) || len(m.Rules) < 1 || len(m.Rules) > 256 {
		return bad()
	}
	switch m.IntegrationBase.Applicability {
	case "absent":
		if m.IntegrationBase.Digest != nil {
			return bad()
		}
	case "present":
		if m.IntegrationBase.Digest == nil || !validInitialDigest(*m.IntegrationBase.Digest) {
			return bad()
		}
	default:
		return bad()
	}
	m.Rules = slices.Clone(m.Rules)
	slices.SortFunc(m.Rules, func(a, b RunInputVerificationRule) int { return strings.Compare(string(a.ACID), string(b.ACID)) })
	for i, r := range m.Rules {
		if !domain.ValidACID(string(r.ACID)) || (i > 0 && m.Rules[i-1].ACID == r.ACID) || r.VerifierClass != "human" || !r.Independent || !validInputText(r.ProhibitedVerifierRunRole, false) || (r.ProhibitedVerifierActor != "" && !validInputID(string(r.ProhibitedVerifierActor))) || !validInitialDigest(r.EnvironmentDigest) {
			return bad()
		}
	}
	data, err := json.Marshal(m)
	if err != nil || len(data) > PolicyProfilesLimit {
		return bad()
	}
	return PolicyProfile{data: data, digest: domain.HashBytes(data)}, nil
}

// requiredPolicyMembers rejects absent/null values before Go zero values can erase intent.
func requiredPolicyMembers(data []byte, names []string, nullable string) (map[string]jsontext.Value, error) {
	var fields map[string]jsontext.Value
	if err := json.Unmarshal(data, &fields); err != nil {
		return nil, err
	}
	if len(fields) != len(names) {
		return nil, errors.New("invalid project completion policy members")
	}
	for _, name := range names {
		v, ok := fields[name]
		if !ok || (name != nullable && bytes.Equal(bytes.TrimSpace(v), []byte("null"))) {
			return nil, errors.New("missing project completion policy member")
		}
	}
	return fields, nil
}

func ParsePolicyProfile(data []byte) (PolicyProfile, error) {
	bad := func() (PolicyProfile, error) { return PolicyProfile{}, errors.New("invalid project completion policy") }
	if len(data) == 0 || len(data) > PolicyProfilesLimit {
		return bad()
	}
	fields, err := requiredPolicyMembers(data, []string{"schema_version", "project_id", "recipe_digest", "approval_required", "integration_base", "verification_rules"}, "")
	if err != nil || string(fields["schema_version"]) != "1" {
		return bad()
	}
	if _, err = requiredPolicyMembers(fields["integration_base"], []string{"applicability", "digest"}, "digest"); err != nil {
		return bad()
	}
	var rules []jsontext.Value
	if json.Unmarshal(fields["verification_rules"], &rules) != nil || len(rules) < 1 || len(rules) > 256 {
		return bad()
	}
	for _, r := range rules {
		if _, err = requiredPolicyMembers(r, []string{"ac_id", "verifier_class", "independent", "prohibited_verifier_actor", "prohibited_verifier_run_role", "environment_digest"}, ""); err != nil {
			return bad()
		}
	}
	var m PolicyProfileMaterial
	if json.Unmarshal(data, &m, json.RejectUnknownMembers(true)) != nil {
		return bad()
	}
	return NewPolicyProfile(m)
}

func DecodePolicyProfile(data []byte, digest domain.Digest) (PolicyProfile, error) {
	p, err := ParsePolicyProfile(data)
	if err != nil || digest.IsZero() || p.digest != digest || !bytes.Equal(p.data, data) {
		return PolicyProfile{}, domain.StorageCorruptionError{Reason: "project completion policy canonical mismatch"}
	}
	return p, nil
}

func ParsePolicyProfiles(data []byte) (map[domain.ProjectID]PolicyProfile, error) {
	bad := func() (map[domain.ProjectID]PolicyProfile, error) {
		return nil, errors.New("invalid project completion policies")
	}
	if len(data) == 0 || len(data) > PolicyProfilesLimit {
		return bad()
	}
	fields, err := requiredPolicyMembers(data, []string{"schema_version", "profiles"}, "")
	if err != nil || string(fields["schema_version"]) != "1" {
		return bad()
	}
	var entries []jsontext.Value
	if json.Unmarshal(fields["profiles"], &entries) != nil || len(entries) < 1 || len(entries) > 32 {
		return bad()
	}
	result := make(map[domain.ProjectID]PolicyProfile, len(entries))
	for _, entry := range entries {
		p, err := ParsePolicyProfile(entry)
		if err != nil {
			return bad()
		}
		id := p.Material().ProjectID
		if _, ok := result[id]; ok {
			return bad()
		}
		result[id] = p
	}
	return result, nil
}

// PolicyProfileRegistrar is startup-only: never an HTTP or command authority.
type PolicyProfileRegistrar interface {
	RegisterPolicyProfiles(context.Context, map[domain.ProjectID]PolicyProfile, int64) error
}
