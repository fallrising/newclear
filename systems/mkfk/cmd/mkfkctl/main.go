package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
	"github.com/fallrising/newclear/systems/mkfk/pkg/client"
)

var commandHTTPClient client.HTTPDoer

func main() {
	if err := run(os.Args[1:]); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(arguments []string) error {
	if len(arguments) == 0 {
		return errors.New("usage: mkfkctl <open-producer|produce> [flags]")
	}
	switch arguments[0] {
	case "open-producer":
		return runOpen(arguments[1:])
	case "produce":
		return runProduce(arguments[1:])
	default:
		return fmt.Errorf("unknown command %q", arguments[0])
	}
}

type commonFlags struct {
	brokers    string
	brokerID   uint
	clusterID  string
	producerID string
	topic      string
	partition  uint
	ledgerPath string
	timeout    time.Duration
}

func addCommonFlags(flags *flag.FlagSet, common *commonFlags) {
	flags.StringVar(&common.brokers, "brokers", "1=http://127.0.0.1:9092", "comma-separated broker_id=URL allowlist")
	flags.UintVar(&common.brokerID, "broker", 1, "initial known broker ID")
	flags.StringVar(&common.clusterID, "cluster", "", "expected cluster ID")
	flags.StringVar(&common.producerID, "producer", "", "canonical producer UUID")
	flags.StringVar(&common.topic, "topic", "", "user topic")
	flags.UintVar(&common.partition, "partition", 0, "fixed partition")
	flags.StringVar(&common.ledgerPath, "ledger", "", "durable outbound ledger file")
	flags.DurationVar(&common.timeout, "timeout", 5*time.Second, "total request deadline")
}

func runOpen(arguments []string) error {
	flags := flag.NewFlagSet("open-producer", flag.ContinueOnError)
	var common commonFlags
	addCommonFlags(flags, &common)
	expectedEpoch := flags.Int64("expected-epoch", -1, "compare-and-set expected epoch")
	requestID := flags.String("request-id", "", "durable OpenProducer request ID")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	ledger, transport, err := common.openResources()
	if err != nil {
		return err
	}
	if existing, exists, err := ledger.Load(); err != nil {
		return err
	} else if exists {
		if existing.Pending != nil {
			return errors.New("cannot fence a producer while the outbound ledger has an unresolved batch")
		}
		if existing.ClusterID != common.clusterID || existing.ProducerID != common.producerID || existing.Topic != common.topic || existing.Partition != uint32(common.partition) {
			return errors.New("existing ledger identity does not match command flags")
		}
	}
	request := protocol.OpenProducerRequest{
		Topic: common.topic, Partition: uint32(common.partition), ProducerID: common.producerID,
		ExpectedEpoch: protocol.DecimalInt64(*expectedEpoch), RequestID: *requestID,
	}
	if err := request.Validate(); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), common.timeout)
	defer cancel()
	response, err := transport.OpenProducer(ctx, *requestID, request)
	if err != nil {
		return err
	}
	if response.ProducerID != common.producerID {
		return errors.New("OpenProducer response producer_id does not match the request")
	}
	state := client.LedgerState{
		Version: client.LedgerVersion, ClusterID: common.clusterID, ProducerID: common.producerID,
		Topic: common.topic, Partition: uint32(common.partition), Epoch: uint64(response.Epoch), NextSequence: 0,
	}
	if err := ledger.Save(state); err != nil {
		return fmt.Errorf("OpenProducer succeeded but ledger initialization failed: %w", err)
	}
	return json.NewEncoder(os.Stdout).Encode(protocol.OpenProducerResponse{RequestID: *requestID, Data: response})
}

func runProduce(arguments []string) error {
	flags := flag.NewFlagSet("produce", flag.ContinueOnError)
	var common commonFlags
	addCommonFlags(flags, &common)
	epoch := flags.Uint64("epoch", 0, "current producer epoch")
	keyBase64 := flags.String("key-base64", "null", "base64 key, or literal null")
	valueBase64 := flags.String("value-base64", "", "base64 record value")
	maxAttempts := flags.Int("max-attempts", 8, "bounded delivery attempts")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	ledger, transport, err := common.openResources()
	if err != nil {
		return err
	}
	producer, err := client.NewProducer(client.ProducerConfig{
		ClusterID: common.clusterID, ProducerID: common.producerID, Topic: common.topic,
		Partition: uint32(common.partition), Epoch: *epoch, DeliveryTimeout: common.timeout,
		MaxAttempts: *maxAttempts, Transport: transport, Ledger: ledger,
	})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), common.timeout)
	defer cancel()
	var response protocol.ProduceResponseData
	if producer.State().Pending != nil {
		response, err = producer.Resume(ctx)
	} else {
		var key []byte
		if *keyBase64 != "null" {
			key, err = base64.StdEncoding.Strict().DecodeString(*keyBase64)
			if err != nil {
				return fmt.Errorf("decode key-base64: %w", err)
			}
		}
		value, decodeErr := base64.StdEncoding.Strict().DecodeString(*valueBase64)
		if decodeErr != nil {
			return fmt.Errorf("decode value-base64: %w", decodeErr)
		}
		response, err = producer.Send(ctx, []client.Record{{Key: key, Value: value}})
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(protocol.ProduceResponse{RequestID: "ledger", Data: response})
}

func (common commonFlags) openResources() (*client.FileLedger, *client.HTTPTransport, error) {
	if common.clusterID == "" || common.producerID == "" || common.topic == "" || common.ledgerPath == "" {
		return nil, nil, errors.New("cluster, producer, topic, and ledger flags are required")
	}
	if common.brokerID == 0 || common.brokerID > uint(^uint32(0)) || common.partition > uint(^uint32(0)) {
		return nil, nil, errors.New("broker and partition must fit positive uint32 IDs")
	}
	endpoints, err := parseBrokerEndpoints(common.brokers)
	if err != nil {
		return nil, nil, err
	}
	transport, err := client.NewHTTPTransport(commandHTTPClient, endpoints, uint32(common.brokerID))
	if err != nil {
		return nil, nil, err
	}
	ledger, err := client.NewFileLedger(common.ledgerPath)
	if err != nil {
		return nil, nil, err
	}
	return ledger, transport, nil
}

func parseBrokerEndpoints(value string) (map[uint32]string, error) {
	result := make(map[uint32]string)
	for _, item := range strings.Split(value, ",") {
		parts := strings.SplitN(item, "=", 2)
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid broker endpoint %q", item)
		}
		brokerID, err := strconv.ParseUint(parts[0], 10, 32)
		if err != nil || brokerID == 0 || parts[1] == "" {
			return nil, fmt.Errorf("invalid broker endpoint %q", item)
		}
		if _, duplicate := result[uint32(brokerID)]; duplicate {
			return nil, fmt.Errorf("duplicate broker ID %d", brokerID)
		}
		result[uint32(brokerID)] = parts[1]
	}
	return result, nil
}
