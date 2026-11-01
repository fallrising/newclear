package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// This complements the production-binary archive journey with a real service
// subprocess and trusted local TLS receiver. The existing test-only transport
// injection is reused; the production executable has no outbound bypass.
func TestM5RealServiceArchiveBackupDeliveryRecovery(t *testing.T) {
	source, isolated := t.TempDir(), t.TempDir()
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	var unix atomic.Int64
	unix.Store(now.Unix())
	var repaired atomic.Bool
	var leaseReceipts atomic.Int64
	receipts := receiverDB(t, filepath.Join(t.TempDir(), "receipts.db"))
	key := []byte("synthetic-m5-persistent-receiver-secret")
	receiver := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			w.WriteHeader(500)
			return
		}
		id := r.Header.Get("Signalhub-Delivery-Id")
		result, err := acceptWebhook(receipts, key, id, r.Header.Get("Signalhub-Timestamp"), r.Header.Get("Signalhub-Signature"), body, unix.Load())
		if err != nil || result == "reject" {
			w.WriteHeader(401)
			return
		}
		if r.URL.Path == "/lease" {
			leaseReceipts.Add(1)
		}
		if !repaired.Load() {
			switch r.URL.Path {
			case "/pending":
				w.WriteHeader(503)
				return
			case "/dlq":
				w.WriteHeader(400)
				return
			case "/lease":
				select {
				case <-r.Context().Done():
				case <-time.After(10 * time.Second):
				}
				return
			}
		}
		w.WriteHeader(200)
	}))
	t.Cleanup(receiver.Close)
	tokens := map[string]string{"source": strings.Repeat("s", 40), "owner": strings.Repeat("o", 40), "reader": strings.Repeat("r", 40)}
	write := func(path string, b []byte) {
		t.Helper()
		if err := os.WriteFile(path, b, 0600); err != nil {
			t.Fatal(err)
		}
	}
	setClock := func(dir string, at time.Time) {
		t.Helper()
		unix.Store(at.Unix())
		write(filepath.Join(dir, "clock.new"), []byte(at.Format(time.RFC3339Nano)))
		if err := os.Rename(filepath.Join(dir, "clock.new"), filepath.Join(dir, "clock")); err != nil {
			t.Fatal(err)
		}
	}
	setup := func(dir string) {
		t.Helper()
		for name, token := range tokens {
			write(filepath.Join(dir, name+".token"), []byte(token))
		}
		write(filepath.Join(dir, "hook.secret"), key)
		write(filepath.Join(dir, "receiver.pem"), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: receiver.Certificate().Raw}))
		setClock(dir, now)
		ref := func(name string) string { return "file:" + filepath.Join(dir, name) }
		subs := []any{}
		allowlist := []string{}
		for _, name := range []string{"pending", "dlq", "lease"} {
			subs = append(subs, map[string]any{"id": name, "filter": map[string]any{"types": []string{"demo.event." + name}}, "mode": "immediate", "channel": map[string]any{"kind": "webhook", "url": receiver.URL + "/" + name, "secret_ref": ref("hook.secret")}})
			allowlist = append(allowlist, receiver.URL+"/"+name)
		}
		cfg := map[string]any{"sources": []any{map[string]any{"name": "demo", "source_prefix": "urn:example:demo:", "allowed_types": []string{"demo.event.*"}, "retention_days": 1, "token_ref": ref("source.token")}}, "rules": []any{}, "subscriptions": subs, "webhook_allowlist": allowlist}
		raw, err := json.Marshal(cfg)
		if err != nil {
			t.Fatal(err)
		}
		write(filepath.Join(dir, "config.json"), raw)
	}
	setup(source)
	setup(isolated)
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
	start := func(dir string) {
		t.Helper()
		binary, err := os.Executable()
		if err != nil {
			t.Fatal(err)
		}
		process = exec.Command(binary, "-test.run=^TestM4ServiceProcess$", "-test.timeout=90s")
		process.Env = append(os.Environ(), "SIGNALHUB_M4_TEST_DIRECTORY="+dir, "SIGNALHUB_M4_TEST_ENDPOINT="+strings.TrimPrefix(receiver.URL, "https://"))
		stderr, err := process.StderrPipe()
		if err != nil {
			t.Fatal(err)
		}
		if err = process.Start(); err != nil {
			t.Fatal(err)
		}
		started := make(chan string, 1)
		go func() {
			s := bufio.NewScanner(stderr)
			for s.Scan() {
				if address, ok := strings.CutPrefix(s.Text(), "signalhub listening on "); ok {
					started <- "http://" + address
				}
			}
		}()
		select {
		case base = <-started:
		case <-time.After(20 * time.Second):
			stop()
			t.Fatal("M5 service startup timeout")
		}
	}
	client := &http.Client{Timeout: 15 * time.Second}
	call := func(method, path, role string, body []byte, want int) map[string]any {
		t.Helper()
		r, err := http.NewRequest(method, base+path, bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set("Authorization", "Bearer "+tokens[role])
		r.Header.Set("Content-Type", "application/json")
		if path == "/v1/events" {
			r.Header.Set("Content-Type", "application/cloudevents+json")
		}
		response, err := client.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != want {
			t.Fatalf("%s %s: status=%d want=%d body=%s", method, path, response.StatusCode, want, raw)
		}
		var value map[string]any
		if err = json.Unmarshal(raw, &value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	wait := func(label string, f func() bool) {
		t.Helper()
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			if f() {
				return
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatal("M5 timeout: " + label)
	}
	state := func(name string) map[string]any {
		t.Helper()
		page := call("GET", "/v1/deliveries?subscription="+name, "reader", nil, 200)
		items := page["items"].([]any)
		if len(items) == 0 {
			return nil
		}
		return items[0].(map[string]any)
	}
	maintenance := func(args ...string) {
		t.Helper()
		var output bytes.Buffer
		if err := run(t.Context(), args, &output); err != nil {
			t.Fatalf("maintenance %s: %v (%s)", args[0], err, output.String())
		}
	}
	start(source)
	original := map[string][]byte{}
	ids := map[string]int64{}
	// Seed sequentially so pending and DLQ are fully materialized before the held
	// lease blocks the serial sender. Every event is beyond retention.
	for _, name := range []string{"pending", "dlq", "lease"} {
		raw, _ := json.Marshal(map[string]any{"specversion": "1.0", "id": name, "source": "urn:example:demo:service", "type": "demo.event." + name, "time": "2026-01-01T12:00:00Z", "summary": "M5 isolated recovery"})
		original[name] = raw
		value := call("POST", "/v1/events", "source", raw, 202)
		ids[name] = int64(value["seq"].(float64))
		want := name
		if name == "lease" {
			want = "inflight"
		}
		wait(name, func() bool {
			d := state(name)
			return d != nil && d["state"] == want && d["attempt_count"].(float64) == 1
		})
	}
	archive := filepath.Join(source, "archive")
	maintenance("archive", "run", "--db", filepath.Join(source, "hub.db"), "--archive-dir", archive)
	maintenance("archive", "verify", "--db", filepath.Join(source, "hub.db"), "--archive-dir", archive, "--day", "2026-01-01")
	for _, seq := range ids {
		call("GET", fmt.Sprintf("/v1/events/%d", seq), "reader", nil, 404)
	}
	for name, raw := range original {
		d := call("POST", "/v1/events", "source", raw, 200)
		if !d["duplicate"].(bool) || int64(d["seq"].(float64)) != ids[name] {
			t.Fatal("purged identity lost", d)
		}
	}
	t.Log("M5 real service: archived pending/inflight/DLQ event bodies; all original identities still deduplicate")
	snapshot := filepath.Join(t.TempDir(), "snapshot.sqlite")
	maintenance("backup", "--db", filepath.Join(source, "hub.db"), "--output", snapshot)
	before, err := os.ReadFile(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(before)
	stop()
	repaired.Store(true)
	maintenance("restore", "--backup", snapshot, "--db", filepath.Join(isolated, "hub.db"), "--reason", "isolated M5 delivery recovery")
	// Copy only this test's immutable archive into its isolated sibling; no real
	// config, credentials, backup, or runtime data enters the drill.
	if err := filepath.WalkDir(archive, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(archive, path)
		if err != nil {
			return err
		}
		dest := filepath.Join(isolated, "archive", relative)
		if d.IsDir() {
			return os.MkdirAll(dest, 0700)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(dest, raw, 0600)
	}); err != nil {
		t.Fatal(err)
	}
	maintenance("archive", "import", "--db", filepath.Join(isolated, "hub.db"), "--archive-dir", filepath.Join(isolated, "archive"), "--day", "2026-01-01", "--reason", "query restored delivery context")
	start(isolated)
	for name, seq := range ids {
		d := call("GET", fmt.Sprintf("/v1/events/%d", seq), "reader", nil, 200)
		item := d["item"].(map[string]any)
		if item["restored"] != true || item["event"].(map[string]any)["id"] != name {
			t.Fatal("restored context", d)
		}
	}
	if state("lease")["state"] != "inflight" || leaseReceipts.Load() != 1 {
		t.Fatal("restored lease prematurely resent")
	}
	if state("pending")["attempt_count"].(float64) != 1 || state("dlq")["state"] != "dlq" {
		t.Fatal("restore reset delivery states")
	}
	setClock(isolated, now.Add(121*time.Second))
	for _, name := range []string{"pending", "lease"} {
		wait(name+" recovery", func() bool { d := state(name); return d["state"] == "succeeded" && d["attempt_count"].(float64) == 2 })
	}
	dlqID := state("dlq")["delivery_id"].(string)
	path := "/v1/deliveries/" + url.PathEscape(dlqID) + ":replay"
	call("POST", path, "reader", []byte(`{"reason":"no authority"}`), 403)
	call("POST", path, "owner", []byte(`{"reason":"receiver repaired after isolated restore"}`), 202)
	wait("DLQ audited replay", func() bool {
		d := state("dlq")
		return d["state"] == "succeeded" && d["delivery_id"] == dlqID && d["attempt_count"].(float64) == 2
	})
	stop()
	for name, raw := range original {
		var received []byte
		if err := receipts.QueryRow("SELECT body FROM receipts WHERE id=?", fmt.Sprintf("%s:%d", name, ids[name])).Scan(&received); err != nil || !bytes.Equal(received, raw) {
			t.Fatalf("stable signed body %s: %v", name, err)
		}
	}
	var count int
	if err := receipts.QueryRow("SELECT COUNT(*) FROM receipts").Scan(&count); err != nil || count != 3 {
		t.Fatalf("receiver durable dedup count=%d err=%v", count, err)
	}
	restoredDB, err := sql.Open("sqlite", filepath.Join(isolated, "hub.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer restoredDB.Close()
	for _, action := range []string{"backup.restore", "archive.import", "delivery.replay"} {
		if err := restoredDB.QueryRow("SELECT COUNT(*) FROM audit_log WHERE action=?", action).Scan(&count); err != nil || count != 1 {
			t.Fatalf("audit %s count=%d err=%v", action, count, err)
		}
	}
	after, err := os.ReadFile(snapshot)
	if err != nil || sha256.Sum256(after) != digest {
		t.Fatal("original backup changed", err)
	}
	t.Log("M5 isolated snapshot restart: query restored context, pending retry, inflight lease fence, same-ID DLQ replay, durable signed receiver dedup and three audits; backup hash unchanged")
}
