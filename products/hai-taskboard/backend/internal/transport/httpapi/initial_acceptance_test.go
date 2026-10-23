package httpapi

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"context"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func TestInitialAcceptance_OptionalCapabilityFailsClosed(t *testing.T) {
	digest := "sha256:" + domain.HashString("material").String()
	body := fmt.Sprintf(`{"command_id":"cmd_01ARZ3NDEK","idempotency_key":"00000000-0000-4000-8000-000000000001","operation":"AcceptInitialSpecification","expected_version":1,"issued_at":"2026-09-10T12:00:00Z","payload":{"proposal_digest":%q,"policy_revision_digest":%q,"acceptance_subject_digest":%q,"work_items":[{"work_item_id":"wi_01ARZ3NDEK","expected_version":1}],"ac_contents":[{"ac_id":"AC-A","content":""}]}}`, digest, digest, digest)
	commands := &commandStub{}
	server := testServer(t, commands, nil, nil, nil, nil)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+string(testProjectID)+"/commands", strings.NewReader(body))
	addSession(request)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://taskboard.test")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != 503 || commands.calls != 0 {
		t.Fatalf("optional capability %d calls %d %s", response.Code, commands.calls, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/api/v1/projects/"+string(testProjectID)+"/proposals/"+digest+"/initial-acceptance", nil)
	addSession(request)
	response = httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != 404 || commands.calls != 0 {
		t.Fatalf("optional query %d calls %d", response.Code, commands.calls)
	}
}
func TestInitialAcceptance_PublicResponseStrictness(t *testing.T) {
	digest := domain.HashString("proposal")
	wireDigest := "sha256:" + digest.String()
	valid := fmt.Sprintf(`{"proposal_digest":%q,"policy_revision_digest":%q,"acceptance_subject_digest":%q,"expected_version":1,"work_items":[{"work_item_id":"wi_01ARZ3NDEK","expected_version":1}],"ac_revisions":[{"ac_id":"AC-A","revision_digest":%q}]}`, wireDigest, wireDigest, wireDigest, wireDigest)
	if !validInitialDescription([]byte(valid), digest) {
		t.Fatal("valid public description rejected")
	}
	for _, body := range []string{"", `null`, `{}`, strings.Replace(valid, `"work_items":[`, `"work_items":null,"extra":[`, 1), strings.Replace(valid, `"expected_version":1`, `"expected_version":0`, 1), strings.Replace(valid, `"ac_id":"AC-A"`, `"ac_id":null`, 1), strings.Replace(valid, `"expected_version":1`, `"expected_version":null`, 1), strings.Replace(valid, `"work_item_id":"wi_01ARZ3NDEK"`, `"work_item_id":null`, 1), strings.Replace(valid, `"work_items":[`, `"private_path":"/private","work_items":[`, 1), strings.Replace(valid, wireDigest, "sha256:"+domain.HashString("other").String(), 1)} {
		if validInitialDescription([]byte(body), digest) {
			t.Fatalf("invalid public description accepted %s", body)
		}
	}
}

func TestInitialAcceptance_ProposalACIdentity(t *testing.T) {
	for _, id := range []string{"AC-A", strings.Repeat("a", 120), "驗收:criterion"} {
		if !validInitialACID(id) {
			t.Fatalf("proposal ID rejected %q", id)
		}
	}
	for _, id := range []string{"", strings.Repeat("a", 121), "a b", "a/b", `a\b`, "a\x00", "a\u0085", "\xff"} {
		if validInitialACID(id) {
			t.Fatalf("invalid ID accepted %q", id)
		}
	}
}

type initialAcceptanceCapture struct {
	commandStub
	accepted command.AcceptInitialSpecification
}

func (c *initialAcceptanceCapture) AcceptInitialSpecification(_ context.Context, _ domain.ActorID, v command.AcceptInitialSpecification) (command.Outcome, error) {
	c.calls++
	c.accepted = v
	return command.Outcome{Payload: []byte(`{}`)}, nil
}
func TestInitialAcceptance_UnicodeUTF8ByteLimit(t *testing.T) {
	for _, tc := range []struct {
		name, id string
		want     int
	}{{"unicode_120_bytes", strings.Repeat("界", 40), 200}, {"unicode_123_bytes", strings.Repeat("界", 41), 400}, {"ascii_121_bytes", strings.Repeat("a", 121), 400}} {
		t.Run(tc.name, func(t *testing.T) {
			c := &initialAcceptanceCapture{}
			server, e := NewServer(c, &resultStub{}, &projectionStub{}, &authorityStub{}, NewHub(), Config{Origin: "https://taskboard.test"})
			if e != nil {
				t.Fatal(e)
			}
			d := "sha256:" + domain.HashString("material").String()
			body := fmt.Sprintf(`{"command_id":"cmd_01ARZ3NDEK","idempotency_key":"00000000-0000-4000-8000-000000000001","operation":"AcceptInitialSpecification","expected_version":1,"issued_at":"2026-09-10T12:00:00Z","payload":{"proposal_digest":%q,"policy_revision_digest":%q,"acceptance_subject_digest":%q,"work_items":[{"work_item_id":"wi_01ARZ3NDEK","expected_version":1}],"ac_contents":[{"ac_id":%q,"content":""}]}}`, d, d, d, tc.id)
			request := httptest.NewRequest(http.MethodPost, "/api/v1/projects/"+string(testProjectID)+"/commands", strings.NewReader(body))
			addSession(request)
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Origin", "https://taskboard.test")
			response := httptest.NewRecorder()
			server.ServeHTTP(response, request)
			if response.Code != tc.want {
				t.Fatalf("status %d %s", response.Code, response.Body.String())
			}
			if tc.want == 200 {
				if c.calls != 1 || c.accepted.ACContents[0].ACID != domain.ACID(tc.id) {
					t.Fatal("wire changed Unicode AC identity")
				}
			} else if c.calls != 0 {
				t.Fatal("oversized identity reached application")
			}
		})
	}
}
