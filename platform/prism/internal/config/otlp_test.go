package config

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"strings"
	"testing"
)

func TestIngestRequiresDedicatedCredential(t *testing.T) {
	for _, mode := range []string{"all-in-one", "ingest", "query", "ruler", "console"} {
		t.Run(mode, func(t *testing.T) {
			path := writeFixtureFile(t, "config.yaml", strings.Replace(loadFixture(t), "  mode: all-in-one", "  mode: "+mode, 1))
			_, err := LoadWithEnvironment(context.Background(), path, []string{"PRISM_AUTH_INGEST_API_KEY_FILE="})
			wantFailure := mode == "all-in-one" || mode == "ingest"
			if (err != nil) != wantFailure {
				t.Fatalf("mode %s error=%v", mode, err)
			}
		})
	}
}

func TestIngestSecretValidation(t *testing.T) {
	for _, test := range []struct {
		name, content string
		valid         bool
	}{
		{"short", strings.Repeat("x", 31), false},
		{"minimum", strings.Repeat("x", 32) + "\n", true},
		{"oversized", strings.Repeat("x", 4097), false},
		{"whitespace", strings.Repeat(" ", 32), false},
		{"embedded newline", strings.Repeat("x", 32) + "\nsecret", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			key := writeFixtureFile(t, "key", test.content)
			cfg, err := LoadWithEnvironment(context.Background(), filepath.Join("testdata", "prismd.yaml"), []string{"PRISM_AUTH_INGEST_API_KEY_FILE=" + key})
			if (err == nil) != test.valid {
				t.Fatalf("error=%v valid=%v", err, test.valid)
			}
			if err != nil && strings.Contains(err.Error(), test.content) {
				t.Fatal("error leaks secret")
			}
			if cfg != nil {
				if string(cfg.Auth.IngestAPIKey) != strings.TrimSpace(test.content) {
					t.Fatal("resolved credential mismatch")
				}
				data, _ := json.Marshal(cfg)
				for _, formatted := range []string{string(data), fmt.Sprintf("%v", cfg), fmt.Sprintf("%+v", cfg), fmt.Sprintf("%#v", cfg)} {
					if strings.Contains(formatted, strings.TrimSpace(test.content)) {
						t.Fatal("serialized credential leaked")
					}
				}
			}
		})
	}
}

func TestIngestStrictTenancyFailsClosed(t *testing.T) {
	cfg := loadValid(t)
	cfg.Tenancy.Mode = "strict"
	if err := cfg.Validate(context.Background()); err == nil || !strings.Contains(err.Error(), "strict") {
		t.Fatalf("error=%v", err)
	}
	cfg.Server.Mode = "query"
	if err := cfg.Validate(context.Background()); err == nil || !strings.Contains(err.Error(), "strict tenancy") {
		t.Fatalf("query strict tenancy error=%v", err)
	}
}

func TestIngestCapacityValidation(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*Config)
	}{
		{"queue capacity", func(c *Config) { c.Ingest.QueueDepth = math.MaxInt }},
		{"receive capacity", func(c *Config) { c.Ingest.OTLP.MaxRecvMsgSize = ByteSize(math.MaxInt64) }},
		{"concurrency capacity", func(c *Config) { c.Ingest.OTLP.MaxConcurrentRequests = math.MaxInt }},
		{"batch bytes", func(c *Config) { c.Ingest.Batch.Logs.MaxBytes = ByteSize(math.MaxInt64) }},
		{"batch items", func(c *Config) { c.Ingest.Batch.Traces.MaxItems = math.MaxInt }},
		{"request bytes", func(c *Config) { c.Ingest.MaxRequestBytes = ByteSize(math.MaxInt64) }},
		{"memory budget", func(c *Config) { c.Ingest.MemoryLimit = 1 }},
		{"log limit overflow", func(c *Config) { c.Limits.MaxLogLineBytes = ByteSize(math.MaxInt64) }},
		{"negative concurrency", func(c *Config) { c.Ingest.OTLP.MaxConcurrentRequests = -1 }},
	} {
		t.Run(test.name, func(t *testing.T) {
			cfg := loadValid(t)
			test.mutate(cfg)
			if err := cfg.Validate(context.Background()); err == nil {
				t.Fatal("invalid capacity accepted")
			}
		})
	}
	cfg := loadValid(t)
	budget, err := cfg.Ingest.LogicalBudget()
	if err != nil {
		t.Fatal(err)
	}
	if budget != 1000<<20 {
		t.Fatalf("default logical budget =%d want1000MiB", budget)
	}
	cfg.Ingest.MemoryLimit = ByteSize(budget)
	if err := cfg.Validate(context.Background()); err != nil {
		t.Fatal(err)
	}
	cfg.Ingest.MemoryLimit--
	if err := cfg.Validate(context.Background()); err == nil {
		t.Fatal("budget boundary accepted")
	}
}

func TestOTLPDefaultsAndEnvironment(t *testing.T) {
	cfg := Default()
	if cfg.Ingest.QueueDepth != 4 || cfg.Ingest.OTLP.MaxRecvMsgSize != 4<<20 || cfg.Ingest.OTLP.MaxConcurrentRequests != 16 {
		t.Fatal("unexpected OTLP defaults")
	}
	loaded, err := LoadWithEnvironment(context.Background(), filepath.Join("testdata", "prismd.yaml"), []string{"PRISM_INGEST_OTLP_MAX_RECV_MSG_SIZE=2MiB", "PRISM_INGEST_OTLP_MAX_CONCURRENT_REQUESTS=8"})
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Ingest.OTLP.MaxRecvMsgSize != 2<<20 || loaded.Ingest.OTLP.MaxConcurrentRequests != 8 {
		t.Fatal("nested env override not applied")
	}
}

func TestIngestCredentialCannotReuseJWT(t *testing.T) {
	cfg := loadValid(t)
	cfg.Auth.IngestAPIKeyFile = cfg.Auth.JWTSecretFile
	if err := cfg.Validate(context.Background()); err == nil || !strings.Contains(err.Error(), "distinct") {
		t.Fatalf("JWT reuse accepted: %v", err)
	}
	if cfg.Auth.IngestAPIKey != "" {
		t.Fatal("failed validation retained old credential")
	}
}

func TestIngestIdentityCapacityMatchesReceiver(t *testing.T) {
	for _, tenant := range []string{" default", "default ", strings.Repeat("x", 2049)} {
		cfg := loadValid(t)
		cfg.Tenancy.DefaultTenant = tenant
		if err := cfg.Validate(context.Background()); err == nil {
			t.Fatal("invalid receiver identity passed config-check")
		}
	}
}

func TestMaximumLogicalBudgetCannotOverflow(t *testing.T) {
	cfg := Default()
	cfg.Ingest.QueueDepth = 1024
	cfg.Ingest.OTLP.MaxConcurrentRequests = 1024
	cfg.Ingest.MaxRequestBytes = 1 << 30
	cfg.Ingest.OTLP.MaxRecvMsgSize = 1 << 30
	cfg.Ingest.Batch.Metrics.MaxBytes = 1 << 30
	cfg.Ingest.Batch.Logs.MaxBytes = 1 << 30
	cfg.Ingest.Batch.Traces.MaxBytes = 1 << 30
	budget, err := cfg.Ingest.LogicalBudget()
	if err != nil || budget != 11284<<30 {
		t.Fatalf("maximum budget=%d error=%v", budget, err)
	}
}

func TestCombinedReceiveBudgetBoundaries(t *testing.T) {
	for _, test := range []struct {
		name                    string
		requestBytes, grpcBytes ByteSize
		concurrency             int
		want                    int64
	}{
		{"default", 16 << 20, 4 << 20, 16, 1000 << 20},
		{"HTTP larger", 17 << 20, 4 << 20, 16, 1037 << 20},
		{"gRPC larger", 16 << 20, 32 << 20, 16, 1512 << 20},
		{"one OTLP slot", 16 << 20, 4 << 20, 1, 520 << 20},
	} {
		t.Run(test.name, func(t *testing.T) {
			cfg := loadValid(t)
			cfg.Ingest.MaxRequestBytes = test.requestBytes
			cfg.Ingest.OTLP.MaxRecvMsgSize = test.grpcBytes
			cfg.Ingest.OTLP.MaxConcurrentRequests = test.concurrency
			budget, err := cfg.Ingest.LogicalBudget()
			if err != nil || budget != test.want {
				t.Fatalf("logical budget=%d want=%d error=%v", budget, test.want, err)
			}
			cfg.Ingest.MemoryLimit = ByteSize(test.want)
			if err := cfg.Validate(context.Background()); err != nil {
				t.Fatalf("exact budget rejected: %v", err)
			}
			cfg.Ingest.MemoryLimit--
			if err := cfg.Validate(context.Background()); err == nil {
				t.Fatal("budget one byte above limit accepted")
			}
		})
	}
}
