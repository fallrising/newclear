package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/pkg/client"
)

// history records what the workload observed. Safety is judged from it
// after the run, never from timing.
type history struct {
	mu          sync.Mutex
	start       time.Time
	timeline    []string
	acked       map[uint32][]string                       // partition → acknowledged values
	attempted   map[string]bool                           // every value ever sent
	processed   map[string]map[string]int                 // group → value → times processed
	assignments map[string]map[uint64]map[string][]uint32 // group → generation → member → partitions
	committed   map[string]map[uint32][]uint64            // group → partition → sampled committed offsets
	pollErrors  int
}

func newHistory() *history {
	return &history{
		start: time.Now(), acked: map[uint32][]string{}, attempted: map[string]bool{},
		processed: map[string]map[string]int{}, assignments: map[string]map[uint64]map[string][]uint32{},
		committed: map[string]map[uint32][]uint64{},
	}
}

func (h *history) event(format string, arguments ...any) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.timeline = append(h.timeline, fmt.Sprintf("%7.3fs ", time.Since(h.start).Seconds())+fmt.Sprintf(format, arguments...))
}

// produceLoop appends two-record batches with one producer identity until
// stopNew ends; an unacknowledged batch is resent unchanged until it is
// acknowledged or hardStop ends, so its outcome is either known or unknown.
func produceLoop(stopNew, hardStop context.Context, h *history, w *writer) {
	for batch := 0; stopNew.Err() == nil; batch++ {
		values := []string{fmt.Sprintf("p%d-%d-a", w.partition, batch), fmt.Sprintf("p%d-%d-b", w.partition, batch)}
		h.mu.Lock()
		for _, value := range values {
			h.attempted[value] = true
		}
		h.mu.Unlock()
		records := make([]protocol.WireRecord, len(values))
		for index, value := range values {
			encoded := base64.StdEncoding.EncodeToString([]byte(value))
			records[index] = protocol.WireRecord{KeyBase64: json.RawMessage("null"), ValueBase64: &encoded}
		}
		requestID := fmt.Sprintf("chaos-p%d-%d", w.partition, batch)
		for {
			if hardStop.Err() != nil {
				h.event("p%d batch %d left unresolved (outcome unknown)", w.partition, batch)
				return
			}
			ctx, cancel := context.WithTimeout(hardStop, 6*time.Second)
			response, err := w.transport.Produce(ctx, requestID, protocol.ProduceRequest{
				Topic: "events", Partition: w.partition, ProducerID: w.producerID, Epoch: protocol.DecimalUint64(w.epoch),
				FirstSequence: protocol.DecimalUint64(w.sequence), Acks: "all", Records: records,
			})
			cancel()
			if err == nil {
				w.sequence = uint64(response.NextSequence)
				h.mu.Lock()
				h.acked[w.partition] = append(h.acked[w.partition], values...)
				h.mu.Unlock()
				break
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
}

// consumeLoop polls one group member and records what it processed and
// which partitions it owned in each stable generation.
func consumeLoop(ctx context.Context, h *history, transport *client.ClusterTransport, groupID, memberID string) error {
	consumer, err := client.NewGroupConsumer(client.ConsumerConfig{
		GroupID: groupID, MemberID: memberID, Topics: []string{"events"}, Transport: transport,
		Process: func(_ context.Context, message client.Message) error {
			h.mu.Lock()
			defer h.mu.Unlock()
			if h.processed[groupID] == nil {
				h.processed[groupID] = map[string]int{}
			}
			h.processed[groupID][string(message.Value)]++
			return nil
		},
	})
	if err != nil {
		return err
	}
	for ctx.Err() == nil {
		pollCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		err := consumer.Poll(pollCtx)
		cancel()
		if err != nil {
			h.mu.Lock()
			h.pollErrors++
			h.mu.Unlock()
		}
		if assignment := consumer.Assignment(); err == nil && assignment != nil {
			h.recordAssignment(groupID, consumer.Generation(), memberID, assignment)
		}
		time.Sleep(20 * time.Millisecond)
	}
	return nil
}

func (h *history) recordAssignment(groupID string, generation uint64, memberID string, assignment []protocol.TopicPartition) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.assignments[groupID] == nil {
		h.assignments[groupID] = map[uint64]map[string][]uint32{}
	}
	if h.assignments[groupID][generation] == nil {
		h.assignments[groupID][generation] = map[string][]uint32{}
	}
	partitions := make([]uint32, 0, len(assignment))
	for _, partition := range assignment {
		partitions = append(partitions, partition.Partition)
	}
	h.assignments[groupID][generation][memberID] = partitions
}

// sampleCommitted reads each group's committed offsets until ctx ends; the
// reads pass the coordinator's read barrier, so they must never go back.
func sampleCommitted(ctx context.Context, h *history, transport *client.ClusterTransport, groups []string, partitions uint32) {
	query := make([]protocol.TopicPartition, 0, partitions)
	for partition := uint32(0); partition < partitions; partition++ {
		query = append(query, protocol.TopicPartition{Topic: "events", Partition: partition})
	}
	for ctx.Err() == nil {
		for _, groupID := range groups {
			readCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
			offsets, err := transport.CommittedOffsets(readCtx, "sample", groupID, query)
			cancel()
			if err != nil {
				continue
			}
			h.mu.Lock()
			if h.committed[groupID] == nil {
				h.committed[groupID] = map[uint32][]uint64{}
			}
			for _, offset := range offsets.Offsets {
				if offset.Offset != nil {
					h.committed[groupID][offset.Partition] = append(h.committed[groupID][offset.Partition], uint64(*offset.Offset))
				}
			}
			h.mu.Unlock()
		}
		time.Sleep(200 * time.Millisecond)
	}
}
