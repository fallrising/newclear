package ojbk

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"
	"time"

	ojbkv1 "github.com/fallrising/ojbquay/sdk/go/gen/ojbk/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

func TestProducerAndConsumerInteroperateWithMetadataAndBatchDecisions(t *testing.T) {
	service := &fakeService{acknowledged: make(chan struct{})}
	connection, stop := testConnection(t, service)
	defer stop()

	producer := newProducer(connection, "topic-token")
	key := "order-42"
	partition := int32(1)
	ack, err := producer.Send(context.Background(), Message{
		Topic:     "orders",
		Key:       &key,
		Value:     []byte("payload"),
		Tags:      []string{"paid"},
		Headers:   map[string]string{"traceparent": "00-test"},
		Partition: &partition,
	})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if ack.Offset != 42 || service.producerToken != "topic-token" {
		t.Fatalf("unexpected producer acknowledgement or token: %+v %q", ack, service.producerToken)
	}

	options := defaultOptions()
	options.reconnectDelay = time.Millisecond
	consumer := newConsumer(connection, "settlement", "orders", "group-token", options)
	ctx, cancel := context.WithCancel(context.Background())
	runDone := make(chan error, 1)
	go func() {
		runDone <- consumer.Run(ctx, func(_ context.Context, delivery Delivery) Result {
			if delivery.DeliveryCount != 3 {
				t.Errorf("delivery count = %d", delivery.DeliveryCount)
			}
			if delivery.Offset == 1 {
				return Ack
			}
			return Nack
		})
	}()

	select {
	case <-service.acknowledged:
		cancel()
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for acknowledgement")
	}
	err = <-runDone
	if !errors.Is(err, context.Canceled) && status.Code(err) != codes.Canceled {
		t.Fatalf("run error = %v", err)
	}
	service.mu.Lock()
	defer service.mu.Unlock()
	if service.consumerToken != "group-token" {
		t.Fatalf("consumer token = %q", service.consumerToken)
	}
	if len(service.lastAck.GetAck()) != 1 || service.lastAck.GetAck()[0] != "ack-1" {
		t.Fatalf("ACK tokens = %v", service.lastAck.GetAck())
	}
	if len(service.lastAck.GetNack()) != 1 || service.lastAck.GetNack()[0] != "ack-2" {
		t.Fatalf("NACK tokens = %v", service.lastAck.GetNack())
	}
	if service.polls < 2 {
		t.Fatalf("poll attempts = %d, want reconnect", service.polls)
	}
}

func TestPollReturnsTypedBusinessError(t *testing.T) {
	service := &fakeService{pollCode: ojbkv1.Code_AUTH_FAILED}
	connection, stop := testConnection(t, service)
	defer stop()
	consumer := newConsumer(connection, "settlement", "orders", "bad", defaultOptions())

	_, err := consumer.Poll(context.Background())
	var businessErr *BusinessError
	if !errors.As(err, &businessErr) || businessErr.Code != ojbkv1.Code_AUTH_FAILED {
		t.Fatalf("error = %v", err)
	}
}

type fakeService struct {
	ojbkv1.UnimplementedProducerServiceServer
	ojbkv1.UnimplementedConsumerServiceServer

	mu            sync.Mutex
	polls         int
	producerToken string
	consumerToken string
	lastAck       *ojbkv1.AckRequest
	acknowledged  chan struct{}
	pollCode      ojbkv1.Code
}

func (s *fakeService) Produce(
	ctx context.Context,
	request *ojbkv1.ProduceRequest,
) (*ojbkv1.ProduceResponse, error) {
	s.mu.Lock()
	s.producerToken = token(ctx)
	s.mu.Unlock()
	return &ojbkv1.ProduceResponse{
		Code: ojbkv1.Code_OK,
		Ack: &ojbkv1.ProduceAck{
			Topic:     request.GetMsg().GetTopic(),
			Partition: 1,
			Offset:    42,
		},
	}, nil
}

func (s *fakeService) Poll(
	request *ojbkv1.PollRequest,
	stream grpc.ServerStreamingServer[ojbkv1.MessageOut],
) error {
	s.mu.Lock()
	s.polls++
	attempt := s.polls
	s.consumerToken = token(stream.Context())
	code := s.pollCode
	s.mu.Unlock()
	if attempt == 1 && code == ojbkv1.Code_OK {
		return status.Error(codes.Unavailable, "retry")
	}
	if code != ojbkv1.Code_OK {
		return stream.Send(&ojbkv1.MessageOut{Code: code, Msg: "business failure"})
	}
	if attempt > 2 {
		<-stream.Context().Done()
		return stream.Context().Err()
	}
	for offset, ackToken := range []string{"ack-1", "ack-2"} {
		if err := stream.Send(&ojbkv1.MessageOut{
			Topic:         request.GetTopic(),
			Partition:     0,
			Offset:        int64(offset + 1),
			Value:         []byte("payload"),
			AckToken:      ackToken,
			DeliveryCount: 3,
			Code:          ojbkv1.Code_OK,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *fakeService) Ack(
	ctx context.Context,
	request *ojbkv1.AckRequest,
) (*ojbkv1.AckResponse, error) {
	s.mu.Lock()
	s.lastAck = request
	s.consumerToken = token(ctx)
	channel := s.acknowledged
	s.mu.Unlock()
	if channel != nil {
		select {
		case <-channel:
		default:
			close(channel)
		}
	}
	return &ojbkv1.AckResponse{Code: ojbkv1.Code_OK}, nil
}

func token(ctx context.Context) string {
	values, _ := metadata.FromIncomingContext(ctx)
	items := values.Get("x-ojbk-token")
	if len(items) == 0 {
		return ""
	}
	return items[0]
}

func testConnection(t *testing.T, service *fakeService) (*grpc.ClientConn, func()) {
	t.Helper()
	listener := bufconn.Listen(1 << 20)
	server := grpc.NewServer()
	ojbkv1.RegisterProducerServiceServer(server, service)
	ojbkv1.RegisterConsumerServiceServer(server, service)
	go func() {
		_ = server.Serve(listener)
	}()
	connection, err := grpc.NewClient(
		"passthrough:///bufnet",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) {
			return listener.Dial()
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return connection, func() {
		_ = connection.Close()
		server.Stop()
		_ = listener.Close()
	}
}
