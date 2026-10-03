ALTER TABLE model_proxy_runs ADD COLUMN guest_connected boolean NOT NULL DEFAULT false;
ALTER TABLE model_proxy_runs ADD COLUMN cutoff_reason text;
ALTER TABLE model_proxy_runs ADD COLUMN cutoff_at timestamptz;
ALTER TABLE model_proxy_runs ADD CONSTRAINT model_cutoff_pair
    CHECK ((cutoff_reason IS NULL) = (cutoff_at IS NULL));
