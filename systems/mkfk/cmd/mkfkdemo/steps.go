package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync/atomic"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/pkg/client"
)

const demoProducer = "5d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6"

// lossyTransport applies the first armed produce on the broker but loses
// its reply, as a dropped connection would.
type lossyTransport struct {
	client.Transport
	armed atomic.Bool
}

func (l *lossyTransport) Produce(ctx context.Context, requestID string, request protocol.ProduceRequest) (protocol.ProduceResponseData, error) {
	response, err := l.Transport.Produce(ctx, requestID, request)
	if err == nil && l.armed.CompareAndSwap(true, false) {
		note("broker applied offsets %d..%d, but the reply is lost on the way back", response.BaseOffset, response.LastOffset)
		return protocol.ProduceResponseData{}, errors.New("connection reset before the reply arrived")
	}
	return response, err
}

func (d *demo) run() error {
	step("1. Three brokers start on this project's fresh named volumes")
	if err := d.waitReady(1, 2, 3); err != nil {
		return err
	}
	if metadata, err := d.metadata(1); err == nil {
		for _, partition := range metadata.Partitions {
			note("%s/%d replicas %v, leader observed by broker 1: %v", partition.Topic, partition.Partition, partition.Replicas, leaderText(partition.LeaderID))
		}
	}
	endpoints := map[uint32]string{}
	for id, address := range d.client {
		endpoints[id] = "http://" + address
	}
	cluster, err := client.NewClusterTransport(&http.Client{Timeout: 10 * time.Second}, endpoints)
	if err != nil {
		return err
	}
	lossy := &lossyTransport{Transport: cluster}
	producer, err := d.openProducer(cluster, lossy)
	if err != nil {
		return err
	}

	step("2. Produce with acks=all through the partition leader")
	if err := send(producer, "order-1", "order-2", "order-3"); err != nil {
		return err
	}

	step("3. Lose a reply: the SDK resends the identical batch")
	lossy.armed.Store(true)
	if err := send(producer, "order-4"); err != nil {
		return err
	}

	step("4. Consume with group demo-readers (two members)")
	processed := map[string]int{}
	consumers := []*client.GroupConsumer{}
	for _, member := range []string{"reader-1", "reader-2"} {
		consumer, err := newConsumer(cluster, member, processed)
		if err != nil {
			return err
		}
		consumers = append(consumers, consumer)
	}
	if err := pollUntil(consumers, func() bool { return len(processed) == 4 }); err != nil {
		return err
	}
	describe(consumers)

	step("5. Kill the leader of events/0; a follower takes over and the old leader catches up")
	if err := d.killLeaderAndProduce(producer); err != nil {
		return err
	}

	step("6. Rebalance: a third member joins")
	third, err := newConsumer(cluster, "reader-3", processed)
	if err != nil {
		return err
	}
	consumers = append(consumers, third)
	if err := pollUntil(consumers, func() bool { return allStable(consumers) && processed["order-5"] > 0 }); err != nil {
		return err
	}
	describe(consumers)

	step("7. Restart the group coordinator; members resume from committed offsets")
	coordinator, err := d.leader("__mkfk_groups", 0)
	if err != nil {
		return err
	}
	note("coordinator is broker %d; killing and restarting it", coordinator)
	if err := d.compose("kill", fmt.Sprintf("broker-%d", coordinator)); err != nil {
		return err
	}
	if err := send(producer, "order-6"); err != nil {
		return err
	}
	if err := d.compose("start", fmt.Sprintf("broker-%d", coordinator)); err != nil {
		return err
	}
	if err := pollUntil(consumers, func() bool { return processed["order-6"] > 0 && allStable(consumers) }); err != nil {
		return err
	}
	describe(consumers)

	step("8. Result")
	values := make([]string, 0, len(processed))
	for value := range processed {
		values = append(values, value)
	}
	sort.Strings(values)
	for _, value := range values {
		note("%s processed %d time(s)", value, processed[value])
	}
	note("at-least-once: a record processed but not yet committed when its member's session ended is processed again;")
	note("the broker fenced every commit from an older generation. Stop with `make demo-down` (data kept) or DELETE_DATA=1.")
	return nil
}

func (d *demo) openProducer(cluster *client.ClusterTransport, transport client.Transport) (*client.Producer, error) {
	var epoch uint64
	err := waitFor("the producer to open", 30*time.Second, func() bool {
		opened, err := cluster.OpenProducer(context.Background(), "demo-open", protocol.OpenProducerRequest{
			Topic: "events", ProducerID: demoProducer, ExpectedEpoch: -1, RequestID: "demo-open",
		})
		epoch = uint64(opened.Epoch)
		return err == nil
	})
	if err != nil {
		return nil, err
	}
	directory, err := os.MkdirTemp("", "mkfk-demo-ledger-")
	if err != nil {
		return nil, err
	}
	ledger, err := client.NewFileLedger(filepath.Join(directory, "producer.json"))
	if err != nil {
		return nil, err
	}
	note("producer %s opened events/0 at epoch %d", demoProducer, epoch)
	return client.NewProducer(client.ProducerConfig{
		ClusterID: "mkfk-compose", ProducerID: demoProducer, Topic: "events", Epoch: epoch,
		DeliveryTimeout: 15 * time.Second, MaxAttempts: 30, Transport: transport, Ledger: ledger,
	})
}

// send delivers one batch, resuming the same pending batch after an
// unknown outcome instead of creating a new one.
func send(producer *client.Producer, values ...string) error {
	records := make([]client.Record, len(values))
	for index, value := range values {
		records[index] = client.Record{Value: []byte(value)}
	}
	response, err := producer.Send(context.Background(), records)
	for attempt := 0; err != nil && attempt < 5; attempt++ {
		note("outcome unknown (%v); resending the identical batch", err)
		response, err = producer.Resume(context.Background())
	}
	if err != nil {
		return err
	}
	note("%v -> offsets %d..%d (duplicate=%v, next sequence %d)", values, response.BaseOffset, response.LastOffset, response.Duplicate, response.NextSequence)
	return nil
}

func (d *demo) killLeaderAndProduce(producer *client.Producer) error {
	leader, err := d.leader("events", 0)
	if err != nil {
		return err
	}
	note("broker %d leads events/0; SIGKILL", leader)
	if err := d.compose("kill", fmt.Sprintf("broker-%d", leader)); err != nil {
		return err
	}
	if err := send(producer, "order-5"); err != nil {
		return err
	}
	successor, err := d.leader("events", 0)
	if err != nil {
		return err
	}
	note("broker %d now leads events/0; restarting broker %d", successor, leader)
	if err := d.compose("start", fmt.Sprintf("broker-%d", leader)); err != nil {
		return err
	}
	if err := d.waitReady(leader); err != nil {
		return err
	}
	return waitFor("the restarted broker to catch up", 30*time.Second, func() bool {
		hw := d.metric(successor, "high_watermark", "events", 0)
		caughtUp := d.metric(leader, "log_end_offset", "events", 0) >= hw && hw == 5
		if caughtUp {
			note("broker %d holds all %d committed records again", leader, hw)
		}
		return caughtUp
	})
}

func leaderText(id *uint32) string {
	if id == nil {
		return "none yet"
	}
	return fmt.Sprintf("broker %d", *id)
}

func newConsumer(cluster *client.ClusterTransport, member string, processed map[string]int) (*client.GroupConsumer, error) {
	return client.NewGroupConsumer(client.ConsumerConfig{
		GroupID: "demo-readers", MemberID: member, Topics: []string{"events"}, Transport: cluster,
		Process: func(_ context.Context, message client.Message) error {
			processed[string(message.Value)]++
			return nil
		},
	})
}

func pollUntil(consumers []*client.GroupConsumer, done func() bool) error {
	return waitFor("the consumers", 60*time.Second, func() bool {
		for _, consumer := range consumers {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			_ = consumer.Poll(ctx)
			cancel()
		}
		return done()
	})
}

func allStable(consumers []*client.GroupConsumer) bool {
	for _, consumer := range consumers {
		if consumer.Assignment() == nil {
			return false
		}
	}
	return true
}

func describe(consumers []*client.GroupConsumer) {
	for index, consumer := range consumers {
		partitions := []uint32{}
		for _, partition := range consumer.Assignment() {
			partitions = append(partitions, partition.Partition)
		}
		note("reader-%d: generation %d, events partitions %v", index+1, consumer.Generation(), partitions)
	}
}
