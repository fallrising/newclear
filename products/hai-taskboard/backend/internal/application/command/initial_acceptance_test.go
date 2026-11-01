package command

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func TestInitialAcceptance_CanonicalCompatibility(t *testing.T) {
	m := Metadata{CommandID: "cmd_01HABCDEFGH", IdempotencyKey: "00000000-0000-4000-8000-000000000001", IssuedAt: time.Unix(1, 0).UTC(), CorrelationID: "initial"}
	q := CreateWorkItem{Metadata: m, ProjectID: "prj_01HABCDEFGH", WorkItemID: "wi_01HABCDEFGH", Title: "title", Goal: "goal", OwnerID: "operator", RequiredACRevisions: []ACRevision{}}
	empty, _, e := CanonicalCreateWorkItem(q)
	if e != nil || !bytes.Contains(empty, []byte(`"required_ac_revisions":[]`)) {
		t.Fatalf("explicit empty encoding %s %v", empty, e)
	}
	q.RequiredACRevisions = []ACRevision{{ACID: "AC-A", RevisionDigest: domain.HashString("AC")}}
	b, _, e := CanonicalCreateWorkItem(q)
	if e != nil {
		t.Fatal(e)
	}
	expected := `{"api_version":"v1","operation":"CreateWorkItem","command_id":"cmd_01HABCDEFGH","idempotency_key":"00000000-0000-4000-8000-000000000001","project_id":"prj_01HABCDEFGH","expected_version":0,"issued_at":"1970-01-01T00:00:01Z","work_item_id":"wi_01HABCDEFGH","title":"title","goal":"goal","owner_id":"operator","required_ac_revisions":[{"ac_id":"AC-A","ac_revision_digest":"` + domain.HashString("AC").String() + `"}]}`
	if string(b) != expected {
		t.Fatalf("nonempty canonical bytes changed %s", b)
	}
	old := Result{Type: "ProjectCreated", ProjectID: q.ProjectID, Version: 1}
	payload, e := CanonicalSuccess(m, CreateProjectOperation, old, 1, port.Cursor{Epoch: 1, Sequence: 1})
	if e != nil {
		t.Fatal(e)
	}
	oldExpected := `{"api_version":"v1","ok":true,"command":{"command_id":"cmd_01HABCDEFGH","operation":"CreateProject","status":"recorded","replayed":false},"result":{"type":"ProjectCreated","project_id":"prj_01HABCDEFGH","version":1},"audit":{"sequence":1},"projection_cursor":{"stream_epoch":1,"event_sequence":1},"correlation_id":"initial"}`
	if string(payload) != oldExpected {
		t.Fatalf("old result changed %s", payload)
	}
	for _, field := range []string{"accepted_revision_digest", "acceptance_subject_digest"} {
		bad := strings.Replace(string(payload), `"result":{`, `"result":{"`+field+`":"sha256:`+domain.HashString("forged").String()+`",`, 1)
		if _, e := DecodeCanonicalResult([]byte(bad), m.CommandID, CreateProjectOperation); e == nil {
			t.Fatalf("unrelated operation accepts %s", field)
		}
	}
}
func TestInitialAcceptance_CommandBounds(t *testing.T) {
	q := AcceptInitialSpecification{Metadata: Metadata{CommandID: "cmd_01HABCDEFGH", IdempotencyKey: "00000000-0000-4000-8000-000000000001", ExpectedVersion: 1, IssuedAt: time.Unix(1, 0).UTC(), CorrelationID: "initial"}, ProjectID: "prj_01HABCDEFGH", ProposalDigest: domain.HashString("proposal"), PolicyRevisionDigest: domain.HashString("policy"), AcceptanceSubjectDigest: domain.HashString("subject"), WorkItems: []port.InitialWorkItemVersion{{WorkItemID: "wi_01HABCDEFGH", ExpectedVersion: 1}}, ACContents: []InitialACContent{{ACID: "AC-A", Content: []byte("exact")}}}
	if _, _, e := CanonicalAcceptInitialSpecification(q); e != nil {
		t.Fatal(e)
	}
	for _, kind := range []string{"items", "ac_count", "body", "total", "version"} {
		t.Run(kind, func(t *testing.T) {
			v := q
			switch kind {
			case "items":
				v.WorkItems = make([]port.InitialWorkItemVersion, 257)
			case "ac_count":
				v.ACContents = make([]InitialACContent, 257)
			case "body":
				v.ACContents = []InitialACContent{{ACID: "AC-A", Content: make([]byte, 65537)}}
			case "total":
				v.ACContents = []InitialACContent{}
				for i := range 9 {
					v.ACContents = append(v.ACContents, InitialACContent{ACID: domain.ACID(string(rune('A' + i))), Content: make([]byte, 65536)})
				}
			case "version":
				v.ExpectedVersion = 1<<63 - 1
			}
			if _, _, e := CanonicalAcceptInitialSpecification(v); e == nil {
				t.Fatal("unsupported capacity accepted")
			}
		})
	}
}
