package client

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

const clientTestProducerID = "90f67d4e-13c5-4a3c-8d62-443f1bbb1af4"

func TestM5PR07ReplyLossRetriesExactLedgerBatch(t *testing.T) {
	t.Parallel()
	ledger := &memoryLedger{}
	transport := &scriptedTransport{steps: []transportStep{
		{err: &ResponseError{HTTPStatus: 504, API: protocol.APIError{
			Code: "REQUEST_TIMEOUT", Retryable: true, Outcome: protocol.OutcomeUnknown,
		}}},
		{response: protocol.ProduceResponseData{
			BaseOffset: 0, LastOffset: 0, NextSequence: 1, Duplicate: true, LeaderTerm: 2,
		}},
	}}
	producer := newTestClientProducer(t, ledger, transport, 4)
	response, err := producer.Send(context.Background(), []Record{{Key: nil, Value: []byte("hello")}})
	if err != nil || !response.Duplicate || response.BaseOffset != 0 || response.NextSequence != 1 {
		t.Fatalf("produce = %#v, %v", response, err)
	}
	if len(transport.calls) != 2 || transport.requestIDs[0] != transport.requestIDs[1] || !reflect.DeepEqual(transport.calls[0], transport.calls[1]) {
		t.Fatalf("retry changed identity or batch: IDs=%v calls=%#v", transport.requestIDs, transport.calls)
	}
	if transport.calls[0].ProducerID != clientTestProducerID || transport.calls[0].Partition != 0 || transport.calls[0].FirstSequence != 0 {
		t.Fatalf("retry request lost partition identity: %#v", transport.calls[0])
	}
	state := producer.State()
	if state.Pending != nil || state.NextSequence != 1 {
		t.Fatalf("success did not durably advance ledger: %#v", state)
	}
}

func TestM5PR07LedgerCrashCutpoints(t *testing.T) {
	t.Parallel()
	t.Run("pending-save-before-send", func(t *testing.T) {
		ledger := &memoryLedger{failSaveAt: map[int]error{1: errors.New("injected pending save failure")}}
		transport := &scriptedTransport{}
		producer := newTestClientProducer(t, ledger, transport, 1)
		if _, err := producer.Send(context.Background(), []Record{{Value: []byte("x")}}); err == nil {
			t.Fatal("pending ledger failure was ignored")
		}
		if len(transport.calls) != 0 {
			t.Fatal("batch was sent before its pending ledger record was durable")
		}
	})

	t.Run("crash-after-pending-before-send", func(t *testing.T) {
		ledger := &memoryLedger{}
		failedTransport := &scriptedTransport{steps: []transportStep{{err: errors.New("connection lost before response")}}}
		producer := newTestClientProducer(t, ledger, failedTransport, 1)
		if _, err := producer.Send(context.Background(), []Record{{Value: []byte("resume")}}); err == nil {
			t.Fatal("connection loss unexpectedly succeeded")
		}
		persisted, exists, err := ledger.Load()
		if err != nil || !exists || persisted.Pending == nil || persisted.NextSequence != 0 {
			t.Fatalf("pending batch was not durable: %#v, %v", persisted, err)
		}
		successTransport := &scriptedTransport{steps: []transportStep{{response: protocol.ProduceResponseData{
			BaseOffset: 0, LastOffset: 0, NextSequence: 1, Duplicate: false, LeaderTerm: 1,
		}}}}
		restarted := newTestClientProducer(t, ledger, successTransport, 1)
		if _, err := restarted.Resume(context.Background()); err != nil {
			t.Fatal(err)
		}
		if len(successTransport.calls) != 1 || successTransport.requestIDs[0] != persisted.Pending.RequestID || successTransport.calls[0].FirstSequence != 0 {
			t.Fatalf("restart did not resend the exact ledger batch: %#v", successTransport.calls)
		}
	})

	t.Run("success-before-ledger-update", func(t *testing.T) {
		ledger := &memoryLedger{failSaveAt: map[int]error{2: errors.New("injected success update failure")}}
		transport := &scriptedTransport{steps: []transportStep{{response: protocol.ProduceResponseData{
			BaseOffset: 0, LastOffset: 0, NextSequence: 1, LeaderTerm: 1,
		}}}}
		producer := newTestClientProducer(t, ledger, transport, 1)
		if _, err := producer.Send(context.Background(), []Record{{Value: []byte("acked")}}); err == nil {
			t.Fatal("ledger update failure after broker success was hidden")
		} else {
			var updateError *LedgerUpdateError
			if !errors.As(err, &updateError) {
				t.Fatalf("error = %T %v", err, err)
			}
		}
		persisted, _, _ := ledger.Load()
		if persisted.Pending == nil || persisted.NextSequence != 0 {
			t.Fatalf("failed ledger update advanced sequence: %#v", persisted)
		}
		ledger.failSaveAt = nil
		retryTransport := &scriptedTransport{steps: []transportStep{{response: protocol.ProduceResponseData{
			BaseOffset: 0, LastOffset: 0, NextSequence: 1, Duplicate: true, LeaderTerm: 2,
		}}}}
		restarted := newTestClientProducer(t, ledger, retryTransport, 1)
		response, err := restarted.Resume(context.Background())
		if err != nil || !response.Duplicate {
			t.Fatalf("post-crash retry = %#v, %v", response, err)
		}
	})
}

func TestM5OP04RetryIsBoundedAndKeepsPendingOnFailure(t *testing.T) {
	t.Parallel()
	ledger := &memoryLedger{}
	transport := &scriptedTransport{steps: []transportStep{
		{err: errors.New("network down")}, {err: errors.New("network down")}, {err: errors.New("network down")},
	}}
	producer := newTestClientProducer(t, ledger, transport, 3)
	if _, err := producer.Send(context.Background(), []Record{{Value: []byte("bounded")}}); err == nil {
		t.Fatal("bounded retries unexpectedly succeeded")
	}
	if len(transport.calls) != 3 {
		t.Fatalf("attempt count = %d, want 3", len(transport.calls))
	}
	if producer.State().Pending == nil || producer.State().NextSequence != 0 {
		t.Fatalf("failed delivery changed pending identity: %#v", producer.State())
	}
	first := transport.calls[0]
	for index := 1; index < len(transport.calls); index++ {
		if !reflect.DeepEqual(first, transport.calls[index]) || transport.requestIDs[0] != transport.requestIDs[index] {
			t.Fatal("bounded retry mutated the batch")
		}
	}
}

func newTestClientProducer(t *testing.T, ledger Ledger, transport Transport, attempts int) *Producer {
	t.Helper()
	producer, err := NewProducer(ProducerConfig{
		ClusterID: "m5-client", ProducerID: clientTestProducerID, Topic: "events", Partition: 0, Epoch: 0,
		Transport: transport, Ledger: ledger, MaxAttempts: attempts,
		DeliveryTimeout: time.Minute, BaseBackoff: time.Millisecond, MaxBackoff: 4 * time.Millisecond,
		Waiter: noWaiter{}, Random: fixedRandom(0), RequestIDs: func() (string, error) { return "request-fixed", nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	return producer
}

type transportStep struct {
	response protocol.ProduceResponseData
	err      error
}

type scriptedTransport struct {
	steps      []transportStep
	calls      []protocol.ProduceRequest
	requestIDs []string
}

func (transport *scriptedTransport) Produce(_ context.Context, requestID string, request protocol.ProduceRequest) (protocol.ProduceResponseData, error) {
	transport.requestIDs = append(transport.requestIDs, requestID)
	transport.calls = append(transport.calls, request)
	index := len(transport.calls) - 1
	if index >= len(transport.steps) {
		return protocol.ProduceResponseData{}, errors.New("unexpected transport call")
	}
	return transport.steps[index].response, transport.steps[index].err
}

type memoryLedger struct {
	state      LedgerState
	exists     bool
	saves      int
	failSaveAt map[int]error
}

func (ledger *memoryLedger) Load() (LedgerState, bool, error) {
	return cloneLedgerState(ledger.state), ledger.exists, nil
}

func (ledger *memoryLedger) Save(state LedgerState) error {
	ledger.saves++
	if err := ledger.failSaveAt[ledger.saves]; err != nil {
		return err
	}
	ledger.state = cloneLedgerState(state)
	ledger.exists = true
	return nil
}

type noWaiter struct{}

func (noWaiter) Wait(ctx context.Context, _ time.Duration) error { return ctx.Err() }

type fixedRandom uint64

func (random fixedRandom) Uint64() (uint64, error) { return uint64(random), nil }

var _ Transport = (*scriptedTransport)(nil)
var _ Ledger = (*memoryLedger)(nil)
