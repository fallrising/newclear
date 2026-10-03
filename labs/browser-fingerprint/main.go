package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"
)

type Task struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Project   string `json:"project"`
	Priority  string `json:"priority"`
	Completed bool   `json:"completed"`
}

func seedTasks() []Task {
	return []Task{
		{"task-1", "整理新品牌的視覺靈感", "設計", "high", false},
		{"task-2", "完成首頁互動原型", "設計", "medium", false},
		{"task-3", "串接任務清單 API", "開發", "high", false},
		{"task-4", "讀完一本想讀很久的書", "生活", "low", false},
		{"task-5", "建立專案資料夾與開發環境", "開發", "medium", true},
		{"task-6", "安排週末的散步路線", "生活", "low", true},
	}
}

type application struct {
	publicDir string
	runID     string
	logs      *logStore
	mu        sync.RWMutex
	tasks     []Task
	// The cookie relates observations in this process; it is not an identity.
	fingerprints map[string]string
}

func newApplication(publicDir, logDir, runID string) (*application, error) {
	resolved, err := filepath.Abs(publicDir)
	if err != nil {
		return nil, err
	}
	if err := validateLogDestination(resolved, logDir); err != nil {
		return nil, err
	}
	logs, err := newLogStore(logDir)
	if err != nil {
		return nil, err
	}
	return &application{publicDir: resolved, runID: runID, logs: logs, tasks: seedTasks(), fingerprints: make(map[string]string)}, nil
}

// Resolve existing aliases as well as destinations that have not been created
// yet. A dangling symlink is followed explicitly so it cannot hide a future
// log file inside public merely because EvalSymlinks reports a missing target.
func resolveDestination(target string) (string, error) {
	absolute, err := filepath.Abs(target)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err == nil {
		return resolved, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	info, statErr := os.Lstat(absolute)
	if statErr == nil && info.Mode()&os.ModeSymlink != 0 {
		linked, err := os.Readlink(absolute)
		if err != nil {
			return "", err
		}
		if !filepath.IsAbs(linked) {
			linked = filepath.Join(filepath.Dir(absolute), linked)
		}
		return resolveDestination(linked)
	}
	if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return "", statErr
	}
	parent := filepath.Dir(absolute)
	if parent == absolute {
		return "", err
	}
	resolvedParent, err := resolveDestination(parent)
	if err != nil {
		return "", err
	}
	return filepath.Join(resolvedParent, filepath.Base(absolute)), nil
}

func validateLogDestination(publicDir, logDir string) error {
	publicTarget, err := resolveDestination(publicDir)
	if err != nil {
		return fmt.Errorf("resolve public directory: %w", err)
	}
	logTarget, err := resolveDestination(logDir)
	if err != nil {
		return fmt.Errorf("resolve observation directory: %w", err)
	}
	if insideDirectory(publicTarget, logTarget) {
		return errors.New("observation logs must stay outside the public directory")
	}
	for _, name := range []string{"requests.jsonl", "fingerprints.jsonl", "events.jsonl"} {
		fileTarget, err := resolveDestination(filepath.Join(logDir, name))
		if err != nil {
			return fmt.Errorf("resolve observation file %s: %w", name, err)
		}
		if insideDirectory(publicTarget, fileTarget) {
			return errors.New("observation logs must stay outside the public directory")
		}
	}
	return nil
}

type apiError struct {
	status int
	text   string
}

func (e *apiError) Error() string { return e.text }

func fail(status int, text string) error { return &apiError{status, text} }

func isJSONNull(raw json.RawMessage) bool { return strings.TrimSpace(string(raw)) == "null" }

func sendJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

// Reading a bounded byte buffer before decoding catches trailing data as well
// as invalid top-level types, without retaining request bodies in the logs.
func readObject(w http.ResponseWriter, r *http.Request, limit int64) (map[string]json.RawMessage, error) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return nil, fail(http.StatusUnsupportedMediaType, "請使用 application/json 傳送資料。")
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			return nil, fail(http.StatusRequestEntityTooLarge, fmt.Sprintf("資料超過 %d KB 上限。", limit/1024))
		}
		return nil, fail(http.StatusBadRequest, "無法讀取資料。")
	}
	trimmed := strings.TrimSpace(string(body))
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil, fail(http.StatusBadRequest, "請提供 JSON 物件。")
	}
	var data map[string]json.RawMessage
	if json.Unmarshal(body, &data) != nil || data == nil {
		return nil, fail(http.StatusBadRequest, "JSON 格式不正確。")
	}
	return data, nil
}

func validateTask(data map[string]json.RawMessage, partial bool) (map[string]any, error) {
	values := make(map[string]any)
	if raw, present := data["title"]; present || !partial {
		var title string
		if !present || json.Unmarshal(raw, &title) != nil || isJSONNull(raw) {
			return nil, fail(400, "任務名稱必須為 1 至 100 個字元。")
		}
		title = strings.TrimSpace(title)
		if title == "" || utf8.RuneCountInString(title) > 100 {
			return nil, fail(400, "任務名稱必須為 1 至 100 個字元。")
		}
		values["title"] = title
	}
	for _, field := range []string{"project", "priority"} {
		raw, present := data[field]
		if partial && !present {
			continue
		}
		value := "設計"
		if field == "priority" {
			value = "medium"
		}
		if present && (json.Unmarshal(raw, &value) != nil || isJSONNull(raw)) {
			return nil, fail(400, field+" 必須為有效的字串。")
		}
		if field == "project" && value != "設計" && value != "開發" && value != "生活" {
			return nil, fail(400, "專案必須為設計、開發或生活。")
		}
		if field == "priority" && value != "high" && value != "medium" && value != "low" {
			return nil, fail(400, "優先順序必須為 high、medium 或 low。")
		}
		values[field] = value
	}
	if raw, present := data["completed"]; present {
		var completed bool
		if json.Unmarshal(raw, &completed) != nil || isJSONNull(raw) {
			return nil, fail(400, "completed 必須為布林值。")
		}
		values["completed"] = completed
	}
	if partial && len(values) == 0 {
		return nil, fail(400, "請提供要更新的任務欄位。")
	}
	return values, nil
}

func applyTaskValues(task *Task, values map[string]any) {
	if value, ok := values["title"].(string); ok {
		task.Title = value
	}
	if value, ok := values["project"].(string); ok {
		task.Project = value
	}
	if value, ok := values["priority"].(string); ok {
		task.Priority = value
	}
	if value, ok := values["completed"].(bool); ok {
		task.Completed = value
	}
}

func (app *application) handler() http.Handler { return app.observe(http.HandlerFunc(app.serve)) }

func (app *application) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	// Browsers supporting UA Client Hints may report more detail on later requests.
	w.Header().Set("Accept-CH", "Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Model, Sec-CH-UA-WoW64")
	if err := app.route(w, r); err != nil {
		status, message := 500, "伺服器暫時無法處理請求。"
		var expected *apiError
		if errors.As(err, &expected) {
			status, message = expected.status, expected.text
		} else {
			log.Printf("request failed: %v", err)
		}
		sendJSON(w, status, map[string]any{"error": message})
	}
}

func (app *application) route(w http.ResponseWriter, r *http.Request) error {
	path := r.URL.Path
	if strings.ContainsAny(path, "\\\x00") {
		return fail(400, "無效的檔案路徑。")
	}
	if path == "/api/health" {
		if r.Method != http.MethodGet {
			return fail(405, "不支援此 HTTP 方法。")
		}
		sendJSON(w, 200, map[string]any{"status": "ok", "mode": "mock", "runtime": "go", "runId": app.runID})
		return nil
	}
	if path == "/api/fingerprint" {
		if r.Method != http.MethodPost {
			return fail(405, "不支援此 HTTP 方法。")
		}
		return app.captureFingerprint(w, r)
	}
	if path == "/api/events" {
		if r.Method != http.MethodPost {
			return fail(405, "不支援此 HTTP 方法。")
		}
		return app.captureEvent(w, r)
	}
	if path == "/api/tasks" {
		switch r.Method {
		case http.MethodGet:
			app.mu.RLock()
			tasks := append([]Task(nil), app.tasks...)
			app.mu.RUnlock()
			if tasks == nil {
				tasks = []Task{}
			}
			sendJSON(w, 200, map[string]any{"tasks": tasks})
			return nil
		case http.MethodPost:
			data, err := readObject(w, r, 16*1024)
			if err != nil {
				return err
			}
			values, err := validateTask(data, false)
			if err != nil {
				return err
			}
			id, err := randomID()
			if err != nil {
				return err
			}
			task := Task{ID: "task-" + id}
			applyTaskValues(&task, values)
			app.mu.Lock()
			app.tasks = append([]Task{task}, app.tasks...)
			app.mu.Unlock()
			sendJSON(w, 201, map[string]any{"task": task})
			return nil
		default:
			return fail(405, "不支援此 HTTP 方法。")
		}
	}
	if strings.HasPrefix(path, "/api/tasks/") && !strings.Contains(strings.TrimPrefix(path, "/api/tasks/"), "/") {
		if r.Method != http.MethodPatch && r.Method != http.MethodDelete {
			return fail(405, "不支援此 HTTP 方法。")
		}
		var values map[string]any
		if r.Method == http.MethodPatch {
			data, err := readObject(w, r, 16*1024)
			if err != nil {
				return err
			}
			values, err = validateTask(data, true)
			if err != nil {
				return err
			}
		}
		id := strings.TrimPrefix(path, "/api/tasks/")
		app.mu.Lock()
		defer app.mu.Unlock()
		for i := range app.tasks {
			if app.tasks[i].ID != id {
				continue
			}
			if r.Method == http.MethodDelete {
				app.tasks = append(app.tasks[:i], app.tasks[i+1:]...)
				sendJSON(w, 200, map[string]any{"deleted": true})
			} else {
				applyTaskValues(&app.tasks[i], values)
				sendJSON(w, 200, map[string]any{"task": app.tasks[i]})
			}
			return nil
		}
		return fail(404, "找不到這項任務。")
	}
	if path == "/api" || strings.HasPrefix(path, "/api/") {
		return fail(404, "找不到此 API。")
	}
	return app.serveStatic(w, r)
}

func insideDirectory(root, target string) bool {
	relative, err := filepath.Rel(root, target)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}

func (app *application) serveStatic(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return fail(405, "不支援此 HTTP 方法。")
	}
	path := r.URL.Path
	for _, segment := range strings.Split(path, "/") {
		if segment == "." || segment == ".." || strings.Contains(segment, ":") {
			return fail(403, "無法存取此路徑。")
		}
	}
	if path == "/" {
		path = "/index.html"
	}
	filePath := filepath.Join(app.publicDir, filepath.FromSlash(strings.TrimPrefix(path, "/")))
	if !insideDirectory(app.publicDir, filePath) {
		return fail(403, "無法存取此路徑。")
	}
	// Resolve symlinks too: an allowed public path must not point at logs or
	// other files outside the public directory.
	realRoot, err := filepath.EvalSymlinks(app.publicDir)
	if err != nil {
		return err
	}
	realPath, err := filepath.EvalSymlinks(filePath)
	if os.IsNotExist(err) {
		return fail(404, "找不到此檔案。")
	}
	if err != nil {
		return err
	}
	if !insideDirectory(realRoot, realPath) {
		return fail(403, "無法存取此路徑。")
	}
	file, err := os.Open(realPath)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fail(404, "找不到此檔案。")
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
	return nil
}

func randomID() (string, error) {
	var data [16]byte
	if _, err := rand.Read(data[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(data[:]), nil
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "4173"
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		log.Fatal("PORT must be an integer from 1 to 65535")
	}
	logDir := os.Getenv("LOG_DIR")
	if logDir == "" {
		logDir = filepath.Join(".runtime", "observations")
	}
	runID := os.Getenv("DEMO_RUN_ID")
	if runID == "" {
		runID = time.Now().UTC().Format("20060102T150405.000000000Z")
	}
	app, err := newApplication("public", logDir, runID)
	if err != nil {
		log.Fatal(err)
	}
	defer app.logs.Close()
	server := &http.Server{Addr: net.JoinHostPort("127.0.0.1", port), Handler: app.handler(), ReadHeaderTimeout: 15 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 5 * time.Second, MaxHeaderBytes: 32 * 1024}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("Daylight Go server running at http://%s; runId=%s; logs=%s", server.Addr, runID, logDir)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
