package command

import (
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
)

func TestProposalResult_StrictOperationAndIdentity(t *testing.T) {
	m := Metadata{CommandID: "cmd_01HABCDEFGP", CorrelationID: "proposal", IssuedAt: time.Now()}
	r := Result{Type: "SpecificationProposed", ProjectID: "prj_01HABCDEFGH", Version: 1, ProposalDigest: "sha256:" + strings.Repeat("1", 64), GraphDigest: "sha256:" + strings.Repeat("2", 64), ObjectFormat: "sha1", CommitOID: strings.Repeat("3", 40)}
	payload, err := CanonicalSuccess(m, ProposeSpecificationOperation, r, 1, port.Cursor{Epoch: 1, Sequence: 1})
	if err != nil {
		t.Fatal(err)
	}
	if failure, err := DecodeCanonicalResult(payload, m.CommandID, ProposeSpecificationOperation); failure != nil || err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"digest", "oid", "format", "type", "legacy_operation"} {
		t.Run(kind, func(t *testing.T) {
			copy := r
			op := ProposeSpecificationOperation
			switch kind {
			case "digest":
				copy.ProposalDigest = strings.Repeat("1", 64)
			case "oid":
				copy.CommitOID = strings.Repeat("3", 64)
			case "format":
				copy.ObjectFormat = "unknown"
			case "type":
				copy.Type = "ProjectCreated"
			case "legacy_operation":
				op = CreateProjectOperation
				copy.Type = "ProjectCreated"
			}
			if _, err := CanonicalSuccess(m, op, copy, 1, port.Cursor{Epoch: 1, Sequence: 1}); err == nil {
				t.Fatal("invalid operation/result accepted")
			}
		})
	}
}
