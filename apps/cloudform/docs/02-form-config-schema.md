# CloudForm - Form Config Schema 規格

## 概述

Form Config 是系統的核心產物，由表單設計器生成，驅動前端零代碼渲染。
前端拿到這份 JSON/YAML 後，不需要任何硬編碼，即可渲染出完整的表單。

## Form Config 完整結構

```yaml
# form-config-aliyun-rds.yaml
version: "1.0"
metadata:
  resourceType: "RDS"
  cloudProvider: "ALIYUN"
  tfResource: "alicloud_db_instance"
  displayName: "阿里雲 RDS 數據庫"
  description: "申請阿里雲 RDS MySQL/PostgreSQL 數據庫實例"
  icon: "database"
  createdBy: "ops-admin"
  updatedAt: "2025-01-15T10:30:00Z"

# 表單分為多個 section
forms:
  userForm:
    title: "雲數據庫申請"
    description: "請填寫您的數據庫需求"
    sections:
      - key: "basic"
        title: "基本信息"
        description: "選擇雲商和數據庫類型"
        order: 1
        fields:
          - key: "engine"
            tfPath: "engine"
            displayName: "數據庫引擎"
            description: "選擇數據庫引擎類型"
            componentType: "SELECT"
            required: true
            editable: true
            order: 1
            dataSource:
              type: "STATIC"
              options:
                - label: "MySQL"
                  value: "MySQL"
                - label: "PostgreSQL"
                  value: "PostgreSQL"
                - label: "MariaDB"
                  value: "MariaDB"
            defaultValue: "MySQL"

          - key: "engine_version"
            tfPath: "engine_version"
            displayName: "引擎版本"
            componentType: "SELECT"
            required: true
            editable: true
            order: 2
            dataSource:
              type: "API"
              endpoint: "/api/v1/cloud/aliyun/rds/engine-versions"
              method: "GET"
              params:
                engine: "${engine}"  # 引用其他欄位的值
              responseMapping:
                labelField: "version"
                valueField: "version"
            dependsOn: ["engine"]

      - key: "specification"
        title: "規格配置"
        description: "選擇實例規格和存儲"
        order: 2
        fields:
          - key: "instance_class"
            tfPath: "instance_type"
            displayName: "實例規格"
            description: "選擇 CPU 和內存規格"
            componentType: "SELECT"
            required: true
            editable: true
            order: 1
            dataSource:
              type: "API"
              endpoint: "/api/v1/cloud/aliyun/rds/instance-classes"
              method: "GET"
              params:
                engine: "${engine}"
                engineVersion: "${engine_version}"
              responseMapping:
                labelField: "displayName"
                valueField: "classCode"
                descriptionField: "spec"
            dependsOn: ["engine", "engine_version"]

          - key: "storage_size"
            tfPath: "instance_storage"
            displayName: "存儲空間 (GB)"
            componentType: "NUMBER"
            required: true
            editable: true
            order: 2
            validation:
              min: 20
              max: 6000
              step: 10
            defaultValue: 100

          - key: "node_count"
            tfPath: null  # 不直接對應 TF 欄位，由後端邏輯處理
            displayName: "預計節點數"
            componentType: "NUMBER"
            required: true
            editable: true
            order: 3
            validation:
              min: 1
              max: 100
            defaultValue: 3

  opsForm:
    title: "OPs 配置"
    description: "請配置雲資源的基礎設施參數"
    sections:
      - key: "cloud_account"
        title: "雲帳號配置"
        order: 1
        fields:
          - key: "cloud_account_id"
            tfPath: null  # 由後端處理 provider 配置
            displayName: "雲帳號"
            componentType: "SELECT"
            required: true
            editable: true
            order: 1
            dataSource:
              type: "API"
              endpoint: "/api/v1/cloud/accounts"
              method: "GET"
              params:
                provider: "ALIYUN"
              responseMapping:
                labelField: "accountName"
                valueField: "accountId"

      - key: "network"
        title: "網絡配置"
        order: 2
        fields:
          - key: "region"
            tfPath: null  # Provider level config
            displayName: "地域"
            componentType: "SELECT"
            required: true
            editable: true
            order: 1
            dataSource:
              type: "API"
              endpoint: "/api/v1/cloud/aliyun/regions"
              method: "GET"
              params:
                accountId: "${cloud_account_id}"
              responseMapping:
                labelField: "regionName"
                valueField: "regionId"
            dependsOn: ["cloud_account_id"]

          - key: "vpc_id"
            tfPath: "vswitch_id"  # maps indirectly
            displayName: "VPC"
            componentType: "SELECT"
            required: true
            editable: true
            order: 2
            dataSource:
              type: "API"
              endpoint: "/api/v1/cloud/aliyun/vpcs"
              method: "GET"
              params:
                accountId: "${cloud_account_id}"
                regionId: "${region}"
              responseMapping:
                labelField: "vpcName"
                valueField: "vpcId"
            dependsOn: ["cloud_account_id", "region"]

          - key: "vswitch_id"
            tfPath: "vswitch_id"
            displayName: "交換機 (VSwitch)"
            componentType: "SELECT"
            required: true
            editable: true
            order: 3
            dataSource:
              type: "API"
              endpoint: "/api/v1/cloud/aliyun/vswitches"
              method: "GET"
              params:
                accountId: "${cloud_account_id}"
                regionId: "${region}"
                vpcId: "${vpc_id}"
              responseMapping:
                labelField: "vswitchName"
                valueField: "vswitchId"
                descriptionField: "zoneId"
            dependsOn: ["cloud_account_id", "region", "vpc_id"]

          - key: "zone_id"
            tfPath: "zone_id"
            displayName: "可用區"
            componentType: "SELECT"
            required: true
            editable: true
            order: 4
            dataSource:
              type: "API"
              endpoint: "/api/v1/cloud/aliyun/zones"
              method: "GET"
              params:
                accountId: "${cloud_account_id}"
                regionId: "${region}"
              responseMapping:
                labelField: "zoneName"
                valueField: "zoneId"
            dependsOn: ["cloud_account_id", "region"]

  # 固定值：不出現在任何表單，由平台預設
  fixedFields:
    - key: "instance_charge_type"
      tfPath: "instance_charge_type"
      valueSource: "FIXED"
      fixedValue: "Postpaid"
      description: "付費方式 - 平台統一使用後付費"

    - key: "security_ips"
      tfPath: "security_ips"
      valueSource: "FIXED"
      fixedValue: ["10.0.0.0/8", "172.16.0.0/12"]
      description: "安全組 IP 白名單 - 平台統一配置"

    - key: "monitoring_enabled"
      tfPath: "monitoring_period"
      valueSource: "FIXED"
      fixedValue: 60
      description: "監控週期(秒) - 平台統一配置"

# TF 模板（由設計器根據欄位配置自動生成）
terraformTemplate: |
  resource "alicloud_db_instance" "main" {
    engine           = var.engine
    engine_version   = var.engine_version
    instance_type    = var.instance_type
    instance_storage = var.instance_storage
    vswitch_id       = var.vswitch_id
    zone_id          = var.zone_id

    # Platform defaults
    instance_charge_type = "Postpaid"
    security_ips         = ["10.0.0.0/8", "172.16.0.0/12"]
    monitoring_period    = 60
  }

# 需要從雲商同步的數據
syncConfig:
  - resource: "regions"
    api: "DescribeRegions"
    schedule: "0 0 * * *"  # 每天同步
  - resource: "vpcs"
    api: "DescribeVpcs"
    schedule: "*/30 * * * *"  # 每30分鐘
    dependsOnSync: ["regions"]
  - resource: "vswitches"
    api: "DescribeVSwitches"
    schedule: "*/30 * * * *"
    dependsOnSync: ["vpcs"]
  - resource: "zones"
    api: "DescribeZones"
    schedule: "0 0 * * *"
  - resource: "instance_classes"
    api: "DescribeAvailableClasses"
    schedule: "0 0 * * 0"  # 每週同步

# API 接口定義（需要後端實現的接口）
requiredApis:
  - path: "/api/v1/cloud/aliyun/rds/engine-versions"
    method: "GET"
    params: ["engine"]
    description: "獲取 RDS 支持的引擎版本列表"
    source: "sync_cache"

  - path: "/api/v1/cloud/aliyun/rds/instance-classes"
    method: "GET"
    params: ["engine", "engineVersion"]
    description: "獲取可用實例規格列表"
    source: "sync_cache"

  - path: "/api/v1/cloud/accounts"
    method: "GET"
    params: ["provider"]
    description: "獲取指定雲商的雲帳號列表"
    source: "local_db"

  - path: "/api/v1/cloud/aliyun/regions"
    method: "GET"
    params: ["accountId"]
    description: "獲取可用地域列表"
    source: "sync_cache"

  - path: "/api/v1/cloud/aliyun/vpcs"
    method: "GET"
    params: ["accountId", "regionId"]
    description: "獲取 VPC 列表"
    source: "sync_cache"

  - path: "/api/v1/cloud/aliyun/vswitches"
    method: "GET"
    params: ["accountId", "regionId", "vpcId"]
    description: "獲取交換機列表"
    source: "sync_cache"

  - path: "/api/v1/cloud/aliyun/zones"
    method: "GET"
    params: ["accountId", "regionId"]
    description: "獲取可用區列表"
    source: "sync_cache"
```

## 前端渲染邏輯

前端拿到上述 JSON/YAML 後的渲染流程：

```typescript
// 偽代碼示意
interface FormConfig {
  version: string;
  metadata: ResourceMetadata;
  forms: {
    userForm: FormDefinition;
    opsForm: FormDefinition;
    fixedFields: FixedField[];
  };
}

function DynamicForm({ config, formType }: Props) {
  const formDef = formType === 'user' ? config.forms.userForm : config.forms.opsForm;

  return (
    <Form>
      {formDef.sections.map(section => (
        <FormSection key={section.key} title={section.title}>
          {section.fields
            .sort((a, b) => a.order - b.order)
            .map(field => (
              <DynamicField
                key={field.key}
                config={field}
                // 自動處理 dataSource, dependsOn, validation
              />
            ))}
        </FormSection>
      ))}
    </Form>
  );
}
```

## 欄位聯動機制

```
dependsOn 機制：
1. 用戶選擇 region
2. 前端檢測 vpc_id.dependsOn 包含 region
3. 清空 vpc_id 的當前值
4. 用新的 region 值替換 dataSource.params 中的 ${region}
5. 重新調用 API 獲取 VPC 列表
6. 級聯清空所有依賴 vpc_id 的欄位（如 vswitch_id）
```

## Value Source 優先級

當合併生成最終 TF 時：
```
FIXED (平台預設) > OPS_INPUT > USER_INPUT > SYSTEM_DEFAULT > defaultValue
```
