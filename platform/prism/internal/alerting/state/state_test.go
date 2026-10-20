package state

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/prism/pkg/utm"
	"github.com/prometheus/prometheus/model/labels"
)

func TestSaveRejectsZero(t *testing.T) {
	mem := NewMem()
	err := mem.Save(t.Context(), "", []Row{{
		Fingerprint: 1,
		Labels:      map[string]string{"alertname": "A"},
		State:       0,
		ActiveAt:    time.Unix(1, 0).UTC(),
	}})
	if err == nil || !strings.Contains(err.Error(), "state 0") {
		t.Fatalf("state 0 err = %v", err)
	}
	err = mem.Save(t.Context(), "", []Row{{
		Fingerprint: 1,
		Labels:      map[string]string{},
		State:       Pending,
		ActiveAt:    time.Unix(1, 0).UTC(),
	}})
	if err == nil || !strings.Contains(err.Error(), "empty") {
		t.Fatalf("empty labels err = %v", err)
	}
	err = mem.Save(t.Context(), "", []Row{
		{Fingerprint: 7, Labels: map[string]string{"alertname": "A"}, State: Pending, ActiveAt: time.Unix(1, 0).UTC()},
		{Fingerprint: 7, Labels: map[string]string{"alertname": "B"}, State: Firing, ActiveAt: time.Unix(1, 0).UTC()},
	})
	if err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("duplicate err = %v", err)
	}
}

func TestFingerprintHighBit(t *testing.T) {
	mem := NewMem()
	row := Row{
		Fingerprint: math.MinInt64,
		Labels:      map[string]string{"alertname": "Hi"},
		State:       Firing,
		ActiveAt:    time.Unix(10, 0).UTC(),
	}
	if err := mem.Save(t.Context(), "", []Row{row}); err != nil {
		t.Fatal(err)
	}
	got, err := mem.Load(t.Context(), "")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Fingerprint != math.MinInt64 {
		t.Fatalf("fingerprint = %#v", got)
	}
	ls := labels.FromMap(map[string]string{"alertname": "Hi"})
	if int64(utm.Fingerprint(ls)) == 0 {
		t.Fatal("fingerprint helper returned 0")
	}
}
