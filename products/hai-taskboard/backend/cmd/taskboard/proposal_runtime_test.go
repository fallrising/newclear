package main

import (
	"bytes"
	"context"
	json "encoding/json/v2"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/application/port"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

func TestAdmission_HTTPReplayAndRestart(t *testing.T) {
	git, gitDir, commit := proposalGitFixture(t)
	approvedFile := writeRepositoryConfig(t, git, gitDir)
	root := privateTestRoot(t)
	start := func(address string) (*runningRuntime, context.CancelFunc, *http.Client, string, runtimeConfig) {
		t.Helper()
		listener, err := net.Listen("tcp", address)
		if err != nil {
			t.Fatal(err)
		}
		address = listener.Addr().String()
		config, err := loadRuntimeConfig(func(k string) string {
			return map[string]string{"HAI_TASKBOARD_DATA_ROOT": root, "HAI_TASKBOARD_LISTEN_ADDR": address, "HAI_TASKBOARD_ORIGIN": "http://" + address, "HAI_TASKBOARD_SESSION_TOKEN": testSessionToken, "HAI_TASKBOARD_APPROVED_REPOSITORIES_FILE": approvedFile}[k]
		}, nil)
		if err != nil {
			listener.Close()
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(t.Context())
		runtime, err := startRuntime(ctx, config, listener)
		if err != nil {
			cancel()
			listener.Close()
			t.Fatal(err)
		}
		return runtime, cancel, &http.Client{Transport: &http.Transport{Proxy: nil}, Timeout: 5 * time.Second}, config.Origin, config
	}
	runtime, cancel, client, base, config := start("127.0.0.1:0")
	stopped := false
	t.Cleanup(func() {
		client.CloseIdleConnections()
		if !stopped {
			cancel()
			waitRuntime(t, runtime)
		}
	})
	requireHTTPBody(t, client, createProjectRequest(t, base, base, testSessionToken), 200)
	path := "/api/v1/projects/" + testProjectID
	request := func(method, path, body, token, origin string) *http.Request {
		t.Helper()
		r, err := http.NewRequestWithContext(t.Context(), method, base+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Content-Type", "application/json")
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if token != "" {
			r.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: token})
		}
		return r
	}
	public := requireHTTPBody(t, client, request("GET", path+"/repository-bindings/binding", "", testSessionToken, ""), 200)
	var binding struct {
		Digest string `json:"binding_digest"`
	}
	if err := json.Unmarshal(public, &binding); err != nil || binding.Digest == "" || bytes.Contains(public, []byte(gitDir)) {
		t.Fatalf("binding: %s %v", public, err)
	}
	body := proposalBody(binding.Digest)
	first := requireHTTPBody(t, client, request("POST", path+"/commands", body, testSessionToken, base), 200)
	var result struct {
		Result struct {
			Digest string `json:"proposal_digest"`
			Commit string `json:"commit_oid"`
		} `json:"result"`
	}
	if err := json.Unmarshal(first, &result); err != nil || result.Result.Commit != commit {
		t.Fatalf("proposal result: %s %v", first, err)
	}
	digest, err := httpapi.DecodeSHA256(result.Result.Digest)
	if err != nil {
		t.Fatal(err)
	}
	if err = runtime.store.Within(t.Context(), func(tx port.Transaction) error {
		proposal, err := tx.(port.AdmissionTransaction).LoadProposal(t.Context(), testProjectID, digest)
		if err == nil && proposal.Commit().String() != commit {
			t.Fatal("provenance")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	// Consume the existing SSE wire format with a bounded request lifetime.
	sseCtx, stopSSE := context.WithTimeout(t.Context(), 2*time.Second)
	sseRequest := request("GET", path+"/events?cursor=1:1", "", testSessionToken, "").WithContext(sseCtx)
	sseResponse, err := client.Do(sseRequest)
	if err != nil {
		stopSSE()
		t.Fatal(err)
	}
	chunk := make([]byte, 4096)
	n, readErr := sseResponse.Body.Read(chunk)
	sseResponse.Body.Close()
	stopSSE()
	if readErr != nil && readErr != io.EOF || sseResponse.StatusCode != 200 || !bytes.Contains(chunk[:n], []byte("project.changed")) {
		t.Fatalf("SSE shape: %d %q %v", sseResponse.StatusCode, chunk[:n], readErr)
	}
	for _, tc := range []struct {
		body, token, origin string
		status              int
	}{{body, "", base, 401}, {body, testSessionToken, "http://localhost", 403}, {strings.Replace(body, `"manifest_path":"manifest.json"`, `"manifest_path":"manifest.json","approval":true`, 1), testSessionToken, base, 400}, {strings.Replace(strings.Replace(body, "174001", "174003", 1), `"binding_version":1`, `"binding_version":2`, 1), testSessionToken, base, 403}} {
		requireHTTPBody(t, client, request("POST", path+"/commands", tc.body, tc.token, tc.origin), tc.status)
	}
	requireHTTPBody(t, client, request("GET", strings.Replace(path, "MNPR", "MNPV", 1)+"/repository-bindings/binding", "", testSessionToken, ""), 404)
	if err = os.WriteFile(filepath.Join(gitDir, "refs", "heads", "main"), []byte(strings.Repeat("1", 40)+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if replay := requireHTTPBody(t, client, request("POST", path+"/commands", body, testSessionToken, base), 200); !bytes.Equal(first, replay) {
		t.Fatal("ref move changed replay")
	}
	if err = os.Rename(gitDir, gitDir+"-gone"); err != nil {
		t.Fatal(err)
	}
	if replay := requireHTTPBody(t, client, request("POST", path+"/commands", body, testSessionToken, base), 200); !bytes.Equal(first, replay) {
		t.Fatal("source loss changed replay")
	}
	client.CloseIdleConnections()
	cancel()
	waitRuntime(t, runtime)
	stopped = true
	second, cancelSecond, secondClient, secondBase, _ := start(config.ListenAddress)
	defer func() { secondClient.CloseIdleConnections(); cancelSecond(); waitRuntime(t, second) }()
	base = secondBase
	client = secondClient
	if replay := requireHTTPBody(t, client, request("POST", path+"/commands", body, testSessionToken, base), 200); !bytes.Equal(first, replay) {
		t.Fatal("restart changed replay")
	}
	stored := requireHTTPBody(t, client, request("GET", path+"/commands/cmd_0123456789ABCDEFGHJKMNPS", "", testSessionToken, ""), 200)
	assertProposalRuntimeRows(t, filepath.Join(root, "state", "taskboard.sqlite"))
	if !bytes.Equal(first, stored) {
		t.Fatal("lookup differs after restart")
	}
}
