package server

import (
	"context"
	"log/slog"
	"time"

	"github.com/fallrising/clarkQ/internal/cluster"
	"github.com/fallrising/clarkQ/internal/queue"
)

func (s *Server) startOutboxWorker() {
	if s.outbox == nil {
		return
	}
	go func() {
		t := time.NewTicker(250 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-s.bgStop:
				return
			case <-t.C:
				s.drainOutbox()
			}
		}
	}()
}

func (s *Server) drainOutbox() {
	if s.outbox == nil {
		return
	}
	items := s.outbox.Ready(time.Now().UTC(), 64)
	for _, it := range items {
		// Skip dead targets; leave item for later (membership may recover).
		if s.cluster != nil && s.cluster.Membership != nil && !s.cluster.Membership.IsAlive(it.Target) {
			s.outbox.Fail(it.ID, "target dead")
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := s.dispatchOutbox(ctx, it)
		cancel()
		if err != nil {
			dropped := s.outbox.Fail(it.ID, err.Error())
			if dropped {
				slog.Error("outbox item dropped after max attempts",
					"id", it.ID, "op", it.Op, "target", it.Target, "queue", it.Queue, "error", err)
			}
			continue
		}
		s.outbox.Complete(it.ID)
	}
}

func (s *Server) dispatchOutbox(ctx context.Context, it cluster.OutboxItem) error {
	switch it.Op {
	case cluster.OutboxEnqueue:
		if it.Message == nil {
			return errInvalidJSON
		}
		return s.postJSON(ctx, it.Target+internalEnqueue, *it.Message)
	case cluster.OutboxDequeue:
		return s.postJSON(ctx, it.Target+internalDequeue, map[string]string{
			"queue": it.Queue,
			"id":    it.MessageID,
		})
	case cluster.OutboxClear:
		return s.postJSON(ctx, it.Target+internalClear, map[string]string{"queue": it.Queue})
	default:
		return errInvalidJSON
	}
}

func (s *Server) queueOutboxEnqueue(msg queue.Message, targets []string) {
	if s.outbox == nil {
		return
	}
	for _, t := range targets {
		if t == "" || (s.cluster != nil && t == s.cluster.Self) {
			continue
		}
		cp := msg
		s.outbox.Add(cluster.OutboxItem{
			Op:      cluster.OutboxEnqueue,
			Target:  t,
			Queue:   msg.Queue,
			Message: &cp,
		})
	}
}

func (s *Server) queueOutboxDequeue(queueName, messageID string, targets []string) {
	if s.outbox == nil {
		return
	}
	for _, t := range targets {
		if t == "" || (s.cluster != nil && t == s.cluster.Self) {
			continue
		}
		s.outbox.Add(cluster.OutboxItem{
			Op:        cluster.OutboxDequeue,
			Target:    t,
			Queue:     queueName,
			MessageID: messageID,
		})
	}
}

func (s *Server) queueOutboxClear(queueName string, targets []string) {
	if s.outbox == nil {
		return
	}
	for _, t := range targets {
		if t == "" || (s.cluster != nil && t == s.cluster.Self) {
			continue
		}
		s.outbox.Add(cluster.OutboxItem{
			Op:     cluster.OutboxClear,
			Target: t,
			Queue:  queueName,
		})
	}
}
