package peer

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/storage"
)

const (
	testCluster = "mkfk-peer-test"
	testHash    = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
)

var identity = raft.Identity{ClusterID: testCluster, ConfigHash: testHash, GroupID: "events/2"}

func sampleMessages() []raft.Message {
	return []raft.Message{
		{Kind: raft.MessageRequestVote, Identity: identity, From: 1, To: 2, Term: 7, RPCID: 3, Vote: &raft.RequestVote{LastLogIndex: 9, LastLogTerm: 6}},
		{Kind: raft.MessageRequestVoteResponse, Identity: identity, From: 2, To: 1, Term: 7, RPCID: 3, VoteResp: &raft.RequestVoteResponse{Granted: true}},
		{Kind: raft.MessageAppendEntries, Identity: identity, From: 1, To: 3, Term: 7, RPCID: 4, Append: &raft.AppendEntries{
			PrevLogIndex: 9, PrevLogTerm: 6, LeaderCommit: 9,
			Entries: []storage.Frame{{Kind: storage.KindNOOP, LogIndex: 10, Term: 7, Payload: []byte("{}")}},
		}},
		{Kind: raft.MessageAppendEntries, Identity: raft.Identity{ClusterID: testCluster, ConfigHash: testHash, GroupID: "__mkfk_groups/0"},
			From: 1, To: 3, Term: 7, RPCID: 5, Append: &raft.AppendEntries{PrevLogIndex: 10, PrevLogTerm: 7, LeaderCommit: 10, ReadContext: "read-1"}},
		{Kind: raft.MessageAppendResponse, Identity: identity, From: 3, To: 1, Term: 7, RPCID: 5, AppendResp: &raft.AppendResponse{
			Success: true, MatchedIndex: 10, ReadContext: "read-1",
		}},
	}
}

func TestM7PeerWireRoundTripsEveryMessageKind(t *testing.T) {
	t.Parallel()
	for _, message := range sampleMessages() {
		wire, err := Encode(message)
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(wire)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(encoded), `"term":"7"`) {
			t.Fatalf("64-bit fields must be decimal strings: %s", encoded)
		}
		var decodedWire Message
		if err := json.Unmarshal(encoded, &decodedWire); err != nil {
			t.Fatal(err)
		}
		decoded, err := Decode(decodedWire)
		if err != nil {
			t.Fatal(err)
		}
		if message.Append != nil && message.Append.Entries == nil {
			message.Append.Entries = decoded.Append.Entries
		}
		if !reflect.DeepEqual(decoded, message) {
			t.Fatalf("round trip changed the message:\n got %+v\nwant %+v", decoded, message)
		}
	}
}

// stepBackend answers every request with a fixed reply and counts calls.
type stepBackend struct {
	calls atomic.Int32
	reply raft.Message
	hwErr error
}

func (b *stepBackend) Step(_ context.Context, request raft.Message) ([]raft.Message, error) {
	b.calls.Add(1)
	reply := b.reply
	reply.RPCID = request.RPCID
	return []raft.Message{reply}, nil
}

func (b *stepBackend) HighWatermark(context.Context, string, uint32) (uint64, error) {
	b.calls.Add(1)
	return 42, b.hwErr
}

func newPeerServer(t *testing.T, backend *stepBackend) (*httptest.Server, *Client) {
	t.Helper()
	server, err := NewServer(backend, testCluster, testHash)
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server)
	t.Cleanup(httpServer.Close)
	client, err := NewClient(httpServer.Client(), strings.TrimPrefix(httpServer.URL, "http://"), testCluster, testHash)
	if err != nil {
		t.Fatal(err)
	}
	return httpServer, client
}

func TestM7PeerClientCarriesAlgorithmReplyAndLeaderHint(t *testing.T) {
	t.Parallel()
	messages := sampleMessages()
	backend := &stepBackend{reply: messages[1]}
	_, client := newPeerServer(t, backend)
	replies, err := client.Step(context.Background(), messages[0])
	if err != nil || len(replies) != 1 || replies[0].VoteResp == nil || !replies[0].VoteResp.Granted || replies[0].RPCID != 3 {
		t.Fatalf("vote reply = %+v, %v", replies, err)
	}
	if _, err := client.Step(context.Background(), messages[1]); err == nil {
		t.Fatal("a response kind was sent as a request")
	}
	if hw, err := client.HighWatermark(context.Background(), "events", 2); err != nil || hw != 42 {
		t.Fatalf("HW = %d, %v", hw, err)
	}
	backend.hwErr = &NotLeaderError{LeaderID: 3}
	var notLeader *NotLeaderError
	if _, err := client.HighWatermark(context.Background(), "events", 2); !errors.As(err, &notLeader) || notLeader.LeaderID != 3 || !errors.Is(err, raft.ErrNotLeader) {
		t.Fatalf("follower HW error = %v, want NOT_LEADER with hint 3", err)
	}
}

// OP-01 on the peer listener: malformed, mismatched, or oversized bodies
// are rejected with a typed error and never reach a partition.
func TestM7OP01MalformedPeerRequestsNeverReachBackend(t *testing.T) {
	t.Parallel()
	backend := &stepBackend{reply: sampleMessages()[1]}
	server, _ := newPeerServer(t, backend)
	vote, _ := Encode(sampleMessages()[0])
	valid, _ := json.Marshal(vote)
	readBarrier, _ := Encode(sampleMessages()[3])
	readBody, _ := json.Marshal(readBarrier)
	wrongHash := strings.Replace(string(valid), testHash, strings.Repeat("f", 64), 1)
	for name, test := range map[string]struct{ path, body, want string }{
		"duplicate key":   {PathRequestVote, strings.Replace(string(valid), `"from":1`, `"from":1,"from":1`, 1), "INVALID_REQUEST"},
		"unknown field":   {PathRequestVote, strings.Replace(string(valid), `"from":1`, `"from":1,"extra":true`, 1), "INVALID_REQUEST"},
		"string term":     {PathRequestVote, strings.Replace(string(valid), `"term":"7"`, `"term":7`, 1), "INVALID_REQUEST"},
		"kind vs path":    {PathAppendEntries, string(valid), "INVALID_REQUEST"},
		"read vs append":  {PathAppendEntries, string(readBody), "INVALID_REQUEST"},
		"wrong topology":  {PathRequestVote, wrongHash, "IDENTITY_MISMATCH"},
		"path traversal":  {PathRequestVote, strings.Replace(string(valid), `"topic":"events"`, `"topic":"../events"`, 1), "INVALID_REQUEST"},
		"bad base64":      {PathAppendEntries, `{"cluster_id":"` + testCluster + `","config_hash":"` + testHash + `","partition":{"topic":"events","id":0},"kind":"append_entries","from":1,"to":2,"term":"1","rpc_id":"1","append":{"prev_log_index":"0","prev_log_term":"0","leader_commit":"0","read_context":"","entries":[{"kind":2,"log_index":"1","term":"1","payload_base64":"%%%"}]}}`, "INVALID_REQUEST"},
		"oversized body":  {PathRequestVote, `{"pad":"` + strings.Repeat("x", MaxBodyBytes) + `"}`, "REQUEST_TOO_LARGE"},
		"high-watermark ": {PathHighWatermark, `{"cluster_id":"` + testCluster + `","config_hash":"` + testHash + `","partition":{"topic":"../x","id":0}}`, "INVALID_REQUEST"},
	} {
		response, err := http.Post(server.URL+test.path, "application/json", strings.NewReader(test.body))
		if err != nil {
			t.Fatal(err)
		}
		var body ErrorBody
		_ = json.NewDecoder(response.Body).Decode(&body)
		_ = response.Body.Close()
		if response.StatusCode == http.StatusOK || body.Error.Code != test.want {
			t.Fatalf("%s: HTTP %d code %q, want %s", name, response.StatusCode, body.Error.Code, test.want)
		}
	}
	if calls := backend.calls.Load(); calls != 0 {
		t.Fatalf("%d malformed requests reached the backend", calls)
	}
}
