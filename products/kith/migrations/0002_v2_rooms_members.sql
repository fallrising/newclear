-- v2 W2: room archive (B-14, BR-14) and forced first-login password change (B-04, Q-03).
ALTER TABLE rooms ADD COLUMN archived_at TEXT;
ALTER TABLE members ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1));
