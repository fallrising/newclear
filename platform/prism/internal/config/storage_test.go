package config

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	_ "github.com/fallrising/newclear/platform/prism/drivers/clickhouse"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
)

func TestClickHouseStorageConfiguration(t *testing.T) {
	c := loadValid(t)
	c.Storage.Driver = "clickhouse"
	c.Storage.DSN = secret.String("clickhouse://prism:private-pass@127.0.0.1:9000/prism")
	c.Storage.Options = map[string]string{"async_insert": "0", "max_execution_time": "20"}
	if err := c.Validate(t.Context()); err != nil {
		t.Fatal(err)
	}
	options, err := c.StorageOptions()
	if err != nil {
		t.Fatal(err)
	}
	if options["retention_metrics_days"] != "30" || options["retention_logs_days"] != "14" || options["retention_traces_days"] != "7" || options["retention_red_days"] != "90" {
		t.Fatalf("retention options = %v", options)
	}
	options["async_insert"] = "1"
	if c.Storage.Options["async_insert"] != "0" {
		t.Fatal("storage options alias the configuration map")
	}
	encoded, err := json.Marshal(c.Storage)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "private-pass") || strings.Contains(c.Storage.DSN.String(), "private-pass") {
		t.Fatal("storage DSN leaked through serialization")
	}
	for _, rendered := range []string{fmt.Sprint(c.Storage), fmt.Sprintf("%+v", c.Storage), fmt.Sprintf("%#v", c.Storage)} {
		if strings.Contains(rendered, "private-pass") {
			t.Fatal("storage DSN leaked through formatting")
		}
	}
	yamlValue, err := c.Storage.DSN.MarshalYAML()
	if err != nil || strings.Contains(fmt.Sprint(yamlValue), "private-pass") {
		t.Fatal("storage DSN leaked through YAML serialization")
	}
}

func TestClickHouseStorageRejectsInvalidSettings(t *testing.T) {
	base := loadValid(t)
	base.Storage.Driver = "clickhouse"
	base.Storage.DSN = secret.String("clickhouse://prism:private-pass@127.0.0.1:9000/prism")
	tests := []struct {
		name string
		edit func(*Config)
	}{
		{"split", func(c *Config) { c.Storage.Split = map[string]StorageTarget{"metrics": {Driver: "memory"}} }},
		{"retention conflict", func(c *Config) { c.Storage.Options["retention_metrics_days"] = "2" }},
		{"timeout", func(c *Config) {
			c.Query.Timeout = Duration(10_000_000_000)
			c.Storage.Options["max_execution_time"] = "20"
		}},
		{"bad DSN", func(c *Config) { c.Storage.DSN = secret.String("http://wrong:secret@127.0.0.1:9000/prism") }},
		{"bad bound", func(c *Config) { c.Storage.Options["max_result_rows"] = "-1" }},
		{"unknown option", func(c *Config) { c.Storage.Options["no_such_limit"] = "1" }},
		{"bad DSN secure", func(c *Config) { c.Storage.DSN = secret.String("clickhouse://prism@127.0.0.1:9000/prism?secure=maybe") }},
		{"bad DSN timeout", func(c *Config) {
			c.Storage.DSN = secret.String("clickhouse://prism@127.0.0.1:9000/prism?read_timeout=forever")
		}},
		{"missing port", func(c *Config) { c.Storage.DSN = secret.String("clickhouse://127.0.0.1/prism") }},
		{"invalid port", func(c *Config) { c.Storage.DSN = secret.String("clickhouse://127.0.0.1:70000/prism") }},
		{"database path", func(c *Config) { c.Storage.DSN = secret.String("clickhouse://127.0.0.1:9000/prism/other") }},
		{"duplicate DSN option", func(c *Config) {
			c.Storage.DSN = secret.String("clickhouse://127.0.0.1:9000/prism?secure=true&secure=false")
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			c := *base
			c.Storage = base.Storage
			c.Storage.Options = map[string]string{"async_insert": "0"}
			test.edit(&c)
			if err := c.Validate(t.Context()); err == nil || strings.Contains(err.Error(), "private-pass") || strings.Contains(err.Error(), "secret") {
				t.Fatalf("Validate() error = %v", err)
			}
		})
	}
}

func TestClickHouseCredentialFiles(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"user", "password"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("fixture-value\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	base := loadFixture(t)
	base = strings.Replace(base, "  driver: memory\n  dsn: \"\"", "  driver: clickhouse\n  dsn: clickhouse://127.0.0.1:9000/prism", 1)
	base = strings.Replace(base, "    async_insert: \"1\"", "    async_insert: \"1\"\n    username_file: user\n    password_file: password", 1)
	path := filepath.Join(dir, "prism.yaml")
	writeFile(t, path, base)
	c, err := LoadWithEnvironment(t.Context(), path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if c.Storage.Options["username_file"] != filepath.Join(dir, "user") || c.Storage.Options["password_file"] != filepath.Join(dir, "password") {
		t.Fatalf("relative credential files not resolved: %v", c.Storage.Options)
	}
	c.Storage.DSN = secret.String("clickhouse://user:password@127.0.0.1:9000/prism")
	if err := c.Validate(t.Context()); err == nil {
		t.Fatal("duplicate DSN credentials accepted")
	}
	if err := os.Symlink(filepath.Join(dir, "password"), filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	c.Storage.DSN = secret.String("clickhouse://127.0.0.1:9000/prism")
	c.Storage.Options["password_file"] = filepath.Join(dir, "link")
	if err := c.Validate(t.Context()); err == nil {
		t.Fatal("symlink credential accepted")
	}
	c.Storage.Options["password_file"] = filepath.Join(dir, "fifo")
	if err := syscall.Mkfifo(c.Storage.Options["password_file"], 0o600); err != nil {
		t.Fatal(err)
	}
	if err := c.Validate(t.Context()); err == nil {
		t.Fatal("FIFO credential accepted")
	}
}

func TestClickHouseDSNFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dsn")
	const dsn = "clickhouse://prism:file-pass@127.0.0.1:9000/prism" //nolint:gosec // Public disposable test credential.
	if err := os.WriteFile(path, []byte(dsn+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	base := loadFixture(t)
	base = strings.Replace(base, "  driver: memory", "  driver: clickhouse\n  dsn_file: "+path, 1)
	configPath := writeFixtureFile(t, "clickhouse.yaml", base)
	c, err := LoadWithEnvironment(context.Background(), configPath, nil)
	if err != nil {
		t.Fatal(err)
	}
	if string(c.Storage.DSN) != dsn {
		t.Fatal("DSN file was not loaded")
	}
	if err := c.Validate(t.Context()); err != nil {
		t.Fatalf("repeated validation failed: %v", err)
	}
	c.Storage.DSN = secret.String("clickhouse://127.0.0.1:9000/other")
	if err := c.Validate(t.Context()); err == nil {
		t.Fatal("postload DSN mutation bypassed dsn_file conflict")
	}
	c.Storage.DSN = secret.String(dsn)
	if err := os.WriteFile(path, []byte("clickhouse://127.0.0.1:9000/changed"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := c.Validate(t.Context()); err == nil {
		t.Fatal("changed DSN file was silently reused")
	}
	if err := os.WriteFile(path, []byte(dsn+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(path, path+"-link"); err != nil {
		t.Fatal(err)
	}
	base = strings.Replace(base, path, path+"-link", 1)
	configPath = writeFixtureFile(t, "clickhouse-symlink.yaml", base)
	if _, err := LoadWithEnvironment(context.Background(), configPath, nil); err == nil {
		t.Fatal("symlink DSN file accepted")
	}
	if err := syscall.Mkfifo(path+"-fifo", 0o600); err != nil {
		t.Fatal(err)
	}
	base = strings.Replace(base, path+"-link", path+"-fifo", 1)
	configPath = writeFixtureFile(t, "clickhouse-fifo.yaml", base)
	if _, err := LoadWithEnvironment(context.Background(), configPath, nil); err == nil {
		t.Fatal("FIFO DSN file accepted")
	}
	base = strings.Replace(base, path+"-fifo", path, 1)
	base = strings.Replace(base, "  dsn_file:", "  dsn: clickhouse://127.0.0.1:9000/prism\n  dsn_file:", 1)
	configPath = writeFixtureFile(t, "clickhouse-double.yaml", base)
	if _, err := LoadWithEnvironment(context.Background(), configPath, nil); err == nil {
		t.Fatal("dsn plus dsn_file accepted")
	}
	for _, test := range []struct {
		name, content string
	}{
		{"empty", ""},
		{"newlines-only", "\r\n"},
		{"oversize", strings.Repeat("x", maxStorageDSNBytes+1)},
	} {
		t.Run(test.name, func(t *testing.T) {
			badPath := filepath.Join(t.TempDir(), "dsn")
			if err := os.WriteFile(badPath, []byte(test.content), 0o600); err != nil {
				t.Fatal(err)
			}
			configText := strings.Replace(loadFixture(t), "  driver: memory", "  driver: clickhouse\n  dsn_file: "+badPath, 1)
			configPath := writeFixtureFile(t, "bad-dsn.yaml", configText)
			if _, err := LoadWithEnvironment(t.Context(), configPath, nil); err == nil {
				t.Fatal("invalid DSN file accepted")
			}
		})
	}
}
