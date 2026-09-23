import { lazy, Suspense } from 'react'
import { LoadingState } from '../../components/shared/states'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import type { SessionView } from '../../domain/schemas'
import { ApplicationDetailRoute, ApplicationListRoute, CiDetailPage, CmdbListPage, EnvironmentDetailRoute, TopologyRoute } from '../../features/cmdb'
import { CenterOverview, Guide, UnknownRoute } from '../../features/foundation'
import { CenterLayout } from '../layouts/CenterLayout'

const AccessPage = lazy(() => import('../../features/admin').then(module => ({ default: module.AccessPage })))
const AdminCatalogPage = lazy(() => import('../../features/admin').then(module => ({ default: module.AdminCatalogPage })))
const AuditPage = lazy(() => import('../../features/admin').then(module => ({ default: module.AuditPage })))
const ModelsPage = lazy(() => import('../../features/admin').then(module => ({ default: module.ModelsPage })))
const NavigationPage = lazy(() => import('../../features/admin').then(module => ({ default: module.NavigationPage })))
const ObservabilityPage = lazy(() => import('../../features/observability').then(module => ({ default: module.ObservabilityPage })))
const IncidentListPage = lazy(() => import('../../features/observability').then(module => ({ default: module.IncidentListPage })))
const IncidentDetailPage = lazy(() => import('../../features/observability').then(module => ({ default: module.IncidentDetailPage })))
const IntegrationsPage = lazy(() => import('../../features/observability').then(module => ({ default: module.IntegrationsPage })))
const PipelineDetailPage = lazy(() => import('../../features/delivery').then(module => ({ default: module.PipelineDetailPage })))
const PipelineListPage = lazy(() => import('../../features/delivery').then(module => ({ default: module.PipelineListPage })))
const ReleaseDetailPage = lazy(() => import('../../features/delivery').then(module => ({ default: module.ReleaseDetailPage })))
const ReleaseListPage = lazy(() => import('../../features/delivery').then(module => ({ default: module.ReleaseListPage })))
const CapacityPage = lazy(() => import('../../features/self-service').then(module => ({ default: module.CapacityPage })))
const CatalogPage = lazy(() => import('../../features/self-service').then(module => ({ default: module.CatalogPage })))
const JobDetailPage = lazy(() => import('../../features/self-service').then(module => ({ default: module.JobDetailPage })))
const JobsPage = lazy(() => import('../../features/self-service').then(module => ({ default: module.JobsPage })))
const RequestDetailPage = lazy(() => import('../../features/self-service').then(module => ({ default: module.RequestDetailPage })))
const WorkItemsPage = lazy(() => import('../../features/resources').then(module => ({ default: module.WorkItemsPage })))
const ServiceResourcesPage = lazy(() => import('../../features/resources').then(module => ({ default: module.ServiceResourcesPage })))
const InventoryListPage = lazy(() => import('../../features/resources').then(module => ({ default: module.InventoryListPage })))
const InventoryDetailPage = lazy(() => import('../../features/resources').then(module => ({ default: module.InventoryDetailPage })))
const ChangeWizardPage = lazy(() => import('../../features/resources').then(module => ({ default: module.ChangeWizardPage })))
const ChangeDetailPage = lazy(() => import('../../features/resources').then(module => ({ default: module.ChangeDetailPage })))
const RequestWizard = lazy(() => import('../../features/self-service').then(module => ({ default: module.RequestWizard })))

const DeliveryPage = lazy(() => import('../../features/service-delivery').then(module => ({ default: module.DeliveryPage })))
const ConfigurationPage = lazy(() => import('../../features/service-delivery').then(module => ({ default: module.ConfigurationPage })))
const TrafficPage = lazy(() => import('../../features/service-delivery').then(module => ({ default: module.TrafficPage })))
const ServiceChangePage = lazy(() => import('../../features/service-delivery').then(module => ({ default: module.ServiceChangePage })))

export function AppRoutes({ session }: { session: SessionView }) {
  return <Suspense fallback={<LoadingState label="正在載入工作區…" />}><Routes>
    <Route path="/" element={<Navigate to={`/${session.centers[0] ?? 'guide'}`} replace />} />
    <Route path="/rd" element={<CenterLayout routeKey="rd.overview" center="rd" session={session}><CenterOverview key={`${session.identityEpoch}:rd`} center="rd" session={session} /></CenterLayout>} />
    <Route path="/rd/apps" element={<CenterLayout routeKey="rd.apps" center="rd" session={session}><ApplicationListRoute /></CenterLayout>} />
    <Route path="/rd/apps/:appId" element={<CenterLayout routeKey="rd.app-detail" center="rd" session={session}><ApplicationDetailRoute canReadResources={session.effectiveActions.includes('binding.read')} canReadServiceDelivery={session.effectiveActions.includes('pipelineDefinition.read')} /></CenterLayout>} />
    <Route path="/rd/apps/:appId/environments/:environmentId" element={<CenterLayout routeKey="rd.environment-detail" center="rd" session={session}><EnvironmentDetailRoute canReadResources={session.effectiveActions.includes('binding.read')} canReadServiceDelivery={session.effectiveActions.includes('pipelineDefinition.read')} /></CenterLayout>} />
    <Route path="/rd/catalog" element={<CenterLayout routeKey="rd.catalog" center="rd" session={session}><CatalogPage /></CenterLayout>} />
    <Route path="/rd/catalog/:itemId/request" element={<CenterLayout routeKey="rd.catalog-request" center="rd" session={session}><RequestWizard /></CenterLayout>} />
    <Route path="/rd/requests" element={<CenterLayout routeKey="rd.requests" center="rd" session={session}><WorkItemsPage center="rd" session={session} /></CenterLayout>} />
    <Route path="/rd/requests/:requestId" element={<CenterLayout routeKey="rd.request-detail" center="rd" session={session}><RequestDetailPage center="rd" /></CenterLayout>} />
    <Route path="/rd/pipelines" element={<CenterLayout routeKey="rd.pipelines" center="rd" session={session}><PipelineListPage session={session} /></CenterLayout>} />
    <Route path="/rd/pipelines/:runId" element={<CenterLayout routeKey="rd.pipeline-detail" center="rd" session={session}><PipelineDetailPage session={session} /></CenterLayout>} />
    <Route path="/rd/releases/:releaseId" element={<CenterLayout routeKey="rd.release-detail" center="rd" session={session}><ReleaseDetailPage session={session} /></CenterLayout>} />
    <Route path="/ops" element={<CenterLayout routeKey="ops.overview" center="ops" session={session}><CenterOverview key={`${session.identityEpoch}:ops`} center="ops" session={session} /></CenterLayout>} />
    <Route path="/ops/cmdb" element={<CenterLayout routeKey="ops.cmdb" center="ops" session={session}><CmdbListPage session={session} /></CenterLayout>} />
    <Route path="/ops/cmdb/:ciId" element={<CenterLayout routeKey="ops.ci-detail" center="ops" session={session}><CiDetailPage session={session} /></CenterLayout>} />
    <Route path="/ops/topology" element={<CenterLayout routeKey="ops.topology" center="ops" session={session}><TopologyRoute client={api} makeQueryKey={queryKey} canWriteRelations={session.effectiveActions.includes('relation.write')} /></CenterLayout>} />
    <Route path="/ops/requests" element={<CenterLayout routeKey="ops.requests" center="ops" session={session}><WorkItemsPage center="ops" session={session} /></CenterLayout>} />
    <Route path="/ops/requests/:requestId" element={<CenterLayout routeKey="ops.request-detail" center="ops" session={session}><RequestDetailPage center="ops" /></CenterLayout>} />
    <Route path="/ops/jobs" element={<CenterLayout routeKey="ops.jobs" center="ops" session={session}><JobsPage /></CenterLayout>} />
    <Route path="/ops/jobs/:jobId" element={<CenterLayout routeKey="ops.job-detail" center="ops" session={session}><JobDetailPage /></CenterLayout>} />
    <Route path="/ops/capacity" element={<CenterLayout routeKey="ops.capacity" center="ops" session={session}><CapacityPage /></CenterLayout>} />
    <Route path="/ops/releases" element={<CenterLayout routeKey="ops.releases" center="ops" session={session}><ReleaseListPage session={session} /></CenterLayout>} />
    <Route path="/ops/releases/:releaseId" element={<CenterLayout routeKey="ops.release-detail" center="ops" session={session}><ReleaseDetailPage session={session} center="ops" /></CenterLayout>} />
    <Route path="/admin" element={<CenterLayout routeKey="admin.overview" center="admin" session={session}><CenterOverview key={`${session.identityEpoch}:admin`} center="admin" session={session} /></CenterLayout>} />
    <Route path="/admin/access" element={<CenterLayout routeKey="admin.access" center="admin" session={session}><AccessPage session={session} /></CenterLayout>} />
    <Route path="/admin/navigation" element={<CenterLayout routeKey="admin.navigation" center="admin" session={session}><NavigationPage /></CenterLayout>} />
    <Route path="/admin/catalog" element={<CenterLayout routeKey="admin.catalog" center="admin" session={session}><AdminCatalogPage /></CenterLayout>} />
    <Route path="/admin/cmdb-models" element={<CenterLayout routeKey="admin.cmdb-models" center="admin" session={session}><ModelsPage /></CenterLayout>} />
    <Route path="/admin/audit" element={<CenterLayout routeKey="admin.audit" center="admin" session={session}><AuditPage /></CenterLayout>} />
    <Route path="/rd/observability" element={<CenterLayout routeKey="rd.observability" center="rd" session={session}><ObservabilityPage session={session} /></CenterLayout>} />
    <Route path="/ops/incidents" element={<CenterLayout routeKey="ops.incidents" center="ops" session={session}><IncidentListPage session={session} /></CenterLayout>} />
    <Route path="/ops/incidents/:incidentId" element={<CenterLayout routeKey="ops.incident-detail" center="ops" session={session}><IncidentDetailPage session={session} /></CenterLayout>} />
    <Route path="/admin/integrations" element={<CenterLayout routeKey="admin.integrations" center="admin" session={session}><IntegrationsPage session={session} /></CenterLayout>} />
    <Route path="/rd/apps/:appId/resources" element={<CenterLayout routeKey="rd.resources" center="rd" session={session}><ServiceResourcesPage session={session} /></CenterLayout>} />
    <Route path="/rd/catalog/:itemId/resource-request" element={<CenterLayout routeKey="rd.resource-request" center="rd" session={session}><ChangeWizardPage /></CenterLayout>} />
    <Route path="/rd/changes/:changeId" element={<CenterLayout routeKey="rd.change-detail" center="rd" session={session}><ChangeDetailPage center="rd" session={session} /></CenterLayout>} />
    <Route path="/ops/changes/:changeId" element={<CenterLayout routeKey="ops.change-detail" center="ops" session={session}><ChangeDetailPage center="ops" session={session} /></CenterLayout>} />
    <Route path="/ops/caches" element={<CenterLayout routeKey="ops.caches" center="ops" session={session}><InventoryListPage kind="cache" /></CenterLayout>} />
    <Route path="/ops/caches/:ciId" element={<CenterLayout routeKey="ops.cache-detail" center="ops" session={session}><InventoryDetailPage kind="cache" session={session} /></CenterLayout>} />
    <Route path="/ops/messaging" element={<CenterLayout routeKey="ops.messaging" center="ops" session={session}><InventoryListPage kind="queue" /></CenterLayout>} />
    <Route path="/ops/messaging/:ciId" element={<CenterLayout routeKey="ops.messaging-detail" center="ops" session={session}><InventoryDetailPage kind="queue" session={session} /></CenterLayout>} />
    <Route path="/ops/clusters" element={<CenterLayout routeKey="ops.clusters" center="ops" session={session}><InventoryListPage kind="cluster" /></CenterLayout>} />
    <Route path="/ops/clusters/:ciId" element={<CenterLayout routeKey="ops.cluster-detail" center="ops" session={session}><InventoryDetailPage kind="cluster" session={session} /></CenterLayout>} />
    <Route path="/rd/apps/:appId/delivery" element={<CenterLayout routeKey="rd.delivery" center="rd" session={session}><DeliveryPage session={session} /></CenterLayout>} />
    <Route path="/rd/apps/:appId/configuration" element={<CenterLayout routeKey="rd.configuration" center="rd" session={session}><ConfigurationPage session={session} /></CenterLayout>} />
    <Route path="/rd/apps/:appId/traffic" element={<CenterLayout routeKey="rd.traffic" center="rd" session={session}><TrafficPage session={session} /></CenterLayout>} />
    <Route path="/ops/service-changes/:sourceType/:sourceId" element={<CenterLayout routeKey="ops.service-change" center="ops" session={session}><ServiceChangePage session={session} /></CenterLayout>} />
    <Route path="/guide" element={<Guide session={session} />} />
    <Route path="*" element={<UnknownRoute session={session} />} />
  </Routes></Suspense>
}
