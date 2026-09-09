package config

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/fallrising/newclear/platform/prism/pkg/spi"
)

const maxAuxiliaryFileBytes = 4 << 20

const maxRuleFiles = 10_000

// Validate checks configuration values and local files without connecting to a backend.
func (c *Config) Validate(ctx context.Context) error {
	if c == nil {
		return errors.New("configuration is nil")
	}
	errs := []error{
		validateServer(c.Server),
		validateStorage(c.Storage),
		validateControlplane(c.Controlplane),
		validateTenancy(c.Tenancy),
		validateAuth(ctx, c.Auth),
		validateIngest(c.Ingest),
		validateLimits(c.Limits),
		validateQuery(c.Query),
		validateRules(ctx, c.Rules),
		validateTelemetry(c.Telemetry),
	}
	notifyState, notifyErr := validateNotify(ctx, c.Notify)
	c.notifyState = notifyState
	errs = append(errs, notifyErr)
	if err := validateReadableFile(ctx, "server.tls_cert_file", c.Server.TLSCertFile, false); err != nil {
		errs = append(errs, err)
	}
	if err := validateReadableFile(ctx, "server.tls_key_file", c.Server.TLSKeyFile, false); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

func validateServer(server ServerConfig) error {
	var errs []error
	if err := validateListen("server.http_listen", server.HTTPListen); err != nil {
		errs = append(errs, err)
	}
	if err := validateListen("server.grpc_listen", server.GRPCListen); err != nil {
		errs = append(errs, err)
	}
	if !slices.Contains([]string{"all-in-one", "ingest", "query", "ruler", "console"}, server.Mode) {
		errs = append(errs, fmt.Errorf("server.mode must be all-in-one, ingest, query, ruler, or console"))
	}
	if server.ShutdownTimeout <= 0 {
		errs = append(errs, fmt.Errorf("server.shutdown_timeout must be positive"))
	}
	if server.ExternalURL != "" {
		parsed, err := url.Parse(server.ExternalURL)
		if err != nil || !parsed.IsAbs() || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			errs = append(errs, fmt.Errorf("server.external_url must be an absolute HTTP or HTTPS URL"))
		}
	}
	if (server.TLSCertFile == "") != (server.TLSKeyFile == "") {
		errs = append(errs, fmt.Errorf("server.tls_cert_file and server.tls_key_file must be configured together"))
	}
	return errors.Join(errs...)
}

func validateListen(field, address string) error {
	_, port, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("%s must be a host:port listen address: %w", field, err)
	}
	parsed, err := strconv.Atoi(port)
	if err != nil || parsed < 1 || parsed > 65_535 {
		return fmt.Errorf("%s must contain a valid TCP port", field)
	}
	return nil
}

func validateStorage(storage StorageConfig) error {
	var errs []error
	if err := validateStorageTarget("storage", StorageTarget{Driver: storage.Driver, DSN: storage.DSN, Options: storage.Options}); err != nil {
		errs = append(errs, err)
	}
	if storage.Retention.MetricsDays <= 0 || storage.Retention.LogsDays <= 0 || storage.Retention.TracesDays <= 0 || storage.Retention.REDDays <= 0 {
		errs = append(errs, fmt.Errorf("storage.retention values must all be positive"))
	}
	for signal, target := range storage.Split {
		if !slices.Contains([]string{"metrics", "logs", "traces"}, signal) {
			errs = append(errs, fmt.Errorf("storage.split contains unsupported signal %q", signal))
			continue
		}
		if err := validateStorageTarget("storage.split."+signal, target); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func validateStorageTarget(field string, target StorageTarget) error {
	if !slices.Contains(spi.Drivers(), target.Driver) {
		return fmt.Errorf("%s.driver %q is not registered (available: %v)", field, target.Driver, spi.Drivers())
	}
	if target.Driver != "memory" && strings.TrimSpace(target.DSN) == "" {
		return fmt.Errorf("%s.dsn is required for driver %q", field, target.Driver)
	}
	return nil
}

func validateControlplane(controlplane ControlplaneConfig) error {
	if controlplane.PostgresDSN == "" {
		return nil
	}
	parsed, err := url.Parse(controlplane.PostgresDSN)
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") || parsed.Host == "" {
		return fmt.Errorf("controlplane.postgres_dsn must be a PostgreSQL URL")
	}
	return nil
}

func validateTenancy(tenancy TenancyConfig) error {
	var errs []error
	if !slices.Contains([]string{"single", "strict"}, tenancy.Mode) {
		errs = append(errs, fmt.Errorf("tenancy.mode must be single or strict"))
	}
	if strings.TrimSpace(tenancy.DefaultTenant) == "" {
		errs = append(errs, fmt.Errorf("tenancy.default_tenant must not be empty"))
	}
	return errors.Join(errs...)
}

func validateAuth(ctx context.Context, auth AuthConfig) error {
	if err := validateReadableFile(ctx, "auth.jwt_secret_file", auth.JWTSecretFile, true); err != nil {
		return err
	}
	secret, err := readBounded(ctx, auth.JWTSecretFile, maxAuxiliaryFileBytes)
	if err != nil {
		return fmt.Errorf("read auth.jwt_secret_file: %w", err)
	}
	if len(strings.TrimSpace(string(secret))) < 32 {
		return fmt.Errorf("auth.jwt_secret_file must contain at least 32 bytes")
	}
	return nil
}

func validateIngest(ingest IngestConfig) error {
	var errs []error
	if ingest.MaxRequestBytes <= 0 {
		errs = append(errs, fmt.Errorf("ingest.max_request_bytes must be positive"))
	}
	if ingest.QueueDepth <= 0 {
		errs = append(errs, fmt.Errorf("ingest.queue_depth must be positive"))
	}
	for name, batch := range map[string]BatchSignalConfig{
		"metrics": ingest.Batch.Metrics,
		"logs":    ingest.Batch.Logs,
		"traces":  ingest.Batch.Traces,
	} {
		if batch.MaxItems <= 0 || batch.MaxBytes <= 0 || batch.FlushInterval <= 0 {
			errs = append(errs, fmt.Errorf("ingest.batch.%s limits must be positive", name))
		}
	}
	if !slices.Contains([]string{"clamp", "drop"}, ingest.ClockSkewPolicy) {
		errs = append(errs, fmt.Errorf("ingest.clock_skew_policy must be clamp or drop"))
	}
	if ingest.MaxPast <= 0 || ingest.MaxFuture <= 0 || ingest.MemoryLimit <= 0 {
		errs = append(errs, fmt.Errorf("ingest time windows and memory_limit must be positive"))
	}
	return errors.Join(errs...)
}

func validateLimits(limits LimitsConfig) error {
	if limits.MaxActiveSeriesPerTenant <= 0 || limits.MaxLogLineBytes <= 0 || limits.CardinalityAlarmThreshold <= 0 {
		return fmt.Errorf("limits numeric values must be positive")
	}
	return nil
}

func validateQuery(query QueryConfig) error {
	var errs []error
	if query.Timeout <= 0 || query.MaxLookback <= 0 || query.MaxRange <= 0 || query.LookbackDelta <= 0 {
		errs = append(errs, fmt.Errorf("query durations must be positive"))
	}
	if query.MaxConcurrent <= 0 || query.MaxConcurrentPerTenant <= 0 || query.MaxConcurrentPerTenant > query.MaxConcurrent {
		errs = append(errs, fmt.Errorf("query concurrency must be positive and per-tenant must not exceed global"))
	}
	if query.MaxRange > query.MaxLookback {
		errs = append(errs, fmt.Errorf("query.max_range must not exceed query.max_lookback"))
	}
	if query.MaxPoints <= 0 || query.MaxSamples <= 0 {
		errs = append(errs, fmt.Errorf("query point and sample limits must be positive"))
	}
	if query.Fallback.MaxRange <= 0 || query.Fallback.MaxRows <= 0 || query.Fallback.MaxRange > query.MaxRange {
		errs = append(errs, fmt.Errorf("query.fallback limits must be positive and max_range must not exceed query.max_range"))
	}
	return errors.Join(errs...)
}

func validateRules(ctx context.Context, rules RulesConfig) error {
	var errs []error
	if rules.DBSyncInterval <= 0 || rules.EvalTimeout <= 0 || rules.StateFlushInterval <= 0 {
		errs = append(errs, fmt.Errorf("rules intervals must be positive"))
	}
	entries, err := readRuleDirectory(ctx, rules.Path)
	if err != nil {
		errs = append(errs, fmt.Errorf("read rules.path: %w", err))
		return errors.Join(errs...)
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			errs = append(errs, err)
			break
		}
		if entry.IsDir() || (!strings.HasSuffix(entry.Name(), ".yml") && !strings.HasSuffix(entry.Name(), ".yaml")) {
			continue
		}
		path := filepath.Join(rules.Path, entry.Name())
		content, readErr := readBounded(ctx, path, maxAuxiliaryFileBytes)
		if readErr != nil {
			errs = append(errs, fmt.Errorf("read rule file %q: %w", entry.Name(), readErr))
			continue
		}
		if parseErr := validateRuleDocument(content); parseErr != nil {
			errs = append(errs, fmt.Errorf("parse rule file %q: %w", entry.Name(), parseErr))
		}
	}
	return errors.Join(errs...)
}

func readRuleDirectory(ctx context.Context, path string) ([]os.DirEntry, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	directory, err := os.Open(path) //nolint:gosec // The administrator-selected rules path is scanned with an entry bound.
	if err != nil {
		return nil, err
	}
	entries, readErr := directory.ReadDir(maxRuleFiles + 1)
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		_ = directory.Close()
		return nil, readErr
	}
	if closeErr := directory.Close(); closeErr != nil {
		return nil, closeErr
	}
	if len(entries) > maxRuleFiles {
		return nil, fmt.Errorf("rules.path contains more than %d entries", maxRuleFiles)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return entries, nil
}

func validateRuleDocument(content []byte) error {
	document, err := parseYAMLDocument(content)
	if err != nil {
		return err
	}
	root, ok := document.(map[string]any)
	if !ok {
		return fmt.Errorf("rule document must be a mapping")
	}
	groups, ok := root["groups"].([]any)
	if !ok || len(groups) == 0 {
		return fmt.Errorf("rule document must contain a non-empty groups sequence")
	}
	for groupIndex, groupValue := range groups {
		group, ok := groupValue.(map[string]any)
		if !ok || scalarString(group["name"]) == "" {
			return fmt.Errorf("groups[%d].name must not be empty", groupIndex)
		}
		rules, ok := group["rules"].([]any)
		if !ok || len(rules) == 0 {
			return fmt.Errorf("groups[%d].rules must be a non-empty sequence", groupIndex)
		}
		for ruleIndex, ruleValue := range rules {
			rule, ok := ruleValue.(map[string]any)
			if !ok || scalarString(rule["expr"]) == "" {
				return fmt.Errorf("groups[%d].rules[%d].expr must not be empty", groupIndex, ruleIndex)
			}
			if scalarString(rule["alert"]) == "" && scalarString(rule["record"]) == "" {
				return fmt.Errorf("groups[%d].rules[%d] must define alert or record", groupIndex, ruleIndex)
			}
		}
	}
	return nil
}

func validateTelemetry(telemetry TelemetryConfig) error {
	var errs []error
	if !slices.Contains([]string{"trace", "debug", "info", "warn", "error"}, telemetry.LogLevel) {
		errs = append(errs, fmt.Errorf("telemetry.log_level must be trace, debug, info, warn, or error"))
	}
	if !slices.Contains([]string{"json", "text"}, telemetry.LogFormat) {
		errs = append(errs, fmt.Errorf("telemetry.log_format must be json or text"))
	}
	return errors.Join(errs...)
}

func validateReadableFile(ctx context.Context, field, path string, required bool) error {
	if path == "" {
		if required {
			return fmt.Errorf("%s is required", field)
		}
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("%s is not readable: %w", field, err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o444 == 0 {
		return fmt.Errorf("%s must be a readable regular file", field)
	}
	file, err := os.Open(path) //nolint:gosec // File paths are administrator-selected and checked before opening.
	if err != nil {
		return fmt.Errorf("%s is not readable: %w", field, err)
	}
	return file.Close()
}

func resolveRelativePaths(config *Config, configPath string) {
	absoluteConfigPath, err := filepath.Abs(configPath)
	if err == nil {
		configPath = absoluteConfigPath
	}
	base := filepath.Dir(configPath)
	config.Auth.JWTSecretFile = resolveRelativePath(base, config.Auth.JWTSecretFile)
	config.Rules.Path = resolveRelativePath(base, config.Rules.Path)
	config.Notify.ConfigPath = resolveRelativePath(base, config.Notify.ConfigPath)
	config.Server.TLSCertFile = resolveRelativePath(base, config.Server.TLSCertFile)
	config.Server.TLSKeyFile = resolveRelativePath(base, config.Server.TLSKeyFile)
}

func resolveRelativePath(base, path string) string {
	if path == "" || filepath.IsAbs(path) {
		return path
	}
	return filepath.Clean(filepath.Join(base, path))
}

func scalarString(value any) string {
	scalar, ok := value.(yamlScalar)
	if !ok {
		return ""
	}
	return strings.TrimSpace(scalar.value)
}

// SecurityWarnings returns non-fatal startup findings in stable checklist order.
func (c *Config) SecurityWarnings(state SecurityState) []Warning {
	warnings := make([]Warning, 0, 6)
	publicHTTP := !isLoopbackListen(c.Server.HTTPListen)
	if publicHTTP && c.Auth.AllowAnonymousRead {
		warnings = append(warnings, Warning{Code: "anonymous-public-listener", Message: "anonymous reads are enabled on a public listener"})
	}
	if publicHTTP && c.Server.TLSCertFile == "" && !c.Server.TrustProxy {
		warnings = append(warnings, Warning{Code: "public-listener-without-transport-security", Message: "public listener has neither TLS nor a trusted terminating proxy"})
	}
	if c.Tenancy.Mode == "single" && state.TenantCount > 1 {
		warnings = append(warnings, Warning{Code: "single-tenancy-with-multiple-tenants", Message: "single tenancy is configured while multiple tenants exist"})
	}
	if c.Control.AutoUpgrade {
		warnings = append(warnings, Warning{Code: "automatic-upgrade-enabled", Message: "automatic upgrades increase supply-chain and unreviewed-change risk"})
	}
	if !c.notifyState.hasWatchdog {
		warnings = append(warnings, Warning{Code: "watchdog-route-missing", Message: "notification routing has no watchdog receiver route"})
	}
	if hasBroadAgentReadScope(state.AgentKeys) {
		warnings = append(warnings, Warning{Code: "agent-broad-read-scope", Message: "an agent key has a broad read:* scope"})
	}
	return warnings
}

func isLoopbackListen(address string) bool {
	host, _, err := net.SplitHostPort(address)
	if err != nil || host == "" {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

func hasBroadAgentReadScope(keys []AgentKey) bool {
	for _, key := range keys {
		if slices.Contains(key.Scopes, "read:*") {
			return true
		}
	}
	return false
}
