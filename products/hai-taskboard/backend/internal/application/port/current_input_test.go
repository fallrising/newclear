package port

import (
	"bytes"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func inputMaterial() RunInputMaterial {
	d := func(s string) string { return domain.HashString(s).String() }
	return RunInputMaterial{Schema: 1, ProjectID: "project", WorkItemID: "item", ReadyVersion: 3, BindingDigest: d("binding"), GraphRevisionDigest: d("graph"), ACs: []InitialACBinding{{"ac2", d("ac2")}, {"ac1", d("ac1")}}, PolicyRevisionDigest: d("policy"), RecipeDigest: d("recipe"), Rules: []RunInputVerificationRule{{ACID: "ac2", VerifierClass: "test", EnvironmentDigest: d(FakeEnvironmentProfile)}, {ACID: "ac1", VerifierClass: "test", Independent: true, ProhibitedVerifierActor: "producer", ProhibitedVerifierRunRole: "author", EnvironmentDigest: d(FakeEnvironmentProfile)}}, ApprovalRequired: true, IntegrationBase: RunInputIntegrationBase{Applicability: "absent"}, AdapterID: "fake/v1", AdapterVersion: "1", ScenarioID: "success"}
}
func TestRunInput_CanonicalCopiesAndSemanticDimensions(t *testing.T) {
	m := inputMaterial()
	v, e := NewRunInput(m)
	if e != nil {
		t.Fatal(e)
	}
	decoded, e := DecodeRunInput(v.CanonicalJSON(), v.Digest())
	if e != nil || !decoded.SemanticallyEqual(v) {
		t.Fatal(e)
	}
	m.ACs[0].Digest = "mutated"
	m.Rules[0].VerifierClass = "mutated"
	b := v.CanonicalJSON()
	b[0] = 'x'
	copied := v.Material()
	copied.ACs[0].Digest = "mutated"
	copied.Rules[0].VerifierClass = "mutated"
	if _, e = DecodeRunInput(v.CanonicalJSON(), v.Digest()); e != nil {
		t.Fatal("mutable alias", e)
	}
	changed := v.Material()
	changed.ReadyVersion++
	lifecycle, e := NewRunInput(changed)
	if e != nil || !lifecycle.SemanticallyEqual(v) || lifecycle.Digest() == v.Digest() {
		t.Fatal("lifecycle comparison")
	}
	mutations := map[string]func(*RunInputMaterial){
		"project": func(m *RunInputMaterial) { m.ProjectID = "other" }, "item": func(m *RunInputMaterial) { m.WorkItemID = "other" },
		"binding": func(m *RunInputMaterial) { m.BindingDigest = domain.HashString("other").String() }, "graph": func(m *RunInputMaterial) { m.GraphRevisionDigest = domain.HashString("other").String() },
		"ac": func(m *RunInputMaterial) { m.ACs[0].Digest = domain.HashString("other").String() }, "policy": func(m *RunInputMaterial) { m.PolicyRevisionDigest = domain.HashString("other").String() },
		"recipe": func(m *RunInputMaterial) { m.RecipeDigest = domain.HashString("other").String() }, "class": func(m *RunInputMaterial) { m.Rules[0].VerifierClass = "other" },
		"independence": func(m *RunInputMaterial) { m.Rules[0].Independent = !m.Rules[0].Independent }, "actor": func(m *RunInputMaterial) { m.Rules[0].ProhibitedVerifierActor = "other" },
		"role": func(m *RunInputMaterial) { m.Rules[0].ProhibitedVerifierRunRole = "other" }, "environment": func(m *RunInputMaterial) { m.Rules[0].EnvironmentDigest = domain.HashString("other").String() },
		"approval": func(m *RunInputMaterial) { m.ApprovalRequired = !m.ApprovalRequired }, "base": func(m *RunInputMaterial) {
			m.IntegrationBase = RunInputIntegrationBase{Applicability: "present", Digest: new(domain.HashString("base").String())}
		},
		"scenario": func(m *RunInputMaterial) { m.ScenarioID = "other" },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			m := v.Material()
			mutate(&m)
			other, e := NewRunInput(m)
			if e != nil || v.SemanticallyEqual(other) || v.Digest() == other.Digest() {
				t.Fatalf("dimension omitted: %v", e)
			}
		})
	}
	present := v.Material()
	present.IntegrationBase = RunInputIntegrationBase{Applicability: "present", Digest: new(domain.HashString("base").String())}
	p, e := NewRunInput(present)
	if e != nil {
		t.Fatal(e)
	}
	present.IntegrationBase.Digest = new(domain.HashString("base2").String())
	p2, e := NewRunInput(present)
	if e != nil || p.SemanticallyEqual(p2) {
		t.Fatal("base digest omitted")
	}
	if !v.SupportsExecutor(ExecutorDeclaration{AdapterID: "fake/v1", AdapterVersion: "1", Scenarios: []string{"success"}}) || v.SupportsExecutor(ExecutorDeclaration{AdapterID: "fake/v1", AdapterVersion: "1", Scenarios: []string{"other"}}) {
		t.Fatal("dynamic membership")
	}
}
func TestRunInput_StrictValidationAndBounds(t *testing.T) {
	invalid := map[string]func(*RunInputMaterial){
		"schema": func(m *RunInputMaterial) { m.Schema = 2 }, "id": func(m *RunInputMaterial) { m.ProjectID = "bad/id" }, "version0": func(m *RunInputMaterial) { m.ReadyVersion = 0 }, "versionOverflow": func(m *RunInputMaterial) { m.ReadyVersion = 1 << 63 },
		"zeroDigest": func(m *RunInputMaterial) { m.BindingDigest = strings.Repeat("0", 64) }, "upperDigest": func(m *RunInputMaterial) { m.RecipeDigest = strings.Repeat("A", 64) },
		"emptyAC": func(m *RunInputMaterial) { m.ACs = nil }, "duplicate": func(m *RunInputMaterial) { m.ACs[1] = m.ACs[0] }, "partialRules": func(m *RunInputMaterial) { m.Rules = m.Rules[:1] }, "wrongRule": func(m *RunInputMaterial) { m.Rules[0].ACID = "other" },
		"class": func(m *RunInputMaterial) { m.Rules[0].VerifierClass = "" }, "environment": func(m *RunInputMaterial) { m.Rules[0].EnvironmentDigest = strings.Repeat("0", 64) },
		"baseUnknown": func(m *RunInputMaterial) { m.IntegrationBase.Applicability = "unknown" }, "baseNull": func(m *RunInputMaterial) { m.IntegrationBase.Applicability = "present" }, "baseAbsentDigest": func(m *RunInputMaterial) { m.IntegrationBase.Digest = new(domain.HashString("base").String()) },
		"adapter": func(m *RunInputMaterial) { m.AdapterID = "real" }, "adapterVersion": func(m *RunInputMaterial) { m.AdapterVersion = "2" }, "scenario": func(m *RunInputMaterial) { m.ScenarioID = "../bad" },
	}
	for name, mutate := range invalid {
		t.Run(name, func(t *testing.T) {
			m := inputMaterial()
			mutate(&m)
			if _, e := NewRunInput(m); e == nil {
				t.Fatal("invalid accepted")
			}
		})
	}
	m := inputMaterial()
	m.ACs = nil
	m.Rules = nil
	for i := range 257 {
		id := domain.ACID(strings.Repeat("a", i+1))
		m.ACs = append(m.ACs, InitialACBinding{id, domain.HashString(string(id)).String()})
		m.Rules = append(m.Rules, RunInputVerificationRule{ACID: id, VerifierClass: "test", EnvironmentDigest: domain.HashString("env").String()})
	}
	if _, e := NewRunInput(m); e == nil {
		t.Fatal("AC overflow")
	}
	v, _ := NewRunInput(inputMaterial())
	canonical := v.CanonicalJSON()
	unknown := append(bytes.Clone(canonical[:len(canonical)-1]), []byte(`,"unknown":true}`)...)
	unsorted, _ := json.Marshal(inputMaterial())
	for name, b := range map[string][]byte{"space": append([]byte(" "), canonical...), "unknown": unknown, "unsorted": unsorted, "oversize": bytes.Repeat([]byte(" "), RunInputLimit+1), "empty": nil, "duplicate": bytes.Replace(canonical, []byte(`"schema_version":1`), []byte(`"schema_version":1,"schema_version":1`), 1)} {
		t.Run(name, func(t *testing.T) {
			_, e := DecodeRunInput(b, domain.HashBytes(b))
			if _, ok := errors.AsType[domain.StorageCorruptionError](e); !ok {
				t.Fatalf("not corruption: %v", e)
			}
		})
	}
	if _, e := DecodeRunInput(canonical, domain.HashString("wrong")); e == nil {
		t.Fatal("hash mismatch accepted")
	}
}

func TestRunInput_ExactACCapacityAndBaseCopy(t *testing.T) {
	m := inputMaterial()
	m.ACs = nil
	m.Rules = nil
	for i := range 256 {
		id := domain.ACID(fmt.Sprintf("ac-%03d", i))
		m.ACs = append(m.ACs, InitialACBinding{ACID: id, Digest: domain.HashString(string(id)).String()})
		m.Rules = append(m.Rules, RunInputVerificationRule{ACID: id, VerifierClass: "test", EnvironmentDigest: domain.HashString("environment").String()})
	}
	m.IntegrationBase = RunInputIntegrationBase{Applicability: "present", Digest: new(domain.HashString("base").String())}
	v, e := NewRunInput(m)
	if e != nil {
		t.Fatal("exact supported AC capacity", e)
	}
	*m.IntegrationBase.Digest = domain.HashString("changed").String()
	copy := v.Material()
	*copy.IntegrationBase.Digest = domain.HashString("changed").String()
	if _, e = DecodeRunInput(v.CanonicalJSON(), v.Digest()); e != nil {
		t.Fatal("base alias", e)
	}
	m.ACs = append(m.ACs, InitialACBinding{ACID: "overflow", Digest: domain.HashString("overflow").String()})
	m.Rules = append(m.Rules, RunInputVerificationRule{ACID: "overflow", VerifierClass: "test", EnvironmentDigest: domain.HashString("environment").String()})
	if _, e = NewRunInput(m); e == nil {
		t.Fatal("AC overflow accepted")
	}
}
