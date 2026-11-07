package service

import (
	"bytes"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"maps"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

type discoveredMaterial struct {
	ProjectID  string `json:"project_id"`
	WorkItemID string `json:"work_item_id"`
	Phase      string `json:"phase"`
	Version    uint64 `json:"work_item_version"`
	Accepted   *struct {
		Kind string `json:"acceptance_kind"`
	} `json:"accepted_specification"`
	ACs []struct {
		ACID   string `json:"ac_id"`
		Digest string `json:"revision_digest"`
	} `json:"required_ac_revisions"`
	Runs []struct {
		ID    string `json:"run_id"`
		Input string `json:"input_digest"`
	} `json:"runs"`
	Candidates []struct {
		ID    string `json:"candidate_id"`
		RunID string `json:"run_id"`
		Input string `json:"input_subject_digest"`
	} `json:"candidates"`
}

func readDiscoveredMaterial(t *testing.T, h http.Handler) discoveredMaterial {
	t.Helper()
	r := initialHTTPRequest(h, "GET", "/api/v1/projects/"+string(projectID)+"/work-items/"+string(workItemID)+"/material-index", nil, true, false)
	if r.Code != 200 {
		t.Fatalf("material discovery HTTP%d %s", r.Code, r.Body)
	}
	var w discoveredMaterial
	if e := json.Unmarshal(r.Body.Bytes(), &w); e != nil {
		t.Fatal(e)
	}
	if w.ProjectID != string(projectID) || w.WorkItemID != string(workItemID) || len(w.Runs) != 1 || len(w.Candidates) != 1 || w.Candidates[0].RunID != w.Runs[0].ID || w.Candidates[0].Input != w.Runs[0].Input {
		t.Fatalf("discovery identities %+v", w)
	}
	return w
}

// Downstream URLs use only identifiers returned by material-index.
func consumeDiscoveredMaterial(t *testing.T, h http.Handler, index discoveredMaterial) []byte {
	t.Helper()
	base := "/api/v1/projects/" + index.ProjectID + "/work-items/" + index.WorkItemID
	output := initialHTTPRequest(h, "GET", base+"/runs/"+index.Candidates[0].RunID+"/outputs", nil, true, false)
	if output.Code != 200 {
		t.Fatal("discovered outputs", output.Code, output.Body)
	}
	prep := initialHTTPRequest(h, "GET", base+"/candidates/"+index.Candidates[0].ID+"/completion-preparation", nil, true, false)
	if prep.Code != 200 {
		t.Fatal("discovered preparation", prep.Code, prep.Body)
	}
	return bytes.Clone(prep.Body.Bytes())
}
func TestWorkItemMaterialIndex_DiscoverThenComplete(t *testing.T) {
	t.Run("accepted_unicode_fake_reports_restart_done", func(t *testing.T) { testAcceptedMultiACHTTPAndRestart(t, true) })
	t.Run("stale_intent_after_discovery", func(t *testing.T) {
		f := acceptedCurrentFlow(t, 5)
		h, e := httpapi.NewServer(f.svc, httpapi.UnitCommandResults{Unit: f.store}, httpapi.PersistedProjections{Store: f.store}, initialHTTPAuthority{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
		if e != nil {
			t.Fatal(e)
		}
		before := preparationDatabaseSnapshot(t, f.db)
		ids := maps.Clone(f.svc.ids.(*sequenceIDs).values)
		index := readDiscoveredMaterial(t, h)
		prep := consumeDiscoveredMaterial(t, h, index)
		coverage := initialHTTPRequest(h, "GET", "/api/v1/projects/"+index.ProjectID+"/work-items/"+index.WorkItemID+"/candidates/"+index.Candidates[0].ID+"/verified-coverage", nil, true, false)
		var observed coverageTestResponse
		if coverage.Code != 200 || json.Unmarshal(coverage.Body.Bytes(), &observed) != nil || !observed.Eligibility.Satisfied {
			t.Fatal(coverage.Code, coverage.Body)
		}
		if index.Phase != "QA" || !bytes.Equal(before, preparationDatabaseSnapshot(t, f.db)) || !maps.Equal(ids, f.svc.ids.(*sequenceIDs).values) {
			t.Fatal("observation completed or wrote")
		}
		var prepared map[string]jsontext.Value
		if e = json.Unmarshal(prep, &prepared); e != nil {
			t.Fatal(e)
		}
		meta := initialMetadata(190, 6)
		body, e := json.Marshal(map[string]any{"command_id": meta.CommandID, "idempotency_key": meta.IdempotencyKey, "issued_at": meta.IssuedAt.UTC().Format(time.RFC3339Nano), "expected_version": index.Version, "operation": string(command.CompleteWorkItemOperation), "payload": map[string]any{"work_item_id": index.WorkItemID, "completion_subject": prepared["completion_subject"]}})
		if e != nil {
			t.Fatal(e)
		}
		// Change actual subject semantics. A head counter alone is metadata, not
		// a changed CompletionSubject; the original counter-only attempt is retained.
		// This explicit configuration fault is not an Impact activation writer.
		f.svc.config.Completion.RecipeDigest = domain.HashString("changed completion recipe")
		rejected := initialHTTPRequest(h, "POST", "/api/v1/projects/"+index.ProjectID+"/commands", body, true, true)
		if rejected.Code != 409 || !strings.Contains(rejected.Body.String(), "stale_subject") {
			t.Fatalf("stale discovered intent %d %s", rejected.Code, rejected.Body)
		}
		item, e := f.store.LoadWorkItem(t.Context(), projectID, workItemID)
		if e != nil || item.Phase() != domain.PhaseQA {
			t.Fatal("stale intent entered Done", e)
		}
	})
}

func TestWorkItemMaterialIndex_MissingPolicyAndArtifactsStillReadable(t *testing.T) {
	f := acceptedCurrentFlow(t, 1)
	f.svc.artifacts = rejectCurrentArtifacts{t: t}
	f.svc.config.ProjectPolicies = nil
	f.svc.config.Completion.Checks = nil
	h, e := httpapi.NewServer(f.svc, httpapi.UnitCommandResults{Unit: f.store}, httpapi.PersistedProjections{Store: f.store}, initialHTTPAuthority{}, httpapi.NewHub(), httpapi.Config{Origin: "https://taskboard.test"})
	if e != nil {
		t.Fatal(e)
	}
	before := preparationDatabaseSnapshot(t, f.db)
	ids := maps.Clone(f.svc.ids.(*sequenceIDs).values)
	_ = readDiscoveredMaterial(t, h)
	if !bytes.Equal(before, preparationDatabaseSnapshot(t, f.db)) || !maps.Equal(ids, f.svc.ids.(*sequenceIDs).values) {
		t.Fatal("metadata read wrote state")
	}
}
