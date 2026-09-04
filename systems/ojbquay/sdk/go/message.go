package ojbk

import (
	"fmt"

	ojbkv1 "github.com/fallrising/newclear/systems/ojbquay/sdk/go/gen/ojbk/v1"
)

// Message is the language-neutral producer value.
type Message struct {
	Topic     string
	Key       *string
	Value     []byte
	Tags      []string
	Headers   map[string]string
	Partition *int32
}

// Acknowledgement identifies the durably stored Kafka record.
type Acknowledgement struct {
	Topic     string
	Partition int32
	Offset    int64
}

// Delivery is a pull message and its opaque, single-use acknowledgement token.
type Delivery struct {
	Topic         string
	Partition     int32
	Offset        int64
	Key           string
	Value         []byte
	Tags          []string
	Headers       map[string]string
	AckToken      string
	DeliveryCount int32
}

// Result is the handler decision applied to one pull delivery.
type Result int

const (
	// Ack accepts the delivery.
	Ack Result = iota
	// Nack releases the delivery for broker redelivery.
	Nack
)

// BusinessError carries the stable cross-language platform code.
type BusinessError struct {
	Code    ojbkv1.Code
	Message string
}

func (e *BusinessError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code.String(), e.Message)
}
