# CloudForm - API 設計

## API 總覽

所有 API 統一前綴 `/api/v1/`，響應格式：

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "message": "OK",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

分頁響應：
```json
{
  "success": true,
  "data": {
    "content": [ ... ],
    "page": 0,
    "size": 20,
    "totalElements": 150,
    "totalPages": 8
  }
}
```

## 1. Resource Template APIs

### 1.1 模板管理
| Method | Path | Description |
|--------|------|-------------|
| GET | `/templates` | 列表（分頁、篩選） |
| GET | `/templates/{id}` | 詳情 |
| POST | `/templates` | 創建模板 |
| PUT | `/templates/{id}` | 更新模板 |
| DELETE | `/templates/{id}` | 刪除模板（僅 DRAFT） |
| POST | `/templates/{id}/publish` | 發布模板 |
| POST | `/templates/{id}/archive` | 歸檔模板 |

### 1.2 TF Schema 操作
| Method | Path | Description |
|--------|------|-------------|
| POST | `/templates/{id}/import-schema` | 導入 TF Provider Schema |
| GET | `/templates/{id}/schema-tree` | 獲取解析後的欄位樹 |
| POST | `/templates/{id}/refresh-schema` | 重新解析 Schema |

### 1.3 Field Config 操作（設計器核心）
| Method | Path | Description |
|--------|------|-------------|
| GET | `/templates/{id}/fields` | 獲取所有欄位配置 |
| PUT | `/templates/{id}/fields/{fieldKey}` | 更新單個欄位配置 |
| PUT | `/templates/{id}/fields/batch` | 批量更新欄位配置 |
| POST | `/templates/{id}/fields/reset` | 重置為 Schema 預設 |

### 1.4 Config Generation
| Method | Path | Description |
|--------|------|-------------|
| POST | `/templates/{id}/generate` | 生成所有配置（Form Config + TF Template + API Spec + Sync Config） |
| GET | `/templates/{id}/form-config` | 獲取生成的 Form Config JSON |
| GET | `/templates/{id}/tf-template` | 獲取生成的 TF 模板 |
| GET | `/templates/{id}/api-spec` | 獲取需要實現的 API 列表 |
| GET | `/templates/{id}/sync-config` | 獲取同步配置 |
| POST | `/templates/{id}/preview` | 預覽（不儲存，用於設計器即時預覽） |

## 2. Provisioning Request APIs

### 2.1 申請管理
| Method | Path | Description |
|--------|------|-------------|
| GET | `/requests` | 列表（分頁、篩選、我的申請/待我審批） |
| GET | `/requests/{id}` | 詳情（含工作流狀態） |
| POST | `/requests` | 創建申請 |
| PUT | `/requests/{id}` | 更新申請（僅 DRAFT） |
| DELETE | `/requests/{id}` | 取消申請 |

### 2.2 表單操作
| Method | Path | Description |
|--------|------|-------------|
| GET | `/requests/{id}/user-form` | 獲取用戶表單數據 |
| PUT | `/requests/{id}/user-form` | 保存用戶表單數據 |
| POST | `/requests/{id}/user-form/submit` | 提交用戶表單（觸發審批流） |
| GET | `/requests/{id}/ops-form` | 獲取 OPs 表單數據 |
| PUT | `/requests/{id}/ops-form` | 保存 OPs 表單數據 |
| POST | `/requests/{id}/ops-form/submit` | 提交 OPs 表單 |
| GET | `/requests/{id}/form-config` | 獲取該申請對應的 Form Config |

### 2.3 審批操作
| Method | Path | Description |
|--------|------|-------------|
| POST | `/requests/{id}/approve` | 審批通過 |
| POST | `/requests/{id}/reject` | 駁回 |
| POST | `/requests/{id}/reassign` | 轉交 |
| GET | `/requests/{id}/workflow-history` | 審批歷史 |

### 2.4 配置操作
| Method | Path | Description |
|--------|------|-------------|
| POST | `/requests/{id}/provision` | 觸發資源配置（生成 TF → 提交平台） |
| GET | `/requests/{id}/provision-status` | 查詢配置狀態 |
| POST | `/requests/{id}/retry` | 重試失敗的配置 |
| GET | `/requests/{id}/tf-preview` | 預覽生成的 TF 代碼 |

## 3. Cloud Data APIs（前端表單數據源）

### 3.1 通用
| Method | Path | Description |
|--------|------|-------------|
| GET | `/cloud/accounts` | 雲帳號列表 |
| GET | `/cloud/providers` | 支持的雲商列表 |

### 3.2 Aliyun
| Method | Path | Description |
|--------|------|-------------|
| GET | `/cloud/aliyun/regions` | 地域列表 |
| GET | `/cloud/aliyun/zones` | 可用區列表 |
| GET | `/cloud/aliyun/vpcs` | VPC 列表 |
| GET | `/cloud/aliyun/vswitches` | 交換機列表 |
| GET | `/cloud/aliyun/rds/engine-versions` | RDS 引擎版本 |
| GET | `/cloud/aliyun/rds/instance-classes` | RDS 實例規格 |
| GET | `/cloud/aliyun/es/versions` | ES 版本 |
| GET | `/cloud/aliyun/es/instance-types` | ES 實例規格 |
| GET | `/cloud/aliyun/redis/versions` | Redis 版本 |
| GET | `/cloud/aliyun/redis/instance-classes` | Redis 實例規格 |

### 3.3 AWS
| Method | Path | Description |
|--------|------|-------------|
| GET | `/cloud/aws/regions` | Region 列表 |
| GET | `/cloud/aws/azs` | Availability Zones |
| GET | `/cloud/aws/vpcs` | VPC 列表 |
| GET | `/cloud/aws/subnets` | Subnet 列表 |
| GET | `/cloud/aws/rds/engine-versions` | RDS Engine Versions |
| GET | `/cloud/aws/rds/instance-classes` | RDS Instance Classes |

## 4. Data Sync APIs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/sync/tasks` | 同步任務列表 |
| POST | `/sync/tasks/{id}/trigger` | 手動觸發同步 |
| GET | `/sync/tasks/{id}/logs` | 同步日誌 |
| GET | `/sync/status` | 同步狀態總覽 |

## 5. System APIs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/system/health` | 健康檢查 |
| GET | `/system/config` | 系統配置 |
| GET | `/users/me` | 當前用戶信息 |
| GET | `/users` | 用戶列表（用於審批人選擇） |

## 核心 DTO 設計

### FieldConfigUpdateRequest
```java
public record FieldConfigUpdateRequest(
    String fieldKey,
    String displayName,
    String description,
    String groupKey,
    FormTarget formTarget,
    ValueSource valueSource,
    ComponentType componentType,
    boolean required,
    boolean editable,
    int displayOrder,
    Object fixedValue,
    Object defaultValue,
    DataSourceConfig dataSource,
    ValidationConfig validation,
    List<String> dependsOn
) {}

public record DataSourceConfig(
    String type,        // STATIC, API
    String endpoint,
    String method,
    Map<String, String> params,
    ResponseMapping responseMapping,
    List<StaticOption> options
) {}

public record StaticOption(
    String label,
    String value,
    String description
) {}

public record ResponseMapping(
    String labelField,
    String valueField,
    String descriptionField
) {}

public record ValidationConfig(
    Integer min,
    Integer max,
    Integer step,
    Integer minLength,
    Integer maxLength,
    String pattern,
    String patternMessage
) {}
```

### ProvisioningRequestCreateRequest
```java
public record ProvisioningRequestCreateRequest(
    UUID templateId,
    Map<String, Object> userFormData
) {}
```

### ApprovalRequest
```java
public record ApprovalRequest(
    String action,       // APPROVE, REJECT
    String comment
) {}
```
