package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

// fileConfig is the YAML on-disk schema.
type fileConfig struct {
	Addr            string   `yaml:"addr"`
	MaxQueues       int      `yaml:"max_queues"`
	MaxDepth        int      `yaml:"max_depth"`
	MaxMessageBytes int      `yaml:"max_message_bytes"`
	APIKeys         []string `yaml:"api_keys"`
	APIKey          string   `yaml:"api_key"` // singular convenience alias
	Encryption      struct {
		Mode         string            `yaml:"mode"`
		Queues       map[string]string `yaml:"queues"`
		RSAPublicKey string            `yaml:"rsa_public_key"`
		RSAKeyDir    string            `yaml:"rsa_key_dir"`
	} `yaml:"encryption"`
	Snapshot struct {
		Path     string `yaml:"path"`
		Interval string `yaml:"interval"` // Go duration, e.g. 30s
	} `yaml:"snapshot"`
	WAL struct {
		Path string `yaml:"path"`
	} `yaml:"wal"`
	TLS struct {
		CertFile     string `yaml:"cert_file"`
		KeyFile      string `yaml:"key_file"`
		ClientCAFile string `yaml:"client_ca_file"`
	} `yaml:"tls"`
	OIDC struct {
		Issuer   string `yaml:"issuer"`
		Audience string `yaml:"audience"`
		JWKSURL  string `yaml:"jwks_url"`
	} `yaml:"oidc"`
	JWT struct {
		HSSecret     string `yaml:"hs_secret"`
		RSAPublicKey string `yaml:"rsa_public_key"`
		ACL          *bool  `yaml:"acl"`
		AdminRole    string `yaml:"admin_role"`
	} `yaml:"jwt"`
	OTEL struct {
		Endpoint    string `yaml:"endpoint"`
		ServiceName string `yaml:"service_name"`
	} `yaml:"otel"`
	Cluster struct {
		Nodes             []string `yaml:"nodes"`
		AdvertiseURL      string   `yaml:"advertise_url"`
		ReplicationFactor int      `yaml:"replication_factor"`
		ReplicationMode   string   `yaml:"replication_mode"` // sync | async
		Secret            string   `yaml:"secret"`
	} `yaml:"cluster"`
}

// LoadFromFile reads YAML configuration from path, then applies environment overrides.
// Environment variables always win over file values.
func LoadFromFile(path string) (Config, error) {
	cfg := defaultConfig()
	if path != "" {
		if err := mergeYAMLFile(&cfg, path); err != nil {
			return Config{}, err
		}
	}
	return applyEnv(cfg), nil
}

// Load prefers CLARKQ_CONFIG when set, otherwise env-only defaults.
func Load() Config {
	path := os.Getenv("CLARKQ_CONFIG")
	if path == "" {
		return applyEnv(defaultConfig())
	}
	cfg, err := LoadFromFile(path)
	if err != nil {
		// Fail closed: invalid config file should not silently fall back.
		// main will need to surface this — use MustLoad for process entry.
		panic(fmt.Sprintf("load config %s: %v", path, err))
	}
	return cfg
}

// MustLoad loads config and returns an error instead of panicking.
func MustLoad() (Config, error) {
	path := os.Getenv("CLARKQ_CONFIG")
	if path == "" {
		return applyEnv(defaultConfig()), nil
	}
	return LoadFromFile(path)
}

func mergeYAMLFile(cfg *Config, path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read config file: %w", err)
	}
	var fc fileConfig
	if err := yaml.Unmarshal(data, &fc); err != nil {
		return fmt.Errorf("parse config YAML: %w", err)
	}

	if fc.Addr != "" {
		cfg.Addr = fc.Addr
	}
	if fc.MaxQueues > 0 {
		cfg.MaxQueues = fc.MaxQueues
	}
	if fc.MaxDepth > 0 {
		cfg.MaxDepth = fc.MaxDepth
	}
	if fc.MaxMessageBytes > 0 {
		cfg.MaxMessageBytes = fc.MaxMessageBytes
	}
	if len(fc.APIKeys) > 0 {
		cfg.APIKeys = append([]string(nil), fc.APIKeys...)
	} else if fc.APIKey != "" {
		cfg.APIKeys = []string{fc.APIKey}
	}
	if fc.Encryption.Mode != "" {
		cfg.EncryptionMode = fc.Encryption.Mode
	}
	if len(fc.Encryption.Queues) > 0 {
		cfg.EncryptionQueues = copyStringMap(fc.Encryption.Queues)
	}
	if fc.Encryption.RSAPublicKey != "" {
		cfg.RSAPublicKey = fc.Encryption.RSAPublicKey
	}
	if fc.Encryption.RSAKeyDir != "" {
		cfg.RSAKeyDir = fc.Encryption.RSAKeyDir
	}
	if fc.Snapshot.Path != "" {
		cfg.SnapshotPath = fc.Snapshot.Path
	}
	if fc.Snapshot.Interval != "" {
		d, err := time.ParseDuration(fc.Snapshot.Interval)
		if err != nil {
			return fmt.Errorf("snapshot.interval: %w", err)
		}
		if d < 0 {
			return fmt.Errorf("snapshot.interval must be >= 0")
		}
		cfg.SnapshotInterval = d
	}
	if fc.WAL.Path != "" {
		cfg.WALPath = fc.WAL.Path
	}
	if fc.TLS.CertFile != "" {
		cfg.TLSCertFile = fc.TLS.CertFile
	}
	if fc.TLS.KeyFile != "" {
		cfg.TLSKeyFile = fc.TLS.KeyFile
	}
	if fc.TLS.ClientCAFile != "" {
		cfg.TLSClientCAFile = fc.TLS.ClientCAFile
	}
	if fc.OIDC.Issuer != "" {
		cfg.OIDCIssuer = fc.OIDC.Issuer
	}
	if fc.OIDC.Audience != "" {
		cfg.OIDCAudience = fc.OIDC.Audience
	}
	if fc.OIDC.JWKSURL != "" {
		cfg.OIDCJWKSURL = fc.OIDC.JWKSURL
	}
	if fc.JWT.HSSecret != "" {
		cfg.JWTHSSecret = fc.JWT.HSSecret
	}
	if fc.JWT.RSAPublicKey != "" {
		cfg.JWTRSAPublicKey = loadKeyMaterial(fc.JWT.RSAPublicKey)
	}
	if fc.JWT.ACL != nil {
		cfg.JWTACL = *fc.JWT.ACL
	}
	if fc.JWT.AdminRole != "" {
		cfg.JWTAdminRole = fc.JWT.AdminRole
	}
	if fc.OTEL.Endpoint != "" {
		cfg.OTELEndpoint = fc.OTEL.Endpoint
	}
	if fc.OTEL.ServiceName != "" {
		cfg.OTELServiceName = fc.OTEL.ServiceName
	}
	if len(fc.Cluster.Nodes) > 0 {
		cfg.ClusterNodes = append([]string(nil), fc.Cluster.Nodes...)
	}
	if fc.Cluster.AdvertiseURL != "" {
		cfg.ClusterAdvertiseURL = fc.Cluster.AdvertiseURL
	}
	if fc.Cluster.ReplicationFactor > 0 {
		cfg.ReplicationFactor = fc.Cluster.ReplicationFactor
	}
	if fc.Cluster.ReplicationMode != "" {
		cfg.ReplicationMode = fc.Cluster.ReplicationMode
	}
	if fc.Cluster.Secret != "" {
		cfg.ClusterSecret = fc.Cluster.Secret
	}
	return nil
}

func copyStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
