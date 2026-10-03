import { z } from 'zod'
import * as d from '../../domain/schemas.ts'
import type { ContractContext } from '../contracts.ts'

/** The six monitoring collections share one bounded, scope-aware list surface. */
export const monitoringListQuerySchema = z.strictObject({
  applicationId: d.idSchema.optional(), environmentId: d.idSchema.optional(), ciId: d.idSchema.optional(),
  ruleId: d.idSchema.optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['updatedAt', 'createdAt', 'id']).default('updatedAt'), order: z.enum(['asc', 'desc']).default('desc'),
})
export const monitoringPolicyListQuerySchema = monitoringListQuerySchema.extend({ status: z.enum(['draft', 'validated', 'submitted', 'approved', 'rejected', 'active']).optional() })
export const silenceListQuerySchema = monitoringListQuerySchema.extend({ status: z.enum(['scheduled', 'active', 'expired']).optional() })
export const alertEvaluationListQuerySchema = monitoringListQuerySchema.extend({ status: z.enum(['fresh', 'stale', 'unknown']).optional() })
export const notificationDeliveryListQuerySchema = monitoringListQuerySchema.extend({ status: z.enum(['queued', 'suppressed', 'delivered', 'failed']).optional() })

export function registerAlertingContracts({ read, command }: ContractContext) {
  for (const [path, listName, detailName, schema, query] of [
    ['monitor-policies', 'listMonitorPolicies', 'getMonitorPolicy', d.monitorPolicySchema, monitoringPolicyListQuerySchema],
    ['alert-rules', 'listAlertRules', 'getAlertRule', d.alertRuleSchema, monitoringPolicyListQuerySchema],
    ['slo-policies', 'listSloPolicies', 'getSloPolicy', d.sloPolicySchema, monitoringPolicyListQuerySchema],
    ['silences', 'listSilences', 'getSilence', d.silenceSchema, silenceListQuerySchema],
    ['alert-evaluations', 'listAlertEvaluations', 'getAlertEvaluation', d.alertEvaluationSchema, alertEvaluationListQuerySchema],
    ['notification-deliveries', 'listNotificationDeliveries', 'getNotificationDelivery', d.notificationDeliverySchema, notificationDeliveryListQuerySchema],
  ] as const) {
    read(`/${path}`, listName, d.pageSchema(schema), 'W4', query)
    read(`/${path}/{id}`, detailName, schema, 'W4')
  }
  for (const [path, name, createBody, reviseBody] of [
    ['monitor-policies', 'MonitorPolicy', d.createMonitorPolicyInputSchema, d.reviseMonitorPolicyInputSchema],
    ['alert-rules', 'AlertRule', d.createAlertRuleInputSchema, d.reviseAlertRuleInputSchema],
    ['slo-policies', 'SloPolicy', d.createSLOPolicyInputSchema, d.reviseSLOPolicyInputSchema],
  ] as const) {
    command('post', `/${path}`, `create${name}`, createBody, 'W4', 201)
    command('post', `/${path}/{id}/revise`, `revise${name}`, reviseBody, 'W4', 201)
    for (const action of ['validate', 'submit', 'approve', 'reject', 'activate'] as const) {
      command('post', `/${path}/{id}/${action}`, `${action}${name}`, d.monitoringActionInputSchema, 'W4')
    }
  }
  command('post', '/silences', 'createSilence', d.createSilenceInputSchema, 'W4', 201)
}
