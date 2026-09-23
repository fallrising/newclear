import type { z } from 'zod'
import { commandReceiptSchema, pageSchema, type CommandReceipt, type Page } from '../../domain/schema-models'
import { monitorPolicySchema, alertRuleSchema, sloPolicySchema, silenceSchema, alertEvaluationSchema,
  notificationDeliverySchema, type MonitorPolicy, type AlertRule, type SLOPolicy, type Silence,
  type AlertEvaluation, type NotificationDelivery } from '../../domain/monitoring-models'
import type { createMonitorPolicyInputSchema, createAlertRuleInputSchema, createSLOPolicyInputSchema,
  reviseMonitorPolicyInputSchema, reviseAlertRuleInputSchema, reviseSLOPolicyInputSchema,
  monitoringActionInputSchema, createSilenceInputSchema } from '../../domain/monitoring-input-schemas'
import type { ApiRequest } from '../core/request'

export type MonitoringListQuery = {
  applicationId?: string; environmentId?: string; ciId?: string; ruleId?: string;
  page?: number; pageSize?: number; sort?: 'updatedAt' | 'createdAt' | 'id'; order?: 'asc' | 'desc';
}
export type MonitoringPolicyQuery = MonitoringListQuery & { status?: 'draft' | 'validated' | 'submitted' | 'approved' | 'rejected' | 'active' }
export type SilenceQuery = MonitoringListQuery & { status?: 'scheduled' | 'active' | 'expired' }
export type AlertEvaluationQuery = MonitoringListQuery & { status?: 'fresh' | 'stale' | 'unknown' }
export type NotificationDeliveryQuery = MonitoringListQuery & { status?: 'queued' | 'suppressed' | 'delivered' | 'failed' }
export type CreateMonitorPolicyInput = z.input<typeof createMonitorPolicyInputSchema>
export type CreateAlertRuleInput = z.input<typeof createAlertRuleInputSchema>
export type CreateSloPolicyInput = z.input<typeof createSLOPolicyInputSchema>
export type ReviseMonitorPolicyInput = z.input<typeof reviseMonitorPolicyInputSchema>
export type ReviseAlertRuleInput = z.input<typeof reviseAlertRuleInputSchema>
export type ReviseSloPolicyInput = z.input<typeof reviseSLOPolicyInputSchema>
export type MonitoringActionInput = z.input<typeof monitoringActionInputSchema>
export type CreateSilenceInput = z.input<typeof createSilenceInputSchema>
export type MonitoringAction = 'validate' | 'submit' | 'approve' | 'reject' | 'activate'

const idPath = (collection: string, id: string) => `/${collection}/${encodeURIComponent(id)}`
const queryPath = (path: string, input: MonitoringListQuery & { status?: string }) => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== '') query.set(key, String(value))
  return query.size ? `${path}?${query}` : path
}

export function createAlertingClient(request: ApiRequest) {
  const action = (collection: string, id: string, name: MonitoringAction, body: MonitoringActionInput): Promise<CommandReceipt> =>
    request(`${idPath(collection, id)}/${name}`, commandReceiptSchema, { method: 'POST', body })
  return {
    listMonitorPolicies: (query: MonitoringPolicyQuery = {}): Promise<Page<MonitorPolicy>> => request(queryPath('/monitor-policies', query), pageSchema(monitorPolicySchema)),
    getMonitorPolicy: (id: string): Promise<MonitorPolicy> => request(idPath('monitor-policies', id), monitorPolicySchema),
    createMonitorPolicy: (body: CreateMonitorPolicyInput): Promise<CommandReceipt> => request('/monitor-policies', commandReceiptSchema, { method: 'POST', body }),
    reviseMonitorPolicy: (id: string, body: ReviseMonitorPolicyInput): Promise<CommandReceipt> => request(`${idPath('monitor-policies', id)}/revise`, commandReceiptSchema, { method: 'POST', body }),
    monitorPolicyAction: (id: string, name: MonitoringAction, body: MonitoringActionInput): Promise<CommandReceipt> => action('monitor-policies', id, name, body),
    listAlertRules: (query: MonitoringPolicyQuery = {}): Promise<Page<AlertRule>> => request(queryPath('/alert-rules', query), pageSchema(alertRuleSchema)),
    getAlertRule: (id: string): Promise<AlertRule> => request(idPath('alert-rules', id), alertRuleSchema),
    createAlertRule: (body: CreateAlertRuleInput): Promise<CommandReceipt> => request('/alert-rules', commandReceiptSchema, { method: 'POST', body }),
    reviseAlertRule: (id: string, body: ReviseAlertRuleInput): Promise<CommandReceipt> => request(`${idPath('alert-rules', id)}/revise`, commandReceiptSchema, { method: 'POST', body }),
    alertRuleAction: (id: string, name: MonitoringAction, body: MonitoringActionInput): Promise<CommandReceipt> => action('alert-rules', id, name, body),
    listSloPolicies: (query: MonitoringPolicyQuery = {}): Promise<Page<SLOPolicy>> => request(queryPath('/slo-policies', query), pageSchema(sloPolicySchema)),
    getSloPolicy: (id: string): Promise<SLOPolicy> => request(idPath('slo-policies', id), sloPolicySchema),
    createSloPolicy: (body: CreateSloPolicyInput): Promise<CommandReceipt> => request('/slo-policies', commandReceiptSchema, { method: 'POST', body }),
    reviseSloPolicy: (id: string, body: ReviseSloPolicyInput): Promise<CommandReceipt> => request(`${idPath('slo-policies', id)}/revise`, commandReceiptSchema, { method: 'POST', body }),
    sloPolicyAction: (id: string, name: MonitoringAction, body: MonitoringActionInput): Promise<CommandReceipt> => action('slo-policies', id, name, body),
    listSilences: (query: SilenceQuery = {}): Promise<Page<Silence>> => request(queryPath('/silences', query), pageSchema(silenceSchema)),
    getSilence: (id: string): Promise<Silence> => request(idPath('silences', id), silenceSchema),
    createSilence: (body: CreateSilenceInput): Promise<CommandReceipt> => request('/silences', commandReceiptSchema, { method: 'POST', body }),
    listAlertEvaluations: (query: AlertEvaluationQuery = {}): Promise<Page<AlertEvaluation>> => request(queryPath('/alert-evaluations', query), pageSchema(alertEvaluationSchema)),
    getAlertEvaluation: (id: string): Promise<AlertEvaluation> => request(idPath('alert-evaluations', id), alertEvaluationSchema),
    listNotificationDeliveries: (query: NotificationDeliveryQuery = {}): Promise<Page<NotificationDelivery>> => request(queryPath('/notification-deliveries', query), pageSchema(notificationDeliverySchema)),
    getNotificationDelivery: (id: string): Promise<NotificationDelivery> => request(idPath('notification-deliveries', id), notificationDeliverySchema),
  }
}
