-- Reset the Aliyun RDS seed template's field_configs back to the V2 baseline.
-- M2 dnd-kit testing accumulated noise rows (TF schema leaves that were
-- dragged into buckets while exercising drag handlers) and overwrote
-- region's data_source_json with a minimal smoke-test payload. This is a
-- one-shot cleanup; future drift should use a dedicated reset action.

DELETE FROM field_config
WHERE template_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  AND field_key IN (
    'connection_string', 'id', 'port', 'tags',
    'pg_hba_conf_method', 'pg_hba_conf_type', 'pg_hba_conf_database',
    'pg_hba_conf_address', 'pg_hba_conf_priority_id',
    'parameters_name', 'parameters_value'
  );

UPDATE field_config
SET data_source_json = '{"type":"API","endpoint":"/api/v1/cloud/aliyun/regions","method":"GET","params":{"accountId":"${cloud_account_id}"},"responseMapping":{"labelField":"regionName","valueField":"regionId"}}'::jsonb
WHERE template_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
  AND field_key = 'region';
