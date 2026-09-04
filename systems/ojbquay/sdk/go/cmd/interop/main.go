package main

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"time"

	ojbk "github.com/fallrising/ojbquay/sdk/go"
)

func main() {
	topic := environment("OJBQUAY_INTEROP_TOPIC", "pull-interop")
	group := environment("OJBQUAY_INTEROP_GROUP", "pull-interop")
	topicToken := environment(
		"OJBQUAY_INTEROP_TOPIC_TOKEN",
		"0123456789abcdef0123456789abcdef",
	)
	groupToken := environment(
		"OJBQUAY_INTEROP_GROUP_TOKEN",
		"abcdef0123456789abcdef0123456789",
	)
	producerEndpoint := environment(
		"OJBQUAY_INTEROP_PRODUCER_ENDPOINT", "127.0.0.1:19100",
	)
	consumerEndpoint := environment(
		"OJBQUAY_INTEROP_CONSUMER_ENDPOINT", "127.0.0.1:19101",
	)
	timeoutSeconds, err := strconv.Atoi(environment(
		"OJBQUAY_INTEROP_TIMEOUT_SECONDS", "180",
	))
	check(err)
	ctx, cancel := context.WithTimeout(
		context.Background(), time.Duration(timeoutSeconds)*time.Second,
	)
	defer cancel()

	consumer, err := ojbk.NewConsumer(
		consumerEndpoint,
		group,
		topic,
		groupToken,
		ojbk.WithPlaintext(),
		ojbk.WithPullBatch(1),
		ojbk.WithPullLinger(time.Second),
	)
	check(err)
	deliveries := await(ctx, consumer)
	first := deliveries[0]
	assertJavaDelivery(first)
	check(consumer.Acknowledge(ctx, nil, []string{first.AckToken}))
	redelivered := await(ctx, consumer)[0]
	assertJavaDelivery(redelivered)
	if redelivered.DeliveryCount <= first.DeliveryCount {
		panic(fmt.Sprintf(
			"delivery count did not increase: %d -> %d",
			first.DeliveryCount,
			redelivered.DeliveryCount,
		))
	}
	if redelivered.AckToken == first.AckToken {
		panic("NACK redelivery reused its acknowledgement token")
	}
	check(consumer.Acknowledge(ctx, []string{redelivered.AckToken}, nil))
	check(consumer.Close())

	producer, err := ojbk.NewProducer(
		producerEndpoint, topicToken, ojbk.WithPlaintext(),
	)
	check(err)
	key := "go-key"
	_, err = producer.Send(ctx, ojbk.Message{
		Topic: topic,
		Key:   &key,
		Value: []byte("go-to-java"),
		Tags:  []string{"interop"},
		Headers: map[string]string{
			"traceparent": "00-go",
		},
	})
	check(err)
	check(producer.Close())
	fmt.Println("GO_INTEROP_OK")
}

func assertJavaDelivery(delivery ojbk.Delivery) {
	if string(delivery.Value) != "java-to-go" ||
		delivery.Key != "java-key" ||
		len(delivery.Tags) != 1 ||
		delivery.Tags[0] != "interop" ||
		delivery.Headers["traceparent"] != "00-java" {
		panic("unexpected Java delivery metadata or value")
	}
}

func await(ctx context.Context, consumer *ojbk.Consumer) []ojbk.Delivery {
	for {
		deliveries, err := consumer.Poll(ctx)
		check(err)
		if len(deliveries) > 0 {
			return deliveries
		}
	}
}

func environment(name, defaultValue string) string {
	value := os.Getenv(name)
	if value == "" {
		return defaultValue
	}
	return value
}

func check(err error) {
	if err != nil {
		panic(err)
	}
}
