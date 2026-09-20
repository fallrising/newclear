import { Navigate, Route, Routes } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import type { SessionView } from '../../domain/schemas'
import { ApplicationDetailRoute, ApplicationListRoute, CiDetailPage, CmdbListPage, EnvironmentDetailRoute, TopologyRoute } from '../../features/cmdb'
import { CenterOverview, Guide, UnknownRoute } from '../../features/foundation'
import { CenterLayout } from '../layouts/CenterLayout'

export function AppRoutes({ session }: { session: SessionView }) {
  return <Routes>
    <Route path="/" element={<Navigate to={`/${session.centers[0] ?? 'guide'}`} replace />} />
    <Route path="/rd" element={<CenterLayout routeKey="rd.overview" center="rd" session={session}><CenterOverview key={`${session.identityEpoch}:rd`} center="rd" session={session} /></CenterLayout>} />
    <Route path="/rd/apps" element={<CenterLayout routeKey="rd.apps" center="rd" session={session}><ApplicationListRoute /></CenterLayout>} />
    <Route path="/rd/apps/:appId" element={<CenterLayout routeKey="rd.app-detail" center="rd" session={session}><ApplicationDetailRoute /></CenterLayout>} />
    <Route path="/rd/apps/:appId/environments/:environmentId" element={<CenterLayout routeKey="rd.environment-detail" center="rd" session={session}><EnvironmentDetailRoute /></CenterLayout>} />
    <Route path="/ops" element={<CenterLayout routeKey="ops.overview" center="ops" session={session}><CenterOverview key={`${session.identityEpoch}:ops`} center="ops" session={session} /></CenterLayout>} />
    <Route path="/ops/cmdb" element={<CenterLayout routeKey="ops.cmdb" center="ops" session={session}><CmdbListPage session={session} /></CenterLayout>} />
    <Route path="/ops/cmdb/:ciId" element={<CenterLayout routeKey="ops.ci-detail" center="ops" session={session}><CiDetailPage session={session} /></CenterLayout>} />
    <Route path="/ops/topology" element={<CenterLayout routeKey="ops.topology" center="ops" session={session}><TopologyRoute client={api} makeQueryKey={queryKey} canWriteRelations={session.effectiveActions.includes('relation.write')} /></CenterLayout>} />
    <Route path="/admin" element={<CenterLayout routeKey="admin.overview" center="admin" session={session}><CenterOverview key={`${session.identityEpoch}:admin`} center="admin" session={session} /></CenterLayout>} />
    <Route path="/guide" element={<Guide session={session} />} />
    <Route path="*" element={<UnknownRoute session={session} />} />
  </Routes>
}
