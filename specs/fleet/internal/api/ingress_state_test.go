package api

import (
	"context"
	"testing"
	"time"

	"github.com/fallrising/newclear/specs/fleet/internal/ingress"
	"github.com/fallrising/newclear/specs/fleet/internal/model"
	"github.com/fallrising/newclear/specs/fleet/internal/store"
)

type recordingIngress struct {
	ingress.Noop
	st *store.Store
}

func (r recordingIngress) ReconcileService(_ context.Context, v ingress.ServiceView) error {
	return r.st.SetIngress(v.Name, "pending", "", "dns-new", "app-new", "policy-new")
}

func TestEnqueuePreservesReconciledAccessIDs(t *testing.T) {
	e := newTest(t)
	if err := e.st.CreateNode(&model.Node{ID: "vps-a"}); err != nil {
		t.Fatal(err)
	}
	if err := e.st.InsertService(&model.Service{Name: "dashboard", NodeID: "vps-a", ExposeMode: "access", Hostname: "dashboard.example.com", ContainerPort: 8080, HostPort: 20001, FleetJSON: "{}"}); err != nil {
		t.Fatal(err)
	}
	e.s.ing = recordingIngress{st: e.st}
	e.s.ingressNA = false
	e.s.enqueueService("dashboard")
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		svc, err := e.st.GetService("dashboard")
		if err != nil {
			t.Fatal(err)
		}
		if svc.IngressStatus == "ok" {
			if svc.CFDNSRecordID != "dns-new" || svc.CFAccessAppID != "app-new" || svc.CFAccessPolicyID != "policy-new" {
				t.Fatalf("reconciled IDs overwritten: %+v", svc)
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("reconcile did not complete")
}
