package delivery

import (
	"context"
	"crypto/hmac"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func credentialFile(t *testing.T, raw []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "synthetic-secret")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	return "file:" + path
}
func receiverSubscription(t *testing.T, kind, target string, secret []byte) Subscription {
	t.Helper()
	sub := Subscription{ID: "test-hook", Channel: Channel{Kind: kind, URL: target}, Mode: "immediate", Start: "now"}
	sub.Filter.Types = []string{"release.deploy.*"}
	if kind == "webhook" {
		sub.Channel.SecretRef = credentialFile(t, secret)
	} else {
		sub.Channel.TokenRef = credentialFile(t, secret)
	}
	return sub
}
func fixtureRoots(server *httptest.Server) *x509.CertPool {
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	return roots
}
func localSender(t *testing.T, server *httptest.Server, subs ...Subscription) *Sender {
	t.Helper()
	allowed := []string{}
	for _, s := range subs {
		if !slices.Contains(allowed, s.Channel.URL) {
			allowed = append(allowed, s.Channel.URL)
		}
	}
	sender, err := NewLocalTestSender(subs, allowed, netip.MustParseAddrPort(server.Listener.Addr().String()), fixtureRoots(server))
	if err != nil {
		t.Fatal(err)
	}
	return sender
}

func TestSignedWebhookActualTLS(t *testing.T) {
	key := []byte("synthetic raw HMAC key\n")
	raw := []byte(sampleEvent + "\n ")
	now := parseTime(t, "2026-10-13T00:00:00Z")
	var received atomic.Int64
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil || string(body) != string(raw) || r.Header.Get("Content-Type") != "application/cloudevents+json" || r.Header.Get("Signalhub-Delivery-Id") != "test-hook:42" || r.Header.Get("Signalhub-Timestamp") != strconv.FormatInt(now.Unix(), 10) || r.Header.Get("Signalhub-Signature") != signature(key, strconv.FormatInt(now.Unix(), 10), "test-hook:42", raw) {
			t.Error("webhook payload or signed headers changed")
			w.WriteHeader(400)
			return
		}
		received.Add(1)
		w.Header().Set("Retry-After", "120")
		w.WriteHeader(429)
		_, _ = w.Write([]byte("private response MUST NOT appear in result"))
	}))
	defer receiver.Close()
	sub := receiverSubscription(t, "webhook", receiver.URL+"/hook", key)
	sender := localSender(t, receiver, sub)
	msg, err := Immediate(sub, 42, raw, "http://board.example.invalid")
	if err != nil {
		t.Fatal(err)
	}
	result := sender.Send(t.Context(), sub.ID, "test-hook:42", msg, now)
	if result.HTTPStatus == nil || *result.HTTPStatus != 429 || result.RetryAfter != 2*time.Minute || result.Error == nil || *result.Error != "delivery HTTP response rejected" || received.Load() != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if signature([]byte(strings.TrimSpace(string(key))), strconv.FormatInt(now.Unix(), 10), "test-hook:42", raw) == signature(key, strconv.FormatInt(now.Unix(), 10), "test-hook:42", raw) {
		t.Fatal("raw key newline lost")
	}
}
func TestNtfyActualTLS(t *testing.T) {
	token := strings.Repeat("synthetic", 4)
	var received atomic.Int64
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if r.Header.Get("Authorization") != "Bearer "+token || string(body) != "synthetic summary" || r.Header.Get("X-Priority") != "5" || r.Header.Get("X-Title") != "[critical] release.deploy.succeeded" || r.Header.Get("X-Click") != "http://board.example.invalid/?event=7" {
			t.Error("wrong actual ntfy request")
			w.WriteHeader(400)
			return
		}
		received.Add(1)
		w.WriteHeader(202)
	}))
	defer receiver.Close()
	sub := receiverSubscription(t, "ntfy", receiver.URL+"/topic", []byte(token+"\r\n"))
	msg, err := Immediate(sub, 7, []byte(sampleEvent), "http://board.example.invalid")
	if err != nil {
		t.Fatal(err)
	}
	result := localSender(t, receiver, sub).Send(t.Context(), sub.ID, "test-hook:7", msg, time.Now())
	if result.HTTPStatus == nil || *result.HTTPStatus != 202 || result.Error != nil || received.Load() != 1 {
		t.Fatalf("unexpected result %#v", result)
	}
}
func TestRedirectNeverFollowed(t *testing.T) {
	var final atomic.Int64
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/final" {
			final.Add(1)
			w.WriteHeader(200)
			return
		}
		w.Header().Set("Location", "/final")
		w.WriteHeader(307)
	}))
	defer receiver.Close()
	sub := receiverSubscription(t, "webhook", receiver.URL+"/start", []byte("synthetic-key"))
	result := localSender(t, receiver, sub).Send(t.Context(), sub.ID, "test-hook:1", Message{Body: []byte(sampleEvent), ContentType: "application/cloudevents+json"}, time.Now())
	if result.HTTPStatus == nil || *result.HTTPStatus != 307 || final.Load() != 0 {
		t.Fatalf("redirect followed: %#v", result)
	}
}
func TestProductionRejectsNonTailnetAndMixedDNS(t *testing.T) {
	cases := map[string][]string{
		"loopback": {"127.0.0.1"}, "public": {"8.8.8.8"}, "private": {"192.168.1.1"}, "metadata": {"169.254.169.254"}, "linklocal6": {"fe80::1"}, "loopback6": {"::1"}, "unique6": {"fd00::1"}, "mapped": {"::ffff:100.64.0.1"}, "mixed": {"100.64.0.1", "127.0.0.1"}, "mixed6": {"fd7a:115c:a1e0::1", "2001:4860:4860::8888"},
	}
	for name, addresses := range cases {
		t.Run(name, func(t *testing.T) {
			sub := receiverSubscription(t, "webhook", "https://receiver.example.invalid/hook", []byte("synthetic-key"))
			dials := 0
			sender, err := newSender([]Subscription{sub}, []string{sub.Channel.URL}, transportDependencies{
				lookup: func(context.Context, string, string) ([]netip.Addr, error) {
					out := []netip.Addr{}
					for _, a := range addresses {
						out = append(out, netip.MustParseAddr(a))
					}
					return out, nil
				},
				allowed: tailnetAddress, dial: func(context.Context, string, string) (net.Conn, error) {
					dials++
					return nil, errors.New("must not dial")
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			result := sender.Send(t.Context(), sub.ID, "test-hook:1", Message{}, time.Now())
			if dials != 0 || result.HTTPStatus != nil || result.Error == nil || *result.Error != "delivery transport failed" {
				t.Fatalf("SSRF failure: dials=%d result=%#v", dials, result)
			}
		})
	}
	for _, a := range []string{"100.64.0.0", "100.127.255.255", "fd7a:115c:a1e0::1"} {
		if !tailnetAddress(netip.MustParseAddr(a)) {
			t.Errorf("tailnet denied: %s", a)
		}
	}
	for _, a := range []string{"100.63.255.255", "100.128.0.0", "fd7a:115c:a1e1::1"} {
		if tailnetAddress(netip.MustParseAddr(a)) {
			t.Errorf("tailnet boundary allowed: %s", a)
		}
	}
}
func TestDNSPinningFreshResolutionAndTLSVerification(t *testing.T) {
	var received atomic.Int64
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { received.Add(1); w.WriteHeader(204) }))
	defer receiver.Close()
	sub := receiverSubscription(t, "webhook", receiver.URL+"/hook", []byte("synthetic-key"))
	lookupCount, dialCount := 0, 0
	dialer := &net.Dialer{}
	deps := transportDependencies{
		lookup: func(context.Context, string, string) ([]netip.Addr, error) {
			lookupCount++
			if lookupCount == 1 {
				return []netip.Addr{netip.MustParseAddr("100.64.0.9")}, nil
			}
			return []netip.Addr{netip.MustParseAddr("127.0.0.1")}, nil
		},
		allowed: tailnetAddress, roots: fixtureRoots(receiver),
		dial: func(ctx context.Context, network, address string) (net.Conn, error) {
			dialCount++
			host, _, _ := net.SplitHostPort(address)
			if host != "100.64.0.9" {
				t.Errorf("dial did not pin approved literal: %s", host)
			}
			return dialer.DialContext(ctx, network, receiver.Listener.Addr().String())
		},
	}
	sender, err := newSender([]Subscription{sub}, []string{sub.Channel.URL}, deps)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:1")
	first := sender.Send(t.Context(), sub.ID, "test-hook:1", Message{}, time.Now())
	second := sender.Send(t.Context(), sub.ID, "test-hook:1", Message{}, time.Now())
	if first.HTTPStatus == nil || *first.HTTPStatus != 204 || second.HTTPStatus != nil || lookupCount != 2 || dialCount != 1 || received.Load() != 1 {
		t.Fatalf("DNS refresh/pin: first=%#v second=%#v lookup=%d dials=%d received=%d", first, second, lookupCount, dialCount, received.Load())
	}
	transport := sender.targets[sub.ID].client.Transport.(*http.Transport)
	if transport.Proxy != nil || !transport.DisableKeepAlives || transport.TLSClientConfig.InsecureSkipVerify || sender.targets[sub.ID].client.Timeout != 10*time.Second {
		t.Fatal("unsafe transport defaults")
	}
	// The fixture certificate is not trusted by an empty root pool.
	untrusted, err := NewLocalTestSender([]Subscription{sub}, []string{sub.Channel.URL}, netip.MustParseAddrPort(receiver.Listener.Addr().String()), x509.NewCertPool())
	if err != nil {
		t.Fatal(err)
	}
	result := untrusted.Send(t.Context(), sub.ID, "test-hook:1", Message{}, time.Now())
	if result.Error == nil || result.HTTPStatus != nil || received.Load() != 1 {
		t.Fatal("untrusted TLS certificate accepted")
	}
}
func TestLocalConstructorPinnedPortAndTLSHostname(t *testing.T) {
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("wrong hostname reached receiver") }))
	defer receiver.Close()
	endpoint := netip.MustParseAddrPort(receiver.Listener.Addr().String())
	sub := receiverSubscription(t, "webhook", "https://wrong.example.invalid:"+strconv.Itoa(int(endpoint.Port()))+"/hook", []byte("synthetic-key"))
	sender, err := NewLocalTestSender([]Subscription{sub}, []string{sub.Channel.URL}, endpoint, fixtureRoots(receiver))
	if err != nil {
		t.Fatal(err)
	}
	result := sender.Send(t.Context(), sub.ID, "test-hook:1", Message{}, time.Now())
	if result.Error == nil || result.HTTPStatus != nil {
		t.Fatal("TLS hostname verification skipped")
	}
	for _, bad := range []netip.AddrPort{netip.MustParseAddrPort("100.64.0.1:443"), netip.MustParseAddrPort("127.0.0.1:0"), netip.MustParseAddrPort("[::ffff:127.0.0.1]:443")} {
		if _, err := NewLocalTestSender([]Subscription{sub}, []string{sub.Channel.URL}, bad, fixtureRoots(receiver)); err == nil {
			t.Error("unsafe test endpoint accepted")
		}
	}
	sub.Channel.URL = "https://receiver.example.invalid:1/hook"
	if _, err := NewLocalTestSender([]Subscription{sub}, []string{sub.Channel.URL}, endpoint, fixtureRoots(receiver)); err == nil {
		t.Fatal("test endpoint port was not pinned")
	}
}
func TestCredentialAndErrorHygiene(t *testing.T) {
	for _, suffix := range []string{"\r", "\n\n", " ", "\ntrailing"} {
		sub := receiverSubscription(t, "ntfy", "https://receiver.example.invalid/topic", []byte(strings.Repeat("synthetic", 4)+suffix))
		if _, err := NewSender([]Subscription{sub}, []string{sub.Channel.URL}); err == nil {
			t.Errorf("invalid token suffix %q", suffix)
		}
	}
	sub := receiverSubscription(t, "webhook", "https://receiver.example.invalid/secret-path?secret=query", []byte("synthetic-key"))
	sub.Channel.SecretRef = "file:/unavailable-synthetic-path"
	if _, err := NewSender([]Subscription{sub}, []string{sub.Channel.URL}); err == nil || strings.Contains(err.Error(), "path") || strings.Contains(err.Error(), "query") {
		t.Fatal("credential path leak or missing failure")
	}
	sub.Channel.SecretRef = credentialFile(t, []byte("synthetic-key"))
	sender, err := NewSender([]Subscription{sub}, []string{sub.Channel.URL})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	result := sender.Send(ctx, sub.ID, "test-hook:1", Message{}, time.Now())
	if result.Error == nil || strings.Contains(*result.Error, "secret") || strings.Contains(*result.Error, "example.invalid") {
		t.Fatal("transport error leak")
	}
}

// The reference receiver verifies request authenticity before consulting its
// durable ID file. Acceptance is flushed to storage before returning 2xx.
type referenceReceiver struct {
	key  []byte
	now  time.Time
	path string
	mu   sync.Mutex
}

var deliveryIDFormat = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}:(?:[1-9][0-9]*|digest:[0-9]+)$`)
var timestampFormat = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)
var signatureFormat = regexp.MustCompile(`^v1=[0-9a-f]{64}$`)

func (receiver *referenceReceiver) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	timestamp, id, sig := r.Header.Get("Signalhub-Timestamp"), r.Header.Get("Signalhub-Delivery-Id"), r.Header.Get("Signalhub-Signature")
	ts, parseErr := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || parseErr != nil || !deliveryIDFormat.MatchString(id) || !timestampFormat.MatchString(timestamp) || !signatureFormat.MatchString(sig) || ts < receiver.now.Unix()-300 || ts > receiver.now.Unix()+300 || !hmac.Equal([]byte(signature(receiver.key, timestamp, id, body)), []byte(sig)) {
		w.WriteHeader(401)
		return
	}
	receiver.mu.Lock()
	defer receiver.mu.Unlock()
	raw, err := os.ReadFile(receiver.path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		w.WriteHeader(500)
		return
	}
	for line := range strings.Lines(string(raw)) {
		var accepted string
		if json.Unmarshal([]byte(strings.TrimSpace(line)), &accepted) != nil {
			w.WriteHeader(500)
			return
		}
		if accepted == id {
			w.Header().Set("X-Result", "duplicate")
			w.WriteHeader(200)
			return
		}
	}
	file, err := os.OpenFile(receiver.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		w.WriteHeader(500)
		return
	}
	encoded, _ := json.Marshal(id)
	if _, err = file.Write(append(encoded, '\n')); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		w.WriteHeader(500)
		return
	}
	w.Header().Set("X-Result", "accept")
	w.WriteHeader(202)
}
func vectorRequest(t *testing.T, body []byte, timestamp, id, sig string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "https://receiver.example.invalid/hook", strings.NewReader(string(body)))
	req.Header.Set("Signalhub-Delivery-Id", id)
	req.Header.Set("Signalhub-Timestamp", timestamp)
	req.Header.Set("Signalhub-Signature", sig)
	return req
}
func TestAllM0WebhookVectorsAndDurableReceiver(t *testing.T) {
	raw, err := os.ReadFile("../../contracts/webhook-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors []struct {
		Name                string
		Key                 string `json:"key_hex"`
		Timestamp           string
		DeliveryID          string `json:"delivery_id"`
		Now                 int64
		Body                string   `json:"body_base64"`
		Accepted            []string `json:"accepted_ids"`
		Expected, Signature string
	}
	if err = json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, tc := range vectors {
		t.Run(tc.Name, func(t *testing.T) {
			key, err := hex.DecodeString(tc.Key)
			if err != nil {
				t.Fatal(err)
			}
			body, err := base64.StdEncoding.DecodeString(tc.Body)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "accepted.jsonl")
			var initial strings.Builder
			for _, id := range tc.Accepted {
				b, _ := json.Marshal(id)
				initial.Write(b)
				initial.WriteByte('\n')
			}
			if err := os.WriteFile(path, []byte(initial.String()), 0600); err != nil {
				t.Fatal(err)
			}
			receiver := &referenceReceiver{key: key, now: time.Unix(tc.Now, 0), path: path}
			recorder := httptest.NewRecorder()
			receiver.ServeHTTP(recorder, vectorRequest(t, body, tc.Timestamp, tc.DeliveryID, tc.Signature))
			got := recorder.Header().Get("X-Result")
			if recorder.Code == 401 {
				got = "reject"
			}
			if got != tc.Expected {
				t.Fatalf("got %s HTTP %d want %s", got, recorder.Code, tc.Expected)
			}
			if tc.Expected != "accept" {
				return
			}
			// Reopen the receiver without retaining an in-memory accepted-ID set.
			reopened := &referenceReceiver{key: key, now: time.Unix(tc.Now, 0), path: path}
			duplicate := httptest.NewRecorder()
			reopened.ServeHTTP(duplicate, vectorRequest(t, body, tc.Timestamp, tc.DeliveryID, tc.Signature))
			if duplicate.Code != 200 || duplicate.Header().Get("X-Result") != "duplicate" {
				t.Fatal("durable duplicate was not recognized")
			}
			forged := httptest.NewRecorder()
			reopened.ServeHTTP(forged, vectorRequest(t, body, tc.Timestamp, tc.DeliveryID, "v1="+strings.Repeat("0", 64)))
			if forged.Code != 401 {
				t.Fatal("duplicate bypassed signature validation")
			}
		})
	}
}
