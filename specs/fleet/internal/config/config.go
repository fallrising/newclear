package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

const (
	DefaultListen      = "127.0.0.1:18765"
	DefaultDB          = "/var/lib/fleetd/fleet.db"
	DefaultHostPortMin = 20000
	DefaultHostPortMax = 20999
	DefaultAccessSess  = "24h"
	DefaultAgentHealth = "127.0.0.1:19600"
	DefaultTokenFile   = "/var/lib/fleet/agent.token"
	DefaultStateDir    = "/var/lib/fleet"
	DefaultDocker      = "docker"
	DefaultAgentStack  = "/usr/local/share/fleet/agent-stack.yml"
	DefaultInterval    = 15 * time.Second
	StaleAfter         = 60 * time.Second
	TombstoneTimeout   = 24 * time.Hour
	CookieName         = "fleet_op"
)

// Fleetd is control-plane env. There is no CF_BASE_DOMAIN alias.
type Fleetd struct {
	Listen                 string
	DB                     string
	BootstrapOperatorToken string
	BootstrapNodeToken     string
	GHCRPullToken          string
	BaseDomain             string
	AllowedSuffixes        []string
	UIHostname             string
	APIHostname            string
	BootstrapTunnelID      string
	BootstrapTunnelToken   string
	ProtectedHostnames     []string
	CFAPIToken             string
	CFAccountID            string
	CFZoneID               string
	CFAccessAllowedEmails  []string
	CFAccessSession        string
}

type Agent struct {
	URL              string
	NodeID           string
	TokenFile        string
	StateDir         string
	BootstrapToken   string
	Interval         time.Duration
	Docker           string
	AgentComposeFile string
}

func LoadFleetd() (Fleetd, error) {
	c := Fleetd{
		Listen:                 getenv("FLEETD_LISTEN", DefaultListen),
		DB:                     getenv("FLEETD_DB", DefaultDB),
		BootstrapOperatorToken: os.Getenv("FLEETD_BOOTSTRAP_OPERATOR_TOKEN"),
		BootstrapNodeToken:     os.Getenv("FLEETD_BOOTSTRAP_NODE_TOKEN"),
		GHCRPullToken:          os.Getenv("FLEETD_GHCR_PULL_TOKEN"),
		BaseDomain:             os.Getenv("FLEET_BASE_DOMAIN"),
		UIHostname:             os.Getenv("FLEET_UI_HOSTNAME"),
		APIHostname:            os.Getenv("FLEET_API_HOSTNAME"),
		BootstrapTunnelID:      os.Getenv("FLEET_BOOTSTRAP_TUNNEL_ID"),
		BootstrapTunnelToken:   os.Getenv("FLEET_BOOTSTRAP_TUNNEL_TOKEN"),
		CFAPIToken:             os.Getenv("CF_API_TOKEN"),
		CFAccountID:            os.Getenv("CF_ACCOUNT_ID"),
		CFZoneID:               os.Getenv("CF_ZONE_ID"),
		CFAccessSession:        getenv("CF_ACCESS_SESSION", DefaultAccessSess),
	}
	if c.UIHostname == "" || c.APIHostname == "" {
		return Fleetd{}, fmt.Errorf("FLEET_UI_HOSTNAME and FLEET_API_HOSTNAME are required")
	}
	c.AllowedSuffixes = splitCSV(os.Getenv("FLEET_ALLOWED_SUFFIXES"))
	if len(c.AllowedSuffixes) == 0 && c.BaseDomain != "" {
		c.AllowedSuffixes = []string{c.BaseDomain}
	}
	c.ProtectedHostnames = splitCSV(os.Getenv("FLEET_PROTECTED_HOSTNAMES"))
	if len(c.ProtectedHostnames) == 0 {
		c.ProtectedHostnames = []string{c.UIHostname, c.APIHostname}
	}
	c.CFAccessAllowedEmails = splitCSV(os.Getenv("CF_ACCESS_ALLOWED_EMAILS"))
	return c, nil
}

func LoadAgent() (Agent, error) {
	c := Agent{
		URL:              os.Getenv("FLEET_URL"),
		NodeID:           os.Getenv("FLEET_NODE_ID"),
		TokenFile:        getenv("FLEET_TOKEN_FILE", DefaultTokenFile),
		StateDir:         getenv("FLEET_STATE_DIR", DefaultStateDir),
		BootstrapToken:   os.Getenv("FLEET_BOOTSTRAP_TOKEN"),
		Docker:           getenv("DOCKER", DefaultDocker),
		AgentComposeFile: getenv("FLEET_AGENT_COMPOSE_FILE", DefaultAgentStack),
		Interval:         DefaultInterval,
	}
	if v := os.Getenv("FLEET_INTERVAL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return Agent{}, fmt.Errorf("FLEET_INTERVAL: %w", err)
		}
		c.Interval = d
	}
	if c.URL == "" || c.NodeID == "" {
		return Agent{}, fmt.Errorf("FLEET_URL and FLEET_NODE_ID are required")
	}
	return c, nil
}

func getenv(k, def string) string {
	if v, ok := os.LookupEnv(k); ok && v != "" {
		return v
	}
	return def
}

func splitCSV(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func TestEnv() {
	_ = os.Setenv("FLEET_UI_HOSTNAME", "fleet.example.com")
	_ = os.Setenv("FLEET_API_HOSTNAME", "fleet-api.example.com")
	_ = os.Setenv("FLEET_BASE_DOMAIN", "example.com")
}
