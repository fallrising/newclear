package domain_test

import (
	"bytes"
	json "encoding/json/v2"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/specification"
)

func TestACIdentity_AcceptedBoundary(t *testing.T) {
	for _, tc := range []struct {
		name, id string
		valid    bool
	}{
		{"ascii80", strings.Repeat("a", 80), true}, {"ascii81", strings.Repeat("a", 81), true}, {"ascii120", strings.Repeat("a", 120), true}, {"ascii121", strings.Repeat("a", 121), false},
		{"unicode120", strings.Repeat("界", 40), true}, {"unicode121", strings.Repeat("界", 40) + "a", false}, {"empty", "", false}, {"invalidUTF8", string([]byte{255}), false},
		{"C0", "a\x00b", false}, {"C1", "a\u0085b", false}, {"space", "a b", false}, {"NBSP", "a\u00a0b", false}, {"ideographicSpace", "a\u3000b", false}, {"slash", "a/b", false}, {"backslash", `a\b`, false},
		{"ZWSP", "a\u200bb", true}, {"BOM", "a\ufeffb", true}, {"bidi", "a\u202eb", true}, {"NFC", "é", true}, {"NFD", "e\u0301", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if domain.ValidACID(tc.id) != tc.valid {
				t.Fatalf("validator disagrees: %q", tc.id)
			}
			d := domain.HashString("fixture").String()
			// Inject the literal invalid UTF-8 rather than letting a test encoder repair it.
			quoted, err := json.Marshal(tc.id)
			if err != nil {
				quoted = append(append([]byte{'"'}, []byte(tc.id)...), '"')
			}
			manifest := []byte(`{"schema_version":1,"nodes":[{"id":"SPEC","path":"a.md","required":true,"work_item_ids":["wi"],"required_ac_revisions":[{"ac_id":` + string(quoted) + `,"ac_revision_digest":"` + d + `"}],"recipe_digest":"` + d + `"}],"edges":[]}`)
			parsed, err := specification.ParseManifest(manifest)
			if (err == nil) != tc.valid {
				t.Fatalf("proposal disagrees: %v", err)
			}
			if tc.valid && !bytes.Contains(parsed.CanonicalJSON(), quoted) {
				t.Fatal("proposal changed exact identity")
			}
			m := port.RunInputMaterial{Schema: 1, ProjectID: "project", WorkItemID: "work", ReadyVersion: 1, BindingDigest: d, GraphRevisionDigest: d, PolicyRevisionDigest: d, RecipeDigest: d, ACs: []port.InitialACBinding{{ACID: domain.ACID(tc.id), Digest: d}}, Rules: []port.RunInputVerificationRule{{ACID: domain.ACID(tc.id), VerifierClass: "human", Independent: true, EnvironmentDigest: d}}, IntegrationBase: port.RunInputIntegrationBase{Applicability: "absent"}, AdapterID: "fake/v1", AdapterVersion: "1", ScenarioID: "success"}
			input, err := port.NewRunInput(m)
			if (err == nil) != tc.valid {
				t.Fatalf("Run input disagrees: %v", err)
			}
			if tc.valid {
				decoded, err := port.DecodeRunInput(input.CanonicalJSON(), input.Digest())
				if err != nil || string(decoded.Material().ACs[0].ACID) != tc.id {
					t.Fatal("stored input changed identity", err)
				}
				m.ACs = append(m.ACs, m.ACs[0])
				m.Rules = append(m.Rules, m.Rules[0])
				if _, err := port.NewRunInput(m); err == nil {
					t.Fatal("duplicate stored identity accepted")
				}
			} else {
				// A hostile stored envelope cannot bypass the constructor's identity checks.
				raw, err := json.Marshal(m)
				if err == nil {
					if _, err = port.DecodeRunInput(raw, domain.HashBytes(raw)); err == nil {
						t.Fatal("invalid stored identity accepted")
					}
				}
			}
		})
	}
}
