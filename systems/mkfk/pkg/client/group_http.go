package client

import (
	"context"
	"errors"
	"net/url"

	"github.com/fallrising/newclear/systems/mkfk/internal/protocol"
)

// GroupTransport is the broker API a GroupConsumer needs.
type GroupTransport interface {
	JoinGroup(ctx context.Context, requestID, groupID string, request protocol.JoinGroupRequest) (protocol.JoinGroupResponseData, error)
	SyncGroup(ctx context.Context, requestID, groupID string, request protocol.SyncGroupRequest) (protocol.SyncGroupResponseData, error)
	Heartbeat(ctx context.Context, requestID, groupID string, request protocol.HeartbeatRequest) (protocol.HeartbeatResponseData, error)
	LeaveGroup(ctx context.Context, requestID, groupID string, request protocol.LeaveGroupRequest) (protocol.LeaveGroupResponseData, error)
	CommitOffsets(ctx context.Context, requestID, groupID string, request protocol.CommitOffsetsRequest) (protocol.CommitOffsetsResponseData, error)
	CommittedOffsets(ctx context.Context, requestID, groupID string, partitions []protocol.TopicPartition) (protocol.GetOffsetsResponseData, error)
	Fetch(ctx context.Context, requestID string, request protocol.FetchRequest) (protocol.FetchResponseData, error)
}

func (transport *HTTPTransport) JoinGroup(ctx context.Context, requestID, groupID string, request protocol.JoinGroupRequest) (protocol.JoinGroupResponseData, error) {
	var envelope protocol.JoinGroupResponse
	err := transport.groupPost(ctx, groupID, "join", requestID, request, &envelope, &envelope.RequestID)
	return envelope.Data, err
}

func (transport *HTTPTransport) SyncGroup(ctx context.Context, requestID, groupID string, request protocol.SyncGroupRequest) (protocol.SyncGroupResponseData, error) {
	var envelope protocol.SyncGroupResponse
	err := transport.groupPost(ctx, groupID, "sync", requestID, request, &envelope, &envelope.RequestID)
	return envelope.Data, err
}

func (transport *HTTPTransport) Heartbeat(ctx context.Context, requestID, groupID string, request protocol.HeartbeatRequest) (protocol.HeartbeatResponseData, error) {
	var envelope protocol.HeartbeatResponse
	err := transport.groupPost(ctx, groupID, "heartbeat", requestID, request, &envelope, &envelope.RequestID)
	return envelope.Data, err
}

func (transport *HTTPTransport) LeaveGroup(ctx context.Context, requestID, groupID string, request protocol.LeaveGroupRequest) (protocol.LeaveGroupResponseData, error) {
	var envelope protocol.LeaveGroupResponse
	err := transport.groupPost(ctx, groupID, "leave", requestID, request, &envelope, &envelope.RequestID)
	return envelope.Data, err
}

func (transport *HTTPTransport) CommitOffsets(ctx context.Context, requestID, groupID string, request protocol.CommitOffsetsRequest) (protocol.CommitOffsetsResponseData, error) {
	var envelope protocol.CommitOffsetsResponse
	err := transport.groupPost(ctx, groupID, "offsets/commit", requestID, request, &envelope, &envelope.RequestID)
	return envelope.Data, err
}

func (transport *HTTPTransport) CommittedOffsets(ctx context.Context, requestID, groupID string, partitions []protocol.TopicPartition) (protocol.GetOffsetsResponseData, error) {
	if err := protocol.ValidateGroupID(groupID); err != nil {
		return protocol.GetOffsetsResponseData{}, err
	}
	var envelope protocol.GetOffsetsResponse
	path := "/v1/groups/" + url.PathEscape(groupID) + "/offsets"
	if err := transport.get(ctx, path, protocol.OffsetsQuery(partitions), requestID, &envelope); err != nil {
		return protocol.GetOffsetsResponseData{}, err
	}
	return envelope.Data, matchRequestID(envelope.RequestID, requestID)
}

func (transport *HTTPTransport) Fetch(ctx context.Context, requestID string, request protocol.FetchRequest) (protocol.FetchResponseData, error) {
	if err := request.Validate(); err != nil {
		return protocol.FetchResponseData{}, err
	}
	var envelope protocol.FetchResponse
	if err := transport.get(ctx, "/v1/fetch", protocol.FetchQuery(request), requestID, &envelope); err != nil {
		return protocol.FetchResponseData{}, err
	}
	return envelope.Data, matchRequestID(envelope.RequestID, requestID)
}

func (transport *HTTPTransport) groupPost(ctx context.Context, groupID, action, requestID string, body, envelope any, echoed *string) error {
	if err := protocol.ValidateGroupID(groupID); err != nil {
		return err
	}
	if err := transport.post(ctx, "/v1/groups/"+groupID+"/"+action, requestID, body, envelope); err != nil {
		return err
	}
	return matchRequestID(*echoed, requestID)
}

func matchRequestID(echoed, sent string) error {
	if echoed != sent {
		return errors.New("response request_id mismatch")
	}
	return nil
}

var _ GroupTransport = (*HTTPTransport)(nil)
