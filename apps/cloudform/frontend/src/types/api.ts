export type ApiError = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export type ApiResponse<T> = {
  success: boolean;
  data: T;
  error: ApiError | null;
  message: string;
  timestamp: string;
};

export type PageResponse<T> = {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export type CloudProvider = 'ALIYUN' | 'AWS';

export type ResourceType = 'RDS' | 'ELASTICSEARCH' | 'REDIS' | 'MONGODB' | 'CLICKHOUSE';

export type TemplateStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export type FormTarget = 'USER_FORM' | 'OPS_FORM' | 'HIDDEN' | 'RESULT_ONLY';

export type ValueSource = 'FIXED' | 'USER_INPUT' | 'OPS_INPUT' | 'SYSTEM_DEFAULT' | 'API_DRIVEN';

export type ComponentType =
  | 'INPUT'
  | 'TEXTAREA'
  | 'NUMBER'
  | 'SELECT'
  | 'MULTI_SELECT'
  | 'RADIO'
  | 'CHECKBOX'
  | 'SWITCH'
  | 'DATE'
  | 'PASSWORD'
  | 'READONLY';

export type TemplateSummary = {
  id: string;
  cloudProvider: CloudProvider;
  resourceType: ResourceType;
  tfResourceName: string;
  tfProviderVersion: string | null;
  displayName: string;
  description: string | null;
  icon: string | null;
  status: TemplateStatus;
  updatedAt: string;
};

export type TemplateDetail = {
  id: string;
  cloudProvider: CloudProvider;
  resourceType: ResourceType;
  tfResourceName: string;
  tfProviderVersion: string | null;
  displayName: string;
  description: string | null;
  icon: string | null;
  status: TemplateStatus;
  tfSchemaJson: string | null;
  formConfigJson: string | null;
  tfTemplate: string | null;
  syncConfigJson: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type SchemaSourceItem = {
  provider: string;
  version: string;
  resourceCount: number;
};

export type TfFieldNode = {
  tfPath: string;
  tfType: string;
  required: boolean;
  optional: boolean;
  computed: boolean;
  sensitive: boolean;
  description: string | null;
  nestedBlock: boolean;
  nestingMode?: string | null;
  children: TfFieldNode[];
};

export type SchemaTreeResponse = {
  provider: string;
  version: string;
  resourceName: string;
  description: string | null;
  fields: TfFieldNode[];
};

export type FieldConfigResponse = {
  id: string;
  templateId: string;
  fieldKey: string;
  tfPath: string | null;
  displayName: string | null;
  description: string | null;
  groupKey: string | null;
  formTarget: FormTarget;
  valueSource: ValueSource;
  componentType: ComponentType;
  required: boolean;
  editable: boolean;
  displayOrder: number;
  fixedValueJson: string | null;
  defaultValueJson: string | null;
  dataSourceJson: string | null;
  validationJson: string | null;
  dependsOnJson: string | null;
  tfType: string | null;
  tfRequired: boolean;
  tfComputed: boolean;
  tfDefault: string | null;
};

export type RequiredApi = {
  path: string;
  method: string;
  params: string[];
  description: string | null;
  source: string;
};

export type GenerationResponse = {
  formConfig: unknown;
  terraformTemplate: string;
  requiredApis: RequiredApi[];
};

export type FieldConfigUpdateRequest = {
  fieldKey: string;
  tfPath: string | null;
  displayName: string | null;
  description: string | null;
  groupKey: string | null;
  formTarget: FormTarget;
  valueSource: ValueSource;
  componentType: ComponentType;
  required: boolean;
  editable: boolean;
  displayOrder: number;
  fixedValueJson: string | null;
  defaultValueJson: string | null;
  dataSourceJson: string | null;
  validationJson: string | null;
  dependsOnJson: string | null;
};
