package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func testApplication(t *testing.T) (*application, string) {
	t.Helper()
	dir := t.TempDir()
	public := filepath.Join(dir, "public")
	if err := os.Mkdir(public, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(public, "index.html"), []byte("<html>fixture</html>"), 0600); err != nil {
		t.Fatal(err)
	}
	logs := filepath.Join(dir, "observations")
	app, err := newApplication(public, logs, "unit-run")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = app.logs.Close() })
	return app, logs
}

func perform(app *application, method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	app.handler().ServeHTTP(response, req)
	return response
}

func decodeResponse(t *testing.T, response *httptest.ResponseRecorder) map[string]json.RawMessage {
	t.Helper()
	var data map[string]json.RawMessage
	if err := json.Unmarshal(response.Body.Bytes(), &data); err != nil {
		t.Fatalf("response status=%d invalid JSON: %s", response.Code, response.Body.String())
	}
	return data
}

func readRecords(t *testing.T, dir, name string) []map[string]any {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(dir, name+".jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(string(body)), "\n") {
		if line == "" {
			continue
		}
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatal(err)
		}
		records = append(records, record)
	}
	return records
}

func TestCRUDAndTypedValidation(t *testing.T) {
	app, _ := testApplication(t)
	list := perform(app, "GET", "/api/tasks", "", nil)
	var initial []Task
	if err := json.Unmarshal(decodeResponse(t, list)["tasks"], &initial); err != nil || len(initial) != 6 {
		t.Fatalf("expected six seed tasks: %s", list.Body.String())
	}
	for _, input := range []string{
		`{"title":false}`, `{"title":""}`, `{"title":null}`, `{"title":"ok","completed":"true"}`,
		`{"title":"ok","project":"other"}`, `{"title":"ok","project":null}`, `{"title":"ok","priority":1}`,
		`{"title":"ok","completed":null}`, `{"title":"` + strings.Repeat("漢", 101) + `"}`,
	} {
		response := perform(app, "POST", "/api/tasks", input, nil)
		if response.Code != 400 {
			t.Errorf("input %s: expected 400, got %d", input, response.Code)
		}
	}
	created := perform(app, "POST", "/api/tasks", `{"title":"  Test task  ","project":"開發","priority":"low","completed":true}`, nil)
	if created.Code != 201 {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var task Task
	if err := json.Unmarshal(decodeResponse(t, created)["task"], &task); err != nil || task.Title != "Test task" || !task.Completed {
		t.Fatalf("unexpected task: %s", created.Body.String())
	}
	updated := perform(app, "PATCH", "/api/tasks/"+task.ID, `{"title":"Updated","completed":false}`, nil)
	if updated.Code != 200 {
		t.Fatalf("update: %d %s", updated.Code, updated.Body.String())
	}
	if err := json.Unmarshal(decodeResponse(t, updated)["task"], &task); err != nil || task.Title != "Updated" || task.Completed {
		t.Fatalf("unexpected update: %s", updated.Body.String())
	}
	if response := perform(app, "PATCH", "/api/tasks/"+task.ID, `{}`, nil); response.Code != 400 {
		t.Fatalf("empty update should fail: %d", response.Code)
	}
	if response := perform(app, "DELETE", "/api/tasks/"+task.ID, "", nil); response.Code != 200 || !strings.Contains(response.Body.String(), `"deleted":true`) {
		t.Fatalf("delete: %d %s", response.Code, response.Body.String())
	}
	if response := perform(app, "DELETE", "/api/tasks/"+task.ID, "", nil); response.Code != 404 {
		t.Fatalf("repeat delete should be 404: %d", response.Code)
	}
	final := perform(app, "GET", "/api/tasks", "", nil)
	var tasks []Task
	if err := json.Unmarshal(decodeResponse(t, final)["tasks"], &tasks); err != nil || len(tasks) != 6 {
		t.Fatalf("delete should restore six tasks: %s", final.Body.String())
	}
}

func TestBoundedJSONObjects(t *testing.T) {
	app, _ := testApplication(t)
	for _, body := range []string{`[]`, `null`, `true`, `1`, `"value"`, `{"title":"a"} {}`, `{broken}`} {
		response := perform(app, "POST", "/api/tasks", body, nil)
		if response.Code != 400 {
			t.Errorf("body %q: expected 400, got %d", body, response.Code)
		}
	}
	for _, path := range []string{"/api/tasks", "/api/events", "/api/fingerprint"} {
		response := perform(app, "POST", path, `{"padding":"`+strings.Repeat("x", 65*1024)+`"}`, nil)
		if response.Code != 413 {
			t.Errorf("%s: expected body limit 413, got %d", path, response.Code)
		}
	}
	req := httptest.NewRequest("POST", "/api/tasks", strings.NewReader(`{"title":"x"}`))
	req.Header.Set("Content-Type", "text/plain")
	recorder := httptest.NewRecorder()
	app.handler().ServeHTTP(recorder, req)
	if recorder.Code != 415 {
		t.Fatalf("content type: expected 415, got %d", recorder.Code)
	}
}

func TestStaticCannotEscapeOrExposeLogs(t *testing.T) {
	app, _ := testApplication(t)
	if response := perform(app, "GET", "/", "", nil); response.Code != 200 || !strings.Contains(response.Body.String(), "fixture") {
		t.Fatalf("index did not serve: %d %s", response.Code, response.Body.String())
	}
	for _, path := range []string{
		"/../observations/requests.jsonl", "/%2e%2e/observations/requests.jsonl", "/..%5cobservations/requests.jsonl",
		"/C:%5cWindows%5cwin.ini", "/.runtime/observations/requests.jsonl", "/api/logs", "/api/fingerprints", "/api/events",
	} {
		response := perform(app, "GET", path, "", nil)
		if response.Code == 200 {
			t.Errorf("forbidden log/traversal path succeeded: %s", path)
		}
	}
	if response := perform(app, "GET", "/", "", nil); response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff header")
	}
}

func TestLogDestinationCannotPublishObservations(t *testing.T) {
	for _, name := range []string{"public", "public-child", "directory-link", "public-link", "requests-link", "fingerprints-link", "events-link", "dangling-file-link", "dangling-directory-link"} {
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			public := filepath.Join(dir, "public")
			if err := os.Mkdir(public, 0700); err != nil {
				t.Fatal(err)
			}
			publicArgument := public
			logDir := filepath.Join(dir, "observations")
			exposedRoute := "/requests.jsonl"
			protectedFile := filepath.Join(public, "requests.jsonl")
			var before []byte
			link := func(target, alias string) {
				t.Helper()
				if err := os.Symlink(target, alias); err != nil {
					t.Skipf("symbolic links unavailable on this host: %v", err)
				}
			}
			switch name {
			case "public":
				logDir = public
			case "public-child":
				logDir = filepath.Join(public, "new", "observations")
				exposedRoute = "/new/observations/requests.jsonl"
				protectedFile = filepath.Join(logDir, "requests.jsonl")
			case "directory-link":
				link(public, logDir)
			case "public-link":
				publicArgument = filepath.Join(dir, "static-alias")
				link(public, publicArgument)
				logDir = public
			case "requests-link", "fingerprints-link", "events-link", "dangling-file-link":
				if err := os.Mkdir(logDir, 0700); err != nil {
					t.Fatal(err)
				}
				logName := strings.TrimSuffix(name, "-link")
				if name == "dangling-file-link" {
					logName = "requests"
				} else {
					before = []byte("private observation fixture\n")
					if err := os.WriteFile(protectedFile, before, 0600); err != nil {
						t.Fatal(err)
					}
				}
				link(protectedFile, filepath.Join(logDir, logName+".jsonl"))
			case "dangling-directory-link":
				future := filepath.Join(public, "future")
				link(future, logDir)
				exposedRoute = "/future/requests.jsonl"
				protectedFile = filepath.Join(future, "requests.jsonl")
			}

			app, err := newApplication(publicArgument, logDir, "unit-private-run")
			if err == nil {
				defer app.logs.Close()
				// On the unfixed implementation this writes actual observation
				// records, then exposes them through the ordinary static route.
				perform(app, "POST", "/api/fingerprint", `{"schemaVersion":1,"browser":{"userAgent":"private fixture browser"}}`, nil)
				response := perform(app, "GET", exposedRoute, "", nil)
				t.Fatalf("unsafe log destination accepted; public observation route returned %d", response.Code)
			}
			if !strings.Contains(err.Error(), "outside the public directory") {
				t.Fatalf("expected deliberate log isolation rejection, got %v", err)
			}
			current, readErr := os.ReadFile(protectedFile)
			if before == nil {
				if !os.IsNotExist(readErr) {
					t.Fatalf("rejected configuration created a public log: %v", readErr)
				}
			} else if readErr != nil || string(current) != string(before) {
				t.Fatalf("rejected configuration modified a public log target: %v", readErr)
			}
		})
	}
}

func TestLogDestinationOutsidePublicStillWorks(t *testing.T) {
	for _, useSymlink := range []bool{false, true} {
		t.Run(fmt.Sprintf("symlink=%t", useSymlink), func(t *testing.T) {
			dir := t.TempDir()
			public := filepath.Join(dir, "public")
			if err := os.Mkdir(public, 0700); err != nil {
				t.Fatal(err)
			}
			logDir := filepath.Join(dir, "public-observations", "new")
			if useSymlink {
				alias := filepath.Join(dir, "observation-alias")
				if err := os.MkdirAll(logDir, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(logDir, alias); err != nil {
					t.Skipf("symbolic links unavailable on this host: %v", err)
				}
				logDir = alias
			}
			app, err := newApplication(public, logDir, "unit-safe-run")
			if err != nil {
				t.Fatal(err)
			}
			defer app.logs.Close()
			if response := perform(app, "GET", "/api/health", "", nil); response.Code != 200 {
				t.Fatalf("safe log directory broke the server: %d", response.Code)
			}
			if records := readRecords(t, logDir, "requests"); len(records) != 1 {
				t.Fatalf("safe log directory lost observations: %d", len(records))
			}
			if response := perform(app, "GET", "/requests.jsonl", "", nil); response.Code == 200 {
				t.Fatal("safe log directory was exposed as a public file")
			}
		})
	}
}

func TestFingerprintCanonicalHashExcludesContextAndViewport(t *testing.T) {
	var one, two, changed map[string]json.RawMessage
	_ = json.Unmarshal([]byte(`{"browser":{"version":"123","nested":{"b":2,"a":1},"collectedAt":"old"},"device":{"platform":"Windows","sessionId":"one"},"screen":{"width":1920},"locale":{"language":"zh-TW"},"rendering":{"vendor":"GPU"},"context":{"at":"old","timestamp":"old"},"viewport":{"width":600}}`), &one)
	_ = json.Unmarshal([]byte(`{"rendering":{"vendor":"GPU"},"locale":{"language":"zh-TW"},"screen":{"width":1920},"device":{"platform":"Windows","sessionId":"two"},"browser":{"nested":{"a":1,"b":2},"version":"123","collectedAt":"new"},"context":{"at":"new","timestamp":"new"},"viewport":{"width":800},"sessionId":"ignored"}`), &two)
	_ = json.Unmarshal([]byte(`{"browser":{"version":"124","nested":{"b":2,"a":1}},"device":{"platform":"Windows"},"screen":{"width":1920},"locale":{"language":"zh-TW"},"rendering":{"vendor":"GPU"}}`), &changed)
	a, err := fingerprintHash(one)
	if err != nil {
		t.Fatal(err)
	}
	b, err := fingerprintHash(two)
	if err != nil {
		t.Fatal(err)
	}
	c, err := fingerprintHash(changed)
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != 64 || a != b || a == c {
		t.Fatalf("unexpected hash stability: %s %s %s", a, b, c)
	}
}

func TestSessionAssociationAndRedactedObservationLogs(t *testing.T) {
	app, dir := testApplication(t)
	first := perform(app, "GET", "/", "", nil)
	cookies := first.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "daylight_session" || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("unexpected session cookies: %+v", cookies)
	}
	cookie := cookies[0]
	req := httptest.NewRequest("POST", "/api/fingerprint?never=record-query", strings.NewReader(`{"schemaVersion":1,"browser":{"userAgent":"test browser","plugins":[]},"device":{"platform":"test"},"unknownSecret":"ignore"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "TestBrowser/1")
	req.Header.Set("Authorization", "NeverRecordThis")
	req.Header.Set("CF-Connecting-IP", "203.0.113.2")
	req.Header.Set("X-Forwarded-Proto", "https")
	req.AddCookie(cookie)
	response := httptest.NewRecorder()
	app.handler().ServeHTTP(response, req)
	if response.Code != 201 {
		t.Fatalf("fingerprint failed: %d %s", response.Code, response.Body.String())
	}
	data := decodeResponse(t, response)
	var fingerprintID string
	_ = json.Unmarshal(data["fingerprintId"], &fingerprintID)
	event := perform(app, "POST", "/api/events", `{"type":"search","clientTime":"2026-10-03T01:00:00.123Z","details":{"queryLength":7,"isTrusted":true,"eventKind":"input","pointerType":"mouse","inputType":"insertText","elapsedMs":125.5,"query":"NeverRecordQuery","title":"NeverRecordTask","rawInput":"NeverRecordInput"}}`, cookie)
	if event.Code != 201 {
		t.Fatalf("event failed: %d %s", event.Code, event.Body.String())
	}
	fingerprints := readRecords(t, dir, "fingerprints")
	if len(fingerprints) != 1 || fingerprints[0]["fingerprintId"] != fingerprintID || fingerprints[0]["sessionId"] != cookie.Value {
		t.Fatalf("fingerprint association: %+v", fingerprints)
	}
	server := fingerprints[0]["server"].(map[string]any)
	if server["reportedClientIp"] != "203.0.113.2" || server["reportedClientIpSource"] != "CF-Connecting-IP" || server["originTlsObserved"] != false || server["forwardedScheme"] != "https" || server["forwardedHeadersTrusted"] != false {
		t.Fatalf("reported headers confused with observed TLS: %+v", server)
	}
	events := readRecords(t, dir, "events")
	if len(events) != 1 || events[0]["fingerprintId"] != fingerprintID || events[0]["sessionId"] != cookie.Value {
		t.Fatalf("event association: %+v", events)
	}
	trustedDetails := events[0]["details"].(map[string]any)
	if trustedDetails["isTrusted"] != true || trustedDetails["elapsedMs"] != 125.5 || trustedDetails["inputType"] != "insertText" {
		t.Fatalf("browser event properties missing: %+v", trustedDetails)
	}
	requests := readRecords(t, dir, "requests")
	if len(requests) != 3 || requests[1]["fingerprintId"] != fingerprintID || requests[2]["fingerprintId"] != fingerprintID {
		t.Fatalf("request association: %+v", requests)
	}
	for _, name := range []string{"requests", "fingerprints", "events"} {
		body, err := os.ReadFile(filepath.Join(dir, name+".jsonl"))
		if err != nil {
			t.Fatal(err)
		}
		for _, forbidden := range []string{"NeverRecordThis", "NeverRecordQuery", "NeverRecordTask", "NeverRecordInput", "record-query", "unknownSecret", "Authorization", `"Cookie"`} {
			if strings.Contains(string(body), forbidden) {
				t.Errorf("%s log leaked %s", name, forbidden)
			}
		}
	}
	secureReq := httptest.NewRequest("GET", "/api/health", nil)
	secureReq.Header.Set("X-Forwarded-Proto", "https")
	secureResponse := httptest.NewRecorder()
	app.handler().ServeHTTP(secureResponse, secureReq)
	if secureCookies := secureResponse.Result().Cookies(); len(secureCookies) != 1 || !secureCookies[0].Secure {
		t.Fatal("forwarded HTTPS must set Secure session cookie")
	}
}

func TestFingerprintAndEventValidation(t *testing.T) {
	app, _ := testApplication(t)
	for _, body := range []string{`{"schemaVersion":2,"browser":{}}`, `{"schemaVersion":1,"browser":[]}`, `{"schemaVersion":1,"browser":null}`, `{"schemaVersion":1}`, `[]`} {
		if response := perform(app, "POST", "/api/fingerprint", body, nil); response.Code != 400 {
			t.Errorf("fingerprint input %s: expected 400, got %d", body, response.Code)
		}
	}
	for _, body := range []string{`{"type":"unknown"}`, `{"type":"search","details":[]}`, `{"type":"search","details":{"queryLength":"hello"}}`, `{"type":"tutorial_step","details":{"step":-1}}`, `{"type":"page_view","clientTime":"yesterday"}`, `{"type":"task_update","details":{"isTrusted":"true"}}`, `{"type":"task_update","details":{"elapsedMs":-1}}`, `{"type":"task_update","details":{"elapsedMs":1e999}}`, `{"type":"task_update","details":{"elapsedMs":86400001}}`} {
		if response := perform(app, "POST", "/api/events", body, nil); response.Code != 400 {
			t.Errorf("event input %s: expected 400, got %d", body, response.Code)
		}
	}
}

func TestConcurrentTaskCreatesAndLogLines(t *testing.T) {
	app, dir := testApplication(t)
	const count = 12
	var group sync.WaitGroup
	statuses := make(chan int, count)
	for i := 0; i < count; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			response := perform(app, "POST", "/api/tasks", fmt.Sprintf(`{"title":"Concurrent %d"}`, i), nil)
			statuses <- response.Code
		}(i)
	}
	group.Wait()
	close(statuses)
	for status := range statuses {
		if status != 201 {
			t.Errorf("concurrent create failed: %d", status)
		}
	}
	if len(app.tasks) != 6+count {
		t.Fatalf("lost task updates: %d", len(app.tasks))
	}
	if records := readRecords(t, dir, "requests"); len(records) != count {
		t.Fatalf("lost/interleaved request logs: %d", len(records))
	}
}
