-- A command row is the transactional outbox: accepted rows are durable work.
-- No destructive migration or public seed credentials.
CREATE TABLE grants (id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), revoked INTEGER NOT NULL CHECK(revoked IN(0,1)), policy TEXT NOT NULL CHECK(json_valid(policy)));
CREATE TABLE commands (id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, idem_key TEXT NOT NULL, body TEXT NOT NULL, body_digest TEXT NOT NULL, submit_grant TEXT NOT NULL REFERENCES grants(id), grant_revision INTEGER NOT NULL, record TEXT NOT NULL CHECK(json_valid(record)), revision INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN(0,1)), created_at INTEGER NOT NULL, UNIQUE(principal_id,idem_key));
-- M1 is explicitly one node, one active job, including all unknown jobs.
CREATE UNIQUE INDEX one_active_node ON commands(active) WHERE active=1;
CREATE INDEX command_created ON commands(created_at DESC);
CREATE TABLE nonces (credential_id TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(credential_id,nonce));
CREATE INDEX nonce_expiry ON nonces(expires_at);
CREATE TABLE schedules (id TEXT PRIMARY KEY CHECK(id='health-minute'), revision INTEGER NOT NULL CHECK(revision>0), enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), grant_id TEXT NOT NULL REFERENCES grants(id), last_due INTEGER);
CREATE TABLE firings (schedule_id TEXT NOT NULL, revision INTEGER NOT NULL, due INTEGER NOT NULL, outcome TEXT NOT NULL, PRIMARY KEY(schedule_id,revision,due));
