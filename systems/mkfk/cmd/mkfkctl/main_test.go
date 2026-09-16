package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/pkg/client"
)

func TestM5PR07CLIResumesDurablePendingBatchBeforeNewInput(t *testing.T) {
	ledgerPath := filepath.Join(t.TempDir(), "producer-ledger.json")
	ledger, err := client.NewFileLedger(ledgerPath)
	if err != nil {
		t.Fatal(err)
	}
	pending := client.LedgerState{
		Version: client.LedgerVersion, ClusterID: "cli-cluster", ProducerID: testCLIProducerID,
		Topic: "events", Partition: 0, Epoch: 0, NextSequence: 0,
		Pending: &client.PendingBatch{
			RequestID: "crash-pending", FirstSequence: 0,
			Records: []client.Record{{Key: nil, Value: []byte("from-ledger")}},
		},
	}
	if err := ledger.Save(pending); err != nil {
		t.Fatal(err)
	}
	var received protocol.ProduceRequest
	var receivedRequestID string
	previousClient := commandHTTPClient
	commandHTTPClient = commandDoerFunc(func(request *http.Request) (*http.Response, error) {
		receivedRequestID = request.Header.Get("X-Request-ID")
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Error(err)
		}
		encoded, err := json.Marshal(protocol.ProduceResponse{
			RequestID: receivedRequestID,
			Data: protocol.ProduceResponseData{
				BaseOffset: 0, LastOffset: 0, NextSequence: 1, Duplicate: true, LeaderTerm: 2,
			},
		})
		if err != nil {
			return nil, err
		}
		return &http.Response{
			StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}},
			Body: io.NopCloser(strings.NewReader(string(encoded))),
		}, nil
	})
	defer func() { commandHTTPClient = previousClient }()
	newInput := base64.StdEncoding.EncodeToString([]byte("must-not-replace-pending"))
	err = run([]string{
		"produce", "--brokers", "1=http://broker.invalid:9092", "--broker", "1",
		"--cluster", "cli-cluster", "--producer", testCLIProducerID,
		"--topic", "events", "--partition", "0", "--epoch", "0",
		"--ledger", ledgerPath, "--value-base64", newInput,
	})
	if err != nil {
		t.Fatal(err)
	}
	validated, err := received.Validate()
	if err != nil {
		t.Fatal(err)
	}
	if receivedRequestID != "crash-pending" || received.FirstSequence != 0 || len(validated.Records) != 1 || string(validated.Records[0].Value) != "from-ledger" {
		t.Fatalf("CLI did not resume exact pending batch: request=%#v ID=%q", received, receivedRequestID)
	}
	state, exists, err := ledger.Load()
	if err != nil || !exists || state.Pending != nil || state.NextSequence != 1 {
		t.Fatalf("CLI success ledger = %#v exists=%v err=%v", state, exists, err)
	}
}

const testCLIProducerID = "90f67d4e-13c5-4a3c-8d62-443f1bbb1af4"

type commandDoerFunc func(*http.Request) (*http.Response, error)

func (function commandDoerFunc) Do(request *http.Request) (*http.Response, error) {
	return function(request)
}
