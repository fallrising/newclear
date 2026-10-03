package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type logStore struct {
	mu    sync.Mutex
	files map[string]*os.File
}

func newLogStore(dir string) (*logStore, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	store := &logStore{files: make(map[string]*os.File)}
	for _, name := range []string{"requests", "fingerprints", "events"} {
		file, err := os.OpenFile(filepath.Join(dir, name+".jsonl"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
		if err != nil {
			_ = store.Close()
			return nil, err
		}
		store.files[name] = file
	}
	return store, nil
}

func (store *logStore) append(name string, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	store.mu.Lock()
	defer store.mu.Unlock()
	file := store.files[name]
	if file == nil {
		return fmt.Errorf("unknown observation log %q", name)
	}
	if _, err := file.Write(data); err != nil {
		return err
	}
	return file.Sync()
}

func (store *logStore) Close() error {
	store.mu.Lock()
	defer store.mu.Unlock()
	var first error
	for _, file := range store.files {
		if err := file.Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}

type requestMetadata struct {
	ReceivedAt              string            `json:"receivedAt"`
	RunID                   string            `json:"runId"`
	RequestID               string            `json:"requestId"`
	SessionID               string            `json:"sessionId"`
	FingerprintID           string            `json:"fingerprintId,omitempty"`
	Method                  string            `json:"method"`
	Path                    string            `json:"path"`
	HTTPVersion             string            `json:"httpVersion"`
	RemoteAddr              string            `json:"remoteAddr"`
	ReportedClientIP        string            `json:"reportedClientIp"`
	ReportedClientIPSource  string            `json:"reportedClientIpSource"`
	ForwardedHeadersTrusted bool              `json:"forwardedHeadersTrusted"`
	OriginTLSObserved       bool              `json:"originTlsObserved"`
	ForwardedScheme         string            `json:"forwardedScheme,omitempty"`
	Headers                 map[string]string `json:"headers"`
}

type requestContextKey struct{}

var allowedHeaders = []string{
	"User-Agent", "Accept-Language", "Accept-Encoding",
	"Sec-CH-UA", "Sec-CH-UA-Mobile", "Sec-CH-UA-Platform",
	"Sec-CH-UA-Full-Version", "Sec-CH-UA-Full-Version-List",
	"Sec-CH-UA-Platform-Version", "Sec-CH-UA-Arch", "Sec-CH-UA-Bitness", "Sec-CH-UA-Model", "Sec-CH-UA-WoW64",
	"Sec-Fetch-Dest", "Sec-Fetch-Mode", "Sec-Fetch-Site", "Sec-Fetch-User",
	"CF-Ray", "CF-Connecting-IP", "X-Forwarded-For", "X-Forwarded-Proto",
}

func validSession(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 16 && value == strings.ToLower(value)
}

func requestInfo(r *http.Request) *requestMetadata {
	return r.Context().Value(requestContextKey{}).(*requestMetadata)
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	if w.status != 0 {
		return
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(data)
}

func (app *application) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		sessionID := ""
		if cookie, err := r.Cookie("daylight_session"); err == nil && validSession(cookie.Value) {
			sessionID = cookie.Value
		}
		if sessionID == "" {
			var err error
			sessionID, err = randomID()
			if err != nil {
				sendJSON(w, 500, map[string]any{"error": "無法建立觀察工作階段。"})
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "daylight_session", Value: sessionID, Path: "/", HttpOnly: true, Secure: r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https"), SameSite: http.SameSiteLaxMode})
		}
		requestID, err := randomID()
		if err != nil {
			sendJSON(w, 500, map[string]any{"error": "無法建立請求記錄。"})
			return
		}
		headers := make(map[string]string)
		for _, key := range allowedHeaders {
			if value := r.Header.Get(key); value != "" {
				headers[key] = value
			}
		}
		clientIP, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			clientIP = r.RemoteAddr
		}
		ipSource := "remoteAddr"
		if reported := r.Header.Get("CF-Connecting-IP"); reported != "" {
			clientIP, ipSource = strings.TrimSpace(reported), "CF-Connecting-IP"
		} else if reported := r.Header.Get("X-Forwarded-For"); reported != "" {
			clientIP, ipSource = strings.TrimSpace(strings.Split(reported, ",")[0]), "X-Forwarded-For"
		}
		app.mu.RLock()
		fingerprintID := app.fingerprints[sessionID]
		app.mu.RUnlock()
		info := &requestMetadata{
			ReceivedAt: started.UTC().Format(time.RFC3339Nano), RunID: app.runID, RequestID: requestID, SessionID: sessionID, FingerprintID: fingerprintID,
			Method: r.Method, Path: r.URL.Path, HTTPVersion: r.Proto, RemoteAddr: r.RemoteAddr,
			ReportedClientIP: clientIP, ReportedClientIPSource: ipSource, ForwardedHeadersTrusted: false,
			OriginTLSObserved: r.TLS != nil, ForwardedScheme: r.Header.Get("X-Forwarded-Proto"), Headers: headers,
		}
		w.Header().Set("X-Request-ID", requestID)
		wrapped := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(wrapped, r.WithContext(context.WithValue(r.Context(), requestContextKey{}, info)))
		if wrapped.status == 0 {
			wrapped.status = http.StatusOK
		}
		// Look up again so the fingerprint POST itself and concurrent requests
		// can be joined to a fingerprint successfully captured in this session.
		app.mu.RLock()
		info.FingerprintID = app.fingerprints[sessionID]
		app.mu.RUnlock()
		record := struct {
			*requestMetadata
			Status     int     `json:"status"`
			DurationMS float64 `json:"durationMs"`
		}{info, wrapped.status, float64(time.Since(started).Microseconds()) / 1000}
		if err := app.logs.append("requests", record); err != nil {
			log.Printf("request observation could not be saved: %v", err)
		}
	})
}

var fingerprintSections = []string{"browser", "device", "screen", "viewport", "locale", "capabilities", "rendering", "limitations", "context"}

// json.Marshal sorts map keys, and decoding all nested objects avoids hashing
// source key order. The resulting hash is an experimental configuration label,
// never a proof of a person, unique machine, or human/automation distinction.
func fingerprintHash(payload map[string]json.RawMessage) (string, error) {
	stable := make(map[string]any)
	for _, key := range []string{"browser", "device", "screen", "locale", "rendering"} {
		var value any
		if raw, ok := payload[key]; ok {
			if err := json.Unmarshal(raw, &value); err != nil {
				return "", err
			}
			stable[key] = omitTransientFields(value)
		}
	}
	encoded, err := json.Marshal(stable)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(encoded)
	return hex.EncodeToString(hash[:]), nil
}

func omitTransientFields(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		filtered := make(map[string]any)
		for key, child := range typed {
			switch strings.ToLower(key) {
			case "timestamp", "timestamps", "collectedat", "receivedat", "clienttime", "createdat", "updatedat", "recordedat", "generatedat", "sessionid", "sid", "cookie", "cookies":
				continue
			}
			filtered[key] = omitTransientFields(child)
		}
		return filtered
	case []any:
		filtered := make([]any, len(typed))
		for i, child := range typed {
			filtered[i] = omitTransientFields(child)
		}
		return filtered
	default:
		return value
	}
}

func (app *application) captureFingerprint(w http.ResponseWriter, r *http.Request) error {
	data, err := readObject(w, r, 64*1024)
	if err != nil {
		return err
	}
	var version int
	if json.Unmarshal(data["schemaVersion"], &version) != nil || version != 1 {
		return fail(400, "schemaVersion 必須為 1。")
	}
	payload := map[string]json.RawMessage{"schemaVersion": json.RawMessage("1")}
	for _, name := range fingerprintSections {
		raw, ok := data[name]
		if !ok {
			continue
		}
		var object map[string]json.RawMessage
		if json.Unmarshal(raw, &object) != nil || object == nil {
			return fail(400, name+" 必須為 JSON 物件。")
		}
		payload[name] = raw
	}
	if len(payload) == 1 {
		return fail(400, "請提供瀏覽器或設備觀察資料。")
	}
	id, err := fingerprintHash(payload)
	if err != nil {
		return err
	}
	info := requestInfo(r)
	receivedAt := time.Now().UTC().Format(time.RFC3339Nano)
	serverInfo := *info
	serverInfo.FingerprintID = id
	record := map[string]any{
		"receivedAt": receivedAt, "runId": app.runID, "sessionId": info.SessionID, "requestId": info.RequestID,
		"fingerprintId": id, "fingerprintMeaning": "experimental browser configuration hash; not a unique identity", "client": payload, "server": serverInfo,
	}
	if err := app.logs.append("fingerprints", record); err != nil {
		return err
	}
	app.mu.Lock()
	app.fingerprints[info.SessionID] = id
	app.mu.Unlock()
	sendJSON(w, 201, map[string]any{"fingerprintId": id, "sessionId": info.SessionID, "runId": app.runID, "receivedAt": receivedAt})
	return nil
}

var allowedEventTypes = map[string]bool{
	"page_view": true, "tutorial_start": true, "tutorial_step": true, "tutorial_complete": true,
	"task_create": true, "task_update": true, "task_delete": true, "filter_change": true, "search": true,
}

func eventDetails(data map[string]json.RawMessage) (map[string]any, error) {
	result := make(map[string]any)
	for _, key := range []string{"step", "action", "taskId", "project", "status", "queryLength", "tutorialId", "isTrusted", "eventKind", "pointerType", "inputType", "elapsedMs"} {
		raw, present := data[key]
		if !present {
			continue
		}
		if key == "isTrusted" {
			var value bool
			if json.Unmarshal(raw, &value) != nil || isJSONNull(raw) {
				return nil, fail(400, key+" 必須為布林值。")
			}
			result[key] = value
			continue
		}
		if key == "elapsedMs" {
			var value float64
			if json.Unmarshal(raw, &value) != nil || isJSONNull(raw) || value < 0 || value > 86400000 {
				return nil, fail(400, key+" 必須為 0 至 86400000 的有限數字。")
			}
			result[key] = value
			continue
		}
		if key == "step" || key == "queryLength" {
			var number int
			if json.Unmarshal(raw, &number) != nil || isJSONNull(raw) || number < 0 || number > 10000 {
				return nil, fail(400, key+" 必須為 0 至 10000 的整數。")
			}
			result[key] = number
			continue
		}
		var value string
		if json.Unmarshal(raw, &value) != nil || isJSONNull(raw) || len(value) > 128 {
			return nil, fail(400, key+" 必須為 128 bytes 以內的字串。")
		}
		result[key] = value
	}
	return result, nil
}

func (app *application) captureEvent(w http.ResponseWriter, r *http.Request) error {
	data, err := readObject(w, r, 16*1024)
	if err != nil {
		return err
	}
	var eventType string
	if json.Unmarshal(data["type"], &eventType) != nil || !allowedEventTypes[eventType] {
		return fail(400, "不支援的事件類型。")
	}
	details := make(map[string]json.RawMessage)
	if raw, present := data["details"]; present {
		if json.Unmarshal(raw, &details) != nil || details == nil {
			return fail(400, "details 必須為 JSON 物件。")
		}
	}
	allowed, err := eventDetails(details)
	if err != nil {
		return err
	}
	clientTime := ""
	if raw, present := data["clientTime"]; present {
		if json.Unmarshal(raw, &clientTime) != nil {
			return fail(400, "clientTime 必須為 ISO 日期字串。")
		}
		parsed, err := time.Parse(time.RFC3339Nano, clientTime)
		if err != nil {
			return fail(400, "clientTime 必須為 ISO 日期字串。")
		}
		clientTime = parsed.UTC().Format(time.RFC3339Nano)
	}
	info := requestInfo(r)
	app.mu.RLock()
	id := app.fingerprints[info.SessionID]
	app.mu.RUnlock()
	record := map[string]any{
		"receivedAt": time.Now().UTC().Format(time.RFC3339Nano), "runId": app.runID, "sessionId": info.SessionID,
		"requestId": info.RequestID, "fingerprintId": id, "type": eventType, "details": allowed, "clientTime": clientTime,
	}
	if err := app.logs.append("events", record); err != nil {
		return err
	}
	sendJSON(w, 201, map[string]any{"recorded": true, "runId": app.runID})
	return nil
}
