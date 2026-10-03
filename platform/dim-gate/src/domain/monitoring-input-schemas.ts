import { z } from 'zod'
import { idSchema, timestampSchema, versionSchema } from './schema-primitives.ts'
import { alertRuleSpecSchema, monitorPolicySpecSchema, sloPolicySpecSchema } from './monitoring-models.ts'

const reason = z.string().trim().min(1).max(500)
export const createMonitorPolicyInputSchema = z.strictObject({ spec: monitorPolicySpecSchema, reason })
export const createAlertRuleInputSchema = z.strictObject({ spec: alertRuleSpecSchema, reason })
export const createSLOPolicyInputSchema = z.strictObject({ spec: sloPolicySpecSchema, reason })
export const reviseMonitorPolicyInputSchema = createMonitorPolicyInputSchema.extend({ expectedVersion: versionSchema })
export const reviseAlertRuleInputSchema = createAlertRuleInputSchema.extend({ expectedVersion: versionSchema })
export const reviseSLOPolicyInputSchema = createSLOPolicyInputSchema.extend({ expectedVersion: versionSchema })
export const monitoringActionInputSchema = z.strictObject({ expectedVersion: versionSchema, reason })
export const createSilenceInputSchema = z.strictObject({ ruleId: idSchema, startAt: timestampSchema, expiresAt: timestampSchema, reason })
export const alertScenarioInputSchema = z.strictObject({ scenarioKey: z.enum(['alert-breach', 'alert-recovery', 'alert-unknown', 'alert-delivery-failure']), ruleId: idSchema })
