import { lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Shield } from 'lucide-react'
import type { Center, SessionView } from '../../domain/schemas'
import { Button } from '../../components/ui/button'
import { LoadingState } from '../../components/shared/states'
import { centerDetails } from './center-details'

const GuidePage = lazy(() => import('./GuidePage').then(module => ({ default: module.Guide })))
export { WorkspaceHome as CenterOverview } from './WorkspaceHome'
export function Guide({ session }: { session: SessionView }) {
  return <Suspense fallback={<LoadingState label="正在載入示範導覽…" />}><GuidePage session={session} /></Suspense>
}

export function ForbiddenCenter({ center }: { center: Center }) {
  return <section className="access-state"><span className="access-icon"><Shield size={30} aria-hidden="true" /></span><p className="eyebrow">403 · 工作區權限</p><h1>目前身分無法進入{centerDetails[center].name}</h1><p>此工作區需要對應授權。請使用頁首的「示範身分」選單，選擇有權限的角色；現有資料與進度會保留。</p><Button asChild variant="outline"><Link to="/guide">查看示範導覽<ArrowRight size={16} aria-hidden="true" /></Link></Button></section>
}

export function UnknownRoute({ session }: { session: SessionView }) {
  return <section className="access-state"><p className="eyebrow">404 · 找不到頁面</p><h1>此頁面尚未提供</h1><p>目前可使用中心摘要與示範導覽。後續模組會在功能可用時加入導覽。</p><Button asChild><Link to={`/${session.centers[0] ?? 'guide'}`}>回到目前工作區<ArrowRight size={16} aria-hidden="true" /></Link></Button></section>
}
