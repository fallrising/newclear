export type Role = "ADMIN" | "OPS" | "USER";

export interface Actor {
  username: string;
  roles: Role[];
}

export interface Topic {
  id: number;
  name: string;
  clusterId: number;
  partitions: number;
  replication: number;
  delayTopic: boolean;
  maxMessageBytes: number;
  retentionMs: number;
  produceQuotaTps: number;
  compression: string;
  token: string;
  owner: string;
  state: number;
  version: number;
  remark: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConsumeGroup {
  id: number;
  name: string;
  token: string;
  owner: string;
  state: number;
  version: number;
  remark: string;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: number;
  groupId: number;
  topicId: number;
  spec: Record<string, unknown>;
  state: number;
  version: number;
  owner: string;
  createdAt: string;
  updatedAt: string;
}

export interface TopicSample {
  partition: number;
  offset: number;
  timestamp: string;
  key: string | null;
  valueBase64: string;
  tags: string[];
  headers: Record<string, string>;
  redacted: boolean;
  celMatched: boolean;
}

export interface Preview {
  action: "DELIVER" | "FILTERED";
  reason: string;
  valueBase64: string;
}

export interface PartitionProgress {
  partition: number;
  committedOffset: number | null;
  endOffset: number;
  lag: number;
  lastCommitAt: string | null;
}

export interface GroupTopicProgress {
  topic: string;
  mode: "CLASSIC" | "SHARE";
  unsupportedReason: string;
  partitions: PartitionProgress[];
}

export interface DlqRecord {
  partition: number;
  offset: number;
  timestamp: string;
  key: string | null;
  valueBase64: string;
  headers: Record<string, string>;
}

export interface Delay {
  delayId: string;
  targetTopic: string;
  status: string;
  dueAt: string;
  createdAt: string;
  firedAt: string | null;
  loopIntervalMs: number | null;
  loopRemaining: number | null;
  expireAt: string | null;
  payloadBytes: number;
  cancelRequested: boolean;
}

export interface AuditPage {
  items: Array<{
    id: number;
    actor: string;
    action: string;
    entity: string;
    entityId: string;
    detail: Record<string, unknown>;
    at: string;
  }>;
  total: number;
  page: number;
  size: number;
}

export interface Cluster {
  id: number;
  name: string;
  bootstrapServers: string;
  defaultCluster: boolean;
  createdAt: string;
}

export interface ClusterHealth {
  clusterId: string;
  controllerId: number;
  nodeCount: number;
  status: string;
}

export interface User {
  id: number;
  username: string;
  role: Role;
  enabled: boolean;
  createdAt: string;
}
