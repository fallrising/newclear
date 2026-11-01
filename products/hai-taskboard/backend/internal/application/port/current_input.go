package port

import (
	"bytes"
	"context"
	json "encoding/json/v2"
	"errors"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

const RunInputLimit = 1 << 20
const FakeEnvironmentProfile = "local-fake-environment-v1"

var ErrUnsupportedAcceptedKind = errors.New("unsupported accepted specification kind")

// CurrentInputTransaction is optional; the ordinary command transaction stays unchanged.
// StoreRunInput follows CreateRun and precedes EnqueueOutbox in the same transaction.
// LoadRunInput requires the exact outbox to have been installed as well.
type CurrentInputTransaction interface {
	Transaction
	LoadCurrentSpecification(context.Context, domain.ProjectID, domain.WorkItemID) (CurrentSpecification, error)
	StoreRunInput(context.Context, RunInputEnvelope) error
	LoadRunInput(context.Context, domain.ProjectID, domain.RunID) (RunInputEnvelope, error)
}

type CurrentSpecification struct {
	ProjectID              domain.ProjectID
	WorkItemID             domain.WorkItemID
	ProjectHeadVersion     uint64
	WorkItemHeadVersion    uint64
	AcceptedRevisionDigest domain.Digest
	BindingDigest          domain.Digest
	GraphRevisionDigest    domain.Digest
	PolicyRevisionDigest   domain.Digest
	RecipeDigest           domain.Digest
	Requirements           []ACRequirement
	ACContents             []ACRevision
}

// Each invocation of LoadCurrentSpecification returns fresh requirement/content slices.
func (v CurrentSpecification) Clone() CurrentSpecification {
	v.Requirements = slices.Clone(v.Requirements)
	v.ACContents = slices.Clone(v.ACContents)
	for i := range v.ACContents {
		v.ACContents[i].Content = bytes.Clone(v.ACContents[i].Content)
	}
	return v
}

type RunInputVerificationRule struct {
	ACID                      domain.ACID    `json:"ac_id"`
	VerifierClass             string         `json:"verifier_class"`
	Independent               bool           `json:"independent"`
	ProhibitedVerifierActor   domain.ActorID `json:"prohibited_verifier_actor"`
	ProhibitedVerifierRunRole string         `json:"prohibited_verifier_run_role"`
	EnvironmentDigest         string         `json:"environment_digest"`
}

type RunInputIntegrationBase struct {
	Applicability string  `json:"applicability"`
	Digest        *string `json:"digest"`
}

type RunInputMaterial struct {
	Schema               int                        `json:"schema_version"`
	ProjectID            domain.ProjectID           `json:"project_id"`
	WorkItemID           domain.WorkItemID          `json:"work_item_id"`
	ReadyVersion         uint64                     `json:"ready_version"`
	BindingDigest        string                     `json:"binding_digest"`
	GraphRevisionDigest  string                     `json:"graph_revision_digest"`
	ACs                  []InitialACBinding         `json:"required_ac_revisions"`
	PolicyRevisionDigest string                     `json:"policy_revision_digest"`
	RecipeDigest         string                     `json:"recipe_digest"`
	Rules                []RunInputVerificationRule `json:"verification_rules"`
	ApprovalRequired     bool                       `json:"approval_required"`
	IntegrationBase      RunInputIntegrationBase    `json:"integration_base"`
	AdapterID            string                     `json:"adapter_id"`
	AdapterVersion       string                     `json:"adapter_version"`
	ScenarioID           string                     `json:"scenario_id"`
}

// RunInput owns only canonical bytes, preventing mutable aliases from changing identity.
type RunInput struct {
	data   []byte
	digest domain.Digest
}
type RunInputEnvelope struct {
	RunID domain.RunID
	Input RunInput
}

func (v RunInput) CanonicalJSON() []byte { return bytes.Clone(v.data) }
func (v RunInput) Digest() domain.Digest { return v.digest }
func (v RunInput) Material() RunInputMaterial {
	var m RunInputMaterial
	_ = json.Unmarshal(v.data, &m)
	return m
}

func validInputID(s string) bool {
	return s != "" && len(s) <= 120 && utf8.ValidString(s) && !strings.ContainsFunc(s, func(r rune) bool { return unicode.IsControl(r) || unicode.IsSpace(r) }) && !strings.ContainsAny(s, "/\\")
}
func validInputText(s string, required bool) bool {
	return (!required || s != "") && len(s) <= 128 && utf8.ValidString(s) && !strings.ContainsFunc(s, unicode.IsControl)
}
func validInputScenario(s string) bool {
	if s == "" || len(s) > 128 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("._-", r)) {
			return false
		}
	}
	return true
}

// NewRunInput sorts complete AC/rule sets. Scenario membership belongs to the
// trusted dynamic ExecutorDeclaration; the codec validates its token and adapter.
func NewRunInput(m RunInputMaterial) (RunInput, error) {
	bad := func() (RunInput, error) { return RunInput{}, errors.New("invalid Run input") }
	if m.Schema != 1 || !validInputID(string(m.ProjectID)) || !validInputID(string(m.WorkItemID)) || m.ReadyVersion == 0 || m.ReadyVersion > 1<<63-1 || m.AdapterID != "fake/v1" || m.AdapterVersion != "1" || !validInputScenario(m.ScenarioID) || len(m.ACs) == 0 || len(m.ACs) > 256 || len(m.Rules) != len(m.ACs) {
		return bad()
	}
	for _, d := range []string{m.BindingDigest, m.GraphRevisionDigest, m.PolicyRevisionDigest, m.RecipeDigest} {
		if !validInitialDigest(d) {
			return bad()
		}
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
	m.ACs = slices.Clone(m.ACs)
	m.Rules = slices.Clone(m.Rules)
	slices.SortFunc(m.ACs, func(a, b InitialACBinding) int { return strings.Compare(string(a.ACID), string(b.ACID)) })
	slices.SortFunc(m.Rules, func(a, b RunInputVerificationRule) int { return strings.Compare(string(a.ACID), string(b.ACID)) })
	for i, a := range m.ACs {
		rule := m.Rules[i]
		if !validInputID(string(a.ACID)) || !validInitialDigest(a.Digest) || (i > 0 && m.ACs[i-1].ACID == a.ACID) || rule.ACID != a.ACID || !validInputText(rule.VerifierClass, true) || !validInputText(rule.ProhibitedVerifierRunRole, false) || (rule.ProhibitedVerifierActor != "" && !validInputID(string(rule.ProhibitedVerifierActor))) || !validInitialDigest(rule.EnvironmentDigest) {
			return bad()
		}
	}
	data, e := json.Marshal(m)
	if e != nil || len(data) > RunInputLimit {
		return bad()
	}
	return RunInput{data, domain.HashBytes(data)}, nil
}
func DecodeRunInput(data []byte, digest domain.Digest) (RunInput, error) {
	bad := func() (RunInput, error) {
		return RunInput{}, domain.StorageCorruptionError{Reason: "Run input canonical mismatch"}
	}
	if len(data) == 0 || len(data) > RunInputLimit || digest.IsZero() || domain.HashBytes(data) != digest {
		return bad()
	}
	var m RunInputMaterial
	if json.Unmarshal(data, &m, json.RejectUnknownMembers(true)) != nil {
		return bad()
	}
	v, e := NewRunInput(m)
	if e != nil || !bytes.Equal(v.data, data) {
		return bad()
	}
	return v, nil
}

// SemanticallyEqual excludes only dispatch-time ReadyVersion; subsequent phase
// changes do not invalidate the input. Every configured rule field participates.
func (v RunInput) SemanticallyEqual(other RunInput) bool {
	if len(v.data) == 0 || len(other.data) == 0 {
		return false
	}
	a, b := v.Material(), other.Material()
	a.ReadyVersion = 1
	b.ReadyVersion = 1
	ca, ea := NewRunInput(a)
	cb, eb := NewRunInput(b)
	return ea == nil && eb == nil && bytes.Equal(ca.data, cb.data)
}
func (v RunInput) SupportsExecutor(declaration ExecutorDeclaration) bool {
	m := v.Material()
	return len(v.data) > 0 && m.AdapterID == declaration.AdapterID && m.AdapterVersion == declaration.AdapterVersion && slices.Contains(declaration.Scenarios, m.ScenarioID)
}
