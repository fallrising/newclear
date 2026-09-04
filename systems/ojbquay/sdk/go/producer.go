package ojbk

import (
	"context"

	ojbkv1 "github.com/fallrising/newclear/systems/ojbquay/sdk/go/gen/ojbk/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

// Producer is a thin authenticated gRPC producer.
type Producer struct {
	connection *grpc.ClientConn
	client     ojbkv1.ProducerServiceClient
	token      string
}

// NewProducer opens a TLS channel unless plaintext or custom credentials are
// explicitly configured.
func NewProducer(target, token string, values ...Option) (*Producer, error) {
	if target == "" || token == "" {
		return nil, invalid("target and token must not be blank")
	}
	options, err := applyOptions(values)
	if err != nil {
		return nil, err
	}
	connection, err := grpc.NewClient(target, options.dialOptions...)
	if err != nil {
		return nil, err
	}
	return newProducer(connection, token), nil
}

func newProducer(connection *grpc.ClientConn, token string) *Producer {
	return &Producer{
		connection: connection,
		client:     ojbkv1.NewProducerServiceClient(connection),
		token:      token,
	}
}

// Send publishes one message and returns its Kafka identity.
func (p *Producer) Send(ctx context.Context, message Message) (Acknowledgement, error) {
	if message.Topic == "" {
		return Acknowledgement{}, invalid("topic must not be blank")
	}
	input := &ojbkv1.MessageIn{
		Topic:   message.Topic,
		Value:   append([]byte(nil), message.Value...),
		Tags:    append([]string(nil), message.Tags...),
		Headers: cloneMap(message.Headers),
		Key:     message.Key,
	}
	if message.Partition != nil {
		input.Partition = message.Partition
	}
	response, err := p.client.Produce(auth(ctx, p.token), &ojbkv1.ProduceRequest{Msg: input})
	if err != nil {
		return Acknowledgement{}, err
	}
	if response.Code != ojbkv1.Code_OK {
		return Acknowledgement{}, business(response.Code, response.Msg)
	}
	if response.Ack == nil {
		return Acknowledgement{}, business(ojbkv1.Code_INTERNAL, "missing acknowledgement")
	}
	return Acknowledgement{
		Topic:     response.Ack.Topic,
		Partition: response.Ack.Partition,
		Offset:    response.Ack.Offset,
	}, nil
}

// Close releases the producer channel.
func (p *Producer) Close() error {
	if p == nil || p.connection == nil {
		return nil
	}
	return p.connection.Close()
}

func auth(ctx context.Context, token string) context.Context {
	return metadata.AppendToOutgoingContext(ctx, "x-ojbk-token", token)
}

func business(code ojbkv1.Code, message string) error {
	return &BusinessError{Code: code, Message: message}
}

func cloneMap(source map[string]string) map[string]string {
	if source == nil {
		return nil
	}
	target := make(map[string]string, len(source))
	for key, value := range source {
		target[key] = value
	}
	return target
}
