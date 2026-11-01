CREATE TABLE result_archives (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL UNIQUE REFERENCES runs(id),
    kind text NOT NULL DEFAULT 'result' CHECK (kind = 'result'),
    payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 1048576),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    size integer NOT NULL CHECK (size BETWEEN 1 AND 1048576),
    mime text NOT NULL DEFAULT 'application/json' CHECK (mime = 'application/json'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION immutable_result_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Result archives are immutable'; END; $$;
CREATE TRIGGER result_archive_immutable BEFORE UPDATE OR DELETE ON result_archives
    FOR EACH ROW EXECUTE FUNCTION immutable_result_archive();
