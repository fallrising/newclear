import { Navigate, Route, Routes } from 'react-router-dom'
import type { SessionView } from '../../domain/schemas'
import { CenterOverview, Guide, UnknownRoute } from '../../features/foundation'
import { CenterLayout } from '../layouts/CenterLayout'

export function AppRoutes({ session }: { session: SessionView }) {
  return <Routes>
    <Route path="/" element={<Navigate to={`/${session.centers[0] ?? 'guide'}`} replace />} />
    <Route path="/rd" element={<CenterLayout routeKey="rd.overview" center="rd" session={session}><CenterOverview key={`${session.identityEpoch}:rd`} center="rd" session={session} /></CenterLayout>} />
    <Route path="/ops" element={<CenterLayout routeKey="ops.overview" center="ops" session={session}><CenterOverview key={`${session.identityEpoch}:ops`} center="ops" session={session} /></CenterLayout>} />
    <Route path="/admin" element={<CenterLayout routeKey="admin.overview" center="admin" session={session}><CenterOverview key={`${session.identityEpoch}:admin`} center="admin" session={session} /></CenterLayout>} />
    <Route path="/guide" element={<Guide session={session} />} />
    <Route path="*" element={<UnknownRoute session={session} />} />
  </Routes>
}
