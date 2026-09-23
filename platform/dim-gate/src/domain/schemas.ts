export * from './service-delivery-input-schemas.ts'
export * from './schema-models.ts'
export * from './command-input-schemas.ts'
import { aliyunComputeAttributesSchema, apiErrorSchema, applicationSchema, artifactSchema, auditEventSchema, awsComputeAttributesSchema, businessUnitSchema, catalogItemSchema, catalogTemplateSchema, changeDetailSchema, changeExecutionSchema, changeRequestSchema, ciSchema, ciViewSchema, commandReceiptSchema, createChangeInputSchema, dashboardViewSchema, deliveryLogSchema, environmentSchema, eventSchema, guideViewSchema, incidentSchema, integrationSchema, locationSchema, metricSeriesSchema, metricsViewSchema, modelFieldSchema, navigationItemSchema, notificationSchema, observationBucketSchema, observationLogSchema, onpremComputeAttributesSchema, organizationSchema, patchChangeInputSchema, personaSchema, pipelineRunSchema, placementSchema, poolSchema, projectSchema, providerAccountSchema, provisionJobSchema, relationSchema, releaseDetailSchema, releaseSchema, requestSchema, resourceBindingSchema, resourceCapacitySchema, resourceInventorySchema, resourceObjectSchema, resourceQuotaSchema, roleAssignmentSchema, scenarioInputSchema, serviceResourcesSchema, sessionViewSchema, snapshotSchema, teamSchema, traceSchema, traceSummarySchema, userSchema, workItemSchema, workItemSummarySchema } from './schema-models.ts'
import { acknowledgeIncidentInputSchema, advanceClockSchema, createAssignmentInputSchema, createCatalogRevisionInputSchema, createCiInputSchema, createModelFieldInputSchema, createPipelineInputSchema, createRelationInputSchema, createRequestInputSchema, deleteRelationInputSchema, patchCatalogInputSchema, patchCiSchema, patchModelFieldInputSchema, patchNavigationInputSchema, patchRequestInputSchema, patchUserInputSchema, publishCatalogInputSchema, reasonCommandSchema, revokeAssignmentSchema, rollbackReleaseInputSchema, versionCommandSchema } from './command-input-schemas.ts'

export const contractSchemas = {
  ResourceObject: resourceObjectSchema, ResourceBinding: resourceBindingSchema, ResourceQuota: resourceQuotaSchema,
  ChangeRequest: changeRequestSchema, ChangeExecution: changeExecutionSchema, CreateChange: createChangeInputSchema, PatchChange: patchChangeInputSchema,
  WorkItemSummary: workItemSummarySchema, ChangeDetail: changeDetailSchema, ResourceCapacity: resourceCapacitySchema, ResourceInventory: resourceInventorySchema, ServiceResources: serviceResourcesSchema, WorkItem: workItemSchema,
  Organization: organizationSchema, BusinessUnit: businessUnitSchema, Team: teamSchema, Project: projectSchema,
  User: userSchema, Application: applicationSchema, Environment: environmentSchema, ProviderAccount: providerAccountSchema,
  Location: locationSchema, ResourcePool: poolSchema, CI: ciSchema, CIView: ciViewSchema, AWSComputeAttributes: awsComputeAttributesSchema,
  AliyunComputeAttributes: aliyunComputeAttributesSchema, OnpremComputeAttributes: onpremComputeAttributesSchema,
  Placement: placementSchema, Relation: relationSchema, RoleAssignment: roleAssignmentSchema,
  NavigationItem: navigationItemSchema, ModelField: modelFieldSchema, CatalogTemplate: catalogTemplateSchema,
  CatalogItem: catalogItemSchema, Request: requestSchema, ProvisionJob: provisionJobSchema, PipelineRun: pipelineRunSchema,
  Release: releaseSchema, Artifact: artifactSchema, DeliveryLog: deliveryLogSchema, ReleaseDetail: releaseDetailSchema,
  ObservationBucket: observationBucketSchema, LogEntry: observationLogSchema, TraceSummary: traceSummarySchema,
  Trace: traceSchema, MetricSeries: metricSeriesSchema, MetricsView: metricsViewSchema, Notification: notificationSchema,
  AcknowledgeIncident: acknowledgeIncidentInputSchema,
  Incident: incidentSchema, Integration: integrationSchema, AuditEvent: auditEventSchema,
  DomainEvent: eventSchema, Snapshot: snapshotSchema, Persona: personaSchema, SessionView: sessionViewSchema,
  DashboardView: dashboardViewSchema, GuideView: guideViewSchema, CommandReceipt: commandReceiptSchema,
  ApiError: apiErrorSchema, CreateCI: createCiInputSchema, PatchCI: patchCiSchema,
  CreateRelation: createRelationInputSchema, DeleteRelation: deleteRelationInputSchema,
  RevokeAssignment: revokeAssignmentSchema, AdvanceClock: advanceClockSchema,
  VersionCommand: versionCommandSchema, ReasonCommand: reasonCommandSchema,
  CreateRequest: createRequestInputSchema, PatchRequest: patchRequestInputSchema,
  CreateAssignment: createAssignmentInputSchema, PatchUser: patchUserInputSchema,
  PatchNavigation: patchNavigationInputSchema, CreateCatalogRevision: createCatalogRevisionInputSchema,
  PatchCatalog: patchCatalogInputSchema, PublishCatalog: publishCatalogInputSchema,
  CreateModelField: createModelFieldInputSchema, PatchModelField: patchModelFieldInputSchema,
  ScenarioInput: scenarioInputSchema,
  CreatePipeline: createPipelineInputSchema, RollbackRelease: rollbackReleaseInputSchema,
}
