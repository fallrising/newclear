package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/delivery"
)

// This subprocess runs the actual CLI lifecycle, HTTP handlers, SQLite and
// dispatcher. Only clock and the exact trusted local TLS destination differ.
func TestM4ServiceProcess(t *testing.T) {
	directory := os.Getenv("SIGNALHUB_M4_TEST_DIRECTORY")
	if directory == "" {
		return
	}
	cert, err := os.ReadFile(filepath.Join(directory, "receiver.pem"))
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(cert) {
		t.Fatal("fixture certificate")
	}
	endpoint := netip.MustParseAddrPort(os.Getenv("SIGNALHUB_M4_TEST_ENDPOINT"))
	now := func() time.Time {
		b, e := os.ReadFile(filepath.Join(directory, "clock"))
		if e != nil {
			panic(e)
		}
		v, e := time.Parse(time.RFC3339Nano, string(b))
		if e != nil {
			panic(e)
		}
		return v
	}
	factory := func(s []delivery.Subscription, a []string) (*delivery.Sender, error) {
		return delivery.NewLocalTestSender(s, a, endpoint, roots)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	err = runWithOptions(ctx, []string{"-config", filepath.Join(directory, "config.json"), "-db", filepath.Join(directory, "hub.db"), "-owner-token-ref", "file:" + filepath.Join(directory, "owner.token"), "-readonly-token-ref", "file:" + filepath.Join(directory, "reader.token"), "-listen", "127.0.0.1:0"}, os.Stderr, runtimeOptions{senderFactory: factory, now: now, deliveryInterval: 20 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
}

var stampPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)
var signaturePattern = regexp.MustCompile(`^v1=[0-9a-f]{64}$`)
var deliveryIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}:(?:[1-9][0-9]*|digest:[0-9]+)$`)

// Reference receiver: validate before checking durable dedup. Never acknowledge
// a new ID until its receipt transaction commits.
func acceptWebhook(db *sql.DB, key []byte, id, stamp, signature string, body []byte, now int64) (string, error) {
	if !stampPattern.MatchString(stamp) || !signaturePattern.MatchString(signature) || !deliveryIDPattern.MatchString(id) {
		return "reject", nil
	}
	seconds, err := strconv.ParseInt(stamp, 10, 64)
	if err != nil || seconds < now-300 || seconds > now+300 {
		return "reject", nil
	}
	mac := hmac.New(sha256.New, key)
	fmt.Fprintf(mac, "v1.%s.%s.", stamp, id)
	mac.Write(body)
	supplied, _ := hex.DecodeString(strings.TrimPrefix(signature, "v1="))
	if !hmac.Equal(mac.Sum(nil), supplied) {
		return "reject", nil
	}
	tx, err := db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	result, err := tx.Exec("INSERT OR IGNORE INTO receipts(id,body) VALUES(?,?)", id, body)
	if err != nil {
		return "", err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return "", err
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	if n == 0 {
		return "duplicate", nil
	}
	return "accept", nil
}
func receiverDB(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,body BLOB NOT NULL)"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}
func TestM4ReferenceReceiverVectors(t *testing.T) {
	raw, err := os.ReadFile("../../contracts/webhook-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name      string   `json:"name"`
		Key       string   `json:"key_hex"`
		Stamp     string   `json:"timestamp"`
		ID        string   `json:"delivery_id"`
		Now       int64    `json:"now"`
		Body      string   `json:"body_base64"`
		Accepted  []string `json:"accepted_ids"`
		Expected  string   `json:"expected"`
		Signature string   `json:"signature"`
	}
	if err = json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			db := receiverDB(t, filepath.Join(t.TempDir(), "receiver.db"))
			for _, id := range tc.Accepted {
				if _, err = db.Exec("INSERT INTO receipts VALUES(?,?)", id, []byte{}); err != nil {
					t.Fatal(err)
				}
			}
			key, _ := hex.DecodeString(tc.Key)
			body, _ := base64.StdEncoding.DecodeString(tc.Body)
			got, err := acceptWebhook(db, key, tc.ID, tc.Stamp, tc.Signature, body, tc.Now)
			if err != nil || got != tc.Expected {
				t.Fatalf("got %s/%v want %s", got, err, tc.Expected)
			}
		})
	}
}

func TestM4RealServiceDeliveryRecovery(t *testing.T) {
	directory := t.TempDir()
	baseTime := time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)
	var clockMu sync.Mutex
	clock := baseTime
	setClock := func(v time.Time) {
		clockMu.Lock()
		defer clockMu.Unlock()
		clock = v
		tmp := filepath.Join(directory, "clock.new")
		if err := os.WriteFile(tmp, []byte(v.Format(time.RFC3339Nano)), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Rename(tmp, filepath.Join(directory, "clock")); err != nil {
			t.Fatal(err)
		}
	}
	setClock(clock)
	getClock := func() time.Time { clockMu.Lock(); defer clockMu.Unlock(); return clock }
	tokens := map[string]string{"source": strings.Repeat("s", 40), "owner": strings.Repeat("o", 40), "reader": strings.Repeat("r", 40), "ntfy": strings.Repeat("n", 40)}
	for role, token := range tokens {
		if err := os.WriteFile(filepath.Join(directory, role+".token"), []byte(token), 0600); err != nil {
			t.Fatal(err)
		}
	}
	key := []byte("synthetic-webhook-key-with-trailing-newline\n")
	if err := os.WriteFile(filepath.Join(directory, "hook.secret"), key, 0600); err != nil {
		t.Fatal(err)
	}
	receipts := receiverDB(t, filepath.Join(directory, "receiver.db"))
	type observation struct {
		Path, ID string
		Body     []byte
		Headers  http.Header
	}
	var receiverMu sync.Mutex
	seen := []observation{}
	counts := map[string]int{}
	allowBad := false
	leaseReceived := make(chan struct{}, 1)
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			w.WriteHeader(500)
			return
		}
		id := r.Header.Get("Signalhub-Delivery-Id")
		receiverMu.Lock()
		counts[r.URL.Path]++
		attempt := counts[r.URL.Path]
		bad := allowBad
		seen = append(seen, observation{r.URL.Path, id, bytes.Clone(body), r.Header.Clone()})
		receiverMu.Unlock()
		if r.URL.Path == "/ntfy" || r.URL.Path == "/digest" {
			if r.Header.Get("Authorization") != "Bearer "+tokens["ntfy"] {
				w.WriteHeader(401)
				return
			}
			w.WriteHeader(200)
			return
		}
		result, err := acceptWebhook(receipts, key, id, r.Header.Get("Signalhub-Timestamp"), r.Header.Get("Signalhub-Signature"), body, getClock().Unix())
		if err != nil || result == "reject" {
			w.WriteHeader(401)
			return
		}
		if r.URL.Path == "/retry" && attempt <= 3 {
			w.WriteHeader(500)
			return
		}
		if r.URL.Path == "/bad" && !bad {
			w.WriteHeader(400)
			return
		}
		if r.URL.Path == "/lease" && attempt == 1 {
			leaseReceived <- struct{}{}
			select {
			case <-r.Context().Done():
			case <-time.After(10 * time.Second):
			}
			return
		}
		w.WriteHeader(200)
	}))
	defer receiver.Close()
	if err := os.WriteFile(filepath.Join(directory, "receiver.pem"), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: receiver.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	endpoint := strings.TrimPrefix(receiver.URL, "https://")
	ref := func(name string) string { return "file:" + filepath.Join(directory, name) }
	subs := []any{}
	allowlist := []string{}
	for _, name := range []string{"retry", "bad", "lease", "ntfy", "digest"} {
		channel := map[string]any{"kind": "webhook", "url": receiver.URL + "/" + name, "secret_ref": ref("hook.secret")}
		if name == "ntfy" || name == "digest" {
			channel = map[string]any{"kind": "ntfy", "url": receiver.URL + "/" + name, "token_ref": ref("ntfy.token")}
		}
		sub := map[string]any{"id": name, "filter": map[string]any{"types": []string{"demo.event." + name}}, "channel": channel, "mode": "immediate"}
		if name == "digest" {
			sub["mode"] = "digest"
			sub["digest"] = map[string]any{"every": "24h", "at": "13:00", "timezone": "Etc/UTC", "skip_empty": true}
		}
		subs = append(subs, sub)
		allowlist = append(allowlist, receiver.URL+"/"+name)
	}
	cfg := map[string]any{"sources": []any{map[string]any{"name": "demo", "source_prefix": "urn:example:demo:", "allowed_types": []string{"demo.event.*"}, "token_ref": ref("source.token")}}, "rules": []any{}, "subscriptions": subs, "webhook_allowlist": allowlist}
	writeConfig := func() {
		b, _ := json.Marshal(cfg)
		if err := os.WriteFile(filepath.Join(directory, "config.json"), b, 0600); err != nil {
			t.Fatal(err)
		}
	}
	writeConfig()
	var process *exec.Cmd
	var base string
	stop := func() {
		if process != nil {
			_ = process.Process.Kill()
			_ = process.Wait()
			process = nil
		}
	}
	t.Cleanup(stop)
	start := func() {
		binary, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		process = exec.Command(binary, "-test.run=^TestM4ServiceProcess$", "-test.timeout=90s")
		process.Env = append(os.Environ(), "SIGNALHUB_M4_TEST_DIRECTORY="+directory, "SIGNALHUB_M4_TEST_ENDPOINT="+endpoint)
		stderr, err := process.StderrPipe()
		if err != nil {
			t.Fatal(err)
		}
		if err = process.Start(); err != nil {
			t.Fatal(err)
		}
		started := make(chan string, 1)
		go func() {
			scanner := bufio.NewScanner(stderr)
			for scanner.Scan() {
				line := scanner.Text()
				if strings.HasPrefix(line, "signalhub listening on ") {
					started <- "http://" + strings.TrimPrefix(line, "signalhub listening on ")
				}
			}
		}()
		select {
		case base = <-started:
		case <-time.After(20 * time.Second):
			stop()
			t.Fatal("service startup timeout")
		}
	}
	start()
	stateDB, err := sql.Open("sqlite", filepath.Join(directory, "hub.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer stateDB.Close()
	client := &http.Client{Timeout: 15 * time.Second}
	call := func(method, path, role string, body []byte, want int) map[string]any {
		t.Helper()
		req, err := http.NewRequest(method, base+path, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+tokens[role])
		req.Header.Set("Content-Type", "application/json")
		if path == "/v1/events" {
			req.Header.Set("Content-Type", "application/cloudevents+json")
		}
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != want {
			t.Fatalf("%s %s status=%d want=%d body=%s", method, path, response.StatusCode, want, raw)
		}
		for _, token := range tokens {
			if bytes.Contains(raw, []byte(token)) {
				t.Fatal("API leaked token")
			}
		}
		var value map[string]any
		if err = json.Unmarshal(raw, &value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	wait := func(label string, predicate func() bool) {
		t.Helper()
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			if predicate() {
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatalf("timeout: %s", label)
	}
	getDelivery := func(name string) map[string]any {
		page := call("GET", "/v1/deliveries?subscription="+name, "reader", nil, 200)
		items := page["items"].([]any)
		if len(items) == 0 {
			return nil
		}
		return items[0].(map[string]any)
	}
	ingest := func(name, id string) []byte {
		raw, _ := json.Marshal(map[string]any{"specversion": "1.0", "id": id, "source": "urn:example:demo:service", "type": "demo.event." + name, "time": getClock().Format(time.RFC3339Nano), "severity": "warning", "summary": "synthetic delivery " + id, "correlationid": "decision-fixture"})
		call("POST", "/v1/events", "source", raw, 202)
		return raw
	}
	original := ingest("retry", "retry-one")
	for attempt := 1; attempt <= 3; attempt++ {
		wait("retry pending", func() bool {
			d := getDelivery("retry")
			return d != nil && int(d["attempt_count"].(float64)) == attempt && d["state"] == "pending"
		})
		d := getDelivery("retry")
		next, err := time.Parse(time.RFC3339Nano, d["next_attempt_at"].(string))
		if err != nil {
			t.Fatal(err)
		}
		setClock(next.Add(time.Second))
	}
	wait("retry succeeded", func() bool { d := getDelivery("retry"); return d != nil && d["state"] == "succeeded" })
	d := getDelivery("retry")
	if d["attempt_count"].(float64) != 4 {
		t.Fatal(d)
	}
	call("POST", "/v1/events", "source", original, 200)
	receiverMu.Lock()
	var retryID string
	for _, o := range seen {
		if o.Path == "/retry" {
			if retryID != "" && retryID != o.ID {
				t.Error("unstable retry id")
			}
			retryID = o.ID
			if !bytes.Equal(o.Body, original) {
				t.Error("webhook bytes changed")
			}
		}
	}
	receiverMu.Unlock()
	t.Log("AC-30: real HTTP ingest → TLS 500×3 → 200, four attempts, stable ID/raw bytes")
	ingest("bad", "bad-one")
	wait("DLQ", func() bool { d := getDelivery("bad"); return d != nil && d["state"] == "dlq" })
	d = getDelivery("bad")
	id := d["delivery_id"].(string)
	replayPath := "/v1/deliveries/" + url.PathEscape(id) + ":replay"
	call("POST", replayPath, "owner", []byte(`{"reason":" "}`), 400)
	call("POST", replayPath, "reader", []byte(`{"reason":"fixture"}`), 403)
	events := call("GET", "/v1/events?type=signalhub.delivery.dlq", "reader", nil, 200)
	if len(events["items"].([]any)) != 1 {
		t.Fatal("missing DLQ event")
	}
	receiverMu.Lock()
	allowBad = true
	receiverMu.Unlock()
	call("POST", replayPath, "owner", []byte(`{"reason":"synthetic receiver repaired"}`), 202)
	wait("replay succeeded", func() bool { d := getDelivery("bad"); return d["state"] == "succeeded" && d["delivery_id"] == id })
	call("POST", replayPath, "owner", []byte(`{"reason":"again"}`), 409)
	t.Log("AC-31/32: 400 → one DLQ event; role/reason rejected; same-ID replay → success")
	ingest("ntfy", "phone-one")
	wait("ntfy receipt", func() bool { d := getDelivery("ntfy"); return d != nil && d["state"] == "succeeded" })
	setClock(time.Date(2026, 10, 3, 13, 0, 1, 0, time.UTC))
	wait("empty window materialized", func() bool {
		var at int64
		err := stateDB.QueryRow("SELECT digest_start FROM subscriptions WHERE id='digest'").Scan(&at)
		return err == nil && at == time.Date(2026, 10, 3, 13, 0, 0, 0, time.UTC).Unix()
	})
	receiverMu.Lock()
	emptyCount := counts["/digest"]
	receiverMu.Unlock()
	if emptyCount != 0 {
		t.Fatal("empty digest sent")
	}
	ingest("digest", "daily-one")
	setClock(time.Date(2026, 10, 4, 13, 0, 1, 0, time.UTC))
	wait("digest receipt", func() bool { d := getDelivery("digest"); return d != nil && d["state"] == "succeeded" })
	receiverMu.Lock()
	for _, o := range seen {
		if o.Path == "/ntfy" && (o.Headers.Get("X-Priority") != "3" || string(o.Body) != "synthetic delivery phone-one") {
			t.Error("ntfy mapping", o.Headers, string(o.Body))
		}
		if o.Path == "/digest" && !bytes.Contains(o.Body, []byte("daily-one")) {
			t.Error("digest omitted event")
		}
	}
	receiverMu.Unlock()
	t.Log("AC-36: empty digest skipped; next nonempty window delivered to local ntfy receiver")
	// Rejected reload must preserve sender and source authentication.
	cfg["webhook_allowlist"] = []string{}
	writeConfig()
	call("POST", "/v1/config:reload", "owner", nil, 400)
	ingest("ntfy", "after-reject")
	wait("old sender after rejected reload", func() bool { receiverMu.Lock(); defer receiverMu.Unlock(); return counts["/ntfy"] == 2 })
	cfg["webhook_allowlist"] = allowlist
	writeConfig()
	ingest("lease", "lease-one")
	select {
	case <-leaseReceived:
	case <-time.After(20 * time.Second):
		t.Fatal("lease receiver timeout")
	}
	wait("inflight", func() bool { d := getDelivery("lease"); return d != nil && d["state"] == "inflight" })
	stop()
	start()
	time.Sleep(150 * time.Millisecond)
	receiverMu.Lock()
	leaseBefore := counts["/lease"]
	receiverMu.Unlock()
	if leaseBefore != 1 {
		t.Fatal("lease resent before expiry")
	}
	setClock(getClock().Add(121 * time.Second))
	wait("lease recovered", func() bool { d := getDelivery("lease"); return d != nil && d["state"] == "succeeded" })
	receiverMu.Lock()
	if counts["/lease"] != 2 {
		t.Error("unexpected lease attempt count")
	}
	receiverMu.Unlock()
	var accepted int
	if err := receipts.QueryRow("SELECT count(*) FROM receipts WHERE id LIKE 'lease:%'").Scan(&accepted); err != nil || accepted != 1 {
		t.Fatalf("persistent receiver dedup=%d err=%v", accepted, err)
	}
	t.Log("AC-33/34: SIGKILL inflight, restart waits for lease, resend uses persistent receiver dedup")
	stop()
	db, err := sql.Open("sqlite", filepath.Join(directory, "hub.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// Store tests check audit shape; integration checks the required reason really persisted.
	var auditCount int
	if err := db.QueryRow("SELECT count(*) FROM audit_log WHERE reason=?", "synthetic receiver repaired").Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatalf("replay audit=%d err=%v", auditCount, err)
	}
}
