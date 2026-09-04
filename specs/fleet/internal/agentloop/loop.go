package agentloop

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fallrising/fleet-catalog/internal/agentclient"
	"github.com/fallrising/fleet-catalog/internal/composeclient"
	"github.com/fallrising/fleet-catalog/internal/config"
	"github.com/fallrising/fleet-catalog/internal/secretfile"
	"github.com/fallrising/fleet-catalog/internal/version"
)

type Loop struct {
	Cfg      config.Agent
	API      FleetAPI
	Compose  composeclient.ComposeClient
	Log      *slog.Logger
	Probe    func(ctx context.Context, url string) (int, time.Duration, error)
	Now      func() time.Time
	Exit     func(int)

	applyMu sync.Mutex
	fails   map[string]int
	applied map[string]appliedMeta
}

type appliedMeta struct {
	Generation int64
	Hash       string
}

func New(cfg config.Agent, api FleetAPI, cc composeclient.ComposeClient, log *slog.Logger) *Loop {
	if log == nil {
		log = slog.Default()
	}
	return &Loop{
		Cfg:     cfg,
		API:     api,
		Compose: cc,
		Log:     log,
		Probe:   probeHealth,
		Now:     time.Now,
		Exit:    os.Exit,
		fails:   map[string]int{},
		applied: map[string]appliedMeta{},
	}
}

func (l *Loop) StateDir() string {
	if l.Cfg.StateDir != "" {
		return l.Cfg.StateDir
	}
	return config.DefaultStateDir
}

func (l *Loop) InstanceID() (string, error) {
	p := filepath.Join(l.StateDir(), "agent_instance_id")
	b, err := os.ReadFile(p)
	if err == nil && len(b) > 0 {
		return string(bytesTrim(b)), nil
	}
	id := newUUID()
	if err := writeFile(p, []byte(id+"\n"), 0o600); err != nil {
		return "", err
	}
	return id, nil
}

func bytesTrim(b []byte) []byte {
	i, j := 0, len(b)
	for i < j && (b[i] == ' ' || b[i] == '\n' || b[i] == '\r' || b[i] == '\t') {
		i++
	}
	for j > i && (b[j-1] == ' ' || b[j-1] == '\n' || b[j-1] == '\r' || b[j-1] == '\t') {
		j--
	}
	return b[i:j]
}

func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func writeFile(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return err
	}
	f, err := os.OpenFile(tmp, os.O_WRONLY, 0)
	if err == nil {
		_ = f.Sync()
		_ = f.Close()
	}
	return os.Rename(tmp, path)
}

func (l *Loop) Token() (string, error) {
	p := l.Cfg.TokenFile
	if p == "" {
		p = filepath.Join(l.StateDir(), "agent.token")
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return "", err
	}
	return string(bytesTrim(b)), nil
}

func (l *Loop) Bootstrap(ctx context.Context) error {
	tokPath := l.Cfg.TokenFile
	if tokPath == "" {
		tokPath = filepath.Join(l.StateDir(), "agent.token")
	}
	if secretfile.Exists(tokPath) {
		return nil
	}
	if l.Cfg.BootstrapToken == "" {
		return fmt.Errorf("FLEET_BOOTSTRAP_TOKEN required for first register")
	}
	id, err := l.InstanceID()
	if err != nil {
		return err
	}
	ag, tun, err := l.API.Register(ctx, l.Cfg.BootstrapToken, l.Cfg.NodeID, l.Cfg.NodeID, id)
	if err != nil {
		return err
	}
	if err := writeFile(tokPath, []byte(ag+"\n"), 0o600); err != nil {
		return err
	}
	if tun != "" {
		if err := writeFile(filepath.Join(l.StateDir(), "tunnel.token"), []byte(tun+"\n"), 0o600); err != nil {
			return err
		}
		env := "TUNNEL_TOKEN=" + tun + "\n"
		if err := writeFile(filepath.Join(l.StateDir(), "cloudflared.env"), []byte(env), 0o600); err != nil {
			return err
		}
		if err := l.Compose.UpSidecar(ctx); err != nil {
			l.Log.Error("upsidecar", "err", err.Error())
		}
	}
	return nil
}

func (l *Loop) Run(ctx context.Context) error {
	if err := os.MkdirAll(l.StateDir(), 0o700); err != nil {
		return err
	}
	if err := l.Bootstrap(ctx); err != nil {
		return err
	}
	l.loadApplied()
	if b, err := os.ReadFile(filepath.Join(l.StateDir(), "desired.json")); err == nil {
		var d agentclient.Desired
		if json.Unmarshal(b, &d) == nil {
			_, _ = l.Apply(ctx, &d)
		}
	}
	go l.heartbeatLoop(ctx)
	t := time.NewTicker(l.interval())
	defer t.Stop()
	l.tickApply(ctx)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-t.C:
			l.tickApply(ctx)
		}
	}
}

func (l *Loop) interval() time.Duration {
	if l.Cfg.Interval > 0 {
		return l.Cfg.Interval
	}
	return 15 * time.Second
}

func (l *Loop) heartbeatLoop(ctx context.Context) {
	t := time.NewTicker(l.interval())
	defer t.Stop()
	l.tickHeartbeat(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			l.tickHeartbeat(ctx)
		}
	}
}

func (l *Loop) tickHeartbeat(ctx context.Context) {
	tok, err := l.Token()
	if err != nil {
		l.Log.Warn("heartbeat", "err", err.Error())
		return
	}
	id, err := l.InstanceID()
	if err != nil {
		return
	}
	facts := CollectFacts(true, 0)
	err = l.API.Heartbeat(ctx, tok, l.Cfg.NodeID, agentclient.Heartbeat{
		AgentInstanceID: id, AgentVersion: version.Version, Facts: facts,
	})
	if err == ErrLeaseHeld {
		l.Log.Error("agent_lease_held")
		l.Exit(2)
		return
	}
	if err != nil {
		l.Log.Warn("control_plane_unreachable", "err", err.Error())
		return
	}
	l.Log.Info("heartbeat_ok", "node_id", l.Cfg.NodeID)
}

func (l *Loop) tickApply(ctx context.Context) {
	tok, err := l.Token()
	if err != nil {
		return
	}
	d, err := l.API.GetDesired(ctx, tok, l.Cfg.NodeID)
	if err != nil {
		l.Log.Warn("control_plane_unreachable", "err", err.Error())
		return
	}
	b, _ := json.Marshal(d)
	_ = writeFile(filepath.Join(l.StateDir(), "desired.json"), b, 0o600)
	act, err := l.Apply(ctx, d)
	if err != nil {
		l.Log.Error("apply", "err", err.Error())
	}
	id, _ := l.InstanceID()
	act.AgentInstanceID = id
	act.NodeID = l.Cfg.NodeID
	if err := l.API.PostActual(ctx, tok, l.Cfg.NodeID, act); err != nil {
		l.Log.Warn("actual", "err", err.Error())
	} else {
		l.Log.Info("desired_applied", "node_id", l.Cfg.NodeID, "generation", d.Generation)
	}
}

func (l *Loop) ServeHealthz(ctx context.Context, addr string) error {
	if addr == "" {
		addr = "127.0.0.1:19600"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"status":"ok","role":"fleet-agent"}`)
	})
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	if tcp, ok := ln.Addr().(*net.TCPAddr); ok && tcp.IP != nil && !tcp.IP.IsLoopback() {
		_ = ln.Close()
		return fmt.Errorf("agent healthz must bind loopback, got %s", tcp.IP)
	}
	srv := &http.Server{Handler: mux}
	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()
	go func() { _ = srv.Serve(ln) }()
	return nil
}

func hashOf(a, b string) string {
	h := sha256.Sum256([]byte(a + "\x00" + b))
	return hex.EncodeToString(h[:])
}

func (l *Loop) loadApplied() {
	root := filepath.Join(l.StateDir(), "services")
	ents, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(root, e.Name(), "applied.json"))
		if err != nil {
			continue
		}
		var m appliedMeta
		if json.Unmarshal(b, &m) == nil {
			l.applied[e.Name()] = m
		}
	}
}
