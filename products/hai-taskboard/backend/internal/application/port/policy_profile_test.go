package port

import (
	"bytes"
	json "encoding/json/v2"
	"fmt"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"os"
	"strings"
	"testing"
)

func policyProfileFixture() PolicyProfileMaterial {
	return PolicyProfileMaterial{Schema: 1, ProjectID: "project-1", RecipeDigest: strings.Repeat("1", 64), IntegrationBase: RunInputIntegrationBase{Applicability: "absent"}, Rules: []RunInputVerificationRule{{ACID: "AC-1", VerifierClass: "human", Independent: true, ProhibitedVerifierRunRole: "<>&", EnvironmentDigest: strings.Repeat("2", 64)}}}
}

const profileGolden = `{"schema_version":1,"project_id":"project-1","recipe_digest":"1111111111111111111111111111111111111111111111111111111111111111","approval_required":false,"integration_base":{"applicability":"absent","digest":null},"verification_rules":[{"ac_id":"AC-1","verifier_class":"human","independent":true,"prohibited_verifier_actor":"","prohibited_verifier_run_role":"<>&","environment_digest":"2222222222222222222222222222222222222222222222222222222222222222"}]}`

func TestPolicyProfile_StrictCanonicalIdentity(t *testing.T) {
	p, err := NewPolicyProfile(policyProfileFixture())
	if err != nil {
		t.Fatalf("valid explicit human policy rejected: %v", err)
	}
	if string(p.CanonicalJSON()) != profileGolden {
		t.Fatalf("canonical golden changed: %s", p.CanonicalJSON())
	}
	// Literal SHA calculated independently from frozen UTF-8 golden bytes.
	if p.Digest().String() != "8da4ff9c757cf8ee03df97d84a3eb5a0d94211aec931094be41f575ce2dc503a" {
		t.Fatal("golden digest changed", p.Digest())
	}
	parsed, err := ParsePolicyProfile([]byte(" \n" + profileGolden + "\t"))
	if err != nil || parsed.Digest() != p.Digest() {
		t.Fatal("layout changed identity", err)
	}
	if _, err = DecodePolicyProfile([]byte(" "+profileGolden), domain.HashString(" "+profileGolden)); err == nil {
		t.Fatal("noncanonical storage admitted")
	}
	if _, err = DecodePolicyProfile(p.CanonicalJSON(), domain.HashString("wrong")); err == nil {
		t.Fatal("wrong hash admitted")
	}
	for name, change := range map[string]func(*PolicyProfileMaterial){
		"project": func(m *PolicyProfileMaterial) { m.ProjectID = "project-2" }, "recipe": func(m *PolicyProfileMaterial) { m.RecipeDigest = strings.Repeat("3", 64) }, "approval": func(m *PolicyProfileMaterial) { m.ApprovalRequired = true }, "base": func(m *PolicyProfileMaterial) {
			m.IntegrationBase = RunInputIntegrationBase{"present", new(strings.Repeat("4", 64))}
		}, "ac": func(m *PolicyProfileMaterial) { m.Rules[0].ACID = "AC-2" }, "actor": func(m *PolicyProfileMaterial) { m.Rules[0].ProhibitedVerifierActor = "界" }, "role": func(m *PolicyProfileMaterial) { m.Rules[0].ProhibitedVerifierRunRole = "producer" }, "environment": func(m *PolicyProfileMaterial) { m.Rules[0].EnvironmentDigest = strings.Repeat("5", 64) },
	} {
		t.Run(name, func(t *testing.T) {
			m := policyProfileFixture()
			change(&m)
			q, e := NewPolicyProfile(m)
			if e != nil || q.Digest() == p.Digest() {
				t.Fatal("semantic field failed identity", e)
			}
		})
	}
	for _, id := range []string{strings.Repeat("a", 80), strings.Repeat("a", 81), strings.Repeat("a", 120), strings.Repeat("界", 40), "é", "e\u0301", "\u200b", "\ufeff", "\u202e"} {
		m := policyProfileFixture()
		m.Rules[0].ACID = domain.ACID(id)
		q, e := NewPolicyProfile(m)
		if e != nil || string(q.Material().Rules[0].ACID) != id {
			t.Fatal("legal identity changed", id, e)
		}
	}
	for _, id := range []string{"", strings.Repeat("a", 121), strings.Repeat("界", 40) + "x", "a b", "a\u0085b", "a\u00a0b", "a\u3000b", "a/b", `a\b`, string([]byte{0xff})} {
		m := policyProfileFixture()
		m.Rules[0].ACID = domain.ACID(id)
		if _, e := NewPolicyProfile(m); e == nil {
			t.Fatal("invalid identity admitted", id)
		}
	}
	a := policyProfileFixture()
	a.Rules = append(a.Rules, RunInputVerificationRule{ACID: "a", VerifierClass: "human", Independent: true, EnvironmentDigest: strings.Repeat("6", 64)})
	q, e := NewPolicyProfile(a)
	if e != nil {
		t.Fatal(e)
	}
	a.Rules[0], a.Rules[1] = a.Rules[1], a.Rules[0]
	r, e := NewPolicyProfile(a)
	if e != nil || q.Digest() != r.Digest() {
		t.Fatal("rule ordering changed identity", e)
	}
	a.Rules[0].ACID = "mutated"
	view := q.Material()
	view.Rules[0].ACID = "mutated"
	raw := q.CanonicalJSON()
	raw[0] = '!'
	if !bytes.Equal(q.CanonicalJSON(), r.CanonicalJSON()) {
		t.Fatal("mutable alias")
	}
	nfc, nfd := policyProfileFixture(), policyProfileFixture()
	nfc.Rules[0].ACID = "é"
	nfd.Rules[0].ACID = "e\u0301"
	x, _ := NewPolicyProfile(nfc)
	y, _ := NewPolicyProfile(nfd)
	if x.Digest() == y.Digest() {
		t.Fatal("Unicode normalized")
	}
}
func TestPolicyProfile_StrictMembersAndBounds(t *testing.T) {
	for _, scope := range []string{"profile", "base", "rule"} {
		var root map[string]any
		_ = json.Unmarshal([]byte(profileGolden), &root)
		target := root
		if scope == "base" {
			target = root["integration_base"].(map[string]any)
		}
		if scope == "rule" {
			target = root["verification_rules"].([]any)[0].(map[string]any)
		}
		keys := []string{}
		for key := range target {
			keys = append(keys, key)
		}
		for _, key := range keys {
			value := target[key]
			delete(target, key)
			b, _ := json.Marshal(root)
			if _, e := ParsePolicyProfile(b); e == nil {
				t.Fatalf("missing %s.%s admitted", scope, key)
			}
			target[key] = nil
			b, _ = json.Marshal(root)
			if !(scope == "base" && key == "digest") {
				if _, e := ParsePolicyProfile(b); e == nil {
					t.Fatalf("null %s.%s admitted", scope, key)
				}
			}
			target[key] = value
		}
		target["unknown"] = true
		b, _ := json.Marshal(root)
		if _, e := ParsePolicyProfile(b); e == nil {
			t.Fatal("unknown member admitted", scope)
		}
	}
	for _, pair := range [][2]string{{`"schema_version":1`, `"schema_version":1.0`}, {`"schema_version":1`, `"schema_version":1e0`}, {`"schema_version":1`, `"schema_version":2`}, {`"approval_required":false`, `"approval_required":0`}, {`"independent":true`, `"independent":false`}, {`"human"`, `"producer"`}, {`"human"`, `"independent"`}, {`"human"`, `"future"`}, {`"schema_version":1`, `"schema_version":1,"schema_version":1`}, {`"applicability":"absent"`, `"applicability":"absent","applicability":"absent"`}, {`"ac_id":"AC-1"`, `"ac_id":"AC-1","ac_id":"AC-1"`}, {`"prohibited_verifier_actor":""`, `"prohibited_verifier_actor":"bad actor"`}, {`"prohibited_verifier_run_role":"<>&"`, `"prohibited_verifier_run_role":"\n"`}, {`"digest":null`, `"digest":"1111111111111111111111111111111111111111111111111111111111111111"`}} {
		if _, e := ParsePolicyProfile([]byte(strings.Replace(profileGolden, pair[0], pair[1], 1))); e == nil {
			t.Fatal("invalid field admitted", pair)
		}
	}
	for _, data := range [][]byte{[]byte(profileGolden + `{}`), []byte(strings.Repeat(" ", PolicyProfilesLimit+1)), []byte(strings.Replace(profileGolden, "AC-1", "\xff", 1)), []byte(strings.Replace(profileGolden, "AC-1", `\ud800`, 1))} {
		if _, e := ParsePolicyProfile(data); e == nil {
			t.Fatal("invalid JSON admitted")
		}
	}
	for _, n := range []int{0, 256, 257} {
		m := policyProfileFixture()
		m.Rules = nil
		for i := range n {
			r := policyProfileFixture().Rules[0]
			r.ACID = domain.ACID(fmt.Sprintf("AC-%03d", i))
			m.Rules = append(m.Rules, r)
		}
		_, e := NewPolicyProfile(m)
		if (e == nil) != (n == 256) {
			t.Fatal("rule bound", n, e)
		}
	}
	m := policyProfileFixture()
	m.Rules = append(m.Rules, m.Rules[0])
	if _, e := NewPolicyProfile(m); e == nil {
		t.Fatal("duplicate AC admitted")
	}
}
func TestPolicyProfiles_Envelope(t *testing.T) {
	good := `{"schema_version":1,"profiles":[` + profileGolden + `]}`
	padded := good + strings.Repeat(" ", PolicyProfilesLimit-len(good))
	if _, err := ParsePolicyProfiles([]byte(padded)); err != nil {
		t.Fatal("exact byte boundary rejected", err)
	}
	if _, err := ParsePolicyProfiles([]byte(padded + " ")); err == nil {
		t.Fatal("valid JSON beyond byte boundary admitted")
	}
	profilePadded := profileGolden + strings.Repeat(" ", PolicyProfilesLimit-len(profileGolden))
	if _, err := ParsePolicyProfile([]byte(profilePadded)); err != nil {
		t.Fatal("exact profile boundary rejected", err)
	}
	if _, err := ParsePolicyProfile([]byte(profilePadded + " ")); err == nil {
		t.Fatal("oversize valid profile admitted")
	}

	p, e := ParsePolicyProfiles([]byte(good))
	if e != nil || len(p) != 1 {
		t.Fatal(e)
	}
	for _, bad := range []string{`null`, `{}`, `{"schema_version":1,"profiles":null}`, `{"schema_version":1,"profiles":[]}`, `{"schema_version":1,"profiles":[null]}`, strings.Replace(good, `"profiles"`, `"unknown"`, 1), strings.Replace(good, `"schema_version":1`, `"schema_version":1,"schema_version":1`, 1), strings.Replace(good, `"schema_version":1`, `"schema_version":1.0`, 1), `{"schema_version":1,"profiles":[` + profileGolden + `,` + profileGolden + `]}`, good + `{}`, strings.Repeat(" ", PolicyProfilesLimit+1)} {
		if _, e := ParsePolicyProfiles([]byte(bad)); e == nil {
			t.Fatal("invalid envelope admitted")
		}
	}
}

func TestPolicyProfiles_IndentedReorderedDocumentIdentity(t *testing.T) {
	const document = `{
  "profiles" : [
    {
      "verification_rules" : [
        {
          "environment_digest" : "2222222222222222222222222222222222222222222222222222222222222222",
          "prohibited_verifier_run_role" : "<>&",
          "prohibited_verifier_actor" : "",
          "independent" : true,
          "verifier_class" : "human",
          "ac_id" : "AC-1"
        }
      ],
      "integration_base" : {
        "digest" : null,
        "applicability" : "absent"
      },
      "approval_required" : false,
      "recipe_digest" : "1111111111111111111111111111111111111111111111111111111111111111",
      "project_id" : "project-1",
      "schema_version": 1
    }
  ],
  "schema_version": 1
}`
	profiles, err := ParsePolicyProfiles([]byte(document))
	if err != nil {
		t.Fatalf("indented/reordered operator document rejected: %v", err)
	}
	profile, ok := profiles["project-1"]
	if !ok || len(profiles) != 1 {
		t.Fatalf("parsed profiles do not contain exactly project-1: %v", profiles)
	}
	if got := string(profile.CanonicalJSON()); got != profileGolden {
		t.Fatalf("internal whitespace/key order changed canonical bytes: %s", got)
	}
	if got := profile.Digest().String(); got != "8da4ff9c757cf8ee03df97d84a3eb5a0d94211aec931094be41f575ce2dc503a" {
		t.Fatalf("internal whitespace/key order changed golden digest: %s", got)
	}
}

func TestPolicyProfiles_OperatorDocumentExample(t *testing.T) {
	data, err := os.ReadFile("../../../../docs/examples/project-policies.json")
	if err != nil {
		t.Fatalf("read checked-in operator example: %v", err)
	}
	if _, err := ParsePolicyProfiles(data); err != nil {
		t.Fatalf("checked-in operator example is not an admissible policy document: %v", err)
	}
}

func TestPolicyProfile_RunInputCompatibilityAndDocumentBounds(t *testing.T) {
	for _, n := range []int{1, 256} {
		m := policyProfileFixture()
		m.Rules = nil
		m.IntegrationBase = RunInputIntegrationBase{"present", new(domain.HashString("base").String())}
		for i := range n {
			m.Rules = append(m.Rules, RunInputVerificationRule{ACID: domain.ACID(fmt.Sprintf("界-%03d", i)), VerifierClass: "human", Independent: true, ProhibitedVerifierActor: "驗證員", ProhibitedVerifierRunRole: strings.Repeat("r", 128), EnvironmentDigest: domain.HashString("environment").String()})
		}
		p, e := NewPolicyProfile(m)
		if e != nil {
			t.Fatal(e)
		}
		input := inputMaterial()
		input.ProjectID = m.ProjectID
		input.PolicyRevisionDigest = p.Digest().String()
		input.RecipeDigest = m.RecipeDigest
		input.Rules = m.Rules
		input.ApprovalRequired = m.ApprovalRequired
		input.IntegrationBase = m.IntegrationBase
		input.ACs = nil
		for _, r := range m.Rules {
			input.ACs = append(input.ACs, InitialACBinding{r.ACID, domain.HashString(string(r.ACID)).String()})
		}
		if _, e = NewRunInput(input); e != nil {
			t.Fatal("admitted policy cannot form Run input", e)
		}
		*m.IntegrationBase.Digest = domain.HashString("mutation").String()
		view := p.Material()
		*view.IntegrationBase.Digest = domain.HashString("other mutation").String()
		if *p.Material().IntegrationBase.Digest != domain.HashString("base").String() {
			t.Fatal("integration-base pointer escaped")
		}
	}
	for _, n := range []int{32, 33} {
		profiles := []PolicyProfileMaterial{}
		for i := range n {
			m := policyProfileFixture()
			m.ProjectID = domain.ProjectID(fmt.Sprintf("p-%02d", i))
			profiles = append(profiles, m)
		}
		data, e := json.Marshal(map[string]any{"profiles": profiles, "schema_version": 1})
		if e != nil {
			t.Fatal(e)
		}
		got, e := ParsePolicyProfiles(data)
		if (e == nil) != (n == 32) {
			t.Fatal("profile cardinality", n, e)
		}
		if n == 32 && len(got) != 32 {
			t.Fatal("profile set truncated")
		}
	}
	m := policyProfileFixture()
	m.IntegrationBase = RunInputIntegrationBase{"present", new(strings.Repeat("3", 64))}
	a, _ := NewPolicyProfile(m)
	m.IntegrationBase.Digest = new(strings.Repeat("4", 64))
	b, _ := NewPolicyProfile(m)
	if a.Digest() == b.Digest() {
		t.Fatal("base digest omitted")
	}
	var reversed map[string]any
	if e := json.Unmarshal([]byte(profileGolden), &reversed); e != nil {
		t.Fatal(e)
	}
	reordered, e := json.Marshal(reversed, json.Deterministic(true))
	if e != nil {
		t.Fatal(e)
	}
	parsed, e := ParsePolicyProfile(reordered)
	if e != nil || string(parsed.CanonicalJSON()) != profileGolden {
		t.Fatal("object key order affected identity", e)
	}
}
