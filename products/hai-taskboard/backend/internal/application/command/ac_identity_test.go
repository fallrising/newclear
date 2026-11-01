package command

import (
	"bytes"
	json "encoding/json/v2"
	"fmt"
	"strings"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func identityInitial(id string) AcceptInitialSpecification {
	h := humanCommand()
	d := domain.HashString("digest")
	return AcceptInitialSpecification{Metadata: h.Metadata, ProjectID: h.ProjectID, ProposalDigest: d, PolicyRevisionDigest: d, AcceptanceSubjectDigest: d, WorkItems: []port.InitialWorkItemVersion{{WorkItemID: h.WorkItemID, ExpectedVersion: 1}}, ACContents: []InitialACContent{{ACID: domain.ACID(id), Content: []byte("exact")}}}
}

func identityHuman(id string) SubmitHumanReport {
	h := humanCommand()
	d := domain.HashString("digest")
	h.Kind, h.Review = "evidence", nil
	h.Evidence = &HumanEvidenceIntent{ACID: domain.ACID(id), ACRevisionDigest: d, RecipeDigest: d, EnvironmentDigest: d, Verdict: "Passing"}
	return h
}

func identityFixture(id string) PublishFixtureEvidence {
	h := humanCommand()
	d := domain.HashString("digest")
	return PublishFixtureEvidence{Metadata: h.Metadata, ProjectID: h.ProjectID, RunID: h.RunID, LeaseEpoch: 1, RestoreGeneration: 1, Evidence: Evidence{ID: "evidence", SubjectDigest: d, ACID: domain.ACID(id), ACRevisionDigest: d, ObservationVerdict: "Passing", ReviewDisposition: "Accepted", Applicability: "Fresh", MaterialAvailability: "Present", VerifierID: "operator", VerifierClass: "human", RecipeDigest: d, EnvironmentDigest: d, ObservedAt: h.IssuedAt, Report: ArtifactLocator{Digest: d, MediaType: "text/plain", ByteLength: 6, Availability: "Present"}}}
}

func TestACIdentity_CommandIngress(t *testing.T) {
	for _, tc := range []struct {
		name, id string
		valid    bool
	}{
		{"ascii80", strings.Repeat("a", 80), true}, {"ascii81", strings.Repeat("a", 81), true}, {"ascii120", strings.Repeat("a", 120), true}, {"ascii121", strings.Repeat("a", 121), false},
		{"unicode120", strings.Repeat("界", 40), true}, {"unicode121", strings.Repeat("界", 40) + "a", false},
		{"empty", "", false}, {"invalid-utf8", string([]byte{255}), false}, {"nul", "a\x00b", false}, {"control", "a\u0085b", false},
		{"space", "a b", false}, {"nbsp", "a\u00a0b", false}, {"ideographic-space", "a\u3000b", false}, {"slash", "a/b", false}, {"backslash", `a\b`, false},
		{"zero-width-space", "a\u200bb", true}, {"bom-character", "a\ufeffb", true}, {"bidi-format", "a\u202eb", true}, {"NFC", "é", true}, {"NFD", "e\u0301", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := CanonicalAcceptInitialSpecification(identityInitial(tc.id)); (err == nil) != tc.valid {
				t.Errorf("initial acceptance=%v want=%v", err, tc.valid)
			}
			if _, _, err := CanonicalSubmitHumanReport(identityHuman(tc.id)); (err == nil) != tc.valid {
				t.Errorf("human evidence=%v want=%v", err, tc.valid)
			}
			// Fixture canonicalization retains its old text80 vocabulary for recorded replay.
			if _, _, err := CanonicalPublishFixtureEvidence(identityFixture(tc.id)); (err == nil) != (tc.valid || validText(tc.id, 80)) {
				t.Errorf("fixture evidence=%v", err)
			}
		})
	}
	q := identityInitial("same")
	q.ACContents = append(q.ACContents, q.ACContents[0])
	if _, _, err := CanonicalAcceptInitialSpecification(q); err == nil {
		t.Fatal("duplicate identity accepted")
	}
	q.ACContents = []InitialACContent{{ACID: "é", Content: []byte("NFC")}, {ACID: "e\u0301", Content: []byte("NFD")}}
	if _, _, err := CanonicalAcceptInitialSpecification(q); err != nil {
		t.Fatal("distinct Unicode identities merged", err)
	}
}

func TestACIdentity_CanonicalCompatibility(t *testing.T) {
	for _, id := range []string{"AC-1", strings.Repeat("x", 80), "legacy space", "legacy/slash", `legacy\slash`} {
		t.Run(id, func(t *testing.T) {
			q := identityFixture(id)
			got, digest, err := CanonicalPublishFixtureEvidence(q)
			if err != nil {
				t.Fatal(err)
			}
			quoted, err := json.Marshal(id)
			if err != nil {
				t.Fatal(err)
			}
			d := "sha256:" + domain.HashString("digest").String()
			want := fmt.Sprintf(`{"api_version":"v1","operation":"PublishFixtureEvidence","command_id":"cmd_01HABCDEFGH","idempotency_key":"00000000-0000-4000-8000-000000000001","project_id":"prj_01HABCDEFGH","expected_version":4,"issued_at":"1970-01-01T00:00:01Z","run_id":"run_01HABCDEFGH","lease_epoch":1,"restore_generation":1,"evidence":{"evidence_id":"evidence","completion_subject_digest":"%s","ac_id":%s,"ac_revision_digest":"%s","observation_verdict":"Passing","review_disposition":"Accepted","applicability":"Fresh","material_availability":"Present","verifier_id":"operator","verifier_class":"human","recipe_digest":"%s","environment_digest":"%s","observed_at":"1970-01-01T00:00:01Z","report":{"sha256":"%s","media_type":"text/plain","byte_length":6,"availability":"Present"}}}`, d, quoted, d, d, d, d)
			if !bytes.Equal(got, []byte(want)) || digest != domain.HashString(want) {
				t.Fatalf("legacy canonical bytes/hash changed: %s", got)
			}
			q.CorrelationID = "retry"
			replayed, other, err := CanonicalPublishFixtureEvidence(q)
			if err != nil || !bytes.Equal(replayed, got) || other != digest {
				t.Fatal("retry identity changed", err)
			}
		})
	}
	_, nfc, err := CanonicalSubmitHumanReport(identityHuman("é"))
	if err != nil {
		t.Fatal(err)
	}
	_, nfd, err := CanonicalSubmitHumanReport(identityHuman("e\u0301"))
	if err != nil || nfc == nfd {
		t.Fatal("Unicode identity normalized", err)
	}
}
