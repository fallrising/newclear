PRAGMA foreign_keys = ON;

CREATE TABLE nodes (
  id                  TEXT PRIMARY KEY,
  display_name        TEXT NOT NULL DEFAULT '',
  tunnel_id           TEXT NOT NULL DEFAULT '',
  host_port_min       INTEGER NOT NULL DEFAULT 20000,
  host_port_max       INTEGER NOT NULL DEFAULT 20999,
  agent_token_id      TEXT,
  agent_instance_id   TEXT,
  facts_json          TEXT NOT NULL DEFAULT '{}',
  last_seen_at        TEXT,
  last_error          TEXT NOT NULL DEFAULT '',
  desired_generation  INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE services (
  name                TEXT PRIMARY KEY,
  description         TEXT NOT NULL DEFAULT '',
  labels_json         TEXT NOT NULL DEFAULT '{}',
  node_id             TEXT NOT NULL REFERENCES nodes(id),
  fleet_json          TEXT NOT NULL,
  image               TEXT NOT NULL DEFAULT '',
  desired_state       TEXT NOT NULL CHECK (desired_state IN ('running','stopped','absent')),
  expose_mode         TEXT NOT NULL CHECK (expose_mode IN ('public','access','private')),
  hostname            TEXT NOT NULL,
  container_port      INTEGER NOT NULL,
  host_port           INTEGER NOT NULL,
  health_path         TEXT NOT NULL DEFAULT '/healthz',
  current_release_id  TEXT,
  generation          INTEGER NOT NULL DEFAULT 1,
  force_recreate      INTEGER NOT NULL DEFAULT 0,
  compose_yaml        TEXT NOT NULL DEFAULT '',
  env_file            TEXT NOT NULL DEFAULT '',
  url                 TEXT NOT NULL DEFAULT '',
  cf_dns_record_id    TEXT NOT NULL DEFAULT '',
  cf_access_app_id    TEXT NOT NULL DEFAULT '',
  cf_access_policy_id TEXT NOT NULL DEFAULT '',
  cf_hostname_route_id TEXT NOT NULL DEFAULT '',
  ingress_status      TEXT NOT NULL DEFAULT 'pending'
                      CHECK (ingress_status IN ('pending','ok','error','drift','na')),
  ingress_error       TEXT NOT NULL DEFAULT '',
  purge_volumes       INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE (node_id, host_port),
  UNIQUE (hostname)
);

CREATE INDEX idx_services_node ON services(node_id);
CREATE INDEX idx_services_release ON services(current_release_id);

CREATE TABLE tombstones (
  service         TEXT NOT NULL,
  node_id         TEXT NOT NULL REFERENCES nodes(id),
  compose_project TEXT NOT NULL,
  host_port       INTEGER NOT NULL,
  compose_yaml    TEXT NOT NULL DEFAULT '',
  env_file        TEXT NOT NULL DEFAULT '',
  image           TEXT NOT NULL DEFAULT '',
  health_path     TEXT NOT NULL DEFAULT '/healthz',
  purge_volumes   INTEGER NOT NULL DEFAULT 0,
  generation      INTEGER NOT NULL,
  acked_at        TEXT,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (service, node_id)
);
CREATE UNIQUE INDEX idx_tombstones_port
  ON tombstones(node_id, host_port) WHERE acked_at IS NULL;

CREATE TABLE releases (
  id          TEXT PRIMARY KEY,
  service     TEXT NOT NULL REFERENCES services(name) ON DELETE CASCADE,
  image       TEXT NOT NULL,
  git_sha     TEXT NOT NULL DEFAULT '',
  git_repo    TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT 'operator',
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_releases_service_created ON releases(service, created_at DESC);

CREATE TABLE instances (
  service           TEXT PRIMARY KEY REFERENCES services(name) ON DELETE CASCADE,
  node_id           TEXT NOT NULL,
  release_id        TEXT REFERENCES releases(id) ON DELETE SET NULL,
  compose_project   TEXT NOT NULL,
  container_id      TEXT NOT NULL DEFAULT '',
  image             TEXT NOT NULL DEFAULT '',
  actual_state      TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (actual_state IN ('running','stopped','unhealthy','missing','unknown','progressing','absent')),
  health            TEXT NOT NULL DEFAULT 'unknown',
  health_detail     TEXT NOT NULL DEFAULT '',
  applied_generation INTEGER NOT NULL DEFAULT 0,
  error             TEXT NOT NULL DEFAULT '',
  reported_at       TEXT
);

CREATE TABLE tokens (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('operator','agent','ci','bootstrap')),
  node_id      TEXT,
  name         TEXT NOT NULL DEFAULT '',
  prefix       TEXT NOT NULL,
  hash         TEXT NOT NULL,
  last_used_at TEXT,
  created_at   TEXT NOT NULL,
  revoked_at   TEXT
);
CREATE UNIQUE INDEX idx_tokens_hash ON tokens(hash);
CREATE INDEX idx_tokens_prefix ON tokens(prefix);

CREATE TABLE audit_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  service      TEXT,
  node_id      TEXT,
  detail_json  TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_at ON audit_events(at DESC);

CREATE TABLE cf_state (
  key   TEXT PRIMARY KEY,
  etag  TEXT NOT NULL DEFAULT '',
  json  TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
