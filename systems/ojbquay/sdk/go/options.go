package ojbk

import (
	"crypto/tls"
	"time"

	ojbkv1 "github.com/fallrising/ojbquay/sdk/go/gen/ojbk/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

type clientOptions struct {
	dialOptions    []grpc.DialOption
	maxBatch       int32
	linger         time.Duration
	reconnectDelay time.Duration
}

func defaultOptions() clientOptions {
	return clientOptions{
		dialOptions: []grpc.DialOption{grpc.WithTransportCredentials(
			credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12}),
		)},
		maxBatch:       64,
		linger:         time.Second,
		reconnectDelay: 100 * time.Millisecond,
	}
}

// Option configures producer or consumer connection behavior.
type Option func(*clientOptions) error

// WithPlaintext opts into an unencrypted local-development channel.
func WithPlaintext() Option {
	return func(options *clientOptions) error {
		options.dialOptions = []grpc.DialOption{
			grpc.WithTransportCredentials(insecure.NewCredentials()),
		}
		return nil
	}
}

// WithGRPCDialOptions replaces transport dial options, primarily for custom
// credentials, resolvers, or test transports.
func WithGRPCDialOptions(values ...grpc.DialOption) Option {
	return func(options *clientOptions) error {
		if len(values) == 0 {
			return invalid("at least one gRPC dial option is required")
		}
		options.dialOptions = append([]grpc.DialOption(nil), values...)
		return nil
	}
}

// WithPullBatch sets the requested server batch bound.
func WithPullBatch(maxBatch int32) Option {
	return func(options *clientOptions) error {
		if maxBatch < 1 || maxBatch > 500 {
			return invalid("maxBatch must be 1..500")
		}
		options.maxBatch = maxBatch
		return nil
	}
}

// WithPullLinger sets the long-poll duration.
func WithPullLinger(linger time.Duration) Option {
	return func(options *clientOptions) error {
		if linger < 0 || linger > 30*time.Second {
			return invalid("linger must be 0..30 seconds")
		}
		options.linger = linger
		return nil
	}
}

// WithReconnectDelay sets the initial bounded exponential reconnect delay.
func WithReconnectDelay(delay time.Duration) Option {
	return func(options *clientOptions) error {
		if delay <= 0 || delay > 5*time.Second {
			return invalid("reconnect delay must be positive and at most 5 seconds")
		}
		options.reconnectDelay = delay
		return nil
	}
}

func applyOptions(values []Option) (clientOptions, error) {
	options := defaultOptions()
	for _, option := range values {
		if option == nil {
			return clientOptions{}, invalid("option must not be nil")
		}
		if err := option(&options); err != nil {
			return clientOptions{}, err
		}
	}
	return options, nil
}

func invalid(message string) error {
	return &BusinessError{Code: ojbkv1.Code_INVALID_ARGUMENT, Message: message}
}
