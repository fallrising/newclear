package peer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/fallrising/newclear/systems/mkfk/internal/jsonstrict"
	"github.com/fallrising/newclear/systems/mkfk/internal/raft"
)

// Client calls one peer broker. It implements partition.Remote.
type Client struct {
	http       *http.Client
	base       url.URL
	clusterID  string
	configHash string
}

func NewClient(httpClient *http.Client, peerAddr, clusterID, configHash string) (*Client, error) {
	if httpClient == nil || peerAddr == "" || clusterID == "" || configHash == "" {
		return nil, errors.New("HTTP client, peer address, cluster ID, and config hash are required")
	}
	return &Client{http: httpClient, base: url.URL{Scheme: "http", Host: peerAddr}, clusterID: clusterID, configHash: configHash}, nil
}

// Step sends one request and returns the peer's reply, if any.
func (c *Client) Step(ctx context.Context, request raft.Message) ([]raft.Message, error) {
	wire, err := Encode(request)
	if err != nil {
		return nil, err
	}
	path := PathAppendEntries
	switch {
	case request.Kind == raft.MessageRequestVote:
		path = PathRequestVote
	case request.Kind != raft.MessageAppendEntries:
		return nil, fmt.Errorf("%s is a response; it travels in a reply", request.Kind)
	case request.Append != nil && request.Append.ReadContext != "":
		path = PathReadBarrier
	}
	var response StepResponse
	if err := c.post(ctx, path, wire, &response); err != nil {
		return nil, err
	}
	if response.Reply == nil {
		return nil, nil
	}
	reply, err := Decode(*response.Reply)
	if err != nil {
		return nil, err
	}
	return []raft.Message{reply}, nil
}

// HighWatermark asks the peer for a quorum-confirmed high watermark; a
// follower answers NotLeaderError with its leader hint.
func (c *Client) HighWatermark(ctx context.Context, topic string, partition uint32) (uint64, error) {
	var response HighWatermarkResponse
	err := c.post(ctx, PathHighWatermark, HighWatermarkRequest{
		ClusterID: c.clusterID, ConfigHash: c.configHash, Partition: Partition{Topic: topic, ID: partition},
	}, &response)
	return uint64(response.HighWatermark), err
}

func (c *Client) post(ctx context.Context, path string, body, out any) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	target := c.base
	target.Path = path
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, MaxBodyBytes+1))
	if err != nil {
		return err
	}
	if len(data) > MaxBodyBytes {
		return errors.New("peer response exceeds its cap")
	}
	if response.StatusCode != http.StatusOK {
		var failure ErrorBody
		if err := jsonstrict.Decode(data, &failure); err != nil {
			return fmt.Errorf("peer answered HTTP %d", response.StatusCode)
		}
		if failure.Error.Code == "NOT_LEADER" {
			return &NotLeaderError{LeaderID: failure.Error.LeaderID}
		}
		return fmt.Errorf("peer answered %s: %s", failure.Error.Code, failure.Error.Message)
	}
	return jsonstrict.Decode(data, out)
}
