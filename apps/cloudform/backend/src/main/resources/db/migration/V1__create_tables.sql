-- CloudForm Database Schema
-- V1: Create all core tables

-- Resource Template
CREATE TABLE resource_template (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cloud_provider VARCHAR(20) NOT NULL,
    resource_type VARCHAR(30) NOT NULL,
    tf_resource_name VARCHAR(100) NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    tf_schema_json JSONB,
    form_config_json JSONB,
    tf_template TEXT,
    sync_config_json JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT 0,
    UNIQUE(cloud_provider, tf_resource_name)
);

-- Field Config
CREATE TABLE field_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES resource_template(id) ON DELETE CASCADE,
    field_key VARCHAR(100) NOT NULL,
    tf_path VARCHAR(200),
    display_name VARCHAR(200),
    description TEXT,
    group_key VARCHAR(50),
    form_target VARCHAR(20) NOT NULL,
    value_source VARCHAR(20) NOT NULL,
    component_type VARCHAR(20) NOT NULL DEFAULT 'INPUT',
    required BOOLEAN NOT NULL DEFAULT FALSE,
    editable BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 0,
    fixed_value_json JSONB,
    default_value_json JSONB,
    data_source_json JSONB,
    validation_json JSONB,
    depends_on_json JSONB,
    tf_type VARCHAR(20),
    tf_required BOOLEAN DEFAULT FALSE,
    tf_computed BOOLEAN DEFAULT FALSE,
    tf_default TEXT,
    UNIQUE(template_id, field_key)
);

-- Provisioning Request
CREATE TABLE provisioning_request (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_no VARCHAR(20) NOT NULL UNIQUE,
    template_id UUID NOT NULL REFERENCES resource_template(id),
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    user_form_data_json JSONB,
    ops_form_data_json JSONB,
    merged_tf_vars_json JSONB,
    generated_tf TEXT,
    tf_execution_id VARCHAR(100),
    cloud_instance_id VARCHAR(100),
    applicant_id VARCHAR(100) NOT NULL,
    applicant_name VARCHAR(100),
    applicant_team VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Workflow Instance
CREATE TABLE workflow_instance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE REFERENCES provisioning_request(id),
    current_node_key VARCHAR(30),
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Workflow Step
CREATE TABLE workflow_step (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_instance_id UUID NOT NULL REFERENCES workflow_instance(id),
    node_key VARCHAR(30) NOT NULL,
    action VARCHAR(20) NOT NULL,
    comment TEXT,
    actor_id VARCHAR(100) NOT NULL,
    actor_name VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Cloud Account
CREATE TABLE cloud_account (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(20) NOT NULL,
    account_id VARCHAR(100) NOT NULL,
    account_name VARCHAR(200) NOT NULL,
    access_key_id VARCHAR(200),
    access_key_secret VARCHAR(200),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(provider, account_id)
);

-- Indexes
CREATE INDEX idx_field_config_template ON field_config(template_id);
CREATE INDEX idx_provisioning_request_status ON provisioning_request(status);
CREATE INDEX idx_provisioning_request_applicant ON provisioning_request(applicant_id);
CREATE INDEX idx_workflow_step_instance ON workflow_step(workflow_instance_id);
CREATE INDEX idx_resource_template_status ON resource_template(status);
CREATE INDEX idx_resource_template_provider ON resource_template(cloud_provider);
CREATE INDEX idx_cloud_account_provider ON cloud_account(provider);
