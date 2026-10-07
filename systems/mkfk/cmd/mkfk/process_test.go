package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/config"
)

const brokerProcessEnv = "MKFK_TEST_BROKER_PROCESS"

// TestMain lets the test binary act as the mkfk broker for child processes.
func TestMain(m *testing.M) {
	if os.Getenv(brokerProcessEnv) == "1" {
		main()
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// syncBuffer collects a child's stderr while it runs.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

type brokerProcess struct {
	cmd    *exec.Cmd
	stderr *syncBuffer
	done   chan error
}

// exited waits up to timeout for the process to exit.
func (p *brokerProcess) exited(timeout time.Duration) (error, bool) {
	if timeout == 0 {
		select {
		case err := <-p.done:
			p.done <- err
			return err, true
		default:
			return nil, false
		}
	}
	select {
	case err := <-p.done:
		p.done <- err
		return err, true
	case <-time.After(timeout):
		return nil, false
	}
}

func (p *brokerProcess) kill() {
	_ = p.cmd.Process.Signal(syscall.SIGKILL)
	_, _ = p.exited(10 * time.Second)
}

type testCluster struct {
	t        *testing.T
	dir      string
	path     string
	manifest config.ClusterManifest
	procs    map[uint32]*brokerProcess
	// peerBinds, when set, moves each peer listener behind a fault proxy.
	peerBinds map[uint32]string
}

// newTestCluster writes a topology of size brokers on free loopback ports,
// with topic "events" of partitions partitions at the given replication.
func newTestCluster(t *testing.T, size, partitions, replication int) *testCluster {
	t.Helper()
	manifest := config.ClusterManifest{Version: 1, ClusterID: "mkfk-m7-proc"}
	ports := freePorts(t, 3*size)
	var replicas []uint32
	for id := 1; id <= size; id++ {
		base := 3 * (id - 1)
		manifest.Brokers = append(manifest.Brokers, config.Broker{
			ID: uint32(id), ClientAddr: ports[base], PeerAddr: ports[base+1], AdminAddr: ports[base+2],
		})
		if id <= replication {
			replicas = append(replicas, uint32(id))
		}
	}
	minISR := uint32(len(replicas)/2 + 1)
	events := config.Topic{Name: "events"}
	for id := 0; id < partitions; id++ {
		events.Partitions = append(events.Partitions, config.Partition{ID: uint32(id), Replicas: replicas, MinISR: minISR})
	}
	groups := config.Topic{Name: "__mkfk_groups", Internal: true, Partitions: []config.Partition{{ID: 0, Replicas: replicas, MinISR: minISR}}}
	manifest.Topics = []config.Topic{events, groups}
	topology, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	cluster := &testCluster{t: t, dir: t.TempDir(), manifest: manifest, procs: map[uint32]*brokerProcess{}}
	cluster.path = filepath.Join(cluster.dir, "cluster.json")
	if err := os.WriteFile(cluster.path, topology, 0o600); err != nil {
		t.Fatal(err)
	}
	for id := uint32(1); id <= uint32(size); id++ {
		if err := run([]string{"format", "--data-dir", cluster.dataDir(id), "--node-id", fmt.Sprint(id), "--cluster-json", cluster.path}, io.Discard); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		for _, proc := range cluster.procs {
			proc.kill()
		}
	})
	return cluster
}

func freePorts(t *testing.T, count int) []string {
	t.Helper()
	var listeners []net.Listener
	var addresses []string
	for range count {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		listeners = append(listeners, listener)
		addresses = append(addresses, listener.Addr().String())
	}
	for _, listener := range listeners {
		_ = listener.Close()
	}
	return addresses
}

func (c *testCluster) dataDir(id uint32) string {
	return filepath.Join(c.dir, fmt.Sprintf("node-%d", id))
}

func (c *testCluster) broker(id uint32) config.Broker {
	broker, _ := c.manifest.Broker(id)
	return broker
}

// spawn starts `mkfk serve` as a child process with the given arguments.
func spawn(t *testing.T, arguments ...string) *brokerProcess {
	t.Helper()
	cmd := exec.Command(os.Args[0], append([]string{"serve"}, arguments...)...)
	cmd.Env = append(os.Environ(), brokerProcessEnv+"=1")
	proc := &brokerProcess{cmd: cmd, stderr: &syncBuffer{}, done: make(chan error, 1)}
	cmd.Stderr = proc.stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	go func() { proc.done <- cmd.Wait() }()
	return proc
}

func (c *testCluster) start(id uint32) *brokerProcess {
	c.t.Helper()
	arguments := []string{"--data-dir", c.dataDir(id), "--node-id", fmt.Sprint(id), "--cluster-json", c.path, "--shutdown-timeout", "3s"}
	if bind, ok := c.peerBinds[id]; ok {
		arguments = append(arguments, "--peer-bind", bind)
	}
	proc := spawn(c.t, arguments...)
	c.procs[id] = proc
	return proc
}

func (c *testCluster) waitReady(id uint32) {
	c.t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for {
		if err, exited := c.procs[id].exited(0); exited {
			c.t.Fatalf("broker %d exited: %v\n%s", id, err, c.procs[id].stderr.String())
		}
		if status, _ := c.admin(id, "/readyz"); status == http.StatusOK {
			return
		}
		if time.Now().After(deadline) {
			_, metrics := c.admin(id, "/metrics")
			_ = c.procs[id].cmd.Process.Signal(syscall.SIGQUIT) // Go prints every goroutine's stack
			_, _ = c.procs[id].exited(3 * time.Second)
			c.t.Fatalf("broker %d not ready after 20s\nmetrics:\n%s\nlog tail without role changes:\n%s", id, metrics, tail(withoutRoleChanges(c.procs[id].stderr.String()), 400))
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func withoutRoleChanges(text string) string {
	var kept []string
	for _, line := range strings.Split(text, "\n") {
		if !strings.Contains(line, `"msg":"role change"`) {
			kept = append(kept, line)
		}
	}
	return strings.Join(kept, "\n")
}

func tail(text string, lines int) string {
	all := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(all) > lines {
		all = all[len(all)-lines:]
	}
	return strings.Join(all, "\n")
}

// probeClient bounds every harness probe, so a paused broker cannot hang
// the test.
var probeClient = &http.Client{Timeout: 2 * time.Second}

func (c *testCluster) admin(id uint32, path string) (int, string) {
	response, err := probeClient.Get("http://" + c.broker(id).AdminAddr + path)
	if err != nil {
		return 0, ""
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	return response.StatusCode, string(body)
}

func (c *testCluster) endpoints() map[uint32]string {
	endpoints := map[uint32]string{}
	for _, broker := range c.manifest.Brokers {
		endpoints[broker.ID] = "http://" + broker.ClientAddr
	}
	return endpoints
}

func eventually(t *testing.T, what string, timeout time.Duration, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
