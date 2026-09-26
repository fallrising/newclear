-- v2 W6: B-05 thread queries — `WHERE room_id = ? AND thread_id = ?` and the per-root reply counts of top_level=1.
CREATE INDEX messages_room_thread_seq ON messages(room_id, thread_id, seq);
