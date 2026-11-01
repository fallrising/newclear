-- Keep 001 immutable for existing databases. Refuse unsupported stored modes
-- before changing anything; an operator must explicitly migrate those workloads.
CREATE TEMP TABLE supported_web_modes (
  mode TEXT NOT NULL CONSTRAINT unsupported_exposure_mode CHECK (mode IN ('public', 'access'))
);
INSERT INTO supported_web_modes SELECT expose_mode FROM services;
DROP TABLE supported_web_modes;

ALTER TABLE services DROP COLUMN cf_hostname_route_id;

-- The original table CHECK remains on upgraded databases; these guards narrow
-- both fresh and upgraded schemas without rebuilding tables or cascading data.
CREATE TRIGGER services_web_mode_insert BEFORE INSERT ON services
WHEN NEW.expose_mode NOT IN ('public', 'access')
BEGIN
  SELECT RAISE(ABORT, 'unsupported exposure mode: use public or access');
END;
CREATE TRIGGER services_web_mode_update BEFORE UPDATE OF expose_mode ON services
WHEN NEW.expose_mode NOT IN ('public', 'access')
BEGIN
  SELECT RAISE(ABORT, 'unsupported exposure mode: use public or access');
END;
