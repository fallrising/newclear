CREATE TABLE app_user (
  id BIGSERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPS', 'USER')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kafka_cluster (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  bootstrap_servers TEXT NOT NULL,
  security_json JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_kafka_cluster_default
  ON kafka_cluster (is_default)
  WHERE is_default;

CREATE TABLE topic (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cluster_id BIGINT NOT NULL REFERENCES kafka_cluster(id),
  partitions INT NOT NULL,
  replication INT NOT NULL,
  delay_topic BOOLEAN NOT NULL DEFAULT false,
  max_message_bytes INT NOT NULL DEFAULT 1048576,
  retention_ms BIGINT NOT NULL DEFAULT 259200000,
  produce_quota_tps INT NOT NULL DEFAULT 1000,
  compression TEXT NOT NULL DEFAULT 'zstd',
  token CHAR(32) NOT NULL,
  owner TEXT NOT NULL,
  state SMALLINT NOT NULL DEFAULT 1,
  version BIGINT NOT NULL DEFAULT 1,
  remark TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name, cluster_id)
);

CREATE TABLE consume_group (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  token CHAR(32) NOT NULL,
  owner TEXT NOT NULL,
  state SMALLINT NOT NULL DEFAULT 1,
  version BIGINT NOT NULL DEFAULT 1,
  remark TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscription (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES consume_group(id),
  topic_id BIGINT NOT NULL REFERENCES topic(id),
  spec JSONB NOT NULL,
  state SMALLINT NOT NULL DEFAULT 1,
  version BIGINT NOT NULL DEFAULT 1,
  owner TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, topic_id)
);

CREATE TABLE config_publish (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  version BIGINT NOT NULL,
  payload JSONB,
  published_by TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_id, version)
);

CREATE TABLE outbox_event (
  id BIGSERIAL PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX idx_outbox_unpublished
  ON outbox_event (id)
  WHERE published_at IS NULL;

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_entity ON audit_log (entity, entity_id, at DESC);

CREATE TABLE delay_message (
  delay_id TEXT PRIMARY KEY,
  target_topic TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  payload BYTEA NOT NULL,
  headers JSONB NOT NULL DEFAULT '{}',
  msg_key TEXT,
  loop_interval_ms BIGINT,
  loop_remaining INT,
  expire_at TIMESTAMPTZ,
  status SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fired_at TIMESTAMPTZ
);

CREATE INDEX idx_delay_due
  ON delay_message (due_at)
  WHERE status = 0;

INSERT INTO kafka_cluster (name, bootstrap_servers, is_default)
VALUES ('local', 'localhost:9092', true);
