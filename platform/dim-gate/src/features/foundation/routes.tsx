import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Clock3, RotateCcw, Shield } from 'lucide-react'
import { api, queryKey } from '../../api/client'
import { demoClockMutationKey } from '../../api/query-definitions'
import type { Center, SessionView } from '../../domain/schemas'
import { Button } from '../../components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../components/ui/dialog'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { centerDetails } from './center-details'

const GuideStory = lazy(() => import('./GuideStory').then(module => ({ default: module.GuideStory })))

export { WorkspaceHome as CenterOverview } from './WorkspaceHome'

export function Guide({ session }: { session: SessionView }) {
  const cache = useQueryClient()
  const guide = useQuery({ queryKey: queryKey('guide'), queryFn: () => api.getGuide() })
  const [ticks, setTicks] = useState(1)
  const [clockNotice, setClockNotice] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const clockPending = useIsMutating({ mutationKey: demoClockMutationKey }) > 0
  const advance = useMutation({ mutationKey: demoClockMutationKey, mutationFn: async (count: number) => {
    const receipt = await api.advanceClock(count)
    await cache.invalidateQueries()
    return receipt
  } })
  const reset = useMutation({ mutationFn: () => api.reset() })
  const advanceClock = async () => {
    setClockNotice('')
    try { await advance.mutateAsync(ticks); setClockNotice(`演示時鐘已前進 ${ticks} 個 tick。`) } catch { /* Show command error, without resending the mutation. */ }
  }
  const resetSession = async () => {
    try { await reset.mutateAsync(); setResetOpen(false); setClockNotice('示範已重置。') } catch { /* Preserve confirmation and current session on failure. */ }
  }
  return <>
    <PageHeading eyebrow="DEMO GUIDE" title="示範導覽" description="用一個可重置的 session，探索三種角色的工作邊界。" />
    <div className="guide-layout">
      {guide.isPending ? <LoadingState label="正在讀取故事進度…" /> : guide.isError ? <ErrorState error={guide.error} onRetry={() => void guide.refetch()} /> : <Suspense fallback={<LoadingState label="正在讀取故事進度…" />}><GuideStory key={`${session.sessionId}:${session.identityEpoch}:${session.policyVersion}`} data={guide.data} session={session} /></Suspense>}
      <section className="panel session-panel"><div className="panel-title"><Clock3 size={20} aria-hidden="true" /><h2>Session 控制</h2></div>{guide.isPending ? <LoadingState label="正在讀取演示進度…" /> : guide.isError ? <ErrorState error={guide.error} onRetry={() => void guide.refetch()} /> : <>
        <div className="clock-display"><span>演示時鐘</span><strong data-testid="logical-clock">{guide.data.logicalClock}<small>ticks</small></strong><p>只推進模擬時間，不影響真實環境。</p></div>
        <form className="clock-form" onSubmit={(event) => { event.preventDefault(); void advanceClock() }}><label htmlFor="clock-ticks">前進幅度</label><div><select id="clock-ticks" value={ticks} disabled={clockPending} onChange={(event) => setTicks(Number(event.target.value))}><option value={1}>1 tick</option><option value={5}>5 ticks</option><option value={10}>10 ticks</option><option value={60}>60 ticks</option></select><Button type="submit" disabled={clockPending || reset.isPending}><Clock3 size={16} aria-hidden="true" />{clockPending ? '正在前進…' : '前進演示時鐘'}</Button></div></form>
        <p role="status" className="command-notice">{clockNotice}</p>
        {advance.isError && <ErrorState error={advance.error} title="時鐘未更新" />}
        <dl className="session-facts"><div><dt>已提交指令</dt><dd>{guide.data.commandCount}</dd></div><div><dt>排程中工作</dt><dd>{guide.data.pendingTasks}</dd></div><div><dt>資料版本</dt><dd>{guide.data.storeRevision}</dd></div><div><dt>儲存方式</dt><dd>{session.storageMode === 'session' ? '此分頁 · 可刷新接續' : '暫存記憶體'}</dd></div><div><dt>Seed</dt><dd><code>{guide.data.seedVersion}</code></dd></div><div className="session-id-row"><dt>Session ID</dt><dd><code>{guide.data.sessionId}</code></dd></div></dl>
      </>}
      <div className="reset-section"><h3>重新開始</h3><p>清除此 session 的模擬變更、時鐘與排程，回到初始資料。</p><Dialog open={resetOpen} onOpenChange={(open) => { if (!reset.isPending) setResetOpen(open) }}><DialogTrigger asChild><Button variant="outline" disabled={clockPending}><RotateCcw size={16} aria-hidden="true" />重置示範</Button></DialogTrigger><DialogContent onEscapeKeyDown={(event) => { if (reset.isPending) event.preventDefault() }} onPointerDownOutside={(event) => { if (reset.isPending) event.preventDefault() }}><div className="dialog-warning-icon"><RotateCcw size={23} aria-hidden="true" /></div><DialogTitle>重置這個示範 session？</DialogTitle><DialogDescription>目前分頁的模擬變更、演示時鐘與排程會清除，並恢復初始資料。這個動作不會操作真實雲資源。</DialogDescription>{reset.isError && <ErrorState error={reset.error} title="重置未完成" />}<div className="dialog-actions"><DialogClose asChild><Button variant="outline" disabled={reset.isPending} autoFocus>保留目前進度</Button></DialogClose><Button variant="destructive" disabled={reset.isPending} onClick={() => void resetSession()}>{reset.isPending ? '正在重置…' : '確認重置示範'}</Button></div></DialogContent></Dialog></div>
      </section>
    </div>
  </>
}

export function ForbiddenCenter({ center }: { center: Center }) {
  return <section className="access-state"><span className="access-icon"><Shield size={30} aria-hidden="true" /></span><p className="eyebrow">403 · 工作區權限</p><h1>目前身分無法進入{centerDetails[center].name}</h1><p>此工作區需要對應授權。請使用頁首的「示範身分」選單，選擇有權限的角色；現有資料與進度會保留。</p><Button asChild variant="outline"><Link to="/guide">查看示範導覽<ArrowRight size={16} aria-hidden="true" /></Link></Button></section>
}

export function UnknownRoute({ session }: { session: SessionView }) {
  return <section className="access-state"><p className="eyebrow">404 · 找不到頁面</p><h1>此頁面尚未提供</h1><p>目前可使用中心摘要與示範導覽。後續模組會在功能可用時加入導覽。</p><Button asChild><Link to={`/${session.centers[0] ?? 'guide'}`}>回到目前工作區<ArrowRight size={16} aria-hidden="true" /></Link></Button></section>
}
