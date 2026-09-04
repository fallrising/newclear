package ojbk

import (
	"context"
	"errors"
	"io"
	"time"

	ojbkv1 "github.com/fallrising/ojbquay/sdk/go/gen/ojbk/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Handler returns Ack or Nack for one delivery.
type Handler func(context.Context, Delivery) Result

// Consumer wraps Poll/Ack streaming as a bounded handler loop.
type Consumer struct {
	connection     *grpc.ClientConn
	client         ojbkv1.ConsumerServiceClient
	token          string
	group          string
	topic          string
	maxBatch       int32
	linger         time.Duration
	reconnectDelay time.Duration
}

// NewConsumer opens a TLS channel unless plaintext or custom credentials are
// explicitly configured.
func NewConsumer(target, group, topic, token string, values ...Option) (*Consumer, error) {
	if target == "" || group == "" || topic == "" || token == "" {
		return nil, invalid("target, group, topic, and token must not be blank")
	}
	options, err := applyOptions(values)
	if err != nil {
		return nil, err
	}
	connection, err := grpc.NewClient(target, options.dialOptions...)
	if err != nil {
		return nil, err
	}
	return newConsumer(connection, group, topic, token, options), nil
}

func newConsumer(
	connection *grpc.ClientConn,
	group, topic, token string,
	options clientOptions,
) *Consumer {
	return &Consumer{
		connection:     connection,
		client:         ojbkv1.NewConsumerServiceClient(connection),
		token:          token,
		group:          group,
		topic:          topic,
		maxBatch:       options.maxBatch,
		linger:         options.linger,
		reconnectDelay: options.reconnectDelay,
	}
}

// Poll performs one bounded server-streaming long poll.
func (c *Consumer) Poll(ctx context.Context) ([]Delivery, error) {
	stream, err := c.client.Poll(auth(ctx, c.token), &ojbkv1.PollRequest{
		Group:    c.group,
		Topic:    c.topic,
		MaxBatch: c.maxBatch,
		LingerMs: int32(c.linger.Milliseconds()),
	})
	if err != nil {
		return nil, err
	}
	deliveries := make([]Delivery, 0, c.maxBatch)
	for {
		message, receiveErr := stream.Recv()
		if errors.Is(receiveErr, io.EOF) {
			return deliveries, nil
		}
		if receiveErr != nil {
			return nil, receiveErr
		}
		if message.Code != ojbkv1.Code_OK {
			return nil, business(message.Code, message.Msg)
		}
		if message.AckToken == "" {
			return nil, business(ojbkv1.Code_INTERNAL, "missing acknowledgement token")
		}
		deliveries = append(deliveries, Delivery{
			Topic:         message.Topic,
			Partition:     message.Partition,
			Offset:        message.Offset,
			Key:           message.Key,
			Value:         append([]byte(nil), message.Value...),
			Tags:          append([]string(nil), message.Tags...),
			Headers:       cloneMap(message.Headers),
			AckToken:      message.AckToken,
			DeliveryCount: message.DeliveryCount,
		})
	}
}

// Acknowledge commits one bounded ACK/NACK batch.
func (c *Consumer) Acknowledge(
	ctx context.Context,
	accepted, released []string,
) error {
	if len(accepted)+len(released) == 0 || len(accepted)+len(released) > 500 {
		return invalid("acknowledgement batch must contain 1..500 tokens")
	}
	response, err := c.client.Ack(auth(ctx, c.token), &ojbkv1.AckRequest{
		Group: c.group,
		Ack:   append([]string(nil), accepted...),
		Nack:  append([]string(nil), released...),
	})
	if err != nil {
		return err
	}
	if response.Code != ojbkv1.Code_OK {
		return business(response.Code, response.Msg)
	}
	return nil
}

// Run long-polls until the context ends or a non-transport business error
// occurs. Handler decisions are acknowledged as one batch per poll response.
func (c *Consumer) Run(ctx context.Context, handler Handler) error {
	if handler == nil {
		return invalid("handler must not be nil")
	}
	delay := c.reconnectDelay
	for {
		deliveries, err := c.Poll(ctx)
		if err != nil {
			if contextErr := ctx.Err(); contextErr != nil {
				return contextErr
			}
			if !retryable(err) {
				return err
			}
			if waitErr := wait(ctx, delay); waitErr != nil {
				return waitErr
			}
			delay = min(5*time.Second, delay*2)
			continue
		}
		delay = c.reconnectDelay
		accepted := make([]string, 0, len(deliveries))
		released := make([]string, 0, len(deliveries))
		for _, delivery := range deliveries {
			if handler(ctx, delivery) == Ack {
				accepted = append(accepted, delivery.AckToken)
			} else {
				released = append(released, delivery.AckToken)
			}
		}
		if len(accepted)+len(released) == 0 {
			if err := ctx.Err(); err != nil {
				return err
			}
			continue
		}
		if err := c.Acknowledge(ctx, accepted, released); err != nil {
			if retryable(err) {
				if waitErr := wait(ctx, delay); waitErr != nil {
					return waitErr
				}
				delay = min(5*time.Second, delay*2)
				continue
			}
			return err
		}
	}
}

// Close releases the consumer channel.
func (c *Consumer) Close() error {
	if c == nil || c.connection == nil {
		return nil
	}
	return c.connection.Close()
}

func retryable(err error) bool {
	code := status.Code(err)
	return code == codes.Unavailable ||
		code == codes.DeadlineExceeded ||
		code == codes.ResourceExhausted
}

func wait(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
