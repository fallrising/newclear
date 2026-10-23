package service

import (
	"bytes"
	"context"
	json "encoding/json/v2"
	"io"
	"reflect"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func TestConnectedCompletion_PreparesExactSubjectWithoutWrites(t *testing.T) {
	f := acceptedCurrentFlow(t, 1)
	before := currentHistoryCounts(t, f.db)
	content, err := f.svc.DescribeCompletion(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID)
	if err != nil {
		t.Fatalf("accepted candidate preparation unavailable: %v", err)
	}
	var got struct {
		ExpectedVersion uint64 `json:"expected_version"`
		SubjectDigest   string `json:"completion_subject_digest"`
		Subject         struct {
			Version uint64 `json:"work_item_version"`
		} `json:"completion_subject"`
	}
	if err := json.Unmarshal(content, &got); err != nil {
		t.Fatal(err)
	}
	if got.ExpectedVersion != 5 || got.Subject.Version != 6 || got.SubjectDigest != "sha256:"+f.review.Review.SubjectDigest.String() {
		t.Fatalf("wrong prepared authority: %s", content)
	}
	again, err := f.svc.DescribeCompletion(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID)
	if err != nil || !bytes.Equal(content, again) || !reflect.DeepEqual(before, currentHistoryCounts(t, f.db)) {
		t.Fatal("preparation changed history or output", err)
	}
}

func TestConnectedCompletion_QAKeepsProspectiveSubject(t *testing.T) {
	f := acceptedCurrentFlow(t, 5)
	before := currentHistoryCounts(t, f.db)
	content, err := f.svc.DescribeCompletion(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID)
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Version    uint64 `json:"expected_version"`
		Digest     string `json:"completion_subject_digest"`
		Epoch      uint64 `json:"lease_epoch"`
		Generation uint64 `json:"restore_generation"`
		Rules      []struct {
			AC          string `json:"ac_id"`
			Class       string `json:"verifier_class"`
			Independent bool   `json:"independent"`
			Environment string `json:"environment_digest"`
		} `json:"verification_rules"`
	}
	if err := json.Unmarshal(content, &got); err != nil {
		t.Fatal(err)
	}
	if got.Version != 6 || got.Digest != "sha256:"+f.complete.Subject.Digest().String() || got.Epoch != f.review.LeaseEpoch || got.Generation != f.review.RestoreGeneration || len(got.Rules) != 1 || got.Rules[0].AC != "AC-A" || got.Rules[0].Class != "independent" || !got.Rules[0].Independent || got.Rules[0].Environment != "sha256:"+f.svc.config.Completion.Checks["AC-A"].EnvironmentDigest.String() {
		t.Fatalf("wrong QA preparation: %s", content)
	}
	if !reflect.DeepEqual(before, currentHistoryCounts(t, f.db)) {
		t.Fatal("read changed history")
	}
}

type unavailablePreparationArtifacts struct{}

func (unavailablePreparationArtifacts) Put(context.Context, io.Reader) (domain.Digest, uint64, error) {
	return domain.Digest{}, 0, port.ErrNotFound
}
func (unavailablePreparationArtifacts) Open(context.Context, domain.Digest) (io.ReadCloser, error) {
	return nil, port.ErrNotFound
}

func TestConnectedCompletion_DeniesInvalidAuthority(t *testing.T) {
	for _, kind := range []string{"actor", "project", "item", "candidate", "policy", "legacy", "missing_bytes", "unknown"} {
		t.Run(kind, func(t *testing.T) {
			f := acceptedCurrentFlow(t, 1)
			actor, project, item, candidate := operator, projectID, workItemID, f.candidate.Candidate.ID
			switch kind {
			case "actor":
				actor = "unauthorized"
				f.svc.unit = nil
				f.svc.artifacts = rejectCurrentArtifacts{t: t}
			case "project":
				project = "prj_0000000000"
			case "item":
				item = "wi_0000000000"
			case "candidate":
				candidate = "other-candidate"
			case "policy":
				f.svc.config.Completion.RevisionDigest = domain.HashString("changed")
			case "legacy":
				if _, err := f.db.Exec("DROP TRIGGER run_input_envelopes_no_delete; DELETE FROM run_input_envelopes"); err != nil {
					t.Fatal(err)
				}
			case "missing_bytes":
				f.svc.artifacts = unavailablePreparationArtifacts{}
			case "unknown":
				if _, err := f.db.Exec("UPDATE runs SET observed_state='Unknown',side_effect_outcome='OutcomeUnknown'"); err != nil {
					t.Fatal(err)
				}
			}
			before := currentHistoryCounts(t, f.db)
			if got, err := f.svc.DescribeCompletion(t.Context(), actor, project, item, candidate); err == nil || got != nil {
				t.Fatal("invalid authority prepared", string(got), err)
			}
			if !reflect.DeepEqual(before, currentHistoryCounts(t, f.db)) {
				t.Fatal("rejection changed history")
			}
		})
	}
}

func TestConnectedCompletion_RechecksAfterArtifactIO(t *testing.T) {
	for _, kind := range []string{"policy", "head", "item_version"} {
		t.Run(kind, func(t *testing.T) {
			f := acceptedCurrentFlow(t, 1)
			changed := false
			f.svc.artifacts = changingCurrentArtifacts{base: f.svc.artifacts, after: func() {
				if changed {
					return
				}
				changed = true
				if kind == "policy" {
					f.svc.config.Completion.ApprovalRequired = !f.svc.config.Completion.ApprovalRequired
					return
				}
				query := "UPDATE work_item_spec_heads SET head_version=head_version+1"
				if kind == "item_version" {
					query = "UPDATE work_items SET version=version+1"
				}
				if _, err := f.db.Exec(query); err != nil {
					t.Fatal(err)
				}
			}}
			if got, err := f.svc.DescribeCompletion(t.Context(), operator, projectID, workItemID, f.candidate.Candidate.ID); err == nil || got != nil || !changed {
				t.Fatal("outside-IO change not fenced", err, changed)
			}
		})
	}
}
