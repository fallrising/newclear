package config

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"github.com/fallrising/newclear/platform/prism/internal/secret"
)

const maxIngestKeyBytes = 4096

// IngestEnabled reports whether this role receives telemetry.
func (c *Config) IngestEnabled() bool {
	return c.Server.Mode == "all-in-one" || c.Server.Mode == "ingest"
}

func (c *Config) validateIngestIdentity(ctx context.Context) error {
	c.Auth.IngestAPIKey = ""
	if !c.IngestEnabled() {
		return nil
	}
	if c.Tenancy.Mode != "single" {
		return fmt.Errorf("ingest requires single tenancy; strict tenancy is not implemented")
	}
	if len(c.Tenancy.DefaultTenant) > 2048 || strings.TrimSpace(c.Tenancy.DefaultTenant) != c.Tenancy.DefaultTenant {
		return fmt.Errorf("tenancy.default_tenant exceeds ingest identity capacity")
	}
	if c.Auth.IngestAPIKeyFile == "" {
		return fmt.Errorf("auth.ingest_api_key_file is required for ingest")
	}
	key, err := readBounded(ctx, c.Auth.IngestAPIKeyFile, maxIngestKeyBytes)
	if err != nil {
		return fmt.Errorf("read auth.ingest_api_key_file: %w", err)
	}
	value := strings.TrimSpace(string(key))
	if len(value) < 32 || strings.IndexFunc(value, unicode.IsSpace) >= 0 {
		return fmt.Errorf("auth.ingest_api_key_file must contain a bearer credential of at least 32 bytes without internal whitespace")
	}
	jwt, err := readBounded(ctx, c.Auth.JWTSecretFile, maxAuxiliaryFileBytes)
	if err != nil {
		return fmt.Errorf("read auth.jwt_secret_file: %w", err)
	}
	if value == strings.TrimSpace(string(jwt)) {
		return fmt.Errorf("auth.ingest_api_key_file must use a credential distinct from auth.jwt_secret_file")
	}
	c.Auth.IngestAPIKey = secret.String(strings.Clone(value))
	return nil
}

// LogicalBudget bounds queued/buffered/in-flight payloads and receiver buffers.
// It excludes allocator, decoded protobuf/pdata, normalization/state, and backend storage
// and therefore does not provide a process RSS guarantee.
func (i IngestConfig) LogicalBudget() (int64, error) {
	// Check finite ranges before arithmetic or conversion to machine-sized ints.
	if i.QueueDepth <= 0 || i.QueueDepth > 1024 || i.MaxRequestBytes <= 0 || i.MaxRequestBytes > 1<<30 ||
		i.OTLP.MaxRecvMsgSize <= 0 || i.OTLP.MaxRecvMsgSize > 1<<30 ||
		i.OTLP.MaxConcurrentRequests <= 0 || i.OTLP.MaxConcurrentRequests > 1024 {
		return 0, fmt.Errorf("ingest queue, request, OTLP receive and concurrency capacities are outside supported ranges")
	}
	var batchBytes int64
	for _, batch := range []BatchSignalConfig{i.Batch.Metrics, i.Batch.Logs, i.Batch.Traces} {
		if batch.MaxBytes <= 0 || batch.MaxBytes > 1<<30 || batch.MaxItems <= 0 || batch.MaxItems > 1_000_000 {
			return 0, fmt.Errorf("ingest batch capacities are outside supported ranges")
		}
		batchBytes += int64(batch.MaxBytes)
	}
	// One tenant, three priority lanes, two workers per signal; values above
	// guarantee each product and sum fits int64 (including on 32-bit hosts).
	queues := (3 + 3*int64(i.QueueDepth) + 2) * batchBytes
	receive := 2 * max(int64(i.MaxRequestBytes), int64(i.OTLP.MaxRecvMsgSize)) * int64(i.OTLP.MaxConcurrentRequests)
	// Remote write owns one slot with compressed and decompressed buffers,
	// independent of the existing OTLP gate.
	remoteWriteReceive := 2 * int64(i.MaxRequestBytes)
	// Admission serializes one owned request while decoding may continue.
	return queues + receive + remoteWriteReceive + int64(i.MaxRequestBytes), nil
}

func (c *Config) validateIngestBudget() error {
	budget, err := c.Ingest.LogicalBudget()
	if err != nil {
		return err
	}
	if c.IngestEnabled() && budget > int64(c.Ingest.MemoryLimit) {
		return fmt.Errorf("ingest logical queue and receive budget %d exceeds ingest.memory_limit", budget)
	}
	return nil
}
