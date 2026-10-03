ALTER TABLE agent_profile_revisions DROP CONSTRAINT agent_profile_revisions_backend_check;
ALTER TABLE agent_profile_revisions DROP CONSTRAINT agent_profile_revisions_model_ref_check;
ALTER TABLE agent_profile_revisions DROP CONSTRAINT agent_profile_revisions_template_digest_check;
ALTER TABLE agent_profile_revisions ADD CONSTRAINT supported_profile CHECK (
 (backend='fake' AND model_ref='fixture:m1' AND template_digest='fixture:m1') OR
 (backend='openhands' AND model_ref='fixture:m2' AND template_digest ~ '@sha256:[a-f0-9]{64}$')
);
ALTER TABLE runs ADD COLUMN backend text NOT NULL DEFAULT 'fake' CHECK (backend IN ('fake','openhands'));
ALTER TABLE sandbox_bindings DROP CONSTRAINT sandbox_bindings_node_id_check;
ALTER TABLE sandbox_bindings ADD CONSTRAINT supported_node CHECK (node_id IN ('fake-local','cocoon-local'));
ALTER TABLE runtime_capacity DROP CONSTRAINT runtime_capacity_node_id_check;
ALTER TABLE runtime_capacity ADD CONSTRAINT supported_node CHECK (node_id IN ('fake-local','cocoon-local'));
ALTER TABLE runtime_capacity ADD COLUMN memory_bytes bigint NOT NULL DEFAULT 17179869184 CHECK (memory_bytes>0);
ALTER TABLE runtime_capacity ADD COLUMN cpu integer NOT NULL DEFAULT 16 CHECK (cpu>0);
INSERT INTO runtime_capacity(node_id,slots,draining) VALUES ('cocoon-local',4,true);
CREATE TABLE runtime_catalog (
 node_id text PRIMARY KEY REFERENCES runtime_capacity(node_id),
 template_digest text NOT NULL,
 repositories jsonb NOT NULL,
 registered_at timestamptz NOT NULL DEFAULT now()
);
