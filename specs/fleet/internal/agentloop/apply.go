package agentloop

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fallrising/fleet-catalog/internal/agentclient"
	"github.com/fallrising/fleet-catalog/internal/composeclient"
	"github.com/fallrising/fleet-catalog/internal/secretfile"
)

func (l *Loop) Apply(ctx context.Context, desired *agentclient.Desired) (agentclient.Actual, error) {
	id, _ := l.InstanceID()
	act := agentclient.Actual{NodeID: l.Cfg.NodeID, AgentInstanceID: id, Services: []agentclient.ActualService{}}
	if desired == nil {
		return act, nil
	}
	for _, svc := range desired.Services {
		rep := l.applyOne(ctx, desired, svc)
		act.Services = append(act.Services, rep)
	}
	return act, nil
}

func (l *Loop) applyOne(ctx context.Context, desired *agentclient.Desired, svc agentclient.DesiredService) agentclient.ActualService {
	rep := agentclient.ActualService{
		Name:              svc.Name,
		AppliedGeneration: svc.Generation,
		ActualState:       "unknown",
		Health:            "unknown",
		Image:             svc.Image,
	}
	proj := composeclient.Project(svc.ComposeProject)
	if composeclient.IsProtected(proj) {
		l.Log.Warn("protected_project", "compose_project", svc.ComposeProject)
		return rep
	}
	l.applyMu.Lock()
	defer l.applyMu.Unlock()

	dir := filepath.Join(l.StateDir(), "services", svc.Name)
	_ = os.MkdirAll(dir, 0o750)
	composeFile := filepath.Join(dir, "docker-compose.yml")

	if svc.DesiredState == "absent" {
		if err := l.Compose.Down(ctx, proj, composeFile, composeclient.DownOpts{PurgeVolumes: svc.PurgeVolumes}); err != nil {
			rep.ActualState = "unknown"
			rep.Error = "compose_error"
			return rep
		}
		_ = os.RemoveAll(dir)
		rep.ActualState = "absent"
		rep.Health = "unknown"
		delete(l.fails, svc.Name)
		delete(l.applied, svc.Name)
		return rep
	}

	secretsPath := filepath.Join(dir, "secrets.env")
	if len(svc.SecretKeys) > 0 && !secretfile.Exists(secretsPath) {
		rep.ActualState = "missing"
		rep.Error = "secrets_file_missing"
		l.Log.Warn("secrets_file_missing", "service", svc.Name)
		return rep
	}
	envMerged := svc.EnvFile
	if secretfile.Exists(secretsPath) {
		m, err := secretfile.Merge(svc.EnvFile, secretsPath)
		if err != nil {
			rep.ActualState = "missing"
			rep.Error = "secrets_file_missing"
			return rep
		}
		envMerged = m
	}
	h := hashOf(svc.ComposeYAML, envMerged)
	prev := l.applied[svc.Name]
	if h != prev.Hash {
		if err := writeFile(composeFile, []byte(svc.ComposeYAML), 0o640); err != nil {
			rep.Error = "compose_error"
			return rep
		}
		if err := writeFile(filepath.Join(dir, ".env"), []byte(envMerged), 0o600); err != nil {
			rep.Error = "compose_error"
			return rep
		}
	}
	ps, err := l.Compose.Ps(ctx, proj, composeFile)
	if err != nil {
		rep.Error = "compose_error"
		return rep
	}

	if svc.DesiredState == "stopped" {
		if ps.Running {
			if err := l.Compose.Stop(ctx, proj, composeFile); err != nil {
				rep.Error = "compose_error"
				return rep
			}
		}
		rep.ActualState = "stopped"
		rep.Health = "unknown"
		rep.ContainerID = ps.ContainerID
		l.saveApplied(svc.Name, svc.Generation, h)
		return rep
	}

	if svc.DesiredState == "running" {
		if desired.Registry != nil && desired.Registry.Password != "" {
			_ = l.Compose.Login(ctx, desired.Registry.URL, "x-access-token", desired.Registry.Password)
		}
		needPull := svc.ForceRecreate || svc.Generation != prev.Generation
		if needPull {
			rep.ActualState = "progressing"
			rep.Error = "pull_in_progress"
			rep.Health = "progressing"
			l.postActualNow(ctx, rep)
			pctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
			err := l.Compose.Pull(pctx, proj, composeFile)
			cancel()
			if err != nil {
				l.Log.Error("pull_error", "service", svc.Name, "err", err.Error())
				rep.ActualState = "missing"
				rep.Error = "pull_error"
				return rep
			}
			if err := l.Compose.Up(ctx, proj, composeFile, composeclient.UpOpts{ForceRecreate: true}); err != nil {
				rep.ActualState = "missing"
				rep.Error = "compose_error"
				return rep
			}
		} else if !ps.Running {
			if err := l.Compose.Up(ctx, proj, composeFile, composeclient.UpOpts{ForceRecreate: false}); err != nil {
				rep.ActualState = "missing"
				rep.Error = "compose_error"
				return rep
			}
		}
		ps, _ = l.Compose.Ps(ctx, proj, composeFile)
		rep.ContainerID = ps.ContainerID
		l.saveApplied(svc.Name, svc.Generation, h)
		l.probe(ctx, svc, &rep, ps.Running)
		return rep
	}
	return rep
}

func (l *Loop) postActualNow(ctx context.Context, one agentclient.ActualService) {
	tok, err := l.Token()
	if err != nil {
		return
	}
	id, _ := l.InstanceID()
	_ = l.API.PostActual(ctx, tok, l.Cfg.NodeID, agentclient.Actual{
		NodeID: l.Cfg.NodeID, AgentInstanceID: id, Services: []agentclient.ActualService{one},
	})
}

func (l *Loop) saveApplied(name string, gen int64, hash string) {
	l.applied[name] = appliedMeta{Generation: gen, Hash: hash}
	dir := filepath.Join(l.StateDir(), "services", name)
	b, _ := json.Marshal(appliedMeta{Generation: gen, Hash: hash})
	_ = writeFile(filepath.Join(dir, "applied.json"), b, 0o600)
}

func (l *Loop) probe(ctx context.Context, svc agentclient.DesiredService, rep *agentclient.ActualService, running bool) {
	url := svc.Health.URL
	if url == "" || !strings.HasPrefix(url, "http://127.0.0.1:") {
		url = fmt.Sprintf("http://127.0.0.1:%d/healthz", svc.HostPort)
	}
	pctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	code, dur, err := l.Probe(pctx, url)
	if err == nil && code/100 == 2 {
		l.fails[svc.Name] = 0
		rep.Health = "healthy"
		rep.ActualState = "running"
		rep.Error = ""
		rep.HealthDetail = fmt.Sprintf("%d in %dms", code, dur.Milliseconds())
		return
	}
	l.fails[svc.Name]++
	if !running {
		rep.ActualState = "missing"
		rep.Health = "unknown"
		if err != nil {
			rep.HealthDetail = err.Error()
		}
		return
	}
	if l.fails[svc.Name] >= 3 {
		rep.Health = "unhealthy"
		rep.ActualState = "unhealthy"
		rep.Error = "health_fail"
		l.Log.Warn("health_fail", "service", svc.Name)
		return
	}
	rep.Health = "progressing"
	rep.ActualState = "running"
	if err != nil {
		rep.HealthDetail = err.Error()
	} else {
		rep.HealthDetail = fmt.Sprintf("%d", code)
	}
}

func probeHealth(ctx context.Context, url string) (int, time.Duration, error) {
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, 0, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, time.Since(start), err
	}
	defer resp.Body.Close()
	return resp.StatusCode, time.Since(start), nil
}
