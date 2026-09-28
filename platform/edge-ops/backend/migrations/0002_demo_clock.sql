-- Loopback demo only (S0 mock chain, docs/S0-MOCK-CHAIN.md): a synthetic clock offset so the
-- mock Agent and the UI can simulate a node going offline without touching the OS clock.
-- Read only when the Worker runs with MODE=demo on a loopback URL.

CREATE TABLE demo_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  offset_seconds INTEGER NOT NULL DEFAULT 0
);

INSERT INTO demo_clock (id, offset_seconds) VALUES (1, 0);
