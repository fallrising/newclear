package testkit

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/fallrising/newclear/systems/mkfk/internal/adapters"
)

type ScriptedRandom struct {
	mu       sync.Mutex
	values   []uint64
	position int
}

func NewScriptedRandom(values ...uint64) *ScriptedRandom {
	return &ScriptedRandom{values: append([]uint64(nil), values...)}
}

func (random *ScriptedRandom) Uint64() (uint64, error) {
	random.mu.Lock()
	defer random.mu.Unlock()
	if random.position == len(random.values) {
		return 0, errors.New("scripted random source exhausted")
	}
	value := random.values[random.position]
	random.position++
	return value, nil
}

func InclusiveRange(random adapters.RandomSource, minimum, maximum uint64) (uint64, error) {
	if minimum > maximum {
		return 0, errors.New("minimum exceeds maximum")
	}
	value, err := random.Uint64()
	if err != nil {
		return 0, err
	}
	width := maximum - minimum + 1
	return minimum + value%width, nil
}

type TransportAction struct {
	Drop       bool
	Duplicates int
	Failure    error
}

type FaultTransport struct {
	mu        sync.Mutex
	actions   []TransportAction
	position  int
	delivered []adapters.PeerMessage
	dropped   []adapters.PeerMessage
}

func NewFaultTransport(actions ...TransportAction) *FaultTransport {
	return &FaultTransport{actions: append([]TransportAction(nil), actions...)}
}

func (transport *FaultTransport) Send(ctx context.Context, message adapters.PeerMessage) error {
	transport.mu.Lock()
	defer transport.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	action := TransportAction{Duplicates: 1}
	if transport.position < len(transport.actions) {
		action = transport.actions[transport.position]
		transport.position++
	}
	if action.Failure != nil {
		return action.Failure
	}
	if action.Drop {
		transport.dropped = append(transport.dropped, cloneMessage(message))
		return nil
	}
	if action.Duplicates < 0 {
		return fmt.Errorf("negative duplicate count %d", action.Duplicates)
	}
	for range action.Duplicates {
		transport.delivered = append(transport.delivered, cloneMessage(message))
	}
	return nil
}

func (transport *FaultTransport) Delivered() []adapters.PeerMessage {
	transport.mu.Lock()
	defer transport.mu.Unlock()
	return cloneMessages(transport.delivered)
}

func (transport *FaultTransport) Dropped() []adapters.PeerMessage {
	transport.mu.Lock()
	defer transport.mu.Unlock()
	return cloneMessages(transport.dropped)
}

func cloneMessages(messages []adapters.PeerMessage) []adapters.PeerMessage {
	cloned := make([]adapters.PeerMessage, len(messages))
	for i, message := range messages {
		cloned[i] = cloneMessage(message)
	}
	return cloned
}

func cloneMessage(message adapters.PeerMessage) adapters.PeerMessage {
	message.Body = append([]byte(nil), message.Body...)
	return message
}

type EventRecorder struct {
	mu     sync.Mutex
	events []adapters.Event
}

func (recorder *EventRecorder) Record(event adapters.Event) {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	copy := event
	copy.Metadata = make(map[string]string, len(event.Metadata))
	for key, value := range event.Metadata {
		copy.Metadata[key] = value
	}
	recorder.events = append(recorder.events, copy)
}

func (recorder *EventRecorder) Snapshot() []adapters.Event {
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	result := make([]adapters.Event, len(recorder.events))
	copy(result, recorder.events)
	return result
}
