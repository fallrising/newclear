// Package config loads and validates prismd configuration.
package config

import "time"

const DefaultPath = "/etc/prism/prismd.yaml"

// Config is the complete prismd configuration described by the SDD.
type Config struct {
	Server       ServerConfig       `yaml:"server"`
	Storage      StorageConfig      `yaml:"storage"`
	Controlplane ControlplaneConfig `yaml:"controlplane"`
	Tenancy      TenancyConfig      `yaml:"tenancy"`
	Auth         AuthConfig         `yaml:"auth"`
	Ingest       IngestConfig       `yaml:"ingest"`
	Limits       LimitsConfig       `yaml:"limits"`
	Query        QueryConfig        `yaml:"query"`
	Rules        RulesConfig        `yaml:"rules"`
	Notify       NotifyConfig       `yaml:"notify"`
	Telemetry    TelemetryConfig    `yaml:"telemetry"`
	Control      ControlConfig      `yaml:"control"`

	notifyState notifyState `yaml:"-"`
}

type ServerConfig struct {
	HTTPListen      string   `yaml:"http_listen"`
	GRPCListen      string   `yaml:"grpc_listen"`
	Mode            string   `yaml:"mode"`
	ShutdownTimeout Duration `yaml:"shutdown_timeout"`
	ExternalURL     string   `yaml:"external_url"`
	TLSCertFile     string   `yaml:"tls_cert_file"`
	TLSKeyFile      string   `yaml:"tls_key_file"`
	TrustProxy      bool     `yaml:"trust_proxy"`
}

type StorageConfig struct {
	Driver    string                   `yaml:"driver"`
	DSN       string                   `yaml:"dsn"`
	Options   map[string]string        `yaml:"options"`
	Retention RetentionConfig          `yaml:"retention"`
	Split     map[string]StorageTarget `yaml:"split"`
}

type StorageTarget struct {
	Driver  string            `yaml:"driver"`
	DSN     string            `yaml:"dsn"`
	Options map[string]string `yaml:"options"`
}

type RetentionConfig struct {
	MetricsDays int `yaml:"metrics_days"`
	LogsDays    int `yaml:"logs_days"`
	TracesDays  int `yaml:"traces_days"`
	REDDays     int `yaml:"red_days"`
}

type ControlplaneConfig struct {
	PostgresDSN string `yaml:"postgres_dsn"`
}

type TenancyConfig struct {
	Mode          string `yaml:"mode"`
	DefaultTenant string `yaml:"default_tenant"`
}

type AuthConfig struct {
	AllowAnonymousRead bool   `yaml:"allow_anonymous_read"`
	JWTSecretFile      string `yaml:"jwt_secret_file"`
}

type IngestConfig struct {
	MaxRequestBytes ByteSize    `yaml:"max_request_bytes"`
	QueueDepth      int         `yaml:"queue_depth"`
	Batch           BatchConfig `yaml:"batch"`
	ClockSkewPolicy string      `yaml:"clock_skew_policy"`
	MaxPast         Duration    `yaml:"max_past"`
	MaxFuture       Duration    `yaml:"max_future"`
	MemoryLimit     ByteSize    `yaml:"memory_limit"`
}

type BatchConfig struct {
	Metrics BatchSignalConfig `yaml:"metrics"`
	Logs    BatchSignalConfig `yaml:"logs"`
	Traces  BatchSignalConfig `yaml:"traces"`
}

type BatchSignalConfig struct {
	MaxItems      int      `yaml:"max_items"`
	MaxBytes      ByteSize `yaml:"max_bytes"`
	FlushInterval Duration `yaml:"flush_interval"`
}

type LimitsConfig struct {
	MaxActiveSeriesPerTenant  int      `yaml:"max_active_series_per_tenant"`
	MaxLogLineBytes           ByteSize `yaml:"max_log_line_bytes"`
	CardinalityAlarmThreshold int      `yaml:"cardinality_alarm_threshold"`
	AutoDropHighCardinality   bool     `yaml:"auto_drop_high_cardinality"`
}

type QueryConfig struct {
	Timeout                Duration            `yaml:"timeout"`
	MaxConcurrent          int                 `yaml:"max_concurrent"`
	MaxConcurrentPerTenant int                 `yaml:"max_concurrent_per_tenant"`
	MaxLookback            Duration            `yaml:"max_lookback"`
	MaxRange               Duration            `yaml:"max_range"`
	MaxPoints              int                 `yaml:"max_points"`
	MaxSamples             int64               `yaml:"max_samples"`
	LookbackDelta          Duration            `yaml:"lookback_delta"`
	ForceFallback          bool                `yaml:"force_fallback"`
	Fallback               QueryFallbackConfig `yaml:"fallback"`
}

type QueryFallbackConfig struct {
	MaxRange Duration `yaml:"max_range"`
	MaxRows  int64    `yaml:"max_rows"`
}

type RulesConfig struct {
	Path               string   `yaml:"path"`
	DBSyncInterval     Duration `yaml:"db_sync_interval"`
	EvalTimeout        Duration `yaml:"eval_timeout"`
	StateFlushInterval Duration `yaml:"state_flush_interval"`
	BuiltinEnabled     bool     `yaml:"builtin_enabled"`
}

type NotifyConfig struct {
	ConfigPath         string `yaml:"config_path"`
	DeadletterReceiver string `yaml:"deadletter_receiver"`
}

type TelemetryConfig struct {
	SelfMonitor bool   `yaml:"self_monitor"`
	LogLevel    string `yaml:"log_level"`
	LogFormat   string `yaml:"log_format"`
}

type ControlConfig struct {
	AutoUpgrade bool `yaml:"auto_upgrade"`
}

// SecurityState contains runtime facts needed by the startup security audit.
type SecurityState struct {
	TenantCount int
	AgentKeys   []AgentKey
}

// AgentKey is the security-relevant portion of a registered agent key.
type AgentKey struct {
	Name   string
	Scopes []string
}

// Warning is a non-fatal startup security finding.
type Warning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type notifyState struct {
	hasWatchdog bool
}

// Default returns the SDD-defined configuration defaults.
func Default() Config {
	defaultBatch := BatchSignalConfig{
		MaxItems:      5_000,
		MaxBytes:      ByteSize(8 << 20),
		FlushInterval: Duration(time.Second),
	}
	return Config{
		Server: ServerConfig{
			HTTPListen:      ":9090",
			GRPCListen:      ":4317",
			Mode:            "all-in-one",
			ShutdownTimeout: Duration(30 * time.Second),
		},
		Storage: StorageConfig{
			Driver:  "clickhouse",
			Options: map[string]string{"cluster": "", "async_insert": "1"},
			Retention: RetentionConfig{
				MetricsDays: 30,
				LogsDays:    14,
				TracesDays:  7,
				REDDays:     90,
			},
		},
		Tenancy: TenancyConfig{Mode: "single", DefaultTenant: "default"},
		Auth: AuthConfig{ //nolint:gosec // This block contains a credential file path, not a credential.
			AllowAnonymousRead: true,
			JWTSecretFile:      "/etc/prism/secrets/jwt",
		},
		Ingest: IngestConfig{
			MaxRequestBytes: ByteSize(16 << 20),
			QueueDepth:      64,
			Batch: BatchConfig{
				Metrics: BatchSignalConfig{MaxItems: 10_000, MaxBytes: defaultBatch.MaxBytes, FlushInterval: defaultBatch.FlushInterval},
				Logs:    defaultBatch,
				Traces:  defaultBatch,
			},
			ClockSkewPolicy: "clamp",
			MaxPast:         Duration(time.Hour),
			MaxFuture:       Duration(5 * time.Minute),
			MemoryLimit:     ByteSize(1 << 30),
		},
		Limits: LimitsConfig{
			MaxActiveSeriesPerTenant:  500_000,
			MaxLogLineBytes:           ByteSize(256 << 10),
			CardinalityAlarmThreshold: 10_000,
		},
		Query: QueryConfig{
			Timeout:                Duration(time.Minute),
			MaxConcurrent:          16,
			MaxConcurrentPerTenant: 8,
			MaxLookback:            Duration(30 * 24 * time.Hour),
			MaxRange:               Duration(7 * 24 * time.Hour),
			MaxPoints:              11_000,
			MaxSamples:             50_000_000,
			LookbackDelta:          Duration(5 * time.Minute),
			Fallback: QueryFallbackConfig{
				MaxRange: Duration(24 * time.Hour),
				MaxRows:  5_000_000,
			},
		},
		Rules: RulesConfig{
			Path:               "/etc/prism/rules",
			DBSyncInterval:     Duration(30 * time.Second),
			EvalTimeout:        Duration(30 * time.Second),
			StateFlushInterval: Duration(time.Minute),
			BuiltinEnabled:     true,
		},
		Notify: NotifyConfig{
			ConfigPath:         "/etc/prism/alertmanager.yaml",
			DeadletterReceiver: "ops-fallback",
		},
		Telemetry: TelemetryConfig{SelfMonitor: true, LogLevel: "info", LogFormat: "json"},
	}
}
