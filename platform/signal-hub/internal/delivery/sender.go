package delivery

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Result struct {
	HTTPStatus *int
	DurationMS int64
	Error      *string
	RetryAfter time.Duration
}
type target struct {
	kind, url  string
	credential []byte
	client     *http.Client
}
type Sender struct{ targets map[string]target }
type transportDependencies struct {
	lookup  func(context.Context, string, string) ([]netip.Addr, error)
	dial    func(context.Context, string, string) (net.Conn, error)
	allowed func(netip.Addr) bool
	roots   *x509.CertPool
	port    string
}

var tailnet4 = netip.MustParsePrefix("100.64.0.0/10")
var tailnet6 = netip.MustParsePrefix("fd7a:115c:a1e0::/48")

func tailnetAddress(addr netip.Addr) bool {
	return addr.IsValid() && addr.Zone() == "" && !addr.Is4In6() && (tailnet4.Contains(addr) || tailnet6.Contains(addr))
}

// NewSender validates the complete candidate and loads all credential files
// before returning. It never uses environment proxies or follows redirects.
func NewSender(subscriptions []Subscription, allowlist []string) (*Sender, error) {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	return newSender(subscriptions, allowlist, transportDependencies{lookup: net.DefaultResolver.LookupNetIP, dial: dialer.DialContext, allowed: tailnetAddress})
}

// NewLocalTestSender is only for synthetic integration-test receivers. It pins
// every connection to one explicit loopback endpoint and verifies certificates
// against the supplied fixture roots. No CLI or configuration flag exposes it.
func NewLocalTestSender(subscriptions []Subscription, allowlist []string, endpoint netip.AddrPort, roots *x509.CertPool) (*Sender, error) {
	if !endpoint.IsValid() || !endpoint.Addr().IsLoopback() || endpoint.Addr().Is4In6() || endpoint.Addr().Zone() != "" || endpoint.Port() == 0 || roots == nil {
		return nil, errors.New("invalid local test receiver")
	}
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	return newSender(subscriptions, allowlist, transportDependencies{
		lookup: func(context.Context, string, string) ([]netip.Addr, error) { return []netip.Addr{endpoint.Addr()}, nil },
		dial:   dialer.DialContext, allowed: func(addr netip.Addr) bool { return addr == endpoint.Addr() }, roots: roots.Clone(), port: strconv.Itoa(int(endpoint.Port())),
	})
}
func newSender(subscriptions []Subscription, allowlist []string, deps transportDependencies) (*Sender, error) {
	raw := make([]json.RawMessage, 0, len(subscriptions))
	for _, sub := range subscriptions {
		b, err := json.Marshal(sub)
		if err != nil {
			return nil, errors.New("invalid subscription")
		}
		raw = append(raw, b)
	}
	checked, err := Parse(raw, allowlist)
	if err != nil {
		return nil, err
	}
	sender := &Sender{targets: make(map[string]target, len(checked))}
	for _, sub := range checked {
		ref := sub.Channel.SecretRef
		if sub.Channel.Kind == "ntfy" {
			ref = sub.Channel.TokenRef
		}
		credential, err := os.ReadFile(strings.TrimPrefix(ref, "file:"))
		if err != nil {
			return nil, errors.New("cannot read delivery credential")
		}
		if sub.Channel.Kind == "ntfy" {
			if bytes.HasSuffix(credential, []byte("\n")) {
				credential = bytes.TrimSuffix(credential, []byte("\n"))
				credential = bytes.TrimSuffix(credential, []byte("\r"))
			}
			if !validBearer(credential) {
				clear(credential)
				return nil, errors.New("invalid ntfy bearer credential")
			}
		} else if len(credential) == 0 {
			return nil, errors.New("empty webhook credential")
		}
		parsed, _ := url.Parse(sub.Channel.URL)
		port := parsed.Port()
		if port == "" {
			port = "443"
		}
		if deps.port != "" && port != deps.port {
			clear(credential)
			return nil, errors.New("local receiver endpoint mismatch")
		}
		transport := &http.Transport{
			Proxy: nil, DisableKeepAlives: true, DisableCompression: true, ForceAttemptHTTP2: false,
			TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12, ServerName: parsed.Hostname(), RootCAs: deps.roots},
			TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 10 * time.Second, MaxResponseHeaderBytes: 64 << 10,
		}
		host := parsed.Hostname()
		transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			gotHost, gotPort, err := net.SplitHostPort(address)
			if err != nil || gotHost != host || gotPort != port {
				return nil, errors.New("delivery endpoint mismatch")
			}
			// Resolve on every dial. Validate the complete answer before making any
			// connection, then dial the selected literal to prevent DNS rebinding.
			addresses, err := deps.lookup(ctx, "ip", host)
			if err != nil || len(addresses) == 0 {
				return nil, errors.New("delivery DNS failed")
			}
			for _, addr := range addresses {
				if !deps.allowed(addr) {
					return nil, errors.New("delivery address forbidden")
				}
			}
			for _, addr := range addresses {
				conn, err := deps.dial(ctx, network, net.JoinHostPort(addr.String(), port))
				if err == nil {
					return conn, nil
				}
			}
			return nil, errors.New("delivery connection failed")
		}
		sender.targets[sub.ID] = target{kind: sub.Channel.Kind, url: sub.Channel.URL, credential: credential, client: &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	}
	return sender, nil
}
func validBearer(token []byte) bool {
	if len(token) < 32 || token[0] == '=' {
		return false
	}
	padding := false
	for _, c := range token {
		if c == '=' {
			padding = true
			continue
		}
		if padding || !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("-._~+/", rune(c))) {
			return false
		}
	}
	return true
}
func signature(key []byte, timestamp, deliveryID string, body []byte) string {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("v1." + timestamp + "." + deliveryID + "."))
	mac.Write(body)
	return "v1=" + hex.EncodeToString(mac.Sum(nil))
}
func (s *Sender) Send(ctx context.Context, subscriptionID, deliveryID string, message Message, now time.Time) (result Result) {
	started := time.Now()
	defer func() { result.DurationMS = time.Since(started).Milliseconds() }()
	dst, ok := s.targets[subscriptionID]
	if !ok {
		result.Error = new("delivery subscription inactive")
		return
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, dst.url, bytes.NewReader(message.Body))
	if err != nil {
		result.Error = new("invalid delivery request")
		return
	}
	request.Header.Set("Content-Type", message.ContentType)
	if dst.kind == "webhook" {
		if now.Unix() < 0 {
			result.Error = new("invalid delivery timestamp")
			return
		}
		timestamp := strconv.FormatInt(now.Unix(), 10)
		request.Header.Set("Signalhub-Delivery-Id", deliveryID)
		request.Header.Set("Signalhub-Timestamp", timestamp)
		request.Header.Set("Signalhub-Signature", signature(dst.credential, timestamp, deliveryID, message.Body))
	} else {
		for _, key := range []string{"X-Title", "X-Priority", "X-Tags", "X-Click"} {
			if value, exists := message.Headers[key]; exists {
				request.Header.Set(key, singleLine(value))
			}
		}
		request.Header.Set("Authorization", "Bearer "+string(dst.credential))
	}
	response, err := dst.client.Do(request)
	if err != nil {
		result.Error = new("delivery transport failed")
		if ctx.Err() != nil {
			result.Error = new("delivery canceled")
		}
		return
	}
	defer response.Body.Close()
	// Never consume or retain response bodies, which can contain private data.
	result.HTTPStatus = new(response.StatusCode)
	result.RetryAfter = parseRetryAfter(response.Header.Get("Retry-After"), now)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		result.Error = new("delivery HTTP response rejected")
	}
	return
}
func parseRetryAfter(value string, now time.Time) time.Duration {
	if seconds, err := strconv.ParseUint(value, 10, 64); err == nil {
		return time.Duration(min(seconds, 3600)) * time.Second
	}
	if instant, err := http.ParseTime(value); err == nil {
		return min(max(instant.Sub(now), 0), time.Hour)
	}
	return 0
}

// RetryDelay applies bounded positive jitter to the exponential delay. A valid
// Retry-After can lengthen but cannot exceed the one-hour ceiling.
func RetryDelay(attempt int, retryAfter time.Duration) time.Duration {
	base := 30 * time.Second
	for i := 1; i < attempt && base < time.Hour; i++ {
		base = min(base*2, time.Hour)
	}
	delay := min(base+time.Duration(rand.Int64N(int64(base/5)+1)), time.Hour)
	return min(max(delay, retryAfter), time.Hour)
}
