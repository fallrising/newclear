package agentloop

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/fallrising/fleet-catalog/internal/agentclient"
)

type FleetAPI interface {
	Register(ctx context.Context, bootstrap, nodeID, display, instanceID string) (agentToken, tunnelToken string, err error)
	Heartbeat(ctx context.Context, token, nodeID string, hb agentclient.Heartbeat) error
	GetDesired(ctx context.Context, token, nodeID string) (*agentclient.Desired, error)
	PostActual(ctx context.Context, token, nodeID string, act agentclient.Actual) error
}

type HTTPFleet struct {
	Base   string
	Client *http.Client
}

func (h *HTTPFleet) url(path string) string {
	return strings.TrimRight(h.Base, "/") + path
}

func (h *HTTPFleet) do(ctx context.Context, method, path, token string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, h.url(path), rdr)
	if err != nil {
		return err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	cli := h.Client
	if cli == nil {
		cli = http.DefaultClient
	}
	resp, err := cli.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusConflict && bytes.Contains(b, []byte("agent_lease_held")) {
		return ErrLeaseHeld
	}
	if resp.StatusCode >= 300 {
		return fmt.Errorf("http %d: %s", resp.StatusCode, bytes.TrimSpace(b))
	}
	if out != nil && len(b) > 0 {
		return json.Unmarshal(b, out)
	}
	return nil
}

var ErrLeaseHeld = fmt.Errorf("agent_lease_held")

func (h *HTTPFleet) Register(ctx context.Context, bootstrap, nodeID, display, instanceID string) (string, string, error) {
	var out struct {
		AgentToken  string `json:"agent_token"`
		TunnelToken string `json:"tunnel_token"`
	}
	err := h.do(ctx, http.MethodPost, "/api/v1/nodes/register", bootstrap, map[string]any{
		"id": nodeID, "display_name": display, "agent_instance_id": instanceID,
	}, &out)
	return out.AgentToken, out.TunnelToken, err
}

func (h *HTTPFleet) Heartbeat(ctx context.Context, token, nodeID string, hb agentclient.Heartbeat) error {
	return h.do(ctx, http.MethodPost, "/api/v1/nodes/"+nodeID+"/heartbeat", token, hb, nil)
}

func (h *HTTPFleet) GetDesired(ctx context.Context, token, _ string) (*agentclient.Desired, error) {
	var d agentclient.Desired
	if err := h.do(ctx, http.MethodGet, "/api/v1/agent/desired", token, nil, &d); err != nil {
		return nil, err
	}
	return &d, nil
}

func (h *HTTPFleet) PostActual(ctx context.Context, token, nodeID string, act agentclient.Actual) error {
	act.NodeID = nodeID
	return h.do(ctx, http.MethodPost, "/api/v1/agent/actual", token, act, nil)
}

func defaultHTTP() *http.Client {
	return &http.Client{Timeout: 30 * time.Second}
}
