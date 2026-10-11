-- Bounded daily trace GC follows room/kind/creation order without sorting the whole trace history.
CREATE INDEX IF NOT EXISTS messages_room_kind_created_seq ON messages(room_id, kind, created_at, seq);
ALTER TABLE messages ADD COLUMN trace_full_state TEXT CHECK (trace_full_state IN ('claimed', 'stored', 'deleting'));
-- Quarantined uploads must not make the cleanup cursor scan an unbounded claimed history.
CREATE INDEX IF NOT EXISTS messages_trace_gc ON messages(room_id, created_at, seq)
WHERE kind = 'trace' AND (trace_full_state IS NULL OR trace_full_state IN ('stored', 'deleting'));
