import { z } from 'zod'
import { idSchema, timestampSchema, versionSchema } from './schema-primitives.ts'

const base = { id: idSchema, orgId: idSchema, version: versionSchema, createdAt: timestampSchema, updatedAt: timestampSchema }
export const monitorMetricSchema = z.enum(['rate', 'errorRate', 'p95Latency', 'cpuUtilization', 'memoryUtilization'])
export const monitoringTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('service'), applicationId: idSchema, environmentId: idSchema }),
  z.strictObject({ kind: z.literal('infrastructure'), ciId: idSchema }),
])
export const monitorPolicySpecSchema = z.strictObject({
  target: monitoringTargetSchema, source: z.enum(['demo-red', 'demo-ci']), metrics: z.array(monitorMetricSchema).min(1).max(5)
    .refine(values => new Set(values).size === values.length, 'Metrics must be unique'),
  sampleIntervalSeconds: z.number().int().min(60).max(3600), freshnessSeconds: z.number().int().min(60).max(86400), enabled: z.boolean(),
})
export const alertRuleSpecSchema = z.strictObject({
  monitorPolicyId: idSchema, metric: monitorMetricSchema, aggregation: z.enum(['avg', 'max', 'last']),
  windowSeconds: z.number().int().min(60).max(86400), comparator: z.enum(['gt', 'gte', 'lt', 'lte']),
  threshold: z.number().finite().nonnegative(), unit: z.enum(['requests/second', 'fraction', 'ms']),
  requiredConsecutiveSamples: z.number().int().min(1).max(10), severity: z.enum(['warning', 'critical']),
  channelRef: z.enum(['demo-rd', 'demo-ops']), enabled: z.boolean(),
})
export const sloPolicySpecSchema = z.strictObject({ monitorPolicyId: idSchema,
  indicator: z.enum(['availability', 'latency']), targetFraction: z.number().gt(0).lte(1),
  windowSeconds: z.number().int().min(60).max(2_592_000), unit: z.enum(['fraction', 'ms']),
  thresholdMs: z.number().positive().max(60_000).optional(),
}).superRefine((spec, ctx) => {
  if (spec.indicator === 'availability' && (spec.unit !== 'fraction' || spec.thresholdMs !== undefined)
    || spec.indicator === 'latency' && (spec.unit !== 'ms' || spec.thresholdMs === undefined))
    ctx.addIssue({ code: 'custom', path: ['indicator'], message: 'Indicator, unit and latency threshold must match' })
})
export const monitoringDecisionSchema = z.strictObject({ actorId: idSchema, decision: z.enum(['approved', 'rejected']), reason: z.string().trim().min(1).max(500), occurredAt: timestampSchema })
const lifecycle = { ...base, requesterId: idSchema, correlationId: idSchema, revision: versionSchema,
  activeRevision: versionSchema.nullable(), status: z.enum(['draft', 'validated', 'submitted', 'approved', 'rejected', 'active']) }
const revision = <T extends z.ZodType>(spec: T) => z.strictObject({ revision: versionSchema, spec,
  submittedAt: timestampSchema.optional(), decision: monitoringDecisionSchema.optional() })
export const monitorPolicySchema = z.strictObject({ ...lifecycle, spec: monitorPolicySpecSchema, revisions: z.array(revision(monitorPolicySpecSchema)).min(1) })
export const alertRuleSchema = z.strictObject({ ...lifecycle, spec: alertRuleSpecSchema, revisions: z.array(revision(alertRuleSpecSchema)).min(1) })
export const sloPolicySchema = z.strictObject({ ...lifecycle, spec: sloPolicySpecSchema, revisions: z.array(revision(sloPolicySpecSchema)).min(1) })
export const silenceSchema = z.strictObject({ ...base, ruleId: idSchema, ruleRevision: versionSchema,
  target: monitoringTargetSchema, reason: z.string().trim().min(1).max(500), actorId: idSchema,
  startAt: timestampSchema, expiresAt: timestampSchema, correlationId: idSchema })
export const infrastructureMetricSchema = z.strictObject({ id: idSchema, ciId: idSchema, source: z.literal('demo-ci'),
  metric: z.enum(['cpuUtilization', 'memoryUtilization']), from: timestampSchema, to: timestampSchema,
  value: z.number().min(0).max(1).nullable() })
export const alertEvaluationSchema = z.strictObject({ ...base, ruleId: idSchema, ruleRevision: versionSchema,
  monitorRevision: versionSchema,
  target: monitoringTargetSchema, source: z.enum(['demo-red', 'demo-ci']), metric: monitorMetricSchema,
  sampleId: idSchema, sourceTime: timestampSchema, evaluatedAt: timestampSchema, sampleValue: z.number().nullable(), value: z.number().nullable(),
  freshness: z.enum(['fresh', 'stale', 'unknown']), breached: z.boolean().nullable(),
  consecutive: z.number().int().nonnegative(), incidentId: idSchema.optional(), correlationId: idSchema })
export const notificationDeliverySchema = z.strictObject({ ...base, ruleId: idSchema, ruleRevision: versionSchema,
  incidentId: idSchema, target: monitoringTargetSchema, channelRef: z.enum(['demo-rd', 'demo-ops']),
  recipientType: z.enum(['rd', 'ops']), status: z.enum(['queued', 'suppressed', 'delivered', 'failed']),
  occurredAt: timestampSchema, safeFailureCode: z.enum(['DEMO_DELIVERY_FAILURE']).optional(), correlationId: idSchema })
export const infrastructureIncidentSchema = z.strictObject({ ...base, ciId: idSchema, ruleId: idSchema,
  ruleRevision: versionSchema, severity: z.enum(['warning', 'critical']), state: z.enum(['open', 'acknowledged', 'investigating', 'resolved']),
  assigneeId: idSchema.optional(),
  episode: versionSchema, evidenceEvaluationIds: z.array(idSchema).min(1), recoverySamples: z.number().int().min(0).max(3),
  correlationId: idSchema })

export type MonitoringTarget = z.infer<typeof monitoringTargetSchema>
export type MonitorPolicy = z.infer<typeof monitorPolicySchema>
export type AlertRule = z.infer<typeof alertRuleSchema>
export type SLOPolicy = z.infer<typeof sloPolicySchema>
export type Silence = z.infer<typeof silenceSchema>
export type InfrastructureMetric = z.infer<typeof infrastructureMetricSchema>
export type AlertEvaluation = z.infer<typeof alertEvaluationSchema>
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>
export type InfrastructureIncident = z.infer<typeof infrastructureIncidentSchema>
