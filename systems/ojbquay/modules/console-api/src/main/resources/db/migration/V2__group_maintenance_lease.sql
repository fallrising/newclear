-- Durable fence for consumer-group offset resets: survives loss of the advisory-lock session.
CREATE TABLE group_maintenance_lease (
  group_id BIGINT PRIMARY KEY,
  token UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
