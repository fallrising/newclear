ALTER TABLE runs ADD COLUMN cancel_command_id uuid REFERENCES commands(id);
ALTER TABLE runs ADD COLUMN cancel_requested_at timestamptz;
ALTER TABLE runs ADD COLUMN cancel_completed_at timestamptz;
