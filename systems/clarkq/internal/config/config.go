package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/fallrising/newclear/systems/clarkq/internal/crypto"
	"github.com/fallrising/newclear/systems/clarkq/internal/queue"
)

const (
	defaultAddr             = ":8080"
	defaultMaxQueues        = 1000
	defaultMaxDepth         = 10000
	defaultMaxMessageBytes  = 1 << 20 // 1 MiB
	defaultEncryptionMode   = "none"
	defaultSnapshotInterval = 30 * time.Second
)

type Config struct {
	Addr             string
	MaxQueues        int
	MaxDepth         int
	MaxMessageBytes  int
	APIKeys          []string
	EncryptionMode   string
	EncryptionQueues map[string]string // queue name -> encryption mode
	RSAPublicKey     string
	RSAKeyDir        string

	// SnapshotPath enables optional durability when non-empty.
	SnapshotPath     string
	SnapshotInterval time.Duration
	// WALPath enables append-only write-ahead log for stronger durability.
	WALPath string

	// TLS (optional). When TLSCertFile and TLSKeyFile are set, HTTPS is enabled.
	TLSCertFile string
	TLSKeyFile  string
	// TLSClientCAFile, when set, enables mTLS (require and verify client certificates).
	TLSClientCAFile string

	// JWT / OIDC bearer auth (optional). Any field enables JWT validation.
	// When API keys and/or JWT are configured, /api/* requires at least one.
	OIDCIssuer      string // expected iss; enables OIDC discovery for JWKS when JWKS URL empty
	OIDCAudience    string // expected aud claim
	OIDCJWKSURL     string // explicit JWKS URL
	JWTHSSecret     string // HS256/384/512 shared secret
	JWTRSAPublicKey string // PEM or path for static RS256 public key

	// JWTACL enables scope/role checks on JWT-authenticated requests.
	// API keys always have full access when ACL is on.
	JWTACL       bool
	JWTAdminRole string // role name that grants full access (default "admin")

	// OpenTelemetry (optional). Empty endpoint disables export.
	OTELEndpoint    string
	OTELServiceName string

	// Cluster sharding (optional). Multiple nodes + advertise URL enable routing.
	ClusterNodes        []string
	ClusterAdvertiseURL string
	// ReplicationFactor copies each message to N nodes (1 = primary only).
	// Requires cluster with at least N nodes.
	ReplicationFactor int
	// ReplicationMode is "sync" (default) or "async".
	// sync: wait for replicas; failure rolls back primary enqueue.
	// async: acknowledge after local write; replicate in background (weaker durability).
	ReplicationMode string
	// ClusterSecret authenticates internal replicate/list peer calls.
	ClusterSecret string
	// ClusterProbeInterval is how often peers are health-checked (default 2s).
	ClusterProbeInterval time.Duration
	// ClusterFailThreshold consecutive probe failures before marking peer dead.
	ClusterFailThreshold int
	// OutboxMaxAttempts for async/retry replication (default 8).
	OutboxMaxAttempts int
	// OutboxBackoff base delay for outbox retries (default 500ms).
	OutboxBackoff time.Duration
	// OutboxPath persists outbox to disk (empty = derive from snapshot path or memory-only).
	OutboxPath string
	// CatchUpInterval is how often replica catch-up runs (default 5s; 0 uses default).
	CatchUpInterval time.Duration
	// WriteQuorum is min successful copies including primary (0 = majority of RF).
	WriteQuorum int
	// ReadQuorum is min replicas that must hold a message for linearizable peek/consume (0 = majority).
	ReadQuorum int
	// LinearizableConsume enables read-quorum + CAS pop + delete-quorum on dequeue.
	LinearizableConsume bool
	// EpochFencing rejects internal ops with mismatched membership epoch.
	EpochFencing bool
	// EpochFencingStrict requires epoch header on internal ops when fencing is on.
	EpochFencingStrict bool
	// OwnerGrace blocks client writes for this duration after membership changes.
	OwnerGrace time.Duration

	// LeaseEnabled requires majority lease votes before owner serves a queue.
	LeaseEnabled bool
	// LeaseTTL is how long a lease remains valid (default 5s).
	LeaseTTL time.Duration

	// TenantQuotas enables multi-tenant limits.
	TenantQuotas bool
	// TenantHeader is the HTTP header carrying tenant id (default X-Tenant-ID).
	TenantHeader string
	// TenantClaim is reserved JWT claim name hint (default tenant; sub if set to sub).
	TenantClaim string
	// TenantMaxQueues max distinct queues per tenant (0 = unlimited).
	TenantMaxQueues int
	// TenantMaxMessages max total queued messages per tenant (0 = unlimited).
	TenantMaxMessages int
	// TenantMaxEnqueuePerSec max enqueue ops per tenant per second (0 = unlimited).
	TenantMaxEnqueuePerSec int
}

func defaultConfig() Config {
	return Config{
		Addr:             defaultAddr,
		MaxQueues:        defaultMaxQueues,
		MaxDepth:         defaultMaxDepth,
		MaxMessageBytes:  defaultMaxMessageBytes,
		EncryptionMode:   defaultEncryptionMode,
		SnapshotInterval: defaultSnapshotInterval,
		JWTAdminRole:      "admin",
		OTELServiceName:   "clarkq",
		ReplicationFactor:    1,
		ReplicationMode:      "sync",
		ClusterProbeInterval: 2 * time.Second,
		ClusterFailThreshold: 2,
		OutboxMaxAttempts:    8,
		OutboxBackoff:        500 * time.Millisecond,
		CatchUpInterval:      5 * time.Second,
		WriteQuorum:          0, // majority
		ReadQuorum:           0, // majority
		LinearizableConsume:  false,
		EpochFencing:         true,
		EpochFencingStrict:   false,
		OwnerGrace:           0,
		LeaseEnabled:         false,
		LeaseTTL:             5 * time.Second,
		TenantQuotas:         false,
		TenantHeader:         "X-Tenant-ID",
		TenantClaim:          "tenant",
	}
}

// applyEnv overlays environment variables onto cfg.
func applyEnv(cfg Config) Config {
	cfg.Addr = envString("CLARKQ_ADDR", cfg.Addr)
	cfg.MaxQueues = envInt("CLARKQ_MAX_QUEUES", cfg.MaxQueues)
	cfg.MaxDepth = envInt("CLARKQ_MAX_DEPTH", cfg.MaxDepth)
	cfg.MaxMessageBytes = envInt("CLARKQ_MAX_MESSAGE_BYTES", cfg.MaxMessageBytes)
	if raw := os.Getenv("CLARKQ_API_KEY"); raw != "" {
		cfg.APIKeys = envStringList("CLARKQ_API_KEY")
	}
	cfg.EncryptionMode = envString("CLARKQ_ENCRYPTION_MODE", cfg.EncryptionMode)
	if raw := os.Getenv("CLARKQ_ENCRYPTION_QUEUES"); raw != "" {
		cfg.EncryptionQueues = parseEncryptionQueues(raw)
	}
	cfg.RSAPublicKey = envString("CLARKQ_RSA_PUBLIC_KEY", cfg.RSAPublicKey)
	cfg.RSAKeyDir = envString("CLARKQ_RSA_KEY_DIR", cfg.RSAKeyDir)
	if raw, ok := os.LookupEnv("CLARKQ_SNAPSHOT_PATH"); ok {
		cfg.SnapshotPath = raw
	}
	if raw := os.Getenv("CLARKQ_SNAPSHOT_INTERVAL"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d >= 0 {
			cfg.SnapshotInterval = d
		}
	}
	if raw, ok := os.LookupEnv("CLARKQ_WAL_PATH"); ok {
		cfg.WALPath = raw
	}
	cfg.TLSCertFile = envString("CLARKQ_TLS_CERT_FILE", cfg.TLSCertFile)
	cfg.TLSKeyFile = envString("CLARKQ_TLS_KEY_FILE", cfg.TLSKeyFile)
	cfg.TLSClientCAFile = envString("CLARKQ_TLS_CLIENT_CA_FILE", cfg.TLSClientCAFile)
	cfg.OIDCIssuer = envString("CLARKQ_OIDC_ISSUER", cfg.OIDCIssuer)
	cfg.OIDCAudience = envString("CLARKQ_OIDC_AUDIENCE", cfg.OIDCAudience)
	cfg.OIDCJWKSURL = envString("CLARKQ_OIDC_JWKS_URL", cfg.OIDCJWKSURL)
	cfg.JWTHSSecret = envString("CLARKQ_JWT_HS_SECRET", cfg.JWTHSSecret)
	cfg.JWTRSAPublicKey = envString("CLARKQ_JWT_RSA_PUBLIC_KEY", cfg.JWTRSAPublicKey)
	cfg.JWTRSAPublicKey = loadKeyMaterial(cfg.JWTRSAPublicKey)
	if raw, ok := os.LookupEnv("CLARKQ_JWT_ACL"); ok {
		cfg.JWTACL = parseBool(raw, cfg.JWTACL)
	}
	cfg.JWTAdminRole = envString("CLARKQ_JWT_ADMIN_ROLE", cfg.JWTAdminRole)
	cfg.OTELEndpoint = envString("CLARKQ_OTEL_ENDPOINT", cfg.OTELEndpoint)
	cfg.OTELServiceName = envString("CLARKQ_OTEL_SERVICE_NAME", cfg.OTELServiceName)
	if raw := os.Getenv("CLARKQ_CLUSTER_NODES"); raw != "" {
		cfg.ClusterNodes = envStringList("CLARKQ_CLUSTER_NODES")
	}
	cfg.ClusterAdvertiseURL = envString("CLARKQ_CLUSTER_ADVERTISE_URL", cfg.ClusterAdvertiseURL)
	if raw := os.Getenv("CLARKQ_REPLICATION_FACTOR"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			cfg.ReplicationFactor = n
		}
	}
	cfg.ReplicationMode = envString("CLARKQ_REPLICATION_MODE", cfg.ReplicationMode)
	cfg.ClusterSecret = envString("CLARKQ_CLUSTER_SECRET", cfg.ClusterSecret)
	if raw := os.Getenv("CLARKQ_CLUSTER_PROBE_INTERVAL"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d > 0 {
			cfg.ClusterProbeInterval = d
		}
	}
	if raw := os.Getenv("CLARKQ_CLUSTER_FAIL_THRESHOLD"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			cfg.ClusterFailThreshold = n
		}
	}
	if raw := os.Getenv("CLARKQ_OUTBOX_MAX_ATTEMPTS"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			cfg.OutboxMaxAttempts = n
		}
	}
	if raw := os.Getenv("CLARKQ_OUTBOX_BACKOFF"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d > 0 {
			cfg.OutboxBackoff = d
		}
	}
	if raw, ok := os.LookupEnv("CLARKQ_OUTBOX_PATH"); ok {
		cfg.OutboxPath = raw
	}
	if raw := os.Getenv("CLARKQ_CATCHUP_INTERVAL"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d >= 0 {
			cfg.CatchUpInterval = d
		}
	}
	if raw := os.Getenv("CLARKQ_WRITE_QUORUM"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
			cfg.WriteQuorum = n
		}
	}
	if raw := os.Getenv("CLARKQ_READ_QUORUM"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
			cfg.ReadQuorum = n
		}
	}
	if raw, ok := os.LookupEnv("CLARKQ_LINEARIZABLE_CONSUME"); ok {
		cfg.LinearizableConsume = parseBool(raw, cfg.LinearizableConsume)
	}
	if raw, ok := os.LookupEnv("CLARKQ_EPOCH_FENCING"); ok {
		cfg.EpochFencing = parseBool(raw, cfg.EpochFencing)
	}
	if raw, ok := os.LookupEnv("CLARKQ_EPOCH_FENCING_STRICT"); ok {
		cfg.EpochFencingStrict = parseBool(raw, cfg.EpochFencingStrict)
	}
	if raw := os.Getenv("CLARKQ_OWNER_GRACE"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d >= 0 {
			cfg.OwnerGrace = d
		}
	}
	if raw, ok := os.LookupEnv("CLARKQ_LEASE_ENABLED"); ok {
		cfg.LeaseEnabled = parseBool(raw, cfg.LeaseEnabled)
	}
	if raw := os.Getenv("CLARKQ_LEASE_TTL"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d > 0 {
			cfg.LeaseTTL = d
		}
	}
	if raw, ok := os.LookupEnv("CLARKQ_TENANT_QUOTAS"); ok {
		cfg.TenantQuotas = parseBool(raw, cfg.TenantQuotas)
	}
	cfg.TenantHeader = envString("CLARKQ_TENANT_HEADER", cfg.TenantHeader)
	cfg.TenantClaim = envString("CLARKQ_TENANT_CLAIM", cfg.TenantClaim)
	if raw := os.Getenv("CLARKQ_TENANT_MAX_QUEUES"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
			cfg.TenantMaxQueues = n
		}
	}
	if raw := os.Getenv("CLARKQ_TENANT_MAX_MESSAGES"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
			cfg.TenantMaxMessages = n
		}
	}
	if raw := os.Getenv("CLARKQ_TENANT_MAX_ENQUEUE_PER_SEC"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 0 {
			cfg.TenantMaxEnqueuePerSec = n
		}
	}
	return cfg
}

func parseBool(raw string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

// JWTEnabled reports whether bearer JWT validation is configured.
func (c Config) JWTEnabled() bool {
	return c.OIDCIssuer != "" || c.OIDCJWKSURL != "" || c.JWTHSSecret != "" || c.JWTRSAPublicKey != ""
}

// AuthEnabled reports whether any application-layer auth is configured.
func (c Config) AuthEnabled() bool {
	return len(c.APIKeys) > 0 || c.JWTEnabled()
}

// loadKeyMaterial returns PEM content if value is a path to a PEM file.
func loadKeyMaterial(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "-----BEGIN") {
		return value
	}
	data, err := os.ReadFile(value)
	if err != nil {
		return value // leave as-is; validator will error with a clear message
	}
	return string(data)
}

// Validate checks configuration consistency.
func (c Config) Validate() error {
	mode := c.EncryptionMode
	if mode == "" {
		mode = defaultEncryptionMode
	}
	if err := crypto.ValidateMode(mode); err != nil {
		return err
	}
	for name, mode := range c.EncryptionQueues {
		if !queue.ValidName(name) {
			return fmt.Errorf("invalid queue name in encryption queues: %q", name)
		}
		if err := crypto.ValidateMode(mode); err != nil {
			return fmt.Errorf("queue %q: %w", name, err)
		}
	}
	if c.SnapshotInterval < 0 {
		return fmt.Errorf("snapshot interval must be >= 0")
	}
	certSet := c.TLSCertFile != ""
	keySet := c.TLSKeyFile != ""
	if certSet != keySet {
		return fmt.Errorf("TLS cert and key must both be set (CLARKQ_TLS_CERT_FILE / CLARKQ_TLS_KEY_FILE)")
	}
	if c.TLSClientCAFile != "" && !certSet {
		return fmt.Errorf("mTLS client CA requires TLS cert and key")
	}
	if c.JWTACL && !c.JWTEnabled() {
		return fmt.Errorf("CLARKQ_JWT_ACL requires JWT/OIDC configuration")
	}
	if len(c.ClusterNodes) > 1 && c.ClusterAdvertiseURL == "" {
		return fmt.Errorf("CLARKQ_CLUSTER_ADVERTISE_URL is required when multiple cluster nodes are set")
	}
	if c.ReplicationFactor < 0 {
		return fmt.Errorf("replication factor must be >= 0")
	}
	if c.ReplicationFactor > 1 && len(c.ClusterNodes) < 2 {
		return fmt.Errorf("replication factor > 1 requires at least 2 entries in CLARKQ_CLUSTER_NODES")
	}
	switch strings.ToLower(strings.TrimSpace(c.ReplicationMode)) {
	case "", "sync", "async":
	default:
		return fmt.Errorf("replication mode must be sync or async, got %q", c.ReplicationMode)
	}
	return nil
}

// ReplicationAsync reports whether replica writes are non-blocking.
func (c Config) ReplicationAsync() bool {
	return strings.EqualFold(strings.TrimSpace(c.ReplicationMode), "async")
}

// TLSEnabled reports whether HTTPS should be used.
func (c Config) TLSEnabled() bool {
	return c.TLSCertFile != "" && c.TLSKeyFile != ""
}

// parseEncryptionQueues parses "name:mode,name2:mode2" into a map.
// Empty entries and whitespace are ignored. Later entries win on duplicate names.
func parseEncryptionQueues(raw string) map[string]string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}

	out := make(map[string]string)
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		name, mode, ok := strings.Cut(part, ":")
		if !ok {
			continue
		}
		name = strings.TrimSpace(name)
		mode = strings.TrimSpace(mode)
		if name == "" || mode == "" {
			continue
		}
		out[name] = mode
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func envString(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

func envStringList(key string) []string {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
