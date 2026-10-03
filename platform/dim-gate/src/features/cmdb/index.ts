import { lazy } from 'react'

// Keep the public feature boundary while loading route-sized views on demand.
// The overview can consume InventorySummary without fetching every CMDB page.
export { InventorySummary } from './InventorySummary'
export const ApplicationDetailRoute = lazy(() => import('./application').then(module => ({ default: module.ApplicationDetailRoute })))
export const ApplicationListRoute = lazy(() => import('./application').then(module => ({ default: module.ApplicationListRoute })))
export const EnvironmentDetailRoute = lazy(() => import('./application').then(module => ({ default: module.EnvironmentDetailRoute })))
export const CiDetailPage = lazy(() => import('./ci').then(module => ({ default: module.CiDetailPage })))
export const CiMetadataDialog = lazy(() => import('./ci').then(module => ({ default: module.CiMetadataDialog })))
export const CiOnboardingDialog = lazy(() => import('./ci').then(module => ({ default: module.CiOnboardingDialog })))
export const CmdbListPage = lazy(() => import('./ci').then(module => ({ default: module.CmdbListPage })))
export const TopologyRoute = lazy(() => import('./topology').then(module => ({ default: module.TopologyRoute })))
