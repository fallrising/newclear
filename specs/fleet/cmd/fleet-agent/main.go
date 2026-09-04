package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"syscall"
	"time"

	"github.com/fallrising/fleet-catalog/internal/agentloop"
	"github.com/fallrising/fleet-catalog/internal/composeclient"
	"github.com/fallrising/fleet-catalog/internal/config"
	"gopkg.in/yaml.v3"
)

var redactKeys = regexp.MustCompile(`(?i)token|password|secret|authorization|cookie`)

func redactAttr(_ []string, a slog.Attr) slog.Attr {
	if redactKeys.MatchString(a.Key) {
		a.Value = slog.StringValue("[redacted]")
	}
	return a
}

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{ReplaceAttr: redactAttr}))
	cfg, err := loadAgent()
	if err != nil {
		log.Error("config", "err", err.Error())
		os.Exit(1)
	}
	cli := &composeclient.CLI{Docker: cfg.Docker, AgentComposeFile: cfg.AgentComposeFile}
	api := &agentloop.HTTPFleet{Base: cfg.URL, Client: &http.Client{Timeout: 30 * time.Second}}
	loop := agentloop.New(cfg, api, cli, log)
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	if err := loop.ServeHealthz(ctx, "127.0.0.1:19600"); err != nil {
		log.Error("healthz", "err", err.Error())
		os.Exit(1)
	}
	if err := loop.Run(ctx); err != nil && err != context.Canceled {
		log.Error("run", "err", err.Error())
		os.Exit(1)
	}
}

func loadAgent() (config.Agent, error) {
	state := os.Getenv("FLEET_STATE_DIR")
	if state == "" {
		state = config.DefaultStateDir
	}
	path := filepath.Join(state, "agent.yaml")
	if b, err := os.ReadFile(path); err == nil {
		var file struct {
			URL      string `yaml:"url"`
			NodeID   string `yaml:"node_id"`
			Token    string `yaml:"token_file"`
			Interval string `yaml:"interval"`
		}
		if err := yaml.Unmarshal(b, &file); err == nil {
			if os.Getenv("FLEET_URL") == "" && file.URL != "" {
				_ = os.Setenv("FLEET_URL", file.URL)
			}
			if os.Getenv("FLEET_NODE_ID") == "" && file.NodeID != "" {
				_ = os.Setenv("FLEET_NODE_ID", file.NodeID)
			}
			if os.Getenv("FLEET_TOKEN_FILE") == "" && file.Token != "" {
				_ = os.Setenv("FLEET_TOKEN_FILE", file.Token)
			}
		}
	}
	return config.LoadAgent()
}
