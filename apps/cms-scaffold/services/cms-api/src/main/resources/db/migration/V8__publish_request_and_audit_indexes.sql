-- BW2 publish requests and audit search indexes.
ALTER TABLE cms_entry
    ADD COLUMN publish_requested_at TIMESTAMPTZ,
    ADD COLUMN publish_requested_by UUID;
CREATE INDEX cms_entry_publish_requested_idx ON cms_entry (content_type_id)
    WHERE publish_requested_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX cms_audit_event_target_idx ON cms_audit_event (target_type, target_id);
CREATE INDEX cms_audit_event_action_at_idx ON cms_audit_event (action, at DESC);
