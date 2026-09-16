package raft

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

const processWorkerEnvironment = "MKFK_M3_PROCESS_WORKER"

func TestM3ThreeProcessFailoverAndRestartDriver(t *testing.T) {
	if os.Getenv(processWorkerEnvironment) == "1" {
		runM3ProcessWorker(t)
		return
	}
	topology := []byte(`{
  "version": 1,
  "cluster_id": "mkfk-m3-process",
  "brokers": [
    {"id": 1, "client_addr": "127.0.0.1:29092", "peer_addr": "127.0.0.1:29093", "admin_addr": "127.0.0.1:29094"},
    {"id": 2, "client_addr": "127.0.0.1:39092", "peer_addr": "127.0.0.1:39093", "admin_addr": "127.0.0.1:39094"},
    {"id": 3, "client_addr": "127.0.0.1:49092", "peer_addr": "127.0.0.1:49093", "admin_addr": "127.0.0.1:49094"}
  ],
  "topics": [
    {"name": "events", "internal": false, "partitions": [{"id": 0, "replicas": [1, 2, 3], "min_isr": 2}]},
    {"name": "__mkfk_groups", "internal": true, "partitions": [{"id": 0, "replicas": [1, 2, 3], "min_isr": 2}]}
  ]
}
`)
	roots := make(map[uint32]string)
	for id := uint32(1); id <= 3; id++ {
		root := filepath.Join(t.TempDir(), fmt.Sprintf("node-%d", id))
		if err := storage.FormatDataDir(root, id, topology); err != nil {
			t.Fatal(err)
		}
		roots[id] = root
	}
	workers := startM3Workers(t, roots)
	defer func() { stopM3Workers(workers) }()

	ready := workers[1].request(t, processCommand{Operation: "campaign"}).mustReady(t)
	drainProcessMessages(t, workers, append([]Message(nil), ready.Messages...), 500)
	if snapshot := workers[1].snapshot(t); snapshot.Role != Leader || !snapshot.LeaderReady {
		t.Fatalf("initial process leader = %#v", snapshot)
	}
	proposal := workers[1].request(t, processCommand{Operation: "propose", Value: "before-failover"})
	proposalReady := proposal.mustReady(t)
	firstIndex := proposal.Index
	drainProcessMessages(t, workers, append([]Message(nil), proposalReady.Messages...), 500)
	heartbeatProcessLeader(t, workers, 1)
	for id := uint32(1); id <= 3; id++ {
		snapshot := workers[id].snapshot(t)
		if snapshot.CommitIndex < proposal.Index || snapshot.LastApplied < proposal.Index {
			t.Fatalf("node %d did not commit first process proposal: %#v", id, snapshot)
		}
	}

	workers[1].stop()
	delete(workers, 1)
	ready = workers[2].request(t, processCommand{Operation: "campaign"}).mustReady(t)
	drainProcessMessages(t, workers, append([]Message(nil), ready.Messages...), 500)
	if snapshot := workers[2].snapshot(t); snapshot.Role != Leader || !snapshot.LeaderReady {
		t.Fatalf("failover process leader = %#v", snapshot)
	}
	proposal = workers[2].request(t, processCommand{Operation: "propose", Value: "after-failover"})
	proposalReady = proposal.mustReady(t)
	drainProcessMessages(t, workers, append([]Message(nil), proposalReady.Messages...), 500)
	heartbeatProcessLeader(t, workers, 2)
	secondIndex := proposal.Index
	for _, id := range []uint32{2, 3} {
		if snapshot := workers[id].snapshot(t); snapshot.CommitIndex < secondIndex {
			t.Fatalf("node %d did not commit post-failover proposal: %#v", id, snapshot)
		}
	}

	stopM3Workers(workers)
	workers = startM3Workers(t, roots)
	ready = workers[3].request(t, processCommand{Operation: "campaign"}).mustReady(t)
	drainProcessMessages(t, workers, append([]Message(nil), ready.Messages...), 800)
	if snapshot := workers[3].snapshot(t); snapshot.Role != Leader || !snapshot.LeaderReady || snapshot.CommitIndex < secondIndex {
		t.Fatalf("leader after all-process restart = %#v", snapshot)
	}
	for id := uint32(1); id <= 3; id++ {
		result := workers[id].request(t, processCommand{Operation: "status"})
		if result.Snapshot == nil || result.Snapshot.LastLogIndex < secondIndex || result.LEO != 2 {
			t.Fatalf("node %d restart status = %#v", id, result)
		}
		minimumReplay := firstIndex
		if id != 1 {
			minimumReplay = secondIndex
		}
		if result.RecoveredApplied < int(minimumReplay) {
			t.Fatalf("node %d replayed %d entries, want at least %d", id, result.RecoveredApplied, minimumReplay)
		}
	}
}

type processCommand struct {
	Operation string   `json:"operation"`
	Message   *Message `json:"message,omitempty"`
	Value     string   `json:"value,omitempty"`
}

type processResult struct {
	Ready            *Ready    `json:"ready,omitempty"`
	Snapshot         *Snapshot `json:"snapshot,omitempty"`
	Index            uint64    `json:"index,omitempty"`
	LEO              uint64    `json:"leo,omitempty"`
	RecoveredApplied int       `json:"recovered_applied,omitempty"`
	Error            string    `json:"error,omitempty"`
}

func (result processResult) mustReady(t *testing.T) Ready {
	t.Helper()
	if result.Error != "" {
		t.Fatal(result.Error)
	}
	if result.Ready == nil {
		t.Fatal("worker result has no Ready value")
	}
	return *result.Ready
}

type processWorker struct {
	id      uint32
	command *exec.Cmd
	input   io.WriteCloser
	encoder *json.Encoder
	decoder *json.Decoder
	stderr  bytes.Buffer
}

func startM3Workers(t *testing.T, roots map[uint32]string) map[uint32]*processWorker {
	t.Helper()
	workers := make(map[uint32]*processWorker, 3)
	for id := uint32(1); id <= 3; id++ {
		command := exec.Command(os.Args[0], "-test.run=^TestM3ThreeProcessFailoverAndRestartDriver$")
		command.Env = append(os.Environ(),
			processWorkerEnvironment+"=1",
			"MKFK_M3_NODE_ID="+strconv.FormatUint(uint64(id), 10),
			"MKFK_M3_ROOT="+roots[id],
		)
		stdin, err := command.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		stdout, err := command.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		worker := &processWorker{id: id, command: command, input: stdin, encoder: json.NewEncoder(stdin), decoder: json.NewDecoder(stdout)}
		command.Stderr = &worker.stderr
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
		workers[id] = worker
	}
	return workers
}

func stopM3Workers(workers map[uint32]*processWorker) {
	for _, worker := range workers {
		worker.stop()
	}
}

func (worker *processWorker) stop() {
	if worker == nil || worker.command == nil || worker.command.Process == nil {
		return
	}
	_ = worker.command.Process.Kill()
	_ = worker.command.Wait()
	worker.command = nil
}

func (worker *processWorker) request(t *testing.T, command processCommand) processResult {
	t.Helper()
	if err := worker.encoder.Encode(command); err != nil {
		t.Fatalf("encode command for worker %d: %v; stderr=%s", worker.id, err, worker.stderr.String())
	}
	resultChannel := make(chan processResult, 1)
	errorChannel := make(chan error, 1)
	go func() {
		var result processResult
		if err := worker.decoder.Decode(&result); err != nil {
			errorChannel <- err
			return
		}
		resultChannel <- result
	}()
	select {
	case result := <-resultChannel:
		if result.Error != "" {
			t.Fatalf("worker %d: %s", worker.id, result.Error)
		}
		return result
	case err := <-errorChannel:
		t.Fatalf("decode worker %d response: %v; stderr=%s", worker.id, err, worker.stderr.String())
	case <-time.After(10 * time.Second):
		t.Fatalf("worker %d response timed out; stderr=%s", worker.id, worker.stderr.String())
	}
	return processResult{}
}

func (worker *processWorker) snapshot(t *testing.T) Snapshot {
	t.Helper()
	result := worker.request(t, processCommand{Operation: "status"})
	if result.Snapshot == nil {
		t.Fatal("worker status has no snapshot")
	}
	return *result.Snapshot
}

func drainProcessMessages(t *testing.T, workers map[uint32]*processWorker, queue []Message, limit int) {
	t.Helper()
	for len(queue) > 0 && limit > 0 {
		message := queue[0]
		queue = queue[1:]
		worker := workers[message.To]
		if worker == nil {
			limit--
			continue
		}
		result := worker.request(t, processCommand{Operation: "step", Message: &message})
		ready := result.mustReady(t)
		queue = append(queue, ready.Messages...)
		limit--
	}
	if len(queue) > 0 {
		t.Fatalf("process message queue did not quiesce (%d remain)", len(queue))
	}
}

func heartbeatProcessLeader(t *testing.T, workers map[uint32]*processWorker, leader uint32) {
	t.Helper()
	for range 2 {
		ready := workers[leader].request(t, processCommand{Operation: "tick"}).mustReady(t)
		drainProcessMessages(t, workers, append([]Message(nil), ready.Messages...), 500)
	}
}

func runM3ProcessWorker(t *testing.T) {
	nodeIDValue := os.Getenv("MKFK_M3_NODE_ID")
	nodeID64, err := strconv.ParseUint(nodeIDValue, 10, 32)
	if err != nil {
		t.Fatal(err)
	}
	nodeID := uint32(nodeID64)
	root := os.Getenv("MKFK_M3_ROOT")
	topology, err := os.ReadFile(filepath.Join(root, "cluster.json"))
	if err != nil {
		t.Fatal(err)
	}
	dataDir, err := storage.OpenDataDir(root, nodeID, topology)
	if err != nil {
		t.Fatal(err)
	}
	partition, err := dataDir.OpenPartition("events", 0)
	if err != nil {
		t.Fatal(err)
	}
	node, err := NewNode(Config{
		Identity: testIdentity, NodeID: nodeID, Voters: []uint32{1, 2, 3},
		ElectionTimeoutTicks: 5 + uint64(nodeID), HeartbeatTicks: 2,
	}, partition)
	if err != nil {
		t.Fatal(err)
	}
	recovered := len(node.RecoveredApplied())
	decoder := json.NewDecoder(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	for {
		var command processCommand
		if err := decoder.Decode(&command); err != nil {
			if errors.Is(err, io.EOF) {
				return
			}
			t.Fatal(err)
		}
		result := processResult{RecoveredApplied: recovered}
		var ready Ready
		switch command.Operation {
		case "campaign":
			ready, err = node.Campaign()
			result.Ready = &ready
		case "tick":
			ready, err = node.Tick()
			result.Ready = &ready
		case "step":
			if command.Message == nil {
				err = errors.New("step requires a message")
				break
			}
			ready, err = node.Step(*command.Message)
			result.Ready = &ready
		case "propose":
			result.Index, ready, err = node.ProposeData(uint64(time.Now().UnixMilli()), []storage.DataRecord{{Key: nil, Value: []byte(command.Value)}})
			result.Ready = &ready
		case "status":
			snapshot := node.Snapshot()
			result.Snapshot = &snapshot
			result.LEO = partition.LEO()
		default:
			err = fmt.Errorf("unknown worker operation %q", command.Operation)
		}
		if err != nil {
			result.Error = err.Error()
		}
		if err := encoder.Encode(result); err != nil {
			t.Fatal(err)
		}
	}
}
