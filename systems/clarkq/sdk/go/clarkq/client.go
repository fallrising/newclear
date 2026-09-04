// Package clarkq is a minimal HTTP client for the clarkQ message queue service.
package clarkq

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Client talks to a clarkQ server.
type Client struct {
	BaseURL    string
	APIKey     string // sent as X-API-Key when set
	BearerToken string // sent as Authorization: Bearer when set (JWT / OIDC access token)
	HTTPClient *http.Client
}

// Message is a queue message returned by the API.
type Message struct {
	ID         string            `json:"id"`
	Queue      string            `json:"queue"`
	Body       string            `json:"body"`
	Metadata   map[string]string `json:"metadata,omitempty"`
	Encryption *EncryptionMeta   `json:"encryption,omitempty"`
	CreatedAt  time.Time         `json:"created_at"`
}

// EncryptionMeta mirrors server encryption metadata.
type EncryptionMeta struct {
	Mode         string `json:"mode,omitempty"`
	Algorithm    string `json:"algorithm,omitempty"`
	KeyID        string `json:"key_id,omitempty"`
	Nonce        string `json:"nonce,omitempty"`
	EncryptedKey string `json:"encrypted_key,omitempty"`
}

// EnqueueResult is returned after a successful write.
type EnqueueResult struct {
	ID        string    `json:"id"`
	Queue     string    `json:"queue"`
	CreatedAt time.Time `json:"created_at"`
}

// QueueInfo is one entry from ListQueues.
type QueueInfo struct {
	Name  string `json:"name"`
	Depth int    `json:"depth"`
}

// APIError is a structured clarkQ error response.
type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("clarkq: %s (%s, http %d)", e.Message, e.Code, e.Status)
}

// New creates a client. baseURL should not include a trailing slash.
func New(baseURL, apiKey string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		APIKey:  apiKey,
		HTTPClient: &http.Client{
			Timeout: 35 * time.Second,
		},
	}
}

// Health checks GET /health.
func (c *Client) Health(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/health", nil)
	if err != nil {
		return err
	}
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health status %d", resp.StatusCode)
	}
	return nil
}

// Enqueue posts a JSON message to a named queue.
func (c *Client) Enqueue(ctx context.Context, queue, body string, metadata map[string]string, enc *EncryptionMeta) (*EnqueueResult, error) {
	payload := map[string]any{"body": body}
	if metadata != nil {
		payload["metadata"] = metadata
	}
	if enc != nil {
		payload["encryption"] = enc
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/v1/queue/"+url.PathEscape(queue), bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	c.setAuth(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		return nil, readAPIError(resp)
	}
	var out EnqueueResult
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ReadOptions control dequeue behavior.
type ReadOptions struct {
	Peek    bool
	Timeout time.Duration // truncated to whole seconds; max 30s server-side
}

// Dequeue consumes (or peeks) one message. Returns (nil, nil) on empty queue (204).
func (c *Client) Dequeue(ctx context.Context, queue string, opts ReadOptions) (*Message, error) {
	u, err := url.Parse(c.BaseURL + "/api/v1/queue/" + url.PathEscape(queue))
	if err != nil {
		return nil, err
	}
	q := u.Query()
	if opts.Peek {
		q.Set("peek", "true")
	}
	if opts.Timeout > 0 {
		q.Set("timeout", strconv.Itoa(int(opts.Timeout.Seconds())))
	}
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	c.setAuth(req)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusNoContent:
		return nil, nil
	case http.StatusOK:
		var msg Message
		if err := json.NewDecoder(resp.Body).Decode(&msg); err != nil {
			return nil, err
		}
		return &msg, nil
	default:
		return nil, readAPIError(resp)
	}
}

// Clear removes all messages from a queue.
func (c *Client) Clear(ctx context.Context, queue string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.BaseURL+"/api/v1/queue/"+url.PathEscape(queue), nil)
	if err != nil {
		return 0, err
	}
	c.setAuth(req)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, readAPIError(resp)
	}
	var out struct {
		Cleared int `json:"cleared"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return 0, err
	}
	return out.Cleared, nil
}

// ListQueues returns queue names and depths.
func (c *Client) ListQueues(ctx context.Context) ([]QueueInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/api/v1/queues", nil)
	if err != nil {
		return nil, err
	}
	c.setAuth(req)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, readAPIError(resp)
	}
	var out struct {
		Queues []QueueInfo `json:"queues"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return out.Queues, nil
}

func (c *Client) setAuth(req *http.Request) {
	if c.APIKey != "" {
		req.Header.Set("X-API-Key", c.APIKey)
	}
	if c.BearerToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.BearerToken)
	}
}

func readAPIError(resp *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err == nil && payload.Error.Code != "" {
		return &APIError{Status: resp.StatusCode, Code: payload.Error.Code, Message: payload.Error.Message}
	}
	return &APIError{Status: resp.StatusCode, Code: "HTTP_ERROR", Message: strings.TrimSpace(string(body))}
}
