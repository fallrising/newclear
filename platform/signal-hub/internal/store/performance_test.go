package store

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

// TestQueryPerformance30K exercises the public query path against a synthetic
// event log large enough to catch accidental per-row application filtering.
// The fixture is inserted directly in one transaction so setup does not pay
// for 30,000 independent FULL-synchronous commits.
func TestQueryPerformance30K(t *testing.T) {
	s, _ := newStore(t)
	const eventCount = 30_000
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	sources := []string{"urn:perf:source:0", "urn:perf:source:1", "urn:perf:source:2", "urn:perf:source:3"}
	types := []string{"deploy.completed", "audit.recorded", "service.changed"}
	severities := []string{"warning", "info", "error", "debug", "critical", "notice"}
	subjects := []string{"services/api/node", "services/web/node", "workers/mail/node", "workers/batch/node"}
	correlations := []string{"chain-0", "chain-1", "chain-2", "chain-3", "chain-4", "chain-5"}
	summaries := []string{"needle found in synthetic event", "routine synthetic report", "synthetic status update"}
	ranks := map[string]int{"debug": 0, "info": 1, "notice": 2, "warning": 3, "error": 4, "critical": 5}

	tx, err := s.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	insert, err := tx.PrepareContext(context.Background(), `INSERT INTO events(
		source,id,type,subject,time,received_at,severity,severity_rank,summary,
		originurl,correlationid,causationid,content_hash,raw_json,clock_skew
	) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		t.Fatal(err)
	}
	defer insert.Close()
	for i := 0; i < eventCount; i++ {
		group := i % 12
		// Divide before multiplying: time.Duration is bounded, and multiplying
		// the largest index by the full 30-day span would overflow it.
		at := base.Add((30 * 24 * time.Hour / eventCount) * time.Duration(i))
		source := sources[group%len(sources)]
		typ := types[group%len(types)]
		severity := severities[group%len(severities)]
		subject := subjects[group%len(subjects)]
		correlation := correlations[group%len(correlations)]
		summary := summaries[group%len(summaries)]
		id := fmt.Sprintf("event-%05d", i)
		raw, err := json.Marshal(map[string]string{
			"specversion": "1.0", "source": source, "id": id, "type": typ,
			"time": at.Format(time.RFC3339Nano), "subject": subject,
			"severity": severity, "summary": summary, "correlationid": correlation,
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := insert.ExecContext(context.Background(), source, id, typ, subject,
			timeKey(at), at.Format(time.RFC3339Nano), severity, ranks[severity], summary,
			"", correlation, "", make([]byte, 32), raw, 0); err != nil {
			t.Fatalf("insert synthetic event %d: %v", i, err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	from := base.Add(5 * 24 * time.Hour).Format(time.RFC3339Nano)
	to := base.Add(25 * 24 * time.Hour).Format(time.RFC3339Nano)
	queries := []struct {
		name  string
		query Query
	}{
		{name: "first_page_no_filters", query: Query{}},
		{name: "source", query: Query{Source: sources[0]}},
		{name: "type_pattern", query: Query{Type: "deploy.*"}},
		{name: "severity_min", query: Query{SeverityMin: "warning"}},
		{name: "subject_prefix", query: Query{SubjectPrefix: "services/api"}},
		{name: "correlation_id", query: Query{CorrelationID: correlations[0]}},
		{name: "free_text", query: Query{Q: "needle"}},
		{name: "time_bounds", query: Query{From: from, To: to}},
		{name: "combined", query: Query{
			Source: sources[0], Type: "deploy.*", SeverityMin: "warning",
			SubjectPrefix: "services/api", CorrelationID: correlations[0],
			Q: "needle", From: from, To: to,
		}},
	}
	for _, test := range queries {
		t.Run(test.name, func(t *testing.T) {
			started := time.Now()
			page, err := s.List(context.Background(), test.query)
			elapsed := time.Since(started)
			if err != nil {
				t.Fatalf("List: %v", err)
			}
			t.Logf("30,000-event query returned %d rows in %s", len(page.Items), elapsed)
			if len(page.Items) != 100 {
				t.Fatalf("expected a full first page demonstrating at least 100 matches, got %d", len(page.Items))
			}
			if elapsed >= time.Second {
				t.Fatalf("query exceeded 1s contract: %s", elapsed)
			}
		})
	}
}
