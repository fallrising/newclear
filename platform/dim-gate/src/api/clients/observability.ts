import { z } from 'zod'
import {
  commandReceiptSchema, integrationSchema, metricsViewSchema,
  notificationSchema, observationLogSchema, pageSchema, traceSchema, traceSummarySchema,
  type Incident, type ObservationLog, type TraceSummary,
} from '../../domain/schema-models'
import type { ApiRequest } from '../core/request'
import { incidentViewSchema } from '../wire-views'

export type ObservationWindow = { applicationId: string; environmentId: string; from: string; to: string }
type Pagination = { page?: number; pageSize?: number; order?: 'asc' | 'desc' }
export type TraceListInput = ObservationWindow & Pagination & { status?: TraceSummary['status']; sort?: 'id' | 'start' | 'durationMs' }
export type LogListInput = ObservationWindow & Pagination & { traceId?: string; releaseId?: string; level?: ObservationLog['level']; sort?: 'id' | 'occurredAt' }
export type IncidentListInput = Pagination & { environmentId?: string; ciId?: string; state?: Incident['state']; severity?: Incident['severity']; q?: string; sort?: 'id' | 'updatedAt' }
export type MetricsView = z.infer<typeof metricsViewSchema>

function withQuery(path: string, input: object) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== '') query.set(key, String(value))
  return query.size ? `${path}?${query}` : path
}

export function createObservabilityClient(request: ApiRequest) {
  return {
    getMetrics: (window: ObservationWindow & { step?: '60s' }) =>
      request(withQuery('/observability/metrics', { ...window, step: window.step ?? '60s' }), metricsViewSchema),
    listTraces: (input: TraceListInput) => request(withQuery('/observability/traces', input), pageSchema(traceSummarySchema)),
    getTrace: (id: string) => request(`/observability/traces/${encodeURIComponent(id)}`, traceSchema),
    listLogs: (input: LogListInput) => request(withQuery('/observability/logs', input), pageSchema(observationLogSchema)),
    listIncidents: (input: IncidentListInput = {}) => request(withQuery('/incidents', input), pageSchema(incidentViewSchema)),
    getIncident: (id: string) => request(`/incidents/${encodeURIComponent(id)}`, incidentViewSchema),
    acknowledgeIncident: (id: string, expectedVersion: number, reason?: string) =>
      request(`/incidents/${encodeURIComponent(id)}/acknowledge`, commandReceiptSchema, { method: 'POST', body: { expectedVersion, ...(reason ? { reason } : {}) } }),
    investigateIncident: (id: string, expectedVersion: number, reason: string) =>
      request(`/incidents/${encodeURIComponent(id)}/investigate`, commandReceiptSchema, { method: 'POST', body: { expectedVersion, reason } }),
    listIntegrations: () => request('/integrations', z.array(integrationSchema)),
    testIntegration: (id: string, expectedVersion: number) =>
      request(`/integrations/${encodeURIComponent(id)}/test`, commandReceiptSchema, { method: 'POST', body: { expectedVersion } }),
    getNotifications: () => request('/notifications', z.strictObject({ items: z.array(notificationSchema).max(20) })),
  }
}

export type ObservabilityClient = ReturnType<typeof createObservabilityClient>
