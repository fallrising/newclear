// Package otlp accepts bounded, authenticated OTLP exports for one fixed tenant.
// Success acknowledges asynchronous pipeline admission, not durable storage.
package otlp

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"strings"
	"sync/atomic"

	"github.com/fallrising/newclear/platform/prism/internal/ingest"
	"github.com/fallrising/newclear/platform/prism/internal/secret"
	"github.com/fallrising/newclear/platform/prism/pkg/spi"
	"go.opentelemetry.io/collector/pdata/plog"
	"go.opentelemetry.io/collector/pdata/pmetric"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

// Submitter is the existing bounded pipeline admission contract.
type Submitter interface {
	SubmitOTLPMetrics(context.Context, pmetric.Metrics, int64) (ingest.Result, error)
	SubmitOTLPLogs(context.Context, plog.Logs, int64) (ingest.Result, error)
	SubmitOTLPTraces(context.Context, ptrace.Traces, int64) (ingest.Result, error)
}

// Options are mandatory finite limits and an authenticated fixed tenant.
// Both HTTP wire and decompressed bytes are capped at MaxRequestBytes.
type Options struct {
	Tenant                                                 string
	APIKey                                                 secret.String
	MaxRequestBytes, MaxRecvMsgSize, MaxConcurrentRequests int
}

// Receiver owns neither listeners nor the submitted pipeline.
type Receiver struct {
	pipeline                        Submitter
	tenant                          string
	key                             [sha256.Size]byte
	maxRequestBytes, maxRecvMsgSize int
	gate                            chan struct{}
	stopped                         atomic.Bool
}

func failure(class spi.ErrClass) error {
	return spi.Wrap(class, "", "otlp", fmt.Errorf("OTLP %s", class))
}

// New validates and freezes receiver settings; it starts no goroutines.
func New(pipeline Submitter, options Options) (*Receiver, error) {
	if pipeline == nil || options.Tenant == "" || len(options.Tenant) > 2048 || strings.TrimSpace(options.Tenant) != options.Tenant || len(options.APIKey) < 32 || len(options.APIKey) > 4096 || options.MaxRequestBytes <= 0 || options.MaxRequestBytes > 1<<30 || options.MaxRecvMsgSize <= 0 || options.MaxRecvMsgSize > 1<<30 || options.MaxConcurrentRequests <= 0 || options.MaxConcurrentRequests > 1024 {
		return nil, failure(spi.ErrBadRequest)
	}
	return &Receiver{pipeline: pipeline, tenant: strings.Clone(options.Tenant), key: sha256.Sum256([]byte(options.APIKey)), maxRequestBytes: options.MaxRequestBytes, maxRecvMsgSize: options.MaxRecvMsgSize, gate: make(chan struct{}, options.MaxConcurrentRequests)}, nil
}

// Stop rejects new work; existing submissions remain owned by their transports.
func (r *Receiver) Stop() { r.stopped.Store(true) }
func (r *Receiver) acquire(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return spi.Wrap(spi.ErrTimeout, "", "otlp", err)
	}
	if r.stopped.Load() {
		return failure(spi.ErrUnavailable)
	}
	select {
	case r.gate <- struct{}{}:
		if r.stopped.Load() {
			r.release()
			return failure(spi.ErrUnavailable)
		}
		return nil
	default:
		return failure(spi.ErrThrottled)
	}
}
func (r *Receiver) release() { <-r.gate }

func (r *Receiver) authenticate(authorization, scope, tenant []string) (bool, error) {
	if len(authorization) != 1 || len(authorization[0]) > 4103 {
		return false, nil
	}
	scheme, credential, ok := strings.Cut(authorization[0], " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return false, nil
	}
	hash := sha256.Sum256([]byte(credential))
	if subtle.ConstantTimeCompare(hash[:], r.key[:]) != 1 {
		return false, nil
	}
	for _, selectors := range [][]string{scope, tenant} {
		if len(selectors) > 1 || (len(selectors) == 1 && selectors[0] != r.tenant) {
			return true, failure(spi.ErrBadRequest)
		}
	}
	return true, nil
}

// Diagnostics have a fixed vocabulary and never interpolate request/backend text.
func diagnostics(result ingest.Result) string {
	messages := make([]string, 0, 6)
	if result.OTLPRejected > 0 {
		messages = append(messages, "input records rejected")
	}
	if result.Normalize.Warnings["delta_baseline"] > 0 {
		messages = append(messages, "delta baseline initialized")
	}
	if result.MetadataUnsupported > 0 {
		messages = append(messages, "metric metadata unsupported")
	}
	if len(result.Normalize.Normalized) > 0 || len(result.Normalize.Rejected) > 0 || len(result.Normalize.Warnings) > 0 || result.Normalize.UpstreamDropped > 0 {
		messages = append(messages, "normalization diagnostics")
	}
	if len(result.Limits.Normalized) > 0 || len(result.Limits.Warnings) > 0 || len(result.Limits.Rejected) > 0 || result.Limits.EventOverflow > 0 {
		messages = append(messages, "tenant limit diagnostics")
	}
	if result.InternalFailures > 0 {
		messages = append(messages, "internal admission failure")
	}
	return strings.Join(messages, "; ")
}
