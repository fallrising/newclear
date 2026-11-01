package client

import (
	"context"
	"errors"
	"math"
	"sort"
	"strconv"
	"sync"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

// ClusterTransport sends each call to the broker that can serve it: the
// observed leader of a data partition, or the group coordinator. A
// NOT_LEADER or NOT_COORDINATOR answer (outcome not_applied) moves the route
// to the hinted broker, or to the next broker, and is retried at once. A
// connection error also moves the route but is returned: its outcome is
// unknown, and the caller's retry resends the identical request.
type ClusterTransport struct {
	brokers map[uint32]*HTTPTransport
	order   []uint32

	mu          sync.Mutex
	leaders     map[protocol.TopicPartition]uint32
	coordinator uint32
}

func NewClusterTransport(client HTTPDoer, endpoints map[uint32]string) (*ClusterTransport, error) {
	if len(endpoints) == 0 {
		return nil, errors.New("at least one broker endpoint is required")
	}
	cluster := &ClusterTransport{brokers: make(map[uint32]*HTTPTransport), leaders: make(map[protocol.TopicPartition]uint32)}
	for id, endpoint := range endpoints {
		transport, err := NewHTTPTransport(client, map[uint32]string{id: endpoint}, id)
		if err != nil {
			return nil, err
		}
		cluster.brokers[id] = transport
		cluster.order = append(cluster.order, id)
	}
	sort.Slice(cluster.order, func(i, j int) bool { return cluster.order[i] < cluster.order[j] })
	cluster.coordinator = cluster.order[0]
	return cluster, nil
}

// coordinatorRoute is the route key for group calls.
var coordinatorRoute = protocol.TopicPartition{Topic: "__mkfk_groups"}

func (c *ClusterTransport) target(key protocol.TopicPartition) uint32 {
	c.mu.Lock()
	defer c.mu.Unlock()
	if key == coordinatorRoute {
		return c.coordinator
	}
	if id, ok := c.leaders[key]; ok {
		return id
	}
	return c.order[0]
}

func (c *ClusterTransport) move(key protocol.TopicPartition, from, to uint32) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, known := c.brokers[to]; !known || to == from {
		to = c.next(from)
	}
	if key == coordinatorRoute {
		c.coordinator = to
		return
	}
	c.leaders[key] = to
}

func (c *ClusterTransport) next(from uint32) uint32 {
	for index, id := range c.order {
		if id == from {
			return c.order[(index+1)%len(c.order)]
		}
	}
	return c.order[0]
}

// route runs call on the routed broker and follows routing answers for at
// most one pass over the cluster.
func route[Data any](c *ClusterTransport, key protocol.TopicPartition, call func(*HTTPTransport) (Data, error)) (Data, error) {
	var data Data
	var err error
	for attempt := 0; attempt < len(c.order); attempt++ {
		id := c.target(key)
		data, err = call(c.brokers[id])
		var response *ResponseError
		if !errors.As(err, &response) {
			if err != nil {
				c.move(key, id, 0)
			}
			return data, err
		}
		if response.API.Code != "NOT_LEADER" && response.API.Code != "NOT_COORDINATOR" {
			return data, err
		}
		c.move(key, id, hintedBroker(response.API.Details))
	}
	return data, err
}

func hintedBroker(details map[string]any) uint32 {
	switch value := details["leader_id"].(type) {
	case float64:
		if value > 0 && value <= math.MaxUint32 && math.Trunc(value) == value {
			return uint32(value)
		}
	case string:
		if parsed, err := strconv.ParseUint(value, 10, 32); err == nil {
			return uint32(parsed)
		}
	}
	return 0
}

func partitionRoute(topic string, partition uint32) protocol.TopicPartition {
	return protocol.TopicPartition{Topic: topic, Partition: partition}
}

func (c *ClusterTransport) Produce(ctx context.Context, requestID string, request protocol.ProduceRequest) (protocol.ProduceResponseData, error) {
	return route(c, partitionRoute(request.Topic, request.Partition), func(t *HTTPTransport) (protocol.ProduceResponseData, error) {
		return t.Produce(ctx, requestID, request)
	})
}

func (c *ClusterTransport) OpenProducer(ctx context.Context, requestID string, request protocol.OpenProducerRequest) (protocol.OpenProducerResponseData, error) {
	return route(c, partitionRoute(request.Topic, request.Partition), func(t *HTTPTransport) (protocol.OpenProducerResponseData, error) {
		return t.OpenProducer(ctx, requestID, request)
	})
}

func (c *ClusterTransport) Fetch(ctx context.Context, requestID string, request protocol.FetchRequest) (protocol.FetchResponseData, error) {
	return route(c, partitionRoute(request.Topic, request.Partition), func(t *HTTPTransport) (protocol.FetchResponseData, error) {
		return t.Fetch(ctx, requestID, request)
	})
}

func (c *ClusterTransport) JoinGroup(ctx context.Context, requestID, groupID string, request protocol.JoinGroupRequest) (protocol.JoinGroupResponseData, error) {
	return route(c, coordinatorRoute, func(t *HTTPTransport) (protocol.JoinGroupResponseData, error) {
		return t.JoinGroup(ctx, requestID, groupID, request)
	})
}

func (c *ClusterTransport) SyncGroup(ctx context.Context, requestID, groupID string, request protocol.SyncGroupRequest) (protocol.SyncGroupResponseData, error) {
	return route(c, coordinatorRoute, func(t *HTTPTransport) (protocol.SyncGroupResponseData, error) {
		return t.SyncGroup(ctx, requestID, groupID, request)
	})
}

func (c *ClusterTransport) Heartbeat(ctx context.Context, requestID, groupID string, request protocol.HeartbeatRequest) (protocol.HeartbeatResponseData, error) {
	return route(c, coordinatorRoute, func(t *HTTPTransport) (protocol.HeartbeatResponseData, error) {
		return t.Heartbeat(ctx, requestID, groupID, request)
	})
}

func (c *ClusterTransport) LeaveGroup(ctx context.Context, requestID, groupID string, request protocol.LeaveGroupRequest) (protocol.LeaveGroupResponseData, error) {
	return route(c, coordinatorRoute, func(t *HTTPTransport) (protocol.LeaveGroupResponseData, error) {
		return t.LeaveGroup(ctx, requestID, groupID, request)
	})
}

func (c *ClusterTransport) CommitOffsets(ctx context.Context, requestID, groupID string, request protocol.CommitOffsetsRequest) (protocol.CommitOffsetsResponseData, error) {
	return route(c, coordinatorRoute, func(t *HTTPTransport) (protocol.CommitOffsetsResponseData, error) {
		return t.CommitOffsets(ctx, requestID, groupID, request)
	})
}

func (c *ClusterTransport) CommittedOffsets(ctx context.Context, requestID, groupID string, partitions []protocol.TopicPartition) (protocol.GetOffsetsResponseData, error) {
	return route(c, coordinatorRoute, func(t *HTTPTransport) (protocol.GetOffsetsResponseData, error) {
		return t.CommittedOffsets(ctx, requestID, groupID, partitions)
	})
}

var (
	_ Transport      = (*ClusterTransport)(nil)
	_ GroupTransport = (*ClusterTransport)(nil)
)
