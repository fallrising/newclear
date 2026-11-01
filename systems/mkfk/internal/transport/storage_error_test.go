package transport

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/partition"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

// A write that hit a storage failure may still survive recovery, so its
// outcome is unknown; a request refused by an already failed partition was
// never applied. A NOT_LEADER answer names the leader when it is known.
func TestM7StorageFailuresAndLeaderHintsMapToContract(t *testing.T) {
	t.Parallel()
	for name, test := range map[string]struct {
		err     error
		status  int
		code    string
		outcome protocol.Outcome
		leader  any
	}{
		"failing write":     {fmt.Errorf("%w: sync WAL", partition.ErrStorage), http.StatusServiceUnavailable, "STORAGE_ERROR", protocol.OutcomeUnknown, nil},
		"failed partition":  {partition.ErrFailed, http.StatusServiceUnavailable, "STORAGE_ERROR", protocol.OutcomeNotApplied, nil},
		"actor busy":        {fmt.Errorf("%w: deadline", partition.ErrBusy), http.StatusTooManyRequests, "RESOURCE_EXHAUSTED", protocol.OutcomeNotApplied, nil},
		"hinted not leader": {&LeaderHint{Err: raft.ErrNotLeader, LeaderID: 3, Term: 9}, http.StatusConflict, "NOT_LEADER", protocol.OutcomeNotApplied, float64(3)},
		"unknown leader":    {&LeaderHint{Err: raft.ErrNotLeader}, http.StatusConflict, "NOT_LEADER", protocol.OutcomeNotApplied, nil},
	} {
		handler, _ := NewProducerHandler(&fakeProducerBackend{produceErr: test.err})
		response := serveProducerRequest(handler, "/v1/produce", "trace", validProduceJSON)
		var envelope protocol.ErrorEnvelope
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if response.Code != test.status || envelope.Error.Code != test.code || envelope.Error.Outcome != test.outcome || envelope.Error.Details["leader_id"] != test.leader {
			t.Fatalf("%s: HTTP %d %+v", name, response.Code, envelope.Error)
		}
	}
}
