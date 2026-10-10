package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"testing"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/command"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
)

// These exercise the public completion command over the existing normalized
// in-memory transaction port, with actual digest-correct bytes. Each collection
// stays within its row bound; the object-count test crosses the union of Candidate
// bindings and report objects, which a single SQLite collection limit cannot test.
func TestCompleteWorkItem_MaterialObjectBudgets(t *testing.T) {
	const tenMiB = 10 * 1024 * 1024
	const fiftyMiB = 50 * 1024 * 1024
	for _, test := range []struct {
		name      string
		sizes     []int
		small     int
		rejected  bool
		reason    domain.RejectionCode
		wantOpens int
		wantBytes int
	}{
		{name: "per-object-exact-10MiB", sizes: []int{tenMiB}, wantOpens: 3, wantBytes: tenMiB + 17},
		{name: "per-object-over-10MiB", sizes: []int{tenMiB + 1}, rejected: true, reason: domain.CodeCandidateUnavailable, wantOpens: 1, wantBytes: 9},
		{name: "aggregate-exact-50MiB", sizes: []int{tenMiB, tenMiB, tenMiB, tenMiB, tenMiB - 17}, wantOpens: 7, wantBytes: fiftyMiB},
		{name: "aggregate-over-50MiB", sizes: []int{tenMiB, tenMiB, tenMiB, tenMiB, tenMiB - 16}, rejected: true, reason: domain.CodeEvidenceUnavailable, wantOpens: 6, wantBytes: fiftyMiB - 7},
		{name: "distinct-exact-1024", small: 1022, wantOpens: 1024},
		{name: "distinct-over-1024", small: 1023, rejected: true, reason: domain.CodeEvidenceUnavailable, wantOpens: 1024},
		{name: "zero-byte-object", sizes: []int{0}, wantOpens: 3, wantBytes: 17},
	} {
		t.Run(test.name, func(t *testing.T) {
			application, unit, subject := completionFixture(t)
			material := unit.state.materials[itemKey(projectID, workItemID)]
			provider := &budgetArtifacts{unit: unit, objects: map[domain.Digest][]byte{
				domain.HashString("candidate"): []byte("candidate"), domain.HashString("artifact"): []byte("artifact"),
			}, opened: make(map[domain.Digest]bool)}
			for index, size := range test.sizes {
				addBudgetCandidate(&material, provider, bytes.Repeat([]byte{byte(index + 1)}, size))
			}
			for index := range test.small {
				addBudgetCandidate(&material, provider, fmt.Appendf(nil, "supplement-%04d", index))
			}
			unit.state.materials[itemKey(projectID, workItemID)] = material
			application.artifacts = provider
			before := unit.snapshot()
			outcome, err := application.CompleteWorkItem(t.Context(), operator, completeCommand(subject))
			if test.rejected {
				assertCommandError(t, err, "done_gate_unsatisfied")
				if test.reason == domain.CodeCandidateUnavailable {
					assertReason(t, err, test.reason)
				} else {
					// The union budget may be reached while visiting either a bound
					// Candidate object or a report; visitation order is not authority.
					failure, ok := errors.AsType[*command.Error](err)
					if !ok || (len(failure.Reasons) != 1 || (failure.Reasons[0] != domain.CodeCandidateUnavailable && failure.Reasons[0] != domain.CodeEvidenceUnavailable)) {
						t.Fatalf("budget rejection does not name unavailable material: %#v", err)
					}
				}
				assertOnlyFailureRecorded(t, before, unit.snapshot())
			} else {
				if err != nil || len(outcome.Payload) == 0 || unit.state.workItems[itemKey(projectID, workItemID)].Phase() != domain.PhaseDone || len(unit.state.completions) != 1 {
					t.Fatalf("legal material budget failed completion: outcome=%#v error=%v", outcome, err)
				}
			}
			if provider.closed != provider.opens || provider.ioInside || len(provider.opened) > 1024 || provider.readBytes > fiftyMiB {
				t.Fatalf("bounded open/close/transaction behavior = %d/%d/%t, unique=%d bytes=%d", provider.opens, provider.closed, provider.ioInside, len(provider.opened), provider.readBytes)
			}
			for digest := range provider.opened {
				if len(provider.objects[digest]) > tenMiB {
					t.Fatal("completion opened material over the per-object budget")
				}
			}
			if test.rejected {
				return // Rejection timing/order may vary within the normative budgets.
			}
			if provider.opens != test.wantOpens {
				t.Fatalf("exact legal material set opened %d objects, want %d", provider.opens, test.wantOpens)
			}
			wantBytes := test.wantBytes
			if test.small > 0 {
				wantBytes = 9 + test.small*len("supplement-0000")
				if !test.rejected {
					wantBytes += 8
				}
			}
			if provider.readBytes != wantBytes {
				t.Fatalf("budget rejected too late or read the wrong set: bytes=%d want=%d", provider.readBytes, wantBytes)
			}
		})
	}
}

func addBudgetCandidate(material *port.CompletionMaterial, provider *budgetArtifacts, content []byte) {
	digest := domain.HashBytes(content)
	provider.objects[digest] = content
	material.CandidateArtifacts = append(material.CandidateArtifacts, port.Artifact{Digest: digest, MediaType: "application/octet-stream",
		ByteLength: uint64(len(content)), StorageKey: "sha256:" + digest.String(), Availability: "Present"})
}

type budgetArtifacts struct {
	unit      *memoryUnit
	objects   map[domain.Digest][]byte
	opens     int
	opened    map[domain.Digest]bool
	closed    int
	readBytes int
	ioInside  bool
}

func (provider *budgetArtifacts) Put(context.Context, io.Reader) (domain.Digest, uint64, error) {
	return domain.Digest{}, 0, fmt.Errorf("unexpected publication during completion")
}

func (provider *budgetArtifacts) Open(_ context.Context, digest domain.Digest) (io.ReadCloser, error) {
	provider.opens++
	provider.opened[digest] = true
	provider.ioInside = provider.ioInside || provider.unit.withinActive
	content, present := provider.objects[digest]
	if !present {
		return nil, fmt.Errorf("budget fixture object is absent")
	}
	return &budgetReader{reader: bytes.NewReader(content), provider: provider}, nil
}

type budgetReader struct {
	reader   *bytes.Reader
	provider *budgetArtifacts
}

func (reader *budgetReader) Read(buffer []byte) (int, error) {
	reader.provider.ioInside = reader.provider.ioInside || reader.provider.unit.withinActive
	count, err := reader.reader.Read(buffer)
	reader.provider.readBytes += count
	return count, err
}

func (reader *budgetReader) Close() error {
	reader.provider.ioInside = reader.provider.ioInside || reader.provider.unit.withinActive
	reader.provider.closed++
	return nil
}
