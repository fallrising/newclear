package crypto

import (
	"fmt"
	"sort"
)

// Registry resolves encryption providers by queue name.
// Global default mode applies unless a queue override is configured.
type Registry struct {
	defaultMode string
	queueModes  map[string]string
	providers   map[string]Provider
}

// NewRegistry builds providers for the default mode and every queue override.
// RSA material is loaded once when any configured mode is server_rsa.
func NewRegistry(defaultMode string, queueModes map[string]string, rsaPublicKey, rsaKeyDir string) (*Registry, error) {
	if defaultMode == "" {
		defaultMode = "none"
	}
	if err := ValidateMode(defaultMode); err != nil {
		return nil, err
	}

	normalizedQueues := make(map[string]string, len(queueModes))
	for name, mode := range queueModes {
		if err := ValidateMode(mode); err != nil {
			return nil, fmt.Errorf("queue %q: %w", name, err)
		}
		normalizedQueues[name] = mode
	}

	needed := map[string]struct{}{defaultMode: {}}
	for _, mode := range normalizedQueues {
		needed[mode] = struct{}{}
	}

	providers := make(map[string]Provider, len(needed))
	var rsaLoaded Provider

	for mode := range needed {
		switch mode {
		case "none":
			providers[mode] = NewNoopProvider()
		case "client":
			providers[mode] = NewClientProvider()
		case "server_rsa":
			if rsaLoaded == nil {
				p, _, err := LoadRSAProvider(rsaPublicKey, rsaKeyDir)
				if err != nil {
					return nil, err
				}
				rsaLoaded = p
			}
			providers[mode] = rsaLoaded
		}
	}

	return &Registry{
		defaultMode: defaultMode,
		queueModes:  normalizedQueues,
		providers:   providers,
	}, nil
}

func (r *Registry) DefaultMode() string {
	return r.defaultMode
}

// QueueModes returns a copy of per-queue encryption overrides.
func (r *Registry) QueueModes() map[string]string {
	if len(r.queueModes) == 0 {
		return nil
	}
	out := make(map[string]string, len(r.queueModes))
	for k, v := range r.queueModes {
		out[k] = v
	}
	return out
}

// ModeFor returns the encryption mode used for the given queue.
func (r *Registry) ModeFor(queue string) string {
	if mode, ok := r.queueModes[queue]; ok {
		return mode
	}
	return r.defaultMode
}

// ProviderFor returns the crypto provider for the given queue.
func (r *Registry) ProviderFor(queue string) Provider {
	mode := r.ModeFor(queue)
	return r.providers[mode]
}

// PublicKeyPEM returns the RSA public key when server_rsa is configured.
func (r *Registry) PublicKeyPEM() (string, bool) {
	p, ok := r.providers["server_rsa"]
	if !ok {
		return "", false
	}
	return p.PublicKeyPEM()
}

// ModesInUse returns sorted unique encryption modes currently configured.
func (r *Registry) ModesInUse() []string {
	set := map[string]struct{}{r.defaultMode: {}}
	for _, mode := range r.queueModes {
		set[mode] = struct{}{}
	}
	out := make([]string, 0, len(set))
	for mode := range set {
		out = append(out, mode)
	}
	sort.Strings(out)
	return out
}

// ValidateMode checks that mode is one of none, client, server_rsa.
func ValidateMode(mode string) error {
	switch mode {
	case "none", "client", "server_rsa":
		return nil
	default:
		return fmt.Errorf("unsupported encryption mode %q", mode)
	}
}
