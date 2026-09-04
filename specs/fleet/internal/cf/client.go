package cf

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/fallrising/fleet-catalog/internal/config"
	"github.com/fallrising/fleet-catalog/internal/ingress"
	"github.com/fallrising/fleet-catalog/internal/store"
)

const defaultAPI = "https://api.cloudflare.com/client/v4"

type Client struct {
	cfg    config.Fleetd
	st     *store.Store
	http   *http.Client
	base   string
	log    *slog.Logger
	mu     sync.Mutex // cfMu — serialize all CF writes
}

func New(cfg config.Fleetd, st *store.Store, log *slog.Logger) *Client {
	if log == nil {
		log = slog.Default()
	}
	return &Client{
		cfg:  cfg,
		st:   st,
		http: &http.Client{Timeout: 30 * time.Second},
		base: defaultAPI,
		log:  log,
	}
}

func (c *Client) SetBase(u string) { c.base = strings.TrimRight(u, "/") }

func (c *Client) do(ctx context.Context, method, path string, body any, q url.Values) (json.RawMessage, error) {
	u := c.base + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rdr = bytes.NewReader(b)
	}
	var resp *http.Response
	var lastErr error
	for attempt := 0; attempt < 4; attempt++ {
		if rdr != nil {
			if br, ok := rdr.(*bytes.Reader); ok {
				_, _ = br.Seek(0, io.SeekStart)
			}
		}
		req, err := http.NewRequestWithContext(ctx, method, u, rdr)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+c.cfg.CFAPIToken)
		req.Header.Set("Content-Type", "application/json")
		resp, lastErr = c.http.Do(req)
		if lastErr != nil {
			return nil, lastErr
		}
		if resp.StatusCode != http.StatusTooManyRequests {
			break
		}
		_ = resp.Body.Close()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Duration(1<<attempt) * time.Second):
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	if resp == nil {
		return nil, fmt.Errorf("cf %s %s: empty response", method, path)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	var wrap struct {
		Success bool            `json:"success"`
		Result  json.RawMessage `json:"result"`
		Errors  []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(b, &wrap); err != nil {
		if resp.StatusCode >= 300 {
			return nil, fmt.Errorf("cf %s %s: http %d %s", method, path, resp.StatusCode, bytes.TrimSpace(b))
		}
		return b, nil
	}
	if resp.StatusCode == http.StatusNotFound {
		return wrap.Result, fmt.Errorf("cf_not_found")
	}
	if !wrap.Success && resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(b))
		if len(wrap.Errors) > 0 {
			msg = wrap.Errors[0].Message
		}
		return wrap.Result, fmt.Errorf("cf %s %s: %s", method, path, msg)
	}
	return wrap.Result, nil
}

func (c *Client) EnsureNodeTunnel(ctx context.Context, nodeID string) (string, string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	name := "fleet-" + nodeID
	if n, err := c.st.GetNode(nodeID); err == nil && n.TunnelID != "" {
		if n.TunnelID == c.cfg.BootstrapTunnelID {
			return "", "", fmt.Errorf("bootstrap tunnel cannot be a node tunnel")
		}
		tok, err := c.getToken(ctx, n.TunnelID)
		return n.TunnelID, tok, err
	}
	id, tok, err := c.findTunnel(ctx, name)
	if err == nil && id != "" {
		if id == c.cfg.BootstrapTunnelID {
			return "", "", fmt.Errorf("refusing bootstrap tunnel id")
		}
		if tok == "" {
			tok, _ = c.getToken(ctx, id)
		}
		return id, tok, nil
	}
	res, err := c.do(ctx, http.MethodPost, "/accounts/"+c.cfg.CFAccountID+"/cfd_tunnel", map[string]any{
		"name": name, "config_src": "cloudflare",
	}, nil)
	if err != nil {
		return "", "", err
	}
	var created struct {
		ID    string `json:"id"`
		Token string `json:"token"`
	}
	_ = json.Unmarshal(res, &created)
	if created.ID == "" || created.ID == c.cfg.BootstrapTunnelID {
		return "", "", fmt.Errorf("invalid tunnel id")
	}
	if created.Token == "" {
		created.Token, _ = c.getToken(ctx, created.ID)
	}
	// Must not PUT ingress at register time.
	return created.ID, created.Token, nil
}

func (c *Client) findTunnel(ctx context.Context, name string) (string, string, error) {
	res, err := c.do(ctx, http.MethodGet, "/accounts/"+c.cfg.CFAccountID+"/cfd_tunnel", nil, url.Values{"name": []string{name}})
	if err != nil {
		return "", "", err
	}
	var list []struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Token  string `json:"token"`
	}
	if err := json.Unmarshal(res, &list); err != nil {
		var one struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(res, &one) == nil && one.ID != "" {
			return one.ID, "", nil
		}
		return "", "", err
	}
	for _, t := range list {
		if t.Name == name {
			return t.ID, t.Token, nil
		}
	}
	return "", "", fmt.Errorf("not found")
}

func (c *Client) getToken(ctx context.Context, tunnelID string) (string, error) {
	res, err := c.do(ctx, http.MethodGet, "/accounts/"+c.cfg.CFAccountID+"/cfd_tunnel/"+tunnelID+"/token", nil, nil)
	if err != nil {
		return "", err
	}
	var s string
	if json.Unmarshal(res, &s) == nil && s != "" {
		return s, nil
	}
	var obj struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(res, &obj)
	return obj.Token, nil
}

func (c *Client) ReissueTunnelToken(ctx context.Context, tunnelID string) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if tunnelID == "" || tunnelID == c.cfg.BootstrapTunnelID {
		return "", fmt.Errorf("invalid tunnel")
	}
	return c.getToken(ctx, tunnelID)
}

func (c *Client) EnsureOTPProvider(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, err := c.do(ctx, http.MethodPost, "/accounts/"+c.cfg.CFAccountID+"/access/identity_providers", map[string]any{
		"type": "onetimepin", "config": map[string]any{},
	}, nil)
	if err != nil && !strings.Contains(err.Error(), "already") {
		return err
	}
	return nil
}

func (c *Client) RunWorkers(ctx context.Context) {
	go func() {
		t := time.NewTicker(60 * time.Second)
		defer t.Stop()
		for {
			if err := c.EnsureOTPProvider(ctx); err != nil {
				c.log.Error("cf_error", "err", err.Error())
			}
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
		}
	}()
	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				c.drift(ctx)
			}
		}
	}()
}

var _ ingress.Reconciler = (*Client)(nil)
