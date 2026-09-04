package mqtt

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/fallrising/goku-cli/pkg/models"
)

// Config holds MQTT connection configuration
type Config struct {
	Broker   string
	Port     int
	ClientID string
	Username string
	Password string
	Topic    string
	QoS      byte
}

// Client wraps the MQTT client with bookmark-specific functionality
type Client struct {
	client mqtt.Client
	config *Config
}

// BookmarkEvent represents a bookmark event for MQTT publishing
type BookmarkEvent struct {
	Type      string           `json:"type"`      // "imported", "added", "updated", "deleted"
	Timestamp time.Time        `json:"timestamp"`
	Bookmark  *models.Bookmark `json:"bookmark"`
	Source    string           `json:"source,omitempty"` // "import", "manual", etc.
}

// NewClient creates a new MQTT client with the provided configuration
func NewClient(config *Config) (*Client, error) {
	if config.Broker == "" {
		return nil, fmt.Errorf("MQTT broker address is required")
	}
	
	if config.Topic == "" {
		config.Topic = "goku/bookmarks"
	}
	
	if config.ClientID == "" {
		config.ClientID = fmt.Sprintf("goku-cli-%d", time.Now().Unix())
	}
	
	if config.QoS > 2 {
		config.QoS = 1 // Default to QoS 1
	}

	// MQTT client options
	opts := mqtt.NewClientOptions()
	brokerURL := fmt.Sprintf("tcp://%s:%d", config.Broker, config.Port)
	opts.AddBroker(brokerURL)
	opts.SetClientID(config.ClientID)
	
	if config.Username != "" {
		opts.SetUsername(config.Username)
	}
	if config.Password != "" {
		opts.SetPassword(config.Password)
	}
	
	// Connection settings
	opts.SetConnectTimeout(5 * time.Second)
	opts.SetPingTimeout(1 * time.Second)
	opts.SetKeepAlive(30 * time.Second)
	opts.SetCleanSession(true)
	opts.SetAutoReconnect(true)
	opts.SetMaxReconnectInterval(1 * time.Second)
	
	// Connection status callbacks
	opts.SetOnConnectHandler(func(client mqtt.Client) {
		log.Printf("MQTT: Connected to broker %s", brokerURL)
	})
	
	opts.SetConnectionLostHandler(func(client mqtt.Client, err error) {
		log.Printf("MQTT: Connection lost: %v", err)
	})

	client := mqtt.NewClient(opts)
	
	return &Client{
		client: client,
		config: config,
	}, nil
}

// Connect establishes connection to the MQTT broker
func (c *Client) Connect() error {
	if token := c.client.Connect(); token.Wait() && token.Error() != nil {
		return fmt.Errorf("failed to connect to MQTT broker: %w", token.Error())
	}
	return nil
}

// Disconnect closes the MQTT connection
func (c *Client) Disconnect() {
	c.client.Disconnect(250)
	log.Println("MQTT: Disconnected from broker")
}

// PublishBookmark publishes a bookmark event to MQTT
func (c *Client) PublishBookmark(eventType string, bookmark *models.Bookmark, source string) error {
	event := BookmarkEvent{
		Type:      eventType,
		Timestamp: time.Now(),
		Bookmark:  bookmark,
		Source:    source,
	}
	
	payload, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal bookmark event: %w", err)
	}
	
	token := c.client.Publish(c.config.Topic, c.config.QoS, false, payload)
	if token.Wait() && token.Error() != nil {
		return fmt.Errorf("failed to publish to MQTT: %w", token.Error())
	}
	
	log.Printf("MQTT: Published bookmark '%s' to topic '%s'", bookmark.URL, c.config.Topic)
	return nil
}

// PublishBatch publishes multiple bookmarks efficiently
func (c *Client) PublishBatch(eventType string, bookmarks []*models.Bookmark, source string) error {
	for _, bookmark := range bookmarks {
		if err := c.PublishBookmark(eventType, bookmark, source); err != nil {
			return err
		}
		// Small delay to avoid overwhelming the broker
		time.Sleep(10 * time.Millisecond)
	}
	return nil
}

// IsConnected returns true if the client is connected to the broker
func (c *Client) IsConnected() bool {
	return c.client.IsConnected()
}