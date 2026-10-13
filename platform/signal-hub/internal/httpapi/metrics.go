package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/fallrising/newclear/platform/signal-hub/internal/auth"
	"github.com/fallrising/newclear/platform/signal-hub/internal/config"
	"github.com/fallrising/newclear/platform/signal-hub/internal/delivery"
	"github.com/fallrising/newclear/platform/signal-hub/internal/rules"
	"github.com/fallrising/newclear/platform/signal-hub/internal/store"
)

// ReloadOptions selects the same local configuration and credential files used
// at startup. Their paths and contents never appear in HTTP responses or events.
type ReloadOptions struct {
	ConfigPath, OwnerRef, ReadOnlyRef string
	Sender                            *delivery.Sender
	SenderFactory                     func([]delivery.Subscription, []string) (*delivery.Sender, error)
	Now                               func() time.Time
}

func NewRuntime(db *store.Store, credentials *auth.Authenticator, options ReloadOptions) *Server {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &Server{db: db, auth: credentials, now: now, reloadOptions: options, sender: options.Sender}
}

func (s *Server) EvaluateSources(ctx context.Context, now time.Time) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.db.EvaluateSources(ctx, now)
}

func (s *Server) EvaluateRules(ctx context.Context, now time.Time) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.db.EvaluateRules(ctx, now)
}

func (s *Server) reload(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1))
	if err != nil || len(body) != 0 || r.URL.RawQuery != "" {
		fail(w, 400, "invalid_config", "reload accepts no body or query")
		return
	}
	if s.reloadOptions.ConfigPath == "" {
		fail(w, 503, "unavailable", "configuration reload unavailable")
		return
	}
	now := s.now().UTC()
	reject := func() {
		if s.db.RecordConfigRejected(r.Context(), now) != nil {
			fail(w, 503, "unavailable", "configuration audit unavailable; retry later")
			return
		}
		fail(w, 400, "invalid_config", "configuration rejected; previous configuration remains active")
	}
	cfg, err := config.Load(s.reloadOptions.ConfigPath)
	if err != nil {
		reject()
		return
	}
	definitions, err := rules.Parse(cfg.Rules)
	if err != nil {
		reject()
		return
	}
	credentials, err := auth.New(cfg.Sources, s.reloadOptions.OwnerRef, s.reloadOptions.ReadOnlyRef)
	if err != nil {
		reject()
		return
	}
	subscriptions, err := delivery.Parse(cfg.Subscriptions, cfg.WebhookAllowlist)
	if err != nil {
		reject()
		return
	}
	factory := s.reloadOptions.SenderFactory
	if factory == nil {
		factory = delivery.NewSender
	}
	sender, err := factory(subscriptions, cfg.WebhookAllowlist)
	if err != nil {
		reject()
		return
	}
	if err := s.db.ConfigureRuntime(r.Context(), cfg.Sources, definitions, now, true, subscriptions); err != nil {
		if errors.Is(err, store.ErrInvalidConfig) {
			reject()
			return
		}
		fail(w, 503, "unavailable", "configuration store unavailable; previous configuration remains active")
		return
	}
	s.auth = credentials
	s.sender = sender
	// Evaluation is a projection after activation. Failure keeps the pending
	// backfill for the next minute; it must not turn an accepted reload into 400.
	_ = s.db.EvaluateRules(r.Context(), now)
	writeJSON(w, 200, map[string]string{"reloaded_at": now.Format(time.RFC3339Nano)})
}

var ruleIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)

func metricParams(raw string, rulesOnly bool) (url.Values, int, error) {
	values, err := url.ParseQuery(raw)
	if err != nil {
		return nil, 0, err
	}
	for key, entries := range values {
		allowed := key == "cursor" || key == "limit" || !rulesOnly && (key == "from" || key == "to" || key == "group")
		if !allowed || len(entries) != 1 || entries[0] == "" {
			return nil, 0, store.ErrInvalidQuery
		}
	}
	limit := 100
	if raw := values.Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 200 {
			return nil, 0, store.ErrInvalidQuery
		}
	}
	return values, limit, nil
}

func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/v1/metrics/")
	values, limit, err := metricParams(r.URL.RawQuery, false)
	if err != nil || !ruleIDPattern.MatchString(id) {
		fail(w, 400, "invalid_query", "invalid rule or query parameters")
		return
	}
	page, err := s.db.ListMetrics(r.Context(), id, store.MetricQuery{From: values.Get("from"), To: values.Get("to"), Group: values.Get("group"), Cursor: values.Get("cursor"), Limit: limit})
	if errors.Is(err, store.ErrInvalidQuery) {
		fail(w, 400, "invalid_query", "invalid metric filters or cursor")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		fail(w, 404, "not_found", "rule not found")
		return
	}
	if err != nil {
		fail(w, 503, "unavailable", "metric store unavailable")
		return
	}
	writeJSON(w, 200, page)
}

type ruleCursor struct {
	Digest string `json:"digest"`
	Last   string `json:"last"`
}

func (s *Server) ruleList(w http.ResponseWriter, r *http.Request) {
	values, limit, err := metricParams(r.URL.RawQuery, true)
	if err != nil {
		fail(w, 400, "invalid_query", "invalid rule list query")
		return
	}
	definitions, err := s.db.ActiveRules(r.Context())
	if err != nil {
		fail(w, 503, "unavailable", "rule store unavailable")
		return
	}
	encoded, err := json.Marshal(definitions)
	if err != nil {
		fail(w, 503, "unavailable", "rule store unavailable")
		return
	}
	hash := sha256.Sum256(encoded)
	digest := hex.EncodeToString(hash[:])
	start := 0
	if raw := values.Get("cursor"); raw != "" {
		var cursor ruleCursor
		decoded, err := base64.RawURLEncoding.DecodeString(raw)
		if len(raw) > 4096 || err != nil || json.Unmarshal(decoded, &cursor) != nil || cursor.Digest != digest {
			fail(w, 400, "invalid_query", "invalid or stale rules cursor")
			return
		}
		found := false
		for i, rule := range definitions {
			if rule.ID == cursor.Last {
				start = i + 1
				found = true
				break
			}
		}
		if !found {
			fail(w, 400, "invalid_query", "invalid rules cursor")
			return
		}
	}
	end := min(start+limit, len(definitions))
	items := append([]rules.Rule{}, definitions[start:end]...)
	var next *string
	if end < len(definitions) {
		body, _ := json.Marshal(ruleCursor{digest, definitions[end-1].ID})
		next = new(base64.RawURLEncoding.EncodeToString(body))
	}
	writeJSON(w, 200, struct {
		Items      []rules.Rule `json:"items"`
		NextCursor *string      `json:"next_cursor"`
	}{items, next})
}
