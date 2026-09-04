-- CloudForm Seed Data
-- V2: Sample Aliyun RDS resource template with field configs

-- Insert sample Aliyun RDS template
INSERT INTO resource_template (id, cloud_provider, resource_type, tf_resource_name, display_name, description, icon, status, created_by)
VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'ALIYUN',
    'RDS',
    'alicloud_db_instance',
    '阿里雲 RDS 數據庫',
    '申請阿里雲 RDS MySQL/PostgreSQL 數據庫實例',
    'database',
    'DRAFT',
    'system'
);

-- Field configs for Aliyun RDS
-- User Form fields
INSERT INTO field_config (template_id, field_key, tf_path, display_name, description, group_key, form_target, value_source, component_type, required, editable, display_order, data_source_json, default_value_json)
VALUES
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'engine', 'engine', '數據庫引擎', '選擇數據庫引擎類型', 'basic', 'USER_FORM', 'USER_INPUT', 'SELECT', true, true, 1,
 '{"type":"STATIC","options":[{"label":"MySQL","value":"MySQL"},{"label":"PostgreSQL","value":"PostgreSQL"},{"label":"MariaDB","value":"MariaDB"}]}',
 '"MySQL"'),

('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'engine_version', 'engine_version', '引擎版本', '選擇數據庫引擎版本', 'basic', 'USER_FORM', 'USER_INPUT', 'SELECT', true, true, 2,
 '{"type":"API","endpoint":"/api/v1/cloud/aliyun/rds/engine-versions","method":"GET","params":{"engine":"${engine}"},"responseMapping":{"labelField":"version","valueField":"version"}}',
 null),

('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'instance_type', 'instance_type', '實例規格', '選擇 CPU 和內存規格', 'specification', 'USER_FORM', 'USER_INPUT', 'SELECT', true, true, 3,
 '{"type":"API","endpoint":"/api/v1/cloud/aliyun/rds/instance-classes","method":"GET","params":{"engine":"${engine}","engineVersion":"${engine_version}"},"responseMapping":{"labelField":"displayName","valueField":"classCode","descriptionField":"spec"}}',
 null),

('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'instance_storage', 'instance_storage', '存儲空間 (GB)', '數據庫實例存儲大小', 'specification', 'USER_FORM', 'USER_INPUT', 'NUMBER', true, true, 4,
 null,
 '100');

-- OPs Form fields
INSERT INTO field_config (template_id, field_key, tf_path, display_name, description, group_key, form_target, value_source, component_type, required, editable, display_order, data_source_json, depends_on_json)
VALUES
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'cloud_account_id', null, '雲帳號', '選擇部署雲帳號', 'cloud_account', 'OPS_FORM', 'OPS_INPUT', 'SELECT', true, true, 1,
 '{"type":"API","endpoint":"/api/v1/cloud/accounts","method":"GET","params":{"provider":"ALIYUN"},"responseMapping":{"labelField":"accountName","valueField":"accountId"}}',
 null),

('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'region', null, '地域', '選擇部署地域', 'network', 'OPS_FORM', 'OPS_INPUT', 'SELECT', true, true, 2,
 '{"type":"API","endpoint":"/api/v1/cloud/aliyun/regions","method":"GET","params":{"accountId":"${cloud_account_id}"},"responseMapping":{"labelField":"regionName","valueField":"regionId"}}',
 '["cloud_account_id"]'),

('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'vpc_id', 'vswitch_id', 'VPC', '選擇 VPC 網絡', 'network', 'OPS_FORM', 'OPS_INPUT', 'SELECT', true, true, 3,
 '{"type":"API","endpoint":"/api/v1/cloud/aliyun/vpcs","method":"GET","params":{"accountId":"${cloud_account_id}","regionId":"${region}"},"responseMapping":{"labelField":"vpcName","valueField":"vpcId"}}',
 '["cloud_account_id","region"]'),

('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'vswitch_id', 'vswitch_id', '交換機 (VSwitch)', '選擇交換機', 'network', 'OPS_FORM', 'OPS_INPUT', 'SELECT', true, true, 4,
 '{"type":"API","endpoint":"/api/v1/cloud/aliyun/vswitches","method":"GET","params":{"accountId":"${cloud_account_id}","regionId":"${region}","vpcId":"${vpc_id}"},"responseMapping":{"labelField":"vswitchName","valueField":"vswitchId","descriptionField":"zoneId"}}',
 '["cloud_account_id","region","vpc_id"]'),

('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'zone_id', 'zone_id', '可用區', '選擇可用區', 'network', 'OPS_FORM', 'OPS_INPUT', 'SELECT', true, true, 5,
 '{"type":"API","endpoint":"/api/v1/cloud/aliyun/zones","method":"GET","params":{"accountId":"${cloud_account_id}","regionId":"${region}"},"responseMapping":{"labelField":"zoneName","valueField":"zoneId"}}',
 '["cloud_account_id","region"]');

-- Hidden / Fixed fields
INSERT INTO field_config (template_id, field_key, tf_path, display_name, description, group_key, form_target, value_source, component_type, required, editable, display_order, fixed_value_json)
VALUES
('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'instance_charge_type', 'instance_charge_type', '付費方式', '平台統一使用後付費', 'platform', 'HIDDEN', 'FIXED', 'READONLY', false, false, 1,
 '"Postpaid"'),

('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'security_ips', 'security_ips', '安全組 IP 白名單', '平台統一配置', 'platform', 'HIDDEN', 'FIXED', 'READONLY', false, false, 2,
 '["10.0.0.0/8","172.16.0.0/12"]'),

('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'monitoring_period', 'monitoring_period', '監控週期(秒)', '平台統一配置', 'platform', 'HIDDEN', 'FIXED', 'READONLY', false, false, 3,
 '60');

-- Seed cloud accounts
INSERT INTO cloud_account (id, provider, account_id, account_name, active)
VALUES
('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', 'ALIYUN', 'aliyun-prod-001', '阿里雲生產帳號', true),
('b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', 'ALIYUN', 'aliyun-staging-001', '阿里雲預發帳號', true),
('b3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44', 'AWS', 'aws-prod-001', 'AWS 生產帳號', true);
