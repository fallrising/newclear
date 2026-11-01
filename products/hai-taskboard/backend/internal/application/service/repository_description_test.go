package service

import (
	"bytes"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

func TestRepositoryDescription_PublicOnly(t *testing.T) {
	svc, _, db, reader, request := proposalFixture(t)
	canonical, digest, err := svc.DescribeRepository(t.Context(), operator, request.ProjectID, request.BindingID)
	if err != nil || digest != request.BindingDigest || domain.HashBytes(canonical) != digest {
		t.Fatalf("approved public query: %s %v", canonical, err)
	}
	approved, err := port.DecodeRepositoryBinding(canonical, digest)
	if err != nil || approved.Reader != nil {
		t.Fatalf("public encoding includes nonpublic values: %v", err)
	}
	canonical[0] = '!'
	again, _, err := svc.DescribeRepository(t.Context(), operator, request.ProjectID, request.BindingID)
	if err != nil || bytes.Equal(canonical, again) {
		t.Fatal("returned bytes are not copied")
	}
	for _, tc := range []struct {
		principal domain.ActorID
		project   domain.ProjectID
		id        string
	}{{"intruder", request.ProjectID, request.BindingID}, {operator, "missing-project", request.BindingID}, {operator, request.ProjectID, "missing"}} {
		if _, _, err := svc.DescribeRepository(t.Context(), tc.principal, tc.project, tc.id); err == nil {
			t.Fatal("unauthorized query succeeded")
		}
	}
	svc.config.RepositoryAuthority = nil
	if _, _, err := svc.DescribeRepository(t.Context(), operator, request.ProjectID, request.BindingID); err == nil {
		t.Fatal("absent authority succeeded")
	}
	if reader.opens.Load() != 0 {
		t.Fatal("description read Git")
	}
	assertAdmissionUnchanged(t, db)
	var count int
	if err := db.QueryRow("SELECT count(*) FROM specification_proposals").Scan(&count); err != nil || count != 0 {
		t.Fatalf("description mutated proposals: %d %v", count, err)
	}
}
