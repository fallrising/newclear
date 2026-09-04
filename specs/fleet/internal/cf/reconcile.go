package cf

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/fallrising/fleet-catalog/internal/ingress"
)

type ingressRule struct {
	Hostname      string         `json:"hostname,omitempty"`
	Service       string         `json:"service"`
	OriginRequest map[string]any `json:"originRequest,omitempty"`
}

type tunnelConfig struct {
	WarpRouting map[string]any `json:"warp-routing"`
	Ingress     []ingressRule  `json:"ingress"`
}

func (c *Client) ReconcileTunnel(ctx context.Context, tunnelID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.reconcileTunnelLocked(ctx, tunnelID)
}

func (c *Client) reconcileTunnelLocked(ctx context.Context, tunnelID string) error {
	if tunnelID == "" {
		return nil
	}
	if tunnelID == c.cfg.BootstrapTunnelID {
		c.log.Info("skip_bootstrap_tunnel", "tunnel_id", tunnelID)
		return nil
	}
	existing, _ := c.getConfig(ctx, tunnelID)
	catalog := c.catalogRules(tunnelID)
	protected := c.protectedRules(existing)
	seen := map[string]struct{}{}
	var rules []ingressRule
	for _, r := range catalog {
		if r.Hostname == "" {
			continue
		}
		if _, ok := seen[strings.ToLower(r.Hostname)]; ok {
			continue
		}
		seen[strings.ToLower(r.Hostname)] = struct{}{}
		rules = append(rules, r)
	}
	for _, r := range protected {
		if r.Hostname == "" {
			continue
		}
		if _, ok := seen[strings.ToLower(r.Hostname)]; ok {
			continue
		}
		seen[strings.ToLower(r.Hostname)] = struct{}{}
		rules = append(rules, r)
	}
	rules = append(rules, ingressRule{Service: "http_status:404"})
	cfg := tunnelConfig{
		WarpRouting: map[string]any{"enabled": true},
		Ingress:     rules,
	}
	if sameConfig(existing, cfg) {
		return nil
	}
	body := map[string]any{"config": cfg}
	if _, err := c.do(ctx, http.MethodPut, "/accounts/"+c.cfg.CFAccountID+"/cfd_tunnel/"+tunnelID+"/configurations", body, nil); err != nil {
		return err
	}
	c.log.Info("cf_ingress_put", "tunnel_id", tunnelID)
	b, _ := json.Marshal(cfg)
	_ = c.st.SetCFState("ingress:"+tunnelID, "", string(b))
	return nil
}

func (c *Client) getConfig(ctx context.Context, tunnelID string) (tunnelConfig, error) {
	res, err := c.do(ctx, http.MethodGet, "/accounts/"+c.cfg.CFAccountID+"/cfd_tunnel/"+tunnelID+"/configurations", nil, nil)
	if err != nil {
		return tunnelConfig{}, err
	}
	var wrap struct {
		Config tunnelConfig `json:"config"`
	}
	if json.Unmarshal(res, &wrap) == nil && wrap.Config.Ingress != nil {
		return wrap.Config, nil
	}
	var cfg tunnelConfig
	_ = json.Unmarshal(res, &cfg)
	return cfg, nil
}

func (c *Client) catalogRules(tunnelID string) []ingressRule {
	list, err := c.st.ListServices()
	if err != nil {
		return nil
	}
	var rules []ingressRule
	for i := range list {
		svc := list[i]
		if svc.DesiredState == "absent" {
			continue
		}
		n, err := c.st.GetNode(svc.NodeID)
		if err != nil || n.TunnelID != tunnelID {
			continue
		}
		rules = append(rules, ingressRule{
			Hostname: svc.Hostname,
			Service:  fmt.Sprintf("http://127.0.0.1:%d", svc.HostPort),
			OriginRequest: map[string]any{
				"connectTimeout":   30,
				"keepAliveTimeout": 90,
				"noHappyEyeballs":  true,
			},
		})
	}
	return rules
}

func (c *Client) protectedRules(existing tunnelConfig) []ingressRule {
	set := map[string]struct{}{}
	for _, h := range c.cfg.ProtectedHostnames {
		set[strings.ToLower(h)] = struct{}{}
	}
	set[strings.ToLower(c.cfg.UIHostname)] = struct{}{}
	set[strings.ToLower(c.cfg.APIHostname)] = struct{}{}
	var out []ingressRule
	for _, r := range existing.Ingress {
		if r.Hostname != "" {
			if _, ok := set[strings.ToLower(r.Hostname)]; ok {
				out = append(out, r)
			}
		}
	}
	return out
}

func sameConfig(a, b tunnelConfig) bool {
	ab, _ := json.Marshal(canonical(a))
	bb, _ := json.Marshal(canonical(b))
	return string(ab) == string(bb)
}

func canonical(c tunnelConfig) tunnelConfig {
	c.WarpRouting = map[string]any{"enabled": true}
	return c
}

func (c *Client) ReconcileService(ctx context.Context, svc ingress.ServiceView) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if svc.TunnelID == c.cfg.BootstrapTunnelID && svc.TunnelID != "" {
		c.log.Info("skip_bootstrap_tunnel", "service", svc.Name)
		return nil
	}
	row, err := c.st.GetService(svc.Name)
	if err != nil && svc.DesiredState != "absent" {
		return err
	}
	if svc.DesiredState == "absent" || (row != nil && row.DesiredState == "absent") {
		return c.deleteObjects(ctx, svc)
	}
	if err := c.reconcileTunnelLocked(ctx, svc.TunnelID); err != nil {
		_ = c.st.SetIngress(svc.Name, "error", err.Error(), svc.DNSRecordID, svc.AccessAppID, svc.AccessPolicyID, svc.HostnameRouteID)
		return err
	}
	switch svc.ExposeMode {
	case "public":
		dnsID, err := c.upsertDNS(ctx, svc)
		if err != nil {
			_ = c.st.SetIngress(svc.Name, "error", "dns: "+err.Error(), dnsID, "", "", "")
			return err
		}
		_ = c.deleteAccess(ctx, svc)
		_ = c.st.SetIngress(svc.Name, "ok", "", dnsID, "", "", "")
	case "access":
		dnsID, err := c.upsertDNS(ctx, svc)
		if err != nil {
			_ = c.st.SetIngress(svc.Name, "error", "dns: "+err.Error(), dnsID, svc.AccessAppID, svc.AccessPolicyID, "")
			return err
		}
		appID, polID, err := c.upsertAccess(ctx, svc)
		if err != nil {
			_ = c.st.SetIngress(svc.Name, "error", "access_app: "+err.Error(), dnsID, appID, polID, "")
			return err
		}
		_ = c.st.SetIngress(svc.Name, "ok", "", dnsID, appID, polID, "")
	case "private":
		routeID, err := c.upsertHostnameRoute(ctx, svc)
		if err != nil {
			_ = c.st.SetIngress(svc.Name, "error", "hostname_route: "+err.Error(), "", "", "", routeID)
			return err
		}
		_ = c.st.SetIngress(svc.Name, "ok", "", "", "", "", routeID)
	}
	return nil
}

func (c *Client) deleteObjects(ctx context.Context, svc ingress.ServiceView) error {
	_ = c.reconcileTunnelLocked(ctx, svc.TunnelID)
	if svc.DNSRecordID != "" {
		_, _ = c.do(ctx, http.MethodDelete, "/zones/"+c.cfg.CFZoneID+"/dns_records/"+svc.DNSRecordID, nil, nil)
	} else if svc.Hostname != "" && !c.isProtected(svc.Hostname) {
		if id, _ := c.findDNS(ctx, svc.Hostname); id != "" {
			_, _ = c.do(ctx, http.MethodDelete, "/zones/"+c.cfg.CFZoneID+"/dns_records/"+id, nil, nil)
		}
	}
	_ = c.deleteAccess(ctx, svc)
	if svc.HostnameRouteID != "" {
		_, _ = c.do(ctx, http.MethodDelete, "/accounts/"+c.cfg.CFAccountID+"/zerotrust/routes/hostname/"+svc.HostnameRouteID, nil, nil)
	}
	if svc.Name != "" {
		_ = c.st.SetIngress(svc.Name, "na", "", "", "", "", "")
	}
	return nil
}

func (c *Client) isProtected(host string) bool {
	h := strings.ToLower(host)
	if h == strings.ToLower(c.cfg.UIHostname) || h == strings.ToLower(c.cfg.APIHostname) {
		return true
	}
	for _, p := range c.cfg.ProtectedHostnames {
		if strings.ToLower(p) == h {
			return true
		}
	}
	return false
}

func (c *Client) upsertDNS(ctx context.Context, svc ingress.ServiceView) (string, error) {
	if c.isProtected(svc.Hostname) {
		return "", fmt.Errorf("refusing to mutate protected hostname")
	}
	content := svc.TunnelID + ".cfargotunnel.com"
	id, current, _ := c.findDNSFull(ctx, svc.Hostname)
	body := map[string]any{
		"type": "CNAME", "proxied": true, "name": svc.Hostname, "content": content, "comment": "fleet:" + svc.Name,
	}
	if id == "" {
		res, err := c.do(ctx, http.MethodPost, "/zones/"+c.cfg.CFZoneID+"/dns_records", body, nil)
		if err != nil {
			return "", err
		}
		var rec struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(res, &rec)
		return rec.ID, nil
	}
	if current != content {
		_, err := c.do(ctx, http.MethodPut, "/zones/"+c.cfg.CFZoneID+"/dns_records/"+id, body, nil)
		return id, err
	}
	return id, nil
}

func (c *Client) findDNS(ctx context.Context, name string) (string, error) {
	id, _, err := c.findDNSFull(ctx, name)
	return id, err
}

func (c *Client) findDNSFull(ctx context.Context, name string) (id, content string, err error) {
	res, err := c.do(ctx, http.MethodGet, "/zones/"+c.cfg.CFZoneID+"/dns_records", nil, url.Values{"type": []string{"CNAME"}, "name": []string{name}})
	if err != nil {
		return "", "", err
	}
	var list []struct {
		ID      string `json:"id"`
		Name    string `json:"name"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal(res, &list); err != nil {
		return "", "", err
	}
	for _, r := range list {
		if strings.EqualFold(r.Name, name) {
			return r.ID, r.Content, nil
		}
	}
	return "", "", nil
}

func (c *Client) upsertAccess(ctx context.Context, svc ingress.ServiceView) (appID, polID string, err error) {
	appID, err = c.findAccessApp(ctx, svc.Hostname)
	if err != nil {
		appID = ""
	}
	if appID == "" {
		body := map[string]any{
			"name":                      "fleet:" + svc.Name,
			"type":                      "self_hosted",
			"domain":                    svc.Hostname,
			"session_duration":          c.cfg.CFAccessSession,
			"auto_redirect_to_identity": false,
			"app_launcher_visible":      true,
			"destinations":              []map[string]string{{"type": "public", "uri": svc.Hostname}},
		}
		res, err := c.do(ctx, http.MethodPost, "/accounts/"+c.cfg.CFAccountID+"/access/apps", body, nil)
		if err != nil {
			// fallback without destinations
			delete(body, "destinations")
			res, err = c.do(ctx, http.MethodPost, "/accounts/"+c.cfg.CFAccountID+"/access/apps", body, nil)
			if err != nil {
				return "", "", err
			}
		}
		var created struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(res, &created)
		appID = created.ID
	}
	polID, err = c.ensurePolicy(ctx, appID)
	return appID, polID, err
}

func (c *Client) findAccessApp(ctx context.Context, domain string) (string, error) {
	res, err := c.do(ctx, http.MethodGet, "/accounts/"+c.cfg.CFAccountID+"/access/apps", nil, nil)
	if err != nil {
		return "", err
	}
	var list []struct {
		ID     string `json:"id"`
		Domain string `json:"domain"`
		Name   string `json:"name"`
	}
	if err := json.Unmarshal(res, &list); err != nil {
		return "", err
	}
	for _, a := range list {
		if strings.EqualFold(a.Domain, domain) {
			return a.ID, nil
		}
	}
	return "", nil
}

func (c *Client) ensurePolicy(ctx context.Context, appID string) (string, error) {
	res, err := c.do(ctx, http.MethodGet, "/accounts/"+c.cfg.CFAccountID+"/access/apps/"+appID+"/policies", nil, nil)
	if err == nil {
		var list []struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(res, &list) == nil && len(list) > 0 {
			return list[0].ID, nil
		}
	}
	include := []map[string]any{}
	for _, em := range c.cfg.CFAccessAllowedEmails {
		include = append(include, map[string]any{"email": map[string]string{"email": em}})
	}
	if len(include) == 0 {
		include = append(include, map[string]any{"everyone": map[string]any{}})
	}
	res, err = c.do(ctx, http.MethodPost, "/accounts/"+c.cfg.CFAccountID+"/access/apps/"+appID+"/policies", map[string]any{
		"name": "fleet-operator", "decision": "allow", "include": include,
	}, nil)
	if err != nil {
		return "", err
	}
	var created struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(res, &created)
	return created.ID, nil
}

func (c *Client) deleteAccess(ctx context.Context, svc ingress.ServiceView) error {
	id := svc.AccessAppID
	if id == "" && svc.Hostname != "" {
		id, _ = c.findAccessApp(ctx, svc.Hostname)
	}
	if id != "" {
		_, _ = c.do(ctx, http.MethodDelete, "/accounts/"+c.cfg.CFAccountID+"/access/apps/"+id, nil, nil)
	}
	return nil
}

func (c *Client) upsertHostnameRoute(ctx context.Context, svc ingress.ServiceView) (string, error) {
	res, err := c.do(ctx, http.MethodGet, "/accounts/"+c.cfg.CFAccountID+"/zerotrust/routes/hostname", nil, nil)
	if err == nil {
		var list []struct {
			ID       string `json:"id"`
			Hostname string `json:"hostname"`
			TunnelID string `json:"tunnel_id"`
		}
		if json.Unmarshal(res, &list) == nil {
			for _, r := range list {
				if strings.EqualFold(r.Hostname, svc.Hostname) {
					return r.ID, nil
				}
			}
		}
	}
	res, err = c.do(ctx, http.MethodPost, "/accounts/"+c.cfg.CFAccountID+"/zerotrust/routes/hostname", map[string]any{
		"hostname": svc.Hostname, "tunnel_id": svc.TunnelID, "comment": "fleet:" + svc.Name,
	}, nil)
	if err != nil {
		return "", err
	}
	var created struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(res, &created)
	return created.ID, nil
}

func (c *Client) drift(ctx context.Context) {
	nodes, err := c.st.ListNodes()
	if err != nil {
		return
	}
	repaired := false
	for _, n := range nodes {
		if n.TunnelID == "" || n.TunnelID == c.cfg.BootstrapTunnelID {
			continue
		}
		if err := c.ReconcileTunnel(ctx, n.TunnelID); err == nil {
			repaired = true
		} else {
			c.log.Error("cf_error", "msg", "drift tunnel", "tunnel_id", n.TunnelID, "err", err.Error())
		}
	}
	svcs, err := c.st.ListServices()
	if err != nil {
		return
	}
	for _, s := range svcs {
		n, err := c.st.GetNode(s.NodeID)
		if err != nil {
			continue
		}
		view := ingress.ServiceView{
			Name:            s.Name,
			NodeID:          s.NodeID,
			TunnelID:        n.TunnelID,
			DesiredState:    s.DesiredState,
			ExposeMode:      s.ExposeMode,
			Hostname:        s.Hostname,
			HostPort:        s.HostPort,
			ContainerPort:   s.ContainerPort,
			DNSRecordID:     s.CFDNSRecordID,
			AccessAppID:     s.CFAccessAppID,
			AccessPolicyID:  s.CFAccessPolicyID,
			HostnameRouteID: s.CFHostnameRouteID,
		}
		if err := c.ReconcileService(ctx, view); err != nil {
			c.log.Error("cf_error", "msg", "drift service", "service", s.Name, "err", err.Error())
			continue
		}
		repaired = true
	}
	if repaired {
		c.log.Info("cf_drift_repaired")
	}
}
