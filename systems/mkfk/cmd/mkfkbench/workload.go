package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/pkg/client"
)

// workload is one measured run: closed-loop idempotent producers, acks=all,
// fixed-size records, then a read-back of every committed record.
type workload struct {
	Partitions            int           `json:"partitions"`
	Batch                 int           `json:"batch_records"`
	RecordBytes           int           `json:"record_bytes"`
	ProducersPerPartition int           `json:"producers_per_partition"`
	Warmup                time.Duration `json:"-"`
	Duration              time.Duration `json:"-"`
}

type latency struct {
	Count int64   `json:"count"`
	P50   float64 `json:"p50_ms"`
	P95   float64 `json:"p95_ms"`
	P99   float64 `json:"p99_ms"`
	Max   float64 `json:"max_ms"`
}

type measurement struct {
	ProducedRecords int64          `json:"produced_records"`
	RecordsPerSec   float64        `json:"produce_records_per_sec"`
	BytesPerSec     float64        `json:"produce_bytes_per_sec"`
	Produce         latency        `json:"produce_latency"`
	ProduceErrors   map[string]int `json:"produce_errors"`
	FetchedRecords  int64          `json:"fetched_records"`
	FetchPerSec     float64        `json:"fetch_records_per_sec"`
	Fetch           latency        `json:"fetch_latency"`
}

func summarize(samples []time.Duration) latency {
	if len(samples) == 0 {
		return latency{}
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
	at := func(q float64) float64 {
		return float64(samples[int(q*float64(len(samples)-1))].Microseconds()) / 1000
	}
	return latency{Count: int64(len(samples)), P50: at(0.50), P95: at(0.95), P99: at(0.99), Max: at(1)}
}

// recorder collects what producers saw inside the measurement window.
type recorder struct {
	mu        sync.Mutex
	latencies []time.Duration
	records   int64
	errors    map[string]int
}

func (r *recorder) success(elapsed time.Duration, records int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.latencies = append(r.latencies, elapsed)
	r.records += int64(records)
}

func (r *recorder) failure(err error) {
	code := "TRANSPORT"
	var response *client.ResponseError
	if errors.As(err, &response) {
		code = response.API.Code
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.errors[code]++
}

// produce runs every producer until the window ends. run numbers producer
// IDs so repeated runs on one cluster never reuse an identity.
func produce(transport *client.ClusterTransport, w workload, run int, windowStart, windowEnd time.Time) (*recorder, error) {
	value := base64.StdEncoding.EncodeToString(make([]byte, w.RecordBytes))
	records := make([]protocol.WireRecord, w.Batch)
	for index := range records {
		records[index] = protocol.WireRecord{KeyBase64: json.RawMessage("null"), ValueBase64: &value}
	}
	measured := &recorder{errors: map[string]int{}}
	var wg sync.WaitGroup
	errs := make(chan error, w.Partitions*w.ProducersPerPartition)
	for partition := 0; partition < w.Partitions; partition++ {
		for index := 0; index < w.ProducersPerPartition; index++ {
			producerID := fmt.Sprintf("%08x-%04x-4000-8000-%012x", run, partition, index)
			wg.Add(1)
			go func() {
				defer wg.Done()
				errs <- produceLoop(transport, uint32(partition), producerID, records, measured, windowStart, windowEnd)
			}()
		}
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			return nil, err
		}
	}
	return measured, nil
}

func produceLoop(transport *client.ClusterTransport, partition uint32, producerID string, records []protocol.WireRecord,
	measured *recorder, windowStart, windowEnd time.Time) error {
	var epoch protocol.DecimalUint64
	for {
		opened, err := transport.OpenProducer(context.Background(), "open-"+producerID, protocol.OpenProducerRequest{
			Topic: "events", Partition: partition, ProducerID: producerID, ExpectedEpoch: -1, RequestID: "open-" + producerID,
		})
		if err == nil {
			epoch = opened.Epoch
			break
		}
		if time.Now().After(windowStart) {
			return fmt.Errorf("producer %s could not open: %w", producerID, err)
		}
		time.Sleep(100 * time.Millisecond)
	}
	var sequence uint64
	for batch := 0; time.Now().Before(windowEnd); batch++ {
		request := protocol.ProduceRequest{
			Topic: "events", Partition: partition, ProducerID: producerID, Epoch: epoch,
			FirstSequence: protocol.DecimalUint64(sequence), Acks: "all", Records: records,
		}
		requestID := fmt.Sprintf("b%d-%s", batch, producerID[len(producerID)-12:])
		for {
			started := time.Now()
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			response, err := transport.Produce(ctx, requestID, request)
			cancel()
			inWindow := started.After(windowStart) && started.Before(windowEnd)
			if err == nil {
				if inWindow {
					measured.success(time.Since(started), len(records))
				}
				sequence = uint64(response.NextSequence)
				break
			}
			if inWindow {
				measured.failure(err)
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	return nil
}

// readBack fetches each partition from offset 0 to its high watermark.
func readBack(transport *client.ClusterTransport, partitions int) (int64, time.Duration, []time.Duration, error) {
	var mu sync.Mutex
	var total int64
	var latencies []time.Duration
	var firstErr error
	started := time.Now()
	var wg sync.WaitGroup
	for partition := 0; partition < partitions; partition++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for offset := uint64(0); ; {
				began := time.Now()
				fetched, err := transport.Fetch(context.Background(), fmt.Sprintf("read-%d-%d", partition, offset), protocol.FetchRequest{
					Topic: "events", Partition: uint32(partition), Offset: protocol.DecimalUint64(offset), MaxBytes: 1 << 20,
				})
				elapsed := time.Since(began)
				mu.Lock()
				if err != nil && firstErr == nil {
					firstErr = err
				}
				if err == nil {
					latencies = append(latencies, elapsed)
					total += int64(len(fetched.Records))
				}
				mu.Unlock()
				if err != nil || len(fetched.Records) == 0 || uint64(fetched.NextOffset) >= uint64(fetched.HighWatermark) {
					return
				}
				offset = uint64(fetched.NextOffset)
			}
		}()
	}
	wg.Wait()
	return total, time.Since(started), latencies, firstErr
}
