import { api } from '../../api/client'
import type { PipelineDefinitionDetail, ServiceConfigDetail, ServiceSource, TrafficPolicyDetail } from '../../domain/schemas'

export type ServiceKind = ServiceSource['sourceType']
export type ServiceDetail = PipelineDefinitionDetail | ServiceConfigDetail | TrafficPolicyDetail
export type ServiceAction = ServiceDetail['availableActions'][number]
export const sectionPath = { pipelineDefinition: 'delivery', serviceConfig: 'configuration', trafficPolicy: 'traffic' } as const
export const sectionTitle = { pipelineDefinition: '交付定義', serviceConfig: '服務配置', trafficPolicy: '流量策略' } as const
export const stateLabel: Record<ServiceSource['state'], string> = {
  draft: '草稿', validated: '已驗證', pending_approval: '待獨立審批', approved: '已核准，待執行', rejected: '已拒絕', cancelled: '已取消',
  active: '已生效', superseded: '已由新版本取代', applying: '配置生效中', rolling_out: '流量放量中', failed: '執行失敗',
}
export const actionLabel: Record<ServiceAction, string> = {
  edit: '編輯草稿', validate: '驗證草稿', submit: '提交獨立審批', approve: '核准變更', reject: '拒絕變更', cancel: '取消變更',
  activate: '啟用交付定義', apply: '套用配置', start: '開始灰度放量', revisions: '建立下一版草稿', restore: '以此版本建立回復草稿', runs: '依此定義執行',
}
export const timeLabel = (value: string | null | undefined) => value ? new Date(value).toLocaleString('zh-TW') : '未知／尚未發生'
export const isMissing = (error: unknown) => typeof error === 'object' && error !== null && 'status' in error && error.status === 404
export const sourcePath = (source: ServiceSource, center: 'rd' | 'ops', environmentId?: string) => center === 'ops'
  ? `/ops/service-changes/${source.sourceType}/${encodeURIComponent(source.id)}`
  : `/rd/apps/${encodeURIComponent(source.applicationId)}/${sectionPath[source.sourceType]}?${new URLSearchParams({ environmentId: environmentId ?? ('environmentId' in source ? source.environmentId : source.affectedEnvironmentIds[0]), revisionId: source.id })}`
export async function getServiceDetail(kind: ServiceKind, id: string): Promise<ServiceDetail> {
  if (kind === 'pipelineDefinition') return api.getPipelineDefinition(id)
  if (kind === 'serviceConfig') return api.getServiceConfig(id)
  return api.getTrafficPolicy(id)
}
export async function listServiceSources(kind: ServiceKind, applicationId: string, environmentId: string, page: number) {
  const query = { applicationId, environmentId, page, pageSize: 25, sort: 'updatedAt' as const, order: 'desc' as const }
  if (kind === 'pipelineDefinition') return api.listPipelineDefinitions(query)
  if (kind === 'serviceConfig') return api.listServiceConfigs(query)
  return api.listTrafficPolicies(query)
}
