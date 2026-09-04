package model

import "time"

type Node struct {
	ID                string
	DisplayName       string
	TunnelID          string
	HostPortMin       int
	HostPortMax       int
	AgentTokenID      string
	AgentInstanceID   string
	FactsJSON         string
	LastSeenAt        string
	LastError         string
	DesiredGeneration int64
	CreatedAt         string
	UpdatedAt         string
}

func (n Node) Status(now time.Time) string {
	if n.LastSeenAt == "" {
		return "offline"
	}
	t, err := time.Parse(time.RFC3339, n.LastSeenAt)
	if err != nil {
		t, err = time.Parse(time.RFC3339Nano, n.LastSeenAt)
		if err != nil {
			return "offline"
		}
	}
	if now.Sub(t) < 60*time.Second {
		return "online"
	}
	return "offline"
}

type Service struct {
	Name              string
	Description       string
	LabelsJSON        string
	NodeID            string
	FleetJSON         string
	Image             string
	DesiredState      string
	ExposeMode        string
	Hostname          string
	ContainerPort     int
	HostPort          int
	HealthPath        string
	CurrentReleaseID  string
	Generation        int64
	ForceRecreate     bool
	ComposeYAML       string
	EnvFile           string
	URL               string
	CFDNSRecordID     string
	CFAccessAppID     string
	CFAccessPolicyID  string
	CFHostnameRouteID string
	IngressStatus     string
	IngressError      string
	PurgeVolumes      bool
	CreatedAt         string
	UpdatedAt         string
}

type Tombstone struct {
	Service        string
	NodeID         string
	ComposeProject string
	HostPort       int
	ComposeYAML    string
	EnvFile        string
	Image          string
	HealthPath     string
	PurgeVolumes   bool
	Generation     int64
	AckedAt        string
	CreatedAt      string
}

type Release struct {
	ID        string
	Service   string
	Image     string
	GitSHA    string
	GitRepo   string
	Source    string
	CreatedAt string
}

type Instance struct {
	Service            string
	NodeID             string
	ReleaseID          string
	ComposeProject     string
	ContainerID        string
	Image              string
	ActualState        string
	Health             string
	HealthDetail       string
	AppliedGeneration  int64
	Error              string
	ReportedAt         string
}

type Token struct {
	ID         string
	Kind       string
	NodeID     string
	Name       string
	Prefix     string
	Hash       string
	LastUsedAt string
	CreatedAt  string
	RevokedAt  string
}

type AuditEvent struct {
	ID         int64
	At         string
	Actor      string
	Action     string
	Service    string
	NodeID     string
	DetailJSON string
}

type CFState struct {
	Key       string
	ETag      string
	JSON      string
	UpdatedAt string
}

func ServiceURL(mode, hostname string) string {
	switch mode {
	case "private":
		return "http://" + hostname
	default:
		return "https://" + hostname
	}
}

func ComposeProject(name string) string { return "fleet-" + name }
