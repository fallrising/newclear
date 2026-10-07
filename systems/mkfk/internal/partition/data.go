package partition

import (
	"context"
	"errors"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
	"github.com/fallrising/newclear/systems/mkfk/internal/producer"
	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
	"github.com/fallrising/newclear/systems/mkfk/internal/replication"
)

const (
	DefaultProduceTimeout = 5 * time.Second
	DefaultReadTimeout    = 2 * time.Second
)

// RecordLog is the data partition's WAL as the actor reads it.
type RecordLog interface {
	replication.RecordLog
}

type DataConfig struct {
	Topic          string
	Partition      uint32
	Node           *raft.Node
	Log            RecordLog
	Replication    replication.Config
	Producer       producer.Config
	Clock          adapters.Clock
	TickClock      adapters.Clock
	Sender         Sender
	TickInterval   time.Duration
	ProduceTimeout time.Duration
	ReadTimeout    time.Duration
}

// Data serves one data partition: idempotent produce, committed fetch, and
// quorum-confirmed high-watermark proofs, all through one actor.
type Data struct {
	actor          *Actor
	node           *raft.Node
	log            RecordLog
	controller     *replication.Controller
	producer       *producer.Partition
	clock          adapters.Clock
	produceTimeout time.Duration
	readTimeout    time.Duration

	// Actor goroutine only.
	waiters map[string][]chan producer.Completion
}

func NewData(config DataConfig) (*Data, error) {
	if config.Node == nil || config.Log == nil || config.Clock == nil {
		return nil, errors.New("node, log, and clock are required")
	}
	if config.ProduceTimeout == 0 {
		config.ProduceTimeout = DefaultProduceTimeout
	}
	if config.ReadTimeout == 0 {
		config.ReadTimeout = DefaultReadTimeout
	}
	controller, err := replication.NewController(config.Node, config.Log, config.Replication, config.Clock.Now())
	if err != nil {
		return nil, err
	}
	partition, err := producer.NewPartition(config.Node, controller, producer.PartitionConfig{
		Topic: config.Topic, PartitionID: config.Partition, State: config.Producer,
	})
	if err != nil {
		return nil, err
	}
	data := &Data{
		node: config.Node, log: config.Log, controller: controller, producer: partition, clock: config.Clock,
		produceTimeout: config.ProduceTimeout, readTimeout: config.ReadTimeout,
		waiters: make(map[string][]chan producer.Completion),
	}
	data.actor, err = New(Config{
		Node: config.Node, Clock: config.Clock, TickClock: config.TickClock, Sender: config.Sender,
		TickInterval: config.TickInterval,
	}, data)
	if err != nil {
		return nil, err
	}
	data.actor.Start()
	return data, nil
}

func (d *Data) Actor() *Actor { return d.actor }

func (d *Data) Close() { d.actor.Close() }

// HandleReady implements Handler.
func (d *Data) HandleReady(ready raft.Ready, now time.Time) ([]raft.Message, error) {
	completions, err := d.producer.HandleReady(ready, now)
	d.dispatch(completions)
	return ready.Messages, err
}

// Tick implements Handler: ISR freshness is evaluated on every tick.
func (d *Data) Tick(now time.Time) ([]raft.Message, error) {
	d.controller.AdvanceTime(now)
	return nil, nil
}

// OpenProducer returns OperationOutcomeUnknown when the fence did not
// complete in time; the caller must retry the identical request.
func (d *Data) OpenProducer(ctx context.Context, request protocol.OpenProducerRequest) (producer.OpenResult, error) {
	completion, err := d.submit(ctx, request.RequestID, func(now time.Time) (*producer.Completion, raft.Ready, []producer.Completion, error) {
		result, ready, completions, err := d.producer.Open(request, now)
		if err != nil || result.Status == producer.OperationPending {
			return nil, ready, completions, err
		}
		return &producer.Completion{RequestID: request.RequestID, Open: &result}, ready, completions, nil
	})
	if err != nil {
		return producer.OpenResult{}, err
	}
	if completion.Open == nil {
		return producer.OpenResult{RequestID: request.RequestID, ProducerID: request.ProducerID, Status: producer.OperationOutcomeUnknown}, nil
	}
	return *completion.Open, nil
}

// Produce returns OperationOutcomeUnknown when the acks=all gate did not
// complete in time; the batch may still commit and must be retried as is.
func (d *Data) Produce(ctx context.Context, requestID string, request protocol.ProduceRequest) (producer.ProduceResult, error) {
	completion, err := d.submit(ctx, requestID, func(now time.Time) (*producer.Completion, raft.Ready, []producer.Completion, error) {
		result, ready, completions, err := d.producer.Produce(requestID, request, uint64(now.UnixMilli()), now)
		if err != nil || result.Status == producer.OperationPending {
			return nil, ready, completions, err
		}
		return &producer.Completion{RequestID: requestID, Produce: &result}, ready, completions, nil
	})
	if err != nil {
		return producer.ProduceResult{}, err
	}
	if completion.Produce == nil {
		return producer.ProduceResult{RequestID: requestID, ProducerID: request.ProducerID, Status: producer.OperationOutcomeUnknown}, nil
	}
	return *completion.Produce, nil
}

// producerCall runs on the actor. It returns the caller's completion when the
// operation finished immediately, or nil when it is still pending.
type producerCall func(now time.Time) (*producer.Completion, raft.Ready, []producer.Completion, error)

// submit runs one producer operation and waits for its completion. On
// deadline the gate times out: the outcome is unknown, never "not written".
func (d *Data) submit(ctx context.Context, requestID string, call producerCall) (producer.Completion, error) {
	ctx, cancel := context.WithTimeout(ctx, d.produceTimeout)
	defer cancel()
	wait := make(chan producer.Completion, 1)
	err := d.actor.Do(ctx, func() error {
		immediate, ready, completions, err := call(d.clock.Now())
		d.actor.Send(ready.Messages)
		if err != nil {
			return err
		}
		if immediate != nil {
			wait <- *immediate
		} else {
			d.waiters[requestID] = append(d.waiters[requestID], wait)
		}
		d.dispatch(completions)
		return nil
	})
	if err != nil {
		return producer.Completion{}, err
	}
	select {
	case completion := <-wait:
		return completion, nil
	case <-d.actor.Done():
		return producer.Completion{RequestID: requestID}, nil
	case <-ctx.Done():
	}
	_ = d.actor.Do(context.Background(), func() error {
		d.removeWaiter(requestID, wait)
		completions, err := d.producer.Timeout(requestID)
		if err != nil {
			return nil
		}
		for _, completion := range completions {
			if completion.RequestID == requestID {
				offer(wait, completion)
				continue
			}
			d.dispatch([]producer.Completion{completion})
		}
		return nil
	})
	select {
	case completion := <-wait:
		return completion, nil
	default:
		return producer.Completion{RequestID: requestID}, nil
	}
}

func (d *Data) dispatch(completions []producer.Completion) {
	for _, completion := range completions {
		waiting := d.waiters[completion.RequestID]
		delete(d.waiters, completion.RequestID)
		for _, wait := range waiting {
			offer(wait, completion)
		}
	}
}

func (d *Data) removeWaiter(requestID string, wait chan producer.Completion) {
	waiting := d.waiters[requestID]
	for index, candidate := range waiting {
		if candidate == wait {
			waiting = append(waiting[:index], waiting[index+1:]...)
			break
		}
	}
	if len(waiting) == 0 {
		delete(d.waiters, requestID)
		return
	}
	d.waiters[requestID] = waiting
}

// offer never blocks the actor: each waiter takes at most one completion.
func offer(wait chan producer.Completion, completion producer.Completion) {
	select {
	case wait <- completion:
	default:
	}
}

var _ Handler = (*Data)(nil)
