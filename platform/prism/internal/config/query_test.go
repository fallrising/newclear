package config

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
)

func TestQueryIdentityValidation(t *testing.T) {
	fixture := filepath.Join("testdata", "prismd.yaml")
	for _, test := range []struct {
		name string
		env  []string
		want string
		key  bool
	}{
		{"anonymous query without key", []string{"PRISM_SERVER_MODE=query", "PRISM_AUTH_INGEST_API_KEY_FILE="}, "", false},
		{"authenticated query loads key", []string{"PRISM_SERVER_MODE=query", "PRISM_AUTH_ALLOW_ANONYMOUS_READ=false"}, "", true},
		{"authenticated query requires key", []string{"PRISM_SERVER_MODE=query", "PRISM_AUTH_ALLOW_ANONYMOUS_READ=false", "PRISM_AUTH_INGEST_API_KEY_FILE="}, "auth.ingest_api_key_file", false},
		{"strict query fails closed", []string{"PRISM_SERVER_MODE=query", "PRISM_TENANCY_MODE=strict"}, "strict tenancy", false},
		{"strict all in one fails closed", []string{"PRISM_SERVER_MODE=all-in-one", "PRISM_TENANCY_MODE=strict"}, "strict tenancy", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			cfg, err := LoadWithEnvironment(t.Context(), fixture, test.env)
			if test.want != "" {
				if err == nil || !strings.Contains(err.Error(), test.want) {
					t.Fatalf("LoadWithEnvironment() error = %v, want %q", err, test.want)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if (cfg.Auth.IngestAPIKey != "") != test.key {
				t.Fatalf("query credential loaded = %t, want %t", cfg.Auth.IngestAPIKey != "", test.key)
			}
		})
	}
}

func TestQueryIdentityDirectValidationClearsStaleKey(t *testing.T) {
	cfg, err := LoadWithEnvironment(t.Context(), filepath.Join("testdata", "prismd.yaml"), nil)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Server.Mode = "query"
	cfg.Auth.AllowAnonymousRead = true
	cfg.Auth.IngestAPIKeyFile = ""
	if err := cfg.Validate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if cfg.Auth.IngestAPIKey != "" {
		t.Fatal("query retained stale ingest credential")
	}
}
