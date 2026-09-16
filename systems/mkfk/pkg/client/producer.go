package client

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

var ErrPendingBatch = errors.New("a different batch is already pending in the outbound ledger")

type Transport interface {
	Produce(context.Context, string, protocol.ProduceRequest) (protocol.ProduceResponseData, error)
}

type Waiter interface {
	Wait(context.Context, time.Duration) error
}

type RandomSource interface {
	Uint64() (uint64, error)
}

type RequestIDSource func() (string, error)

type ProducerConfig struct {
	ClusterID       string
	ProducerID      string
	Topic           string
	Partition       uint32
	Epoch           uint64
	NextSequence    uint64
	DeliveryTimeout time.Duration
	BaseBackoff     time.Duration
	MaxBackoff      time.Duration
	MaxAttempts     int
	Transport       Transport
	Ledger          Ledger
	Waiter          Waiter
	Random          RandomSource
	RequestIDs      RequestIDSource
	OnNotLeader     func(context.Context, map[string]any) error
}

type ResponseError struct {
	HTTPStatus int
	API        protocol.APIError
}

func (err *ResponseError) Error() string {
	return fmt.Sprintf("mkfk API %s: %s", err.API.Code, err.API.Message)
}

type LedgerUpdateError struct {
	Cause error
}

func (err *LedgerUpdateError) Error() string {
	return fmt.Sprintf("produce succeeded but outbound ledger update failed: %v", err.Cause)
}

func (err *LedgerUpdateError) Unwrap() error { return err.Cause }

type Producer struct {
	config ProducerConfig
	state  LedgerState
	mu     chan struct{}
}

func NewProducer(config ProducerConfig) (*Producer, error) {
	if config.Transport == nil || config.Ledger == nil {
		return nil, errors.New("transport and durable ledger are required")
	}
	if config.ClusterID == "" {
		return nil, errors.New("cluster ID is required")
	}
	if config.Epoch > math.MaxInt64 {
		return nil, errors.New("producer epoch exceeds MaxInt64")
	}
	probe := protocol.OpenProducerRequest{
		Topic: config.Topic, Partition: config.Partition, ProducerID: config.ProducerID,
		ExpectedEpoch: -1, RequestID: "client-validation",
	}
	if err := probe.Validate(); err != nil {
		return nil, err
	}
	if config.DeliveryTimeout == 0 {
		config.DeliveryTimeout = 5 * time.Second
	}
	if config.BaseBackoff == 0 {
		config.BaseBackoff = 50 * time.Millisecond
	}
	if config.MaxBackoff == 0 {
		config.MaxBackoff = time.Second
	}
	if config.MaxAttempts == 0 {
		config.MaxAttempts = 8
	}
	if config.DeliveryTimeout < 0 || config.BaseBackoff < 0 || config.MaxBackoff < config.BaseBackoff || config.MaxAttempts < 1 {
		return nil, errors.New("invalid delivery timeout, backoff, or attempt limit")
	}
	if config.Waiter == nil {
		config.Waiter = timerWaiter{}
	}
	if config.Random == nil {
		config.Random = cryptoRandom{}
	}
	if config.RequestIDs == nil {
		config.RequestIDs = randomRequestID
	}
	loaded, exists, err := config.Ledger.Load()
	if err != nil {
		return nil, err
	}
	state := LedgerState{
		Version: LedgerVersion, ClusterID: config.ClusterID, ProducerID: config.ProducerID,
		Topic: config.Topic, Partition: config.Partition, Epoch: config.Epoch, NextSequence: config.NextSequence,
	}
	if exists {
		if loaded.ClusterID != state.ClusterID || loaded.ProducerID != state.ProducerID || loaded.Topic != state.Topic || loaded.Partition != state.Partition || loaded.Epoch != state.Epoch {
			return nil, errors.New("outbound ledger identity does not match producer configuration")
		}
		state = loaded
	}
	return &Producer{config: config, state: state, mu: make(chan struct{}, 1)}, nil
}

func (producer *Producer) Send(ctx context.Context, records []Record) (protocol.ProduceResponseData, error) {
	producer.lock()
	defer producer.unlock()
	records = normalizeRecords(records)
	if producer.state.Pending != nil {
		if !reflect.DeepEqual(producer.state.Pending.Records, records) {
			return protocol.ProduceResponseData{}, ErrPendingBatch
		}
		return producer.deliver(ctx)
	}
	requestID, err := producer.config.RequestIDs()
	if err != nil {
		return protocol.ProduceResponseData{}, err
	}
	if err := protocol.ValidateRequestID(requestID); err != nil {
		return protocol.ProduceResponseData{}, err
	}
	next := cloneLedgerState(producer.state)
	next.Pending = &PendingBatch{
		RequestID: requestID, FirstSequence: next.NextSequence, Records: cloneRecords(records),
	}
	if err := validatePendingRequest(next); err != nil {
		return protocol.ProduceResponseData{}, err
	}
	if err := producer.config.Ledger.Save(next); err != nil {
		return protocol.ProduceResponseData{}, err
	}
	producer.state = next
	return producer.deliver(ctx)
}

func (producer *Producer) Resume(ctx context.Context) (protocol.ProduceResponseData, error) {
	producer.lock()
	defer producer.unlock()
	if producer.state.Pending == nil {
		return protocol.ProduceResponseData{}, errors.New("outbound ledger has no pending batch")
	}
	return producer.deliver(ctx)
}

func (producer *Producer) State() LedgerState {
	producer.lock()
	defer producer.unlock()
	return cloneLedgerState(producer.state)
}

func (producer *Producer) deliver(ctx context.Context) (protocol.ProduceResponseData, error) {
	pending := producer.state.Pending
	if pending == nil {
		return protocol.ProduceResponseData{}, errors.New("no pending batch")
	}
	request, err := producer.pendingRequest()
	if err != nil {
		return protocol.ProduceResponseData{}, err
	}
	deliveryContext, cancel := context.WithTimeout(ctx, producer.config.DeliveryTimeout)
	defer cancel()
	backoff := producer.config.BaseBackoff
	var lastErr error
	for attempt := 1; attempt <= producer.config.MaxAttempts; attempt++ {
		response, sendErr := producer.config.Transport.Produce(deliveryContext, pending.RequestID, request)
		if sendErr == nil {
			wantNext := pending.FirstSequence + uint64(len(pending.Records))
			if uint64(response.NextSequence) != wantNext || uint64(response.LastOffset) < uint64(response.BaseOffset) || uint64(response.LastOffset)-uint64(response.BaseOffset)+1 != uint64(len(pending.Records)) {
				return protocol.ProduceResponseData{}, errors.New("server success response does not match the pending batch")
			}
			next := cloneLedgerState(producer.state)
			next.NextSequence = wantNext
			next.Pending = nil
			if err := producer.config.Ledger.Save(next); err != nil {
				return protocol.ProduceResponseData{}, &LedgerUpdateError{Cause: err}
			}
			producer.state = next
			return response, nil
		}
		lastErr = sendErr
		var responseError *ResponseError
		if errors.As(sendErr, &responseError) {
			if !responseError.API.Retryable {
				return protocol.ProduceResponseData{}, sendErr
			}
			if responseError.API.Code == "NOT_LEADER" && producer.config.OnNotLeader != nil {
				if err := producer.config.OnNotLeader(deliveryContext, responseError.API.Details); err != nil {
					return protocol.ProduceResponseData{}, err
				}
			}
		}
		if attempt == producer.config.MaxAttempts {
			break
		}
		delay, err := producer.jitter(backoff)
		if err != nil {
			return protocol.ProduceResponseData{}, err
		}
		if err := producer.config.Waiter.Wait(deliveryContext, delay); err != nil {
			return protocol.ProduceResponseData{}, err
		}
		if backoff < producer.config.MaxBackoff {
			backoff *= 2
			if backoff > producer.config.MaxBackoff {
				backoff = producer.config.MaxBackoff
			}
		}
	}
	return protocol.ProduceResponseData{}, lastErr
}

func (producer *Producer) pendingRequest() (protocol.ProduceRequest, error) {
	pending := producer.state.Pending
	if pending == nil {
		return protocol.ProduceRequest{}, errors.New("no pending batch")
	}
	wireRecords := make([]protocol.WireRecord, len(pending.Records))
	for index, record := range pending.Records {
		var key json.RawMessage
		if record.Key == nil {
			key = json.RawMessage("null")
		} else {
			encoded, err := json.Marshal(base64.StdEncoding.EncodeToString(record.Key))
			if err != nil {
				return protocol.ProduceRequest{}, err
			}
			key = encoded
		}
		value := base64.StdEncoding.EncodeToString(record.Value)
		wireRecords[index] = protocol.WireRecord{KeyBase64: key, ValueBase64: &value}
	}
	request := protocol.ProduceRequest{
		Topic: producer.state.Topic, Partition: producer.state.Partition, ProducerID: producer.state.ProducerID,
		Epoch: protocol.DecimalUint64(producer.state.Epoch), FirstSequence: protocol.DecimalUint64(pending.FirstSequence),
		Acks: "all", Records: wireRecords,
	}
	if _, err := request.Validate(); err != nil {
		return protocol.ProduceRequest{}, err
	}
	return request, nil
}

func validatePendingRequest(state LedgerState) error {
	if err := state.Validate(); err != nil {
		return err
	}
	producer := &Producer{state: state}
	_, err := producer.pendingRequest()
	return err
}

func (producer *Producer) jitter(backoff time.Duration) (time.Duration, error) {
	if backoff <= 1 {
		return backoff, nil
	}
	value, err := producer.config.Random.Uint64()
	if err != nil {
		return 0, err
	}
	half := backoff / 2
	return half + time.Duration(value%uint64(backoff-half+1)), nil
}

func (producer *Producer) lock()   { producer.mu <- struct{}{} }
func (producer *Producer) unlock() { <-producer.mu }

type timerWaiter struct{}

func (timerWaiter) Wait(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

type cryptoRandom struct{}

func (cryptoRandom) Uint64() (uint64, error) {
	var data [8]byte
	if _, err := rand.Read(data[:]); err != nil {
		return 0, err
	}
	var value uint64
	for _, item := range data {
		value = value<<8 | uint64(item)
	}
	return value, nil
}

func randomRequestID() (string, error) {
	var data [16]byte
	if _, err := rand.Read(data[:]); err != nil {
		return "", err
	}
	return "req-" + hex.EncodeToString(data[:]), nil
}

func normalizeRecords(records []Record) []Record {
	result := cloneRecords(records)
	for index := range result {
		if result[index].Value == nil {
			result[index].Value = []byte{}
		}
	}
	return result
}
