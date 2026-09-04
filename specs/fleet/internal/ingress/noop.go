package ingress

import "context"

// Noop is the httptest default. It never calls Cloudflare and invents no CIDRs.
type Noop struct{}

func (Noop) EnsureNodeTunnel(context.Context, string) (string, string, error) {
	return "", "", nil
}

func (Noop) ReconcileService(context.Context, ServiceView) error { return nil }

func (Noop) ReconcileTunnel(context.Context, string) error { return nil }

func (Noop) ReissueTunnelToken(context.Context, string) (string, error) {
	return "", nil
}

func (Noop) EnsureOTPProvider(context.Context) error { return nil }

func (Noop) Status() string { return "na" }
