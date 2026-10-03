ALTER TABLE runs DROP CONSTRAINT runs_state_check;
ALTER TABLE runs ADD CONSTRAINT runs_state_check CHECK (state IN (
    'queued','provisioning','running','awaiting_approval','pausing','paused','resuming',
    'finalizing','cancelling','interrupted','succeeded','failed','cancelled'));
ALTER TABLE runs ADD COLUMN control_action text CHECK (control_action IN ('pause','resume'));
ALTER TABLE runs ADD COLUMN control_command_id uuid REFERENCES commands(id);
ALTER TABLE runs ADD COLUMN pause_command_id uuid REFERENCES commands(id);
ALTER TABLE runs ADD COLUMN pause_completed_at timestamptz;
ALTER TABLE runs ADD COLUMN resume_completed_at timestamptz;
