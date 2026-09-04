package ingress

import "context"

// ServiceView is the catalog snapshot passed to Cloudflare reconcile.
type ServiceView struct {
	Name              string
	NodeID            string
	TunnelID          string
	DesiredState      string
	ExposeMode        string
	Hostname          string
	HostPort          int
	ContainerPort     int
	DNSRecordID       string
	AccessAppID       string
	AccessPolicyID    string
	HostnameRouteID   string
}

// Reconciler owns Cloudflare (or noop) mutations for tunnels and hostnames.
type Reconciler interface {
	EnsureNodeTunnel(ctx context.Context, nodeID string) (tunnelID, tunnelToken string, err error)
	ReconcileService(ctx context.Context, svc ServiceView) error
	ReconcileTunnel(ctx context.Context, tunnelID string) error
	ReissueTunnelToken(ctx context.Context, tunnelID string) (token string, err error)
	EnsureOTPProvider(ctx context.Context) error
}
