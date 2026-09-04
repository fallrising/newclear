package server

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"os"

	"github.com/fallrising/newclear/systems/clarkq/internal/config"
)

// BuildTLSConfig returns a tls.Config when HTTPS is enabled.
// If ClientCA is set, client certificates are required and verified (mTLS).
func BuildTLSConfig(cfg config.Config) (*tls.Config, error) {
	if !cfg.TLSEnabled() {
		return nil, nil
	}

	cert, err := tls.LoadX509KeyPair(cfg.TLSCertFile, cfg.TLSKeyFile)
	if err != nil {
		return nil, fmt.Errorf("load TLS cert/key: %w", err)
	}

	tlsCfg := &tls.Config{
		MinVersion:   tls.VersionTLS12,
		Certificates: []tls.Certificate{cert},
	}

	if cfg.TLSClientCAFile != "" {
		pemData, err := os.ReadFile(cfg.TLSClientCAFile)
		if err != nil {
			return nil, fmt.Errorf("read client CA: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pemData) {
			return nil, fmt.Errorf("parse client CA PEM: no certificates found")
		}
		tlsCfg.ClientCAs = pool
		tlsCfg.ClientAuth = tls.RequireAndVerifyClientCert
	}

	return tlsCfg, nil
}
