package main

import (
	"bytes"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain/sqlite"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/testfixture"
)

// The accepted v1 record is explicitly historical storage fixture material;
// the separate completion test proves current public HTTP policy registration.
func TestRuntimePolicyProfiles_LegacyStartupReplay(t *testing.T) {
	for _, version := range []string{"v1", "v2"} {
		for _, selectedOther := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/other=%t", version, selectedOther), func(t *testing.T) {
				root := privateTestRoot(t)
				sequence := 2000
				h := startPolicyClient(t, root, "", "", &sequence)
				original := h.request(t, "POST", "/api/v1/projects", []byte(testCreateBody), 200)
				h.command(t, testProjectID, 0, "CreateWorkItem", map[string]any{"work_item_id": "wi_0000000001", "title": "Historical Draft", "goal": "Legacy compatibility", "owner_id": "local-operator", "required_ac_revisions": []any{}}, 200)
				other := domain.ProjectID("prj_0123456789ABCDEFGHJKMNPV")
				if selectedOther {
					h.createProject(t, other)
				}
				h.stop(t)
				s, e := sqlite.OpenAtRootWithClock(t.Context(), root, filepath.Join(root, "state", "taskboard.sqlite"), time.Now)
				if e != nil {
					t.Fatal(e)
				}
				if e = testfixture.Accept(t.Context(), s, testProjectID, "local-operator", domain.HashString("local-policy-"+version), domain.HashString("local-recipe-v1"), "local", []byte("historical AC"), []domain.WorkItemID{"wi_0000000001"}, time.Now().UnixNano()); e != nil {
					t.Fatal(e)
				}
				if e = s.Close(); e != nil {
					t.Fatal(e)
				}
				selector := ""
				if selectedOther {
					selector = filepath.Join(privateTestRoot(t), "policies.json")
					if e = os.WriteFile(selector, policyDocument(t, runtimePolicy(t, other, []domain.ACID{"local"}, true)), 0600); e != nil {
						t.Fatal(e)
					}
				}
				h = startPolicyClient(t, root, "", selector, &sequence)
				before := policyCounts(t, root)
				again := h.request(t, "POST", "/api/v1/projects", []byte(testCreateBody), 200)
				if !bytes.Equal(original, again) || !reflect.DeepEqual(before, policyCounts(t, root)) {
					t.Fatal("legacy replay changed")
				}
				expected := 200
				if version == "v1" {
					expected = 422
				}
				result, _ := h.command(t, testProjectID, 2, "MarkReady", map[string]any{"work_item_id": "wi_0000000001"}, expected)
				if version == "v1" {
					policyError(t, result, "lifecycle_rejected")
				}
			})
		}
	}
}

func TestRuntimePolicyProfiles_RegistrationSurvivesLaterListenFailure(t *testing.T) {
	root := privateTestRoot(t)
	sequence := 3000
	h := startPolicyClient(t, root, "", "", &sequence)
	h.createProject(t, testProjectID)
	config := h.config
	h.stop(t)
	file := filepath.Join(privateTestRoot(t), "policies.json")
	if e := os.WriteFile(file, policyDocument(t, runtimePolicy(t, testProjectID, []domain.ACID{"local"}, false)), 0600); e != nil {
		t.Fatal(e)
	}
	config.CompletionPoliciesFile = file
	held, e := net.Listen("tcp", config.ListenAddress)
	if e != nil {
		t.Fatal(e)
	}
	defer held.Close()
	before := policyCounts(t, root)
	if running, e := startRuntime(t.Context(), config, nil); e == nil {
		running.stopRuntime()
		waitRuntime(t, running)
		t.Fatal("occupied listener unexpectedly succeeded")
	}
	after := policyCounts(t, root)
	if after[0] != 1 || !reflect.DeepEqual(before[1:], after[1:]) {
		t.Fatal("later failure changed non-registration data", before, after)
	}
	config.CompletionPoliciesFile = ""
	if running, e := startRuntime(t.Context(), config, nil); e == nil {
		running.stopRuntime()
		waitRuntime(t, running)
		t.Fatal("committed registration forgotten after failed listen")
	}
	held.Close()
	h = startPolicyClient(t, root, "", file, &sequence)
	if !reflect.DeepEqual(after, policyCounts(t, root)) {
		t.Fatal("recovery startup rewrote registration")
	}
	h.stop(t)
}
