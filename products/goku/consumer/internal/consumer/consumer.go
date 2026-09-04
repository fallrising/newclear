package consumer

import (
	"log"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/fallrising/goku-consumer/internal/config"
)

type Consumer struct {
	client     mqtt.Client
	topic      string
	handler    func([]byte) error
	messageCh  chan []byte
	batchSize  int
	batchTimer *time.Timer
}

func New(cfg *config.Config, handler func([]byte) error) (*Consumer, error) {
	opts := mqtt.NewClientOptions().AddBroker(cfg.MQTTBroker).SetClientID(cfg.ClientID)
	client := mqtt.NewClient(opts)
	if token := client.Connect(); token.Wait() && token.Error() != nil {
		return nil, token.Error()
	}

	return &Consumer{
		client:    client,
		topic:     cfg.Topic,
		handler:   handler,
		messageCh: make(chan []byte, 100),
		batchSize: cfg.BatchSize,
	}, nil
}

func (c *Consumer) Start() error {
	if token := c.client.Subscribe(c.topic, 0, func(client mqtt.Client, msg mqtt.Message) {
		c.messageCh <- msg.Payload()
	}); token.Wait() && token.Error() != nil {
		return token.Error()
	}

	go c.processBatch()

	return nil
}

func (c *Consumer) Stop() {
	c.client.Disconnect(250)
	close(c.messageCh)
}

func (c *Consumer) processBatch() {
	batch := make([][]byte, 0, c.batchSize)
	c.batchTimer = time.NewTimer(5 * time.Second)

	for {
		select {
		case msg, ok := <-c.messageCh:
			if !ok {
				return
			}
			batch = append(batch, msg)
			if len(batch) >= c.batchSize {
				c.processBatchItems(batch)
				batch = batch[:0]
				c.batchTimer.Reset(5 * time.Second)
			}
		case <-c.batchTimer.C:
			if len(batch) > 0 {
				c.processBatchItems(batch)
				batch = batch[:0]
			}
			c.batchTimer.Reset(5 * time.Second)
		}
	}
}

func (c *Consumer) processBatchItems(batch [][]byte) {
	for _, msg := range batch {
		if err := c.handler(msg); err != nil {
			log.Printf("Error processing message: %v", err)
		}
	}
}
