package producer

import (
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

const testProducerID = "90f67d4e-13c5-4a3c-8d62-443f1bbb1af4"

func TestM5PR04SequenceValidationAndDedupWindow(t *testing.T) {
	t.Parallel()
	state, err := NewState(Config{})
	if err != nil {
		t.Fatal(err)
	}
	frames := []storage.Frame{testFenceFrame(t, 1, 1, -1, 0, "open-0")}
	if err := state.Replay(frames); err != nil {
		t.Fatal(err)
	}
	firstDigest := testDigest(t, "value-0")
	first := testDataFrame(t, 2, 1, 0, 0, 0, firstDigest, "value-0")
	if err := state.Apply(first); err != nil {
		t.Fatal(err)
	}
	decision, err := state.EvaluateBatch(testProducerID, 0, 0, 1, firstDigest)
	if err != nil || !decision.Duplicate || decision.Existing.BaseOffset != 0 {
		t.Fatalf("exact duplicate = %#v, %v", decision, err)
	}
	different := testDigest(t, "different")
	if _, err := state.EvaluateBatch(testProducerID, 0, 0, 1, different); !IsCode(err, CodeSequenceConflict) {
		t.Fatalf("different duplicate error = %v", err)
	}
	if _, err := state.EvaluateBatch(testProducerID, 0, 2, 1, different); !IsCode(err, CodeOutOfOrderSequence) {
		t.Fatalf("sequence gap error = %v", err)
	}
	if _, err := state.EvaluateBatch(testProducerID, 0, 0, 2, different); !IsCode(err, CodeSequenceConflict) {
		t.Fatalf("partial overlap error = %v", err)
	}

	for sequence := uint64(1); sequence <= 64; sequence++ {
		value := "window-value"
		digest := testDigest(t, value)
		frame := testDataFrame(t, sequence+2, 1, sequence, sequence, 0, digest, value)
		if err := state.Apply(frame); err != nil {
			t.Fatalf("apply sequence %d: %v", sequence, err)
		}
	}
	producer, _ := state.Producer(testProducerID)
	if len(producer.Batches) != DefaultDedupResults || producer.Batches[0].FirstSequence != 1 {
		t.Fatalf("dedup cache = %#v", producer.Batches)
	}
	if _, err := state.EvaluateBatch(testProducerID, 0, 0, 1, firstDigest); !IsCode(err, CodeDuplicateWindowExpired) {
		t.Fatalf("expired duplicate error = %v", err)
	}
}

func TestM5PR05OpenProducerCASAndRequestReplay(t *testing.T) {
	t.Parallel()
	state, err := NewState(Config{})
	if err != nil {
		t.Fatal(err)
	}
	decision, err := state.EvaluateOpen(testProducerID, -1, "open-0")
	if err != nil || decision.NewEpoch != 0 || decision.Duplicate {
		t.Fatalf("initial open = %#v, %v", decision, err)
	}
	if err := state.Apply(testFenceFrame(t, 1, 1, -1, 0, "open-0")); err != nil {
		t.Fatal(err)
	}
	decision, err = state.EvaluateOpen(testProducerID, -1, "open-0")
	if err != nil || !decision.Duplicate || decision.NewEpoch != 0 {
		t.Fatalf("request replay = %#v, %v", decision, err)
	}
	if _, err := state.EvaluateOpen(testProducerID, 0, "open-0"); !IsCode(err, CodeRequestConflict) {
		t.Fatalf("same request changed parameters: %v", err)
	}
	decision, err = state.EvaluateOpen(testProducerID, 0, "open-1")
	if err != nil || decision.NewEpoch != 1 {
		t.Fatalf("epoch increment = %#v, %v", decision, err)
	}
	if err := state.Apply(testFenceFrame(t, 2, 2, 0, 1, "open-1")); err != nil {
		t.Fatal(err)
	}
	if _, err := state.EvaluateBatch(testProducerID, 0, 0, 1, testDigest(t, "old")); !IsCode(err, CodeFencedProducer) {
		t.Fatalf("old epoch batch error = %v", err)
	}
	if _, err := state.EvaluateOpen(testProducerID, -1, "open-0"); !IsCode(err, CodeFencedProducer) {
		t.Fatalf("old fence replay error = %v", err)
	}
}

func TestM5INV07ReplayRejectsDigestThatDoesNotBindRecords(t *testing.T) {
	t.Parallel()
	state, err := NewState(Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := state.Apply(testFenceFrame(t, 1, 1, -1, 0, "open-0")); err != nil {
		t.Fatal(err)
	}
	frame := testDataFrame(t, 2, 1, 0, 0, 0, testDigest(t, "other"), "actual")
	if err := state.Apply(frame); err == nil {
		t.Fatal("DATA whose persisted digest did not bind its records was applied")
	}
}

func testFenceFrame(t *testing.T, index, term uint64, expected int64, epoch uint64, requestID string) storage.Frame {
	t.Helper()
	frame, err := storage.NewFenceFrame(index, term, storage.FenceCommand{
		ProducerID: testProducerID, ExpectedEpoch: expected, NewEpoch: epoch, RequestID: requestID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return frame
}

func testDataFrame(t *testing.T, index, term, baseOffset, sequence, epoch uint64, digest [32]byte, value string) storage.Frame {
	t.Helper()
	frame, err := storage.NewProducerDataFrame(index, term, baseOffset, 1, storage.ProducerMetadata{
		ProducerID: testProducerID, Epoch: epoch, FirstSequence: sequence, BatchDigest: digest,
	}, []storage.DataRecord{{Value: []byte(value)}})
	if err != nil {
		t.Fatal(err)
	}
	return frame
}

func testDigest(t *testing.T, value string) [32]byte {
	t.Helper()
	digest, err := protocol.BatchFingerprint([]protocol.Record{{Value: []byte(value)}})
	if err != nil {
		t.Fatal(err)
	}
	return digest
}
