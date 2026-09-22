package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/domain"
	"github.com/fallrising/newclear/products/hai-taskboard/backend/internal/transport/httpapi"
)

const (
	testSessionToken = "vrRMiu6-SwxUHrSDR2y1g7OVqiinGSbIg4u-KjMT0YY"
	testProjectID    = "prj_0123456789ABCDEFGHJKMNPR"
	testCommandID    = "cmd_0123456789ABCDEFGHJKMNPQ"
	testCreateBody   = "{\"command_id\":\"" + testCommandID + "\",\"idempotency_key\":\"123e4567-e89b-42d3-a456-426614174000\",\"project_id\":\"" + testProjectID + "\",\"expected_version\":0,\"issued_at\":\"2026-01-01T00:00:00Z\",\"name\":\"Local project\",\"repository\":{\"root_hint\":\"/workspace/local\",\"approved_ref\":\"refs/heads/main\"}}"
)

func TestT093Config_RejectsBroadRootAndOriginAliases(t *testing.T) {
	t.Parallel()
	privateParent := privateTestRoot(t)
	privateRoot := filepath.Join(privateParent, "existing-private-root")
	if err := os.Mkdir(privateRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	publicRoot := filepath.Join(privateParent, "existing-public-root")
	if err := os.Mkdir(publicRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(publicRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	unusableRoot := filepath.Join(privateParent, "existing-unusable-root")
	if err := os.Mkdir(unusableRoot, 0o500); err != nil {
		t.Fatal(err)
	}
	symlinkTarget := filepath.Join(privateParent, "symlink-target")
	if err := os.Mkdir(symlinkTarget, 0o700); err != nil {
		t.Fatal(err)
	}
	symlinkRoot := filepath.Join(privateParent, "symlink-root")
	if err := os.Symlink(symlinkTarget, symlinkRoot); err != nil {
		t.Fatal(err)
	}

	valid := runtimeConfig{
		DataRoot:       privateRoot,
		ListenAddress:  "127.0.0.1:18080",
		Origin:         "http://127.0.0.1:18080",
		SessionToken:   testSessionToken,
		SessionActor:   "local-operator",
		ShutdownWindow: time.Second,
	}
	for name, root := range map[string]string{
		"filesystem root":           string(filepath.Separator),
		"platform temporary root":   os.TempDir(),
		"group or other accessible": publicRoot,
		"owner mode is unusable":    unusableRoot,
		"symlink root":              symlinkRoot,
	} {
		t.Run(name, func(t *testing.T) {
			before, err := os.Lstat(root)
			if err != nil {
				t.Fatal(err)
			}
			config := valid
			config.DataRoot = root
			if err := config.validate(); err == nil {
				t.Fatal("broad or uncontrolled root was accepted")
			}
			after, err := os.Lstat(root)
			if err != nil {
				t.Fatal(err)
			}
			if !os.SameFile(before, after) || before.Mode() != after.Mode() {
				t.Fatal("rejected root was mutated")
			}
		})
	}

	privateBefore, err := os.Lstat(privateRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := valid.validate(); err != nil {
		t.Fatalf("private root validation failed: %v", err)
	}
	if err := ensurePrivateDirectory(privateRoot); err != nil {
		t.Fatalf("private root setup failed: %v", err)
	}
	privateAfter, err := os.Lstat(privateRoot)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(privateBefore, privateAfter) || privateBefore.Mode() != privateAfter.Mode() {
		t.Fatal("existing private root identity or mode changed")
	}

	newRoot := filepath.Join(privateParent, "new-runtime-root")
	newConfig := valid
	newConfig.DataRoot = newRoot
	if err := newConfig.validate(); err != nil {
		t.Fatalf("new child below private parent was rejected: %v (root check: %v)", err, validateDataRoot(newRoot))
	}
	if _, err := os.Lstat(newRoot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("configuration validation created the data root: %v", err)
	}
	if err := ensurePrivateDirectory(newRoot); err != nil {
		t.Fatal(err)
	}
	newInfo, err := os.Lstat(newRoot)
	if err != nil {
		t.Fatal(err)
	}
	if !newInfo.IsDir() || newInfo.Mode().Perm() != 0o700 {
		t.Fatalf("new runtime root mode = %v, want 0700 directory", newInfo.Mode())
	}

	aliases := map[string]func(*runtimeConfig){
		"leading-zero origin port": func(config *runtimeConfig) { config.Origin = "http://127.0.0.1:018080" },
		"IPv4-mapped origin":       func(config *runtimeConfig) { config.Origin = "http://[::ffff:127.0.0.1]:18080" },
		"leading-zero listen port": func(config *runtimeConfig) { config.ListenAddress = "127.0.0.1:018080" },
		"expanded IPv6 listen": func(config *runtimeConfig) {
			config.ListenAddress = "[0:0:0:0:0:0:0:1]:18080"
			config.Origin = "http://[0:0:0:0:0:0:0:1]:18080"
		},
		"expanded IPv6 origin": func(config *runtimeConfig) {
			config.ListenAddress = "[::1]:18080"
			config.Origin = "http://[0:0:0:0:0:0:0:1]:18080"
		},
	}
	for name, mutate := range aliases {
		t.Run(name, func(t *testing.T) {
			config := valid
			aliasRoot := filepath.Join(privateParent, "rejected-"+strings.ReplaceAll(name, " ", "-"))
			config.DataRoot = aliasRoot
			mutate(&config)
			if err := config.validate(); err == nil {
				t.Fatal("noncanonical listener or Origin alias was accepted")
			}
			if _, err := os.Lstat(aliasRoot); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("rejected alias opened storage: %v", err)
			}
		})
	}
}

func TestT093SessionToken_RejectsPredictableSecret(t *testing.T) {
	t.Parallel()
	if !validSessionToken(testSessionToken) {
		t.Fatal("canonical strong positive-control token was rejected")
	}
	patterns := map[string][]byte{
		"zero bytes":     make([]byte, 32),
		"repeated bytes": bytes.Repeat([]byte{0x5a, 0xa5}, 16),
		"ascending bytes": func() []byte {
			value := make([]byte, 32)
			for index := range value {
				value[index] = byte(index)
			}
			return value
		}(),
	}
	for name, decoded := range patterns {
		t.Run(name, func(t *testing.T) {
			token := base64.RawURLEncoding.EncodeToString(decoded)
			if validSessionToken(token) {
				t.Fatal("obviously predictable canonical token was accepted")
			}
		})
	}
	if validSessionToken(strings.Repeat("a", 43)) {
		t.Fatal("T-092 repeated-character token was accepted")
	}
}

func TestT093ArtifactStore_RejectsRootReplacement(t *testing.T) {
	t.Parallel()
	privateParent := privateTestRoot(t)
	root := filepath.Join(privateParent, "artifacts")
	store, err := newLocalArtifactStore(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	})
	movedRoot := filepath.Join(privateParent, "moved-artifacts")
	if err := os.Rename(root, movedRoot); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(privateParent, "outside")
	if err := os.Mkdir(outside, 0o700); err != nil {
		t.Fatal(err)
	}
	outsideBefore, err := os.Lstat(outside)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, root); err != nil {
		t.Fatal(err)
	}

	contents := "root replacement must not redirect this artifact"
	digest := domain.HashString(contents)
	if _, _, err := store.Put(t.Context(), strings.NewReader(contents)); err == nil {
		t.Error("artifact write accepted a replaced root")
	}
	if _, err := os.Lstat(filepath.Join(outside, digest.String())); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("artifact write escaped to replacement target: %v", err)
	}
	if _, err := store.Open(t.Context(), digest); err == nil {
		t.Error("artifact read accepted a replaced root")
	}
	outsideAfter, err := os.Lstat(outside)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(outsideBefore, outsideAfter) || outsideBefore.Mode() != outsideAfter.Mode() {
		t.Fatal("replacement target identity or mode changed")
	}
}

func TestRuntimeConfig_RejectsUnsafeExposure(t *testing.T) {
	t.Parallel()
	valid := runtimeConfig{
		DataRoot:       privateTestRoot(t),
		ListenAddress:  "127.0.0.1:18080",
		Origin:         "http://127.0.0.1:18080",
		SessionToken:   testSessionToken,
		SessionActor:   "local-operator",
		ShutdownWindow: time.Second,
	}
	tests := map[string]func(*runtimeConfig){
		"wildcard listener":      func(config *runtimeConfig) { config.ListenAddress = "0.0.0.0:18080" },
		"empty listener host":    func(config *runtimeConfig) { config.ListenAddress = ":18080" },
		"hostname listener":      func(config *runtimeConfig) { config.ListenAddress = "localhost:18080" },
		"non-loopback listener":  func(config *runtimeConfig) { config.ListenAddress = "192.0.2.1:18080" },
		"zero port":              func(config *runtimeConfig) { config.ListenAddress = "127.0.0.1:0" },
		"origin path":            func(config *runtimeConfig) { config.Origin = "http://127.0.0.1:18080/path" },
		"origin query":           func(config *runtimeConfig) { config.Origin = "http://127.0.0.1:18080?x=1" },
		"origin user info":       func(config *runtimeConfig) { config.Origin = "http://user@127.0.0.1:18080" },
		"origin scheme":          func(config *runtimeConfig) { config.Origin = "https://127.0.0.1:18080" },
		"origin port mismatch":   func(config *runtimeConfig) { config.Origin = "http://127.0.0.1:18081" },
		"relative data root":     func(config *runtimeConfig) { config.DataRoot = "relative" },
		"unclean data root":      func(config *runtimeConfig) { config.DataRoot += "/../escape" },
		"missing token":          func(config *runtimeConfig) { config.SessionToken = "" },
		"weak token":             func(config *runtimeConfig) { config.SessionToken = "too-short" },
		"invalid token alphabet": func(config *runtimeConfig) { config.SessionToken = strings.Repeat("a", encodedTokenLength-1) + "+" },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			config := valid
			mutate(&config)
			if err := config.validate(); err == nil {
				t.Fatal("unsafe runtime configuration was accepted")
			}
		})
	}
}

func TestLocalArtifactStore_RejectsEscape(t *testing.T) {
	t.Parallel()
	parent := privateTestRoot(t)
	outsideRoot := privateTestRoot(t)
	symlinkRoot := filepath.Join(parent, "symlink-artifacts")
	if err := os.Symlink(outsideRoot, symlinkRoot); err != nil {
		t.Fatal(err)
	}
	if _, err := newLocalArtifactStore(symlinkRoot); err == nil {
		t.Fatal("symlink artifact root was accepted")
	}

	root := filepath.Join(parent, "artifacts")
	store, err := newLocalArtifactStore(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	})
	validContents := "descriptor-confined artifact"
	validDigest, validBytes, err := store.Put(t.Context(), strings.NewReader(validContents))
	if err != nil {
		t.Fatal(err)
	}
	if validDigest != domain.HashString(validContents) || validBytes != uint64(len(validContents)) {
		t.Fatalf("published artifact = (%s, %d)", validDigest, validBytes)
	}
	opened, err := store.Open(t.Context(), validDigest)
	if err != nil {
		t.Fatal(err)
	}
	openedContents, err := io.ReadAll(opened)
	if closeErr := opened.Close(); err == nil {
		err = closeErr
	}
	if err != nil || string(openedContents) != validContents {
		t.Fatalf("opened artifact = (%q, %v)", openedContents, err)
	}
	if replayDigest, replayBytes, err := store.Put(t.Context(), strings.NewReader(validContents)); err != nil || replayDigest != validDigest || replayBytes != validBytes {
		t.Fatalf("idempotent artifact publication = (%s, %d, %v)", replayDigest, replayBytes, err)
	}
	for _, name := range []string{"../escape", "/absolute", strings.Repeat("a", 63), strings.Repeat("A", 64), strings.Repeat("g", 64)} {
		if _, err := safeArtifactPath(root, name); err == nil {
			t.Fatalf("unsafe artifact name %q was accepted", name)
		}
	}

	digest := domain.HashString("expected artifact")
	outside := filepath.Join(privateTestRoot(t), "outside")
	if err := os.WriteFile(outside, []byte("expected artifact"), 0o600); err != nil {
		t.Fatal(err)
	}
	objectPath, err := safeArtifactPath(root, digest.String())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, objectPath); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Open(t.Context(), digest); err == nil {
		t.Fatal("artifact symlink was accepted")
	}
	if err := os.Remove(objectPath); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(objectPath, []byte("corrupt"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Open(t.Context(), digest); err == nil {
		t.Fatal("corrupt pre-existing artifact was accepted")
	}
	if _, _, err := store.Put(t.Context(), strings.NewReader("expected artifact")); err == nil {
		t.Fatal("corrupt pre-existing artifact was accepted as an idempotent write")
	}
}

func TestLocalSessionAuthority_EnforcesTokenAndOrigin(t *testing.T) {
	t.Parallel()
	authority, err := newLocalSessionAuthority(testSessionToken, "local-operator")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authority.Authenticate(t.Context(), "wrong-token"); !errors.Is(err, httpapi.ErrUnauthenticated) {
		t.Fatalf("wrong token error = %v", err)
	}
	if session, err := authority.Authenticate(t.Context(), testSessionToken); err != nil || session.Principal != "local-operator" {
		t.Fatalf("valid authentication = (%#v, %v)", session, err)
	}

	runtime, cancel, client, baseURL, config := startTestRuntime(t, privateTestRoot(t))
	t.Cleanup(func() {
		client.CloseIdleConnections()
		cancel()
		waitRuntime(t, runtime)
	})

	wrongToken := createProjectRequest(t, baseURL, config.Origin, "wrong-token")
	assertHTTPStatus(t, client, wrongToken, http.StatusUnauthorized)
	wrongOrigin := createProjectRequest(t, baseURL, "http://127.0.0.1:1", config.SessionToken)
	assertHTTPStatus(t, client, wrongOrigin, http.StatusForbidden)
	accepted := createProjectRequest(t, baseURL, config.Origin, config.SessionToken)
	assertHTTPStatus(t, client, accepted, http.StatusOK)
}

func TestRuntime_HTTPPersistenceAcrossRestart(t *testing.T) {
	t.Parallel()
	dataRoot := privateTestRoot(t)

	first, cancelFirst, firstClient, firstBaseURL, firstConfig := startTestRuntime(t, dataRoot)
	t.Cleanup(func() {
		firstClient.CloseIdleConnections()
		cancelFirst()
		waitRuntime(t, first)
	})
	create := createProjectRequest(t, firstBaseURL, firstConfig.Origin, firstConfig.SessionToken)
	created := requireHTTPBody(t, firstClient, create, http.StatusOK)
	lookup := commandResultRequest(t, firstBaseURL, firstConfig.SessionToken)
	stored := requireHTTPBody(t, firstClient, lookup, http.StatusOK)
	if !bytes.Equal(created, stored) {
		t.Fatalf("created and stored canonical result differ:\ncreate=%s\nstored=%s", created, stored)
	}
	firstClient.CloseIdleConnections()
	cancelFirst()
	waitRuntime(t, first)
	if _, err := first.artifacts.root.Stat("."); err == nil {
		t.Fatal("artifact root descriptor remained open after runtime shutdown")
	}

	second, cancelSecond, secondClient, secondBaseURL, secondConfig := startTestRuntimeAt(t, dataRoot, firstConfig.ListenAddress)
	t.Cleanup(func() {
		secondClient.CloseIdleConnections()
		cancelSecond()
		waitRuntime(t, second)
	})
	afterRestart := requireHTTPBody(t, secondClient, commandResultRequest(t, secondBaseURL, secondConfig.SessionToken), http.StatusOK)
	if !bytes.Equal(stored, afterRestart) {
		t.Fatalf("restart changed stored canonical result:\nbefore=%s\nafter=%s", stored, afterRestart)
	}
	replayed := requireHTTPBody(t, secondClient, createProjectRequest(t, secondBaseURL, secondConfig.Origin, secondConfig.SessionToken), http.StatusOK)
	if !bytes.Equal(stored, replayed) {
		t.Fatalf("idempotent replay is not byte-exact:\nstored=%s\nreplayed=%s", stored, replayed)
	}
}

func startTestRuntime(t *testing.T, dataRoot string) (*runningRuntime, context.CancelFunc, *http.Client, string, runtimeConfig) {
	t.Helper()
	return startTestRuntimeAt(t, dataRoot, "127.0.0.1:0")
}

func startTestRuntimeAt(t *testing.T, dataRoot, listenAddress string) (*runningRuntime, context.CancelFunc, *http.Client, string, runtimeConfig) {
	t.Helper()
	listener, err := net.Listen("tcp", listenAddress)
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	config := runtimeConfig{
		DataRoot:       dataRoot,
		ListenAddress:  address,
		Origin:         "http://" + address,
		SessionToken:   testSessionToken,
		SessionActor:   "local-operator",
		ShutdownWindow: 3 * time.Second,
	}
	ctx, cancel := context.WithCancel(t.Context())
	runtime, err := startRuntime(ctx, config, listener)
	if err != nil {
		cancel()
		listener.Close()
		t.Fatal(err)
	}
	transport := &http.Transport{Proxy: nil}
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
	return runtime, cancel, client, "http://" + address, config
}

func createProjectRequest(t *testing.T, baseURL, origin, token string) *http.Request {
	t.Helper()
	request, err := http.NewRequestWithContext(t.Context(), http.MethodPost, baseURL+"/api/v1/projects", strings.NewReader(testCreateBody))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", origin)
	request.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: token})
	return request
}

func commandResultRequest(t *testing.T, baseURL, token string) *http.Request {
	t.Helper()
	request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, baseURL+"/api/v1/projects/"+testProjectID+"/commands/"+testCommandID, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.AddCookie(&http.Cookie{Name: httpapi.SessionCookieName, Value: token})
	return request
}

func assertHTTPStatus(t *testing.T, client *http.Client, request *http.Request, expected int) {
	t.Helper()
	_ = requireHTTPBody(t, client, request, expected)
}

func requireHTTPBody(t *testing.T, client *http.Client, request *http.Request, expected int) []byte {
	t.Helper()
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != expected {
		t.Fatalf("HTTP status = %d, want %d; body=%s", response.StatusCode, expected, body)
	}
	return body
}

func waitRuntime(t *testing.T, runtime *runningRuntime) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := runtime.Wait(ctx); err != nil {
		t.Fatal(err)
	}
}

func privateTestRoot(t *testing.T) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "private")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	return root
}
