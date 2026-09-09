package config

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/fallrising/newclear/platform/prism/drivers/memory"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

func TestLoadReferenceConfiguration(t *testing.T) {
	configuration, err := LoadWithEnvironment(context.Background(), filepath.Join("testdata", "prismd.yaml"), nil)
	if err != nil {
		t.Fatalf("LoadContext() error = %v", err)
	}
	if configuration.Storage.Driver != "memory" {
		t.Fatalf("storage.driver = %q, want memory", configuration.Storage.Driver)
	}
	if !filepath.IsAbs(configuration.Auth.JWTSecretFile) {
		t.Fatalf("jwt_secret_file = %q, want resolved absolute path", configuration.Auth.JWTSecretFile)
	}
	if warnings := configuration.SecurityWarnings(SecurityState{}); len(warnings) != 0 {
		t.Fatalf("SecurityWarnings() = %v, want none", warnings)
	}
}

func TestDefaultsMatchSDD(t *testing.T) {
	configuration := Default()
	checks := map[string]bool{
		"http listener":        configuration.Server.HTTPListen == ":9090",
		"grpc listener":        configuration.Server.GRPCListen == ":4317",
		"mode":                 configuration.Server.Mode == "all-in-one",
		"storage driver":       configuration.Storage.Driver == "clickhouse",
		"metrics retention":    configuration.Storage.Retention.MetricsDays == 30,
		"logs retention":       configuration.Storage.Retention.LogsDays == 14,
		"traces retention":     configuration.Storage.Retention.TracesDays == 7,
		"red retention":        configuration.Storage.Retention.REDDays == 90,
		"metric batch":         configuration.Ingest.Batch.Metrics.MaxItems == 10_000,
		"query timeout":        configuration.Query.Timeout.Std() == time.Minute,
		"query max lookback":   configuration.Query.MaxLookback.Std() == 30*24*time.Hour,
		"query fallback range": configuration.Query.Fallback.MaxRange.Std() == 24*time.Hour,
	}
	for name, correct := range checks {
		if !correct {
			t.Errorf("default %s does not match SDD", name)
		}
	}
}

func TestEnvironmentOverrides(t *testing.T) {
	configuration, err := LoadWithEnvironment(context.Background(), filepath.Join("testdata", "prismd.yaml"), []string{
		"PRISM_SERVER_MODE=query",
		"PRISM_AUTH_ALLOW_ANONYMOUS_READ=false",
		"PRISM_INGEST_MAX_REQUEST_BYTES=32MiB",
		"PRISM_QUERY_TIMEOUT=45s",
		"PRISM_STORAGE_OPTIONS_ASYNC_INSERT=0",
		"PRISM_STORAGE_SPLIT_METRICS_DRIVER=memory",
		"PRISM_STORAGE_SPLIT_METRICS_DSN=",
	})
	if err != nil {
		t.Fatalf("LoadContext() error = %v", err)
	}
	if configuration.Server.Mode != "query" || configuration.Auth.AllowAnonymousRead {
		t.Fatalf("scalar environment overrides were not applied: %#v", configuration)
	}
	if configuration.Ingest.MaxRequestBytes != ByteSize(32<<20) || configuration.Query.Timeout.Std() != 45*time.Second {
		t.Fatalf("typed environment overrides were not applied")
	}
	if configuration.Storage.Options["async_insert"] != "0" || configuration.Storage.Split["metrics"].Driver != "memory" {
		t.Fatalf("map environment overrides were not applied: %#v", configuration.Storage)
	}
}

func TestUnknownEnvironmentOverrideIsRejected(t *testing.T) {
	_, err := LoadWithEnvironment(context.Background(), filepath.Join("testdata", "prismd.yaml"), []string{"PRISM_NOT_A_SETTING=value"})
	if !errors.Is(err, errUnknownEnvironmentPath) {
		t.Fatalf("LoadContext() error = %v, want errUnknownEnvironmentPath", err)
	}
}

func TestInvalidConfigurations(t *testing.T) {
	fixture := loadFixture(t)
	shortSecret := writeFixtureFile(t, "short-jwt", "too-short\n")
	badRules := t.TempDir()
	writeFile(t, filepath.Join(badRules, "bad.yaml"), "groups:\n  - name: broken\n    rules:\n      - alert: MissingExpression\n")
	badNotify := writeFixtureFile(t, "unknown-receiver.yaml", "route:\n  receiver: absent\nreceivers:\n  - name: ops-fallback\n")
	cyclicNotify := writeFixtureFile(t, "cyclic-notify.yaml", "route: &loop\n  receiver: default\n  routes:\n    - *loop\nreceivers:\n  - name: default\n  - name: ops-fallback\n")

	tests := []struct {
		name string
		old  string
		new  string
		want string
	}{
		{name: "unknown field", old: "  mode: all-in-one", new: "  mode: all-in-one\n  mystery: true", want: "unknown field"},
		{name: "invalid mode", old: "  mode: all-in-one", new: "  mode: impossible", want: "server.mode"},
		{name: "invalid listener", old: "  http_listen: \"127.0.0.1:9090\"", new: "  http_listen: missing-port", want: "server.http_listen"},
		{name: "unregistered driver", old: "  driver: memory", new: "  driver: missing", want: "not registered"},
		{name: "zero retention", old: "    metrics_days: 30", new: "    metrics_days: 0", want: "storage.retention"},
		{name: "invalid tenancy", old: "  mode: single", new: "  mode: loose", want: "tenancy.mode"},
		{name: "short jwt", old: fixturePath(t, "secrets/jwt"), new: shortSecret, want: "at least 32 bytes"},
		{name: "invalid batch", old: "    metrics: {max_items: 10000, max_bytes: 8MiB, flush_interval: 1s}", new: "    metrics: {max_items: 0, max_bytes: 8MiB, flush_interval: 1s}", want: "ingest.batch.metrics"},
		{name: "invalid concurrency", old: "  max_concurrent_per_tenant: 8", new: "  max_concurrent_per_tenant: 32", want: "query concurrency"},
		{name: "invalid rules", old: fixturePath(t, "rules"), new: badRules, want: "expr must not be empty"},
		{name: "unknown receiver", old: fixturePath(t, "alertmanager.yaml"), new: badNotify, want: "unknown receiver"},
		{name: "cyclic receiver route", old: fixturePath(t, "alertmanager.yaml"), new: cyclicNotify, want: "anchors, aliases"},
		{name: "invalid telemetry", old: "  log_format: json", new: "  log_format: xml", want: "telemetry.log_format"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if !strings.Contains(fixture, test.old) {
				t.Fatalf("fixture does not contain mutation target %q", test.old)
			}
			path := writeFixtureFile(t, "invalid.yaml", strings.Replace(fixture, test.old, test.new, 1))
			_, err := LoadWithEnvironment(context.Background(), path, nil)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("LoadContext() error = %v, want substring %q", err, test.want)
			}
		})
	}
}

func TestSecurityChecklist(t *testing.T) {
	t.Run("jwt secret exists and is long enough", func(t *testing.T) {
		fixture := loadFixture(t)
		path := writeFixtureFile(t, "missing-jwt.yaml", strings.Replace(fixture, fixturePath(t, "secrets/jwt"), filepath.Join(t.TempDir(), "missing"), 1))
		_, err := LoadWithEnvironment(context.Background(), path, nil)
		if err == nil || !strings.Contains(err.Error(), "jwt_secret_file") {
			t.Fatalf("LoadContext() error = %v, want JWT failure", err)
		}
	})

	t.Run("public anonymous listener warning", func(t *testing.T) {
		configuration := loadValid(t)
		configuration.Server.HTTPListen = ":9090"
		assertWarning(t, configuration.SecurityWarnings(SecurityState{}), "anonymous-public-listener")
	})

	t.Run("public listener transport warning", func(t *testing.T) {
		configuration := loadValid(t)
		configuration.Server.HTTPListen = "0.0.0.0:9090"
		configuration.Auth.AllowAnonymousRead = false
		assertWarning(t, configuration.SecurityWarnings(SecurityState{}), "public-listener-without-transport-security")
	})

	t.Run("single mode multiple tenants warning", func(t *testing.T) {
		configuration := loadValid(t)
		assertWarning(t, configuration.SecurityWarnings(SecurityState{TenantCount: 2}), "single-tenancy-with-multiple-tenants")
	})

	t.Run("plaintext receiver credential is fatal and redacted", func(t *testing.T) {
		fixture := loadFixture(t)
		credential := "do-not-leak-this-password"
		notify := writeFixtureFile(t, "plaintext.yaml", "route:\n  receiver: default\nreceivers:\n  - name: default\n    email_configs:\n      - auth_password: "+credential+"\n  - name: ops-fallback\n")
		path := writeFixtureFile(t, "plaintext-config.yaml", strings.Replace(fixture, fixturePath(t, "alertmanager.yaml"), notify, 1))
		_, err := LoadWithEnvironment(context.Background(), path, nil)
		if err == nil || !strings.Contains(err.Error(), "plaintext credential") {
			t.Fatalf("LoadContext() error = %v, want plaintext credential failure", err)
		}
		if strings.Contains(err.Error(), credential) {
			t.Fatalf("error leaked credential: %v", err)
		}
	})

	t.Run("receiver file references must be readable", func(t *testing.T) {
		fixture := loadFixture(t)
		missing := filepath.Join(t.TempDir(), "missing-password")
		notify := writeFixtureFile(t, "missing-receiver-file.yaml", "route:\n  receiver: default\nreceivers:\n  - name: default\n    email_configs:\n      - auth_password_file: "+missing+"\n  - name: ops-fallback\n")
		path := writeFixtureFile(t, "missing-receiver-file-config.yaml", strings.Replace(fixture, fixturePath(t, "alertmanager.yaml"), notify, 1))
		_, err := LoadWithEnvironment(context.Background(), path, nil)
		if err == nil || !strings.Contains(err.Error(), "auth_password_file is not readable") {
			t.Fatalf("LoadContext() error = %v, want receiver file readability failure", err)
		}
	})

	t.Run("automatic upgrade warning", func(t *testing.T) {
		configuration := loadValid(t)
		configuration.Control.AutoUpgrade = true
		warnings := configuration.SecurityWarnings(SecurityState{})
		assertWarning(t, warnings, "automatic-upgrade-enabled")
		if !strings.Contains(warningMessage(warnings, "automatic-upgrade-enabled"), "supply-chain") {
			t.Fatalf("automatic upgrade warning does not explain consequence: %v", warnings)
		}
	})

	t.Run("missing watchdog warning", func(t *testing.T) {
		configuration := loadValid(t)
		configuration.notifyState.hasWatchdog = false
		assertWarning(t, configuration.SecurityWarnings(SecurityState{}), "watchdog-route-missing")
	})

	t.Run("agent broad read scope warning", func(t *testing.T) {
		configuration := loadValid(t)
		state := SecurityState{AgentKeys: []AgentKey{{Name: "agent-1", Scopes: []string{"write:*", "read:*"}}}}
		warnings := configuration.SecurityWarnings(state)
		assertWarning(t, warnings, "agent-broad-read-scope")
		if _, err := json.Marshal(warnings); err != nil {
			t.Fatalf("warnings cannot be serialized for status API: %v", err)
		}
	})
}

func TestValidationDoesNotOpenBackend(t *testing.T) {
	const driverName = "p0-07-never-open"
	registerNeverOpen.Do(func() { spi.Register(driverName, neverOpenDriver{}) })
	configuration := loadValid(t)
	configuration.Storage.Driver = driverName
	configuration.Storage.DSN = "validated-without-connection"
	if err := configuration.Validate(context.Background()); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
}

type neverOpenDriver struct{}

var registerNeverOpen sync.Once

func (neverOpenDriver) Name() string { return "p0-07-never-open" }

func (neverOpenDriver) Open(context.Context, spi.Config) (spi.Backend, error) {
	panic("configuration validation must not open a backend")
}

func loadValid(t *testing.T) *Config {
	t.Helper()
	configuration, err := LoadWithEnvironment(context.Background(), filepath.Join("testdata", "prismd.yaml"), nil)
	if err != nil {
		t.Fatalf("LoadContext() error = %v", err)
	}
	return configuration
}

func loadFixture(t *testing.T) string {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("testdata", "prismd.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	result := string(content)
	replacements := map[string]string{
		"jwt_secret_file: secrets/jwt":   "jwt_secret_file: " + fixturePath(t, "secrets/jwt"),
		"path: rules":                    "path: " + fixturePath(t, "rules"),
		"config_path: alertmanager.yaml": "config_path: " + fixturePath(t, "alertmanager.yaml"),
	}
	for old, replacement := range replacements {
		result = strings.Replace(result, old, replacement, 1)
	}
	return result
}

func fixturePath(t *testing.T, relative string) string {
	t.Helper()
	absolute, err := filepath.Abs(filepath.Join("testdata", relative))
	if err != nil {
		t.Fatal(err)
	}
	return absolute
}

func writeFixtureFile(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	writeFile(t, path, content)
	return path
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func assertWarning(t *testing.T, warnings []Warning, code string) {
	t.Helper()
	if warningMessage(warnings, code) == "" {
		t.Fatalf("warnings = %v, want code %q", warnings, code)
	}
}

func warningMessage(warnings []Warning, code string) string {
	for _, warning := range warnings {
		if warning.Code == code {
			return warning.Message
		}
	}
	return ""
}
