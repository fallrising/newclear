ALTER TABLE runs ADD COLUMN purpose text NOT NULL DEFAULT 'coding' CHECK (purpose IN ('coding','review'));
ALTER TABLE runs ADD COLUMN review_context jsonb;
ALTER TABLE runs ADD COLUMN rework_context jsonb;
ALTER TABLE runs ADD COLUMN review_candidate bytea;
ALTER TABLE runs ADD COLUMN review_output jsonb;
ALTER TABLE runs ADD CONSTRAINT review_candidate_bound CHECK (review_candidate IS NULL OR octet_length(review_candidate) BETWEEN 1 AND 32768);
CREATE TABLE review_lineages (
    root_writer_run_id uuid PRIMARY KEY REFERENCES runs(id),
    first_review_run_id uuid UNIQUE REFERENCES runs(id),
    rework_run_id uuid UNIQUE REFERENCES runs(id),
    second_review_run_id uuid UNIQUE REFERENCES runs(id),
    CHECK (rework_run_id IS NULL OR first_review_run_id IS NOT NULL),
    CHECK (second_review_run_id IS NULL OR rework_run_id IS NOT NULL)
);
