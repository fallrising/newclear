package httpapi

import (
	json "encoding/json/v2"
	"reflect"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func TestACIdentity_HTTPIngress(t *testing.T) {
	for _, id := range []string{strings.Repeat("a", 80), strings.Repeat("a", 81), strings.Repeat("a", 120), strings.Repeat("a", 121), strings.Repeat("界", 40), strings.Repeat("界", 40) + "a", "", string([]byte{255}), "a\x00b", "a\u0085b", "a b", "a\u00a0b", "a\u3000b", "a/b", `a\b`, "a\u200bb", "a\ufeffb", "a\u202eb", "é", "e\u0301"} {
		t.Run(id, func(t *testing.T) {
			want := domain.ValidACID(id)
			if validInitialACID(id) != want {
				t.Fatal("HTTP profile differs")
			}
			d := "sha256:" + domain.HashString("digest").String()
			wire := humanEvidenceWire{ACID: id, ACRevisionDigest: d, RecipeDigest: d, EnvironmentDigest: d, Verdict: "Passing"}
			raw, err := json.Marshal(wire)
			if err == nil {
				err = strictCommandWire(raw, reflect.TypeFor[humanEvidenceWire]())
			}
			if (err == nil) != want {
				t.Fatalf("strict HTTP evidence=%v want=%v", err, want)
			}
		})
	}
	for _, literal := range []string{`"\ud800"`, `"\udc00"`} {
		d := "sha256:" + domain.HashString("digest").String()
		raw := []byte(`{"ac_id":` + literal + `,"ac_revision_digest":"` + d + `","recipe_digest":"` + d + `","environment_digest":"` + d + `","verdict":"Passing"}`)
		if strictCommandWire(raw, reflect.TypeFor[humanEvidenceWire]()) == nil {
			t.Fatal("lone surrogate accepted")
		}
	}
}
