-- Track which TF provider schema version was snapshotted onto each template,
-- so the template stays reproducible even when upstream schema changes.

ALTER TABLE resource_template
    ADD COLUMN tf_provider_version VARCHAR(50);

CREATE INDEX idx_resource_template_provider_version
    ON resource_template(cloud_provider, tf_provider_version);
