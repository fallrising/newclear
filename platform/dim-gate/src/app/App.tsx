import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BookOpen, Box, ChevronRight, Clock3, Code2, Database, FlaskConical, Menu, Moon, RefreshCw, RotateCcw, Server, Shield, Sun, X } from 'lucide-react'
import { api, getClientIdentity, queryKey } from '../api/client'
import type { Center, DashboardView, SessionView } from '../domain/schemas'
import { Button } from '../components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../components/ui/dialog'
import { ErrorState, LoadingState } from '../components/shared/states'

const centerDetails = {
  rd: { name: '研發中心', short: 'RD', icon: Code2, purpose: '從應用與環境，掌握你的交付範圍。', role: '研發人員', responsibility: '探索獲授權專案的應用、環境與關聯資源。環境申請與發布流程將在後續里程碑開放。' },
  ops: { name: '維運中心', short: 'OPS', icon: Server, purpose: '以一致的資源視圖，理解基礎設施。', role: '維運人員', responsibility: '查看獲授權資源池與專案的示範資產。資源納管、審批與故障處理將在後續里程碑開放。' },
  admin: { name: '平台管理', short: 'ADMIN', icon: Shield, purpose: '讓組織與權限，有清楚的管理邊界。', role: '平台管理員', responsibility: '查看企業層級的示範 metadata。平台管理權限不包含部署權限；角色與目錄編輯將在後續里程碑開放。' },
} satisfies Record<Center, { name: string; short: string; icon: typeof Code2; purpose: string; role: string; responsibility: string }>

function identityToken() {
  const identity = getClientIdentity()
  return identity ? `${identity.sessionId}:${identity.identityEpoch}:${identity.policyVersion}:${identity.generation}` : 'uninitialized'
}

export function createAppQueryClient() {
  return new QueryClient({ defaultOptions: { queries: {
    staleTime: 5_000,
    retry: (count, error) => {
      const status = (error as { status?: number }).status
      return count < 1 && status !== 401 && status !== 403 && status !== 404
    },
    refetchOnWindowFocus: false,
  }, mutations: { retry: false } } })
}

export function App() {
  const [client] = useState(createAppQueryClient)
  return <QueryClientProvider client={client}><BrowserRouter basename={import.meta.env.BASE_URL}><AppSession /></BrowserRouter></QueryClientProvider>
}

// Query invalidation is driven by committed API changes, never optimistic domain state.
export function AppSession() {
  const cache = useQueryClient()
  const [identity, setIdentity] = useState(identityToken)
  const lastIdentity = useRef(identity)
  useEffect(() => api.subscribe(() => {
    const next = identityToken()
    if (next !== lastIdentity.current) {
      lastIdentity.current = next
      void cache.cancelQueries()
      cache.clear()
      setIdentity(next)
    } else {
      void cache.invalidateQueries()
    }
  }), [cache])
  const session = useQuery({ queryKey: [...queryKey('session'), identity], queryFn: () => api.getSession() })
  if (session.isPending) return <div className="startup-page"><Brand /><p className="startup-demo-label"><FlaskConical size={16} aria-hidden="true" />示範資料 · 未連接真實雲端</p><LoadingState label="正在確認示範身分與可用工作區…" /></div>
  if (session.isError) return <div className="startup-page"><Brand /><p className="startup-demo-label"><FlaskConical size={16} aria-hidden="true" />示範資料 · 未連接真實雲端</p><ErrorState error={session.error} onRetry={() => void session.refetch()} /></div>
  return <AppShell session={session.data} />
}

function Brand() {
  return <div className="brand"><span className="brand-symbol"><Box size={24} strokeWidth={1.8} aria-hidden="true" /></span><span className="brand-name">dim-gate<span className="brand-caption">OPERATIONS WORKSPACE</span></span></div>
}

type Preferences = { theme: 'light' | 'dark'; density: 'normal' | 'compact' }
const preferenceKey = 'dim-gate.ui.v1'
function readPreferences(): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey) || '{}') as Partial<Preferences>
    return { theme: stored.theme === 'dark' ? 'dark' : 'light', density: stored.density === 'compact' ? 'compact' : 'normal' }
  } catch { return { theme: 'light', density: 'normal' } }
}

function AppShell({ session }: { session: SessionView }) {
  const [preferences, setPreferences] = useState(readPreferences)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [notice, setNotice] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const personas = useQuery({ queryKey: queryKey('personas'), queryFn: () => api.getPersonas() })
  const personaMutation = useMutation({ mutationFn: (id: string) => api.setPersona(id) })

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme
    document.documentElement.dataset.density = preferences.density
    try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)) } catch { /* Display preferences can remain local to this render. */ }
  }, [preferences])

  const currentCenter = session.centers.find((center) => location.pathname === `/${center}`)
  const currentLabel = location.pathname === '/guide' ? '示範導覽' : currentCenter ? centerDetails[currentCenter].name : '工作區'
  const switchPersona = async (id: string) => {
    if (id === session.user.id) return
    setSwitching(true)
    setNotice('')
    try {
      const next = await personaMutation.mutateAsync(id)
      const destination = location.pathname === '/guide' ? '/guide' : `/${next.centers[0] ?? 'guide'}`
      navigate(destination, { replace: true })
      setNotice('示範身分已切換；工作區與可見資料已依新授權重新讀取。')
    } catch { /* The mutation error is displayed beside the persona selector. */ }
    finally { setSwitching(false) }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主要內容</a>
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`} id="workspace-navigation" aria-label="工作區導覽">
        <Brand />
        <div className="sidebar-section-label">工作空間</div>
        <nav aria-label="中心導覽">
          {session.centers.map((center) => {
            const details = centerDetails[center]
            const Icon = details.icon
            return <NavLink key={center} to={`/${center}`} aria-label={details.name} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMobileMenu(false)}><Icon size={19} aria-hidden="true" /><span className="nav-label">{details.name}</span><span className="nav-code">{details.short}</span></NavLink>
          })}
          <NavLink to="/guide" aria-label="示範導覽" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMobileMenu(false)}><BookOpen size={19} aria-hidden="true" /><span className="nav-label">示範導覽</span></NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="foundation-label"><span className="status-dot" />M0 · 工程基礎</div>
          <p>目前可探索工作區與獨立示範 session。</p>
          <span className="sidebar-version">dim-gate / v0.1 開發中</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Button variant="ghost" size="icon" className="mobile-menu-button" aria-label={mobileMenu ? '收起導覽' : '開啟導覽'} aria-controls="workspace-navigation" aria-expanded={mobileMenu} onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X size={20} /> : <Menu size={20} />}</Button>
          <div className="breadcrumb"><span>工作台</span><ChevronRight size={14} aria-hidden="true" /><strong>{currentLabel}</strong></div>
          <div className="toolbar">
            <Button variant="ghost" size="icon" aria-label={preferences.theme === 'light' ? '切換深色主題' : '切換淺色主題'} onClick={() => setPreferences({ ...preferences, theme: preferences.theme === 'light' ? 'dark' : 'light' })}>{preferences.theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</Button>
            <label className="density-control"><span className="sr-only">顯示密度</span><select aria-label="顯示密度" value={preferences.density} onChange={(event) => setPreferences({ ...preferences, density: event.target.value as Preferences['density'] })}><option value="normal">舒適</option><option value="compact">緊湊</option></select></label>
            <div className="toolbar-divider" />
            <div className="persona-control"><span className="avatar" aria-hidden="true">{session.user.displayName.slice(0, 1)}</span><label><span className="persona-caption">示範身分</span><select aria-label="示範身分" disabled={switching || personas.isPending || personas.isError} value={session.user.id} onChange={(event) => void switchPersona(event.target.value)}>{personas.data ? personas.data.map((persona) => <option key={persona.id} value={persona.id}>{persona.displayName}</option>) : <option value={session.user.id}>{session.user.displayName}</option>}</select></label></div>
          </div>
        </header>
        <div className="demo-banner" role="note"><FlaskConical size={16} aria-hidden="true" /><span><strong>示範資料</strong><span className="demo-description"> · 所有資源與操作均為模擬，未連接真實雲端。</span></span><Link to="/guide">Session 控制<ArrowRight size={14} aria-hidden="true" /></Link></div>
        {session.storageMode === 'memory' && <div className="memory-banner" role="status">目前使用暫存記憶體模式；重新整理後，這次的變更會遺失。</div>}
        <main id="main-content" className="main-content" tabIndex={-1}>
          <div className="sr-only" role="status" aria-live="polite">{notice}</div>
          {personas.isError && <ErrorState error={personas.error} title="示範身分清單無法讀取" onRetry={() => void personas.refetch()} />}
          {personaMutation.isError && <ErrorState error={personaMutation.error} title="示範身分未切換" />}
          {switching ? <LoadingState label="正在切換身分，重新確認可見範圍…" /> : <Routes>
            <Route path="/" element={<Navigate to={`/${session.centers[0] ?? 'guide'}`} replace />} />
            {(['rd', 'ops', 'admin'] as const).map((center) => <Route key={center} path={`/${center}`} element={session.centers.includes(center) ? <CenterOverview key={`${session.identityEpoch}:${center}`} center={center} session={session} /> : <ForbiddenCenter center={center} />} />)}
            <Route path="/guide" element={<Guide session={session} />} />
            <Route path="*" element={<UnknownRoute session={session} />} />
          </Routes>}
        </main>
        <footer className="workspace-footer"><span>單企業 · 多團隊 · 共同資源視圖</span><span>每個分頁使用獨立示範 session</span></footer>
      </div>
    </div>
  )
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p></div>{action}</div>
}

function CenterOverview({ center, session }: { center: Center; session: SessionView }) {
  const dashboard = useQuery({ queryKey: queryKey('dashboard', center), queryFn: () => api.getDashboard(center) })
  const details = centerDetails[center]
  return <>
    <PageHeading eyebrow={`${details.short} WORKSPACE`} title={details.name} description={details.purpose} action={<Button asChild><Link to="/guide">探索示範<ArrowRight size={16} aria-hidden="true" /></Link></Button>} />
    <div className="scope-summary"><Shield size={15} aria-hidden="true" /><span>依目前身分授權範圍顯示</span><strong>{session.user.displayName}</strong></div>
    {dashboard.isPending ? <LoadingState /> : dashboard.isError ? <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} /> : <Dashboard data={dashboard.data} refresh={() => void dashboard.refetch()} refreshing={dashboard.isFetching} />}
    <div className="overview-secondary">
      <section className="panel role-panel"><div className="panel-title"><details.icon size={20} aria-hidden="true" /><h2>你的工作區</h2></div><p className="role-name">{details.role}</p><p>{details.responsibility}</p><div className="subtle-note">切換示範身分會重新評估既有授權，不會授予額外權限。</div></section>
      <section className="panel"><div className="panel-title"><Shield size={20} aria-hidden="true" /><h2>目前授權範圍</h2></div><ScopeAssignments session={session} /></section>
    </div>
    <FoundationNote />
  </>
}

function Dashboard({ data, refresh, refreshing }: { data: DashboardView; refresh: () => void; refreshing: boolean }) {
  const providers = { aws: { label: 'AWS', caption: 'Amazon Web Services' }, aliyun: { label: 'Aliyun', caption: '阿里雲' }, onprem: { label: 'On-premises', caption: '自建機房' } }
  return <section className="inventory-section" aria-label="可見資源摘要">
    <div className="section-heading"><h2>可見資源</h2><Button variant="ghost" size="sm" disabled={refreshing} onClick={refresh} aria-label="重新整理資源摘要"><RefreshCw size={14} className={refreshing ? 'spin' : ''} aria-hidden="true" />重新整理</Button></div>
    <dl className="stats-strip"><div><dt><Code2 size={16} aria-hidden="true" />應用</dt><dd>{data.applicationCount.toLocaleString()}<span>個</span></dd></div><div><dt><Box size={16} aria-hidden="true" />環境</dt><dd>{data.environmentCount.toLocaleString()}<span>個</span></dd></div><div><dt><Database size={16} aria-hidden="true" />配置項 CI</dt><dd>{data.ciCount.toLocaleString()}<span>筆</span></dd></div></dl>
    <div className="panel provider-panel"><div className="panel-title"><h3>資源來源</h3><span className="tag">最小示範資料集</span></div><table className="provider-table"><caption className="sr-only">目前授權範圍內的示範配置項，按來源統計</caption><thead><tr><th scope="col">Provider</th><th scope="col">可見配置項</th><th scope="col" className="distribution-heading">佔可見總數</th></tr></thead><tbody>{data.providers.map((entry) => <tr key={entry.provider}><th scope="row"><span className={`provider-monogram provider-${entry.provider}`} aria-hidden="true">{entry.provider === 'aws' ? 'A' : entry.provider === 'aliyun' ? '阿' : 'P'}</span><span>{providers[entry.provider].label}<small>{providers[entry.provider].caption}</small></span></th><td>{entry.count}<span className="muted"> 筆</span></td><td className="distribution-cell"><span className="distribution-track" aria-hidden="true"><span style={{ width: `${data.ciCount ? entry.count / data.ciCount * 100 : 0}%` }} /></span><span>{data.ciCount ? Math.round(entry.count / data.ciCount * 100) : 0}%</span></td></tr>)}</tbody></table><div className="data-caption">{data.ciCount === 0 ? '目前授權範圍沒有可見配置項。可切換示範身分探索其他工作區。' : '此摘要只包含目前身分可見的配置項，不代表真實基礎設施健康度。'}<span>資料時間：<time dateTime={data.dataAsOf}>{new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', hour12: false }).format(new Date(data.dataAsOf))} UTC</time></span></div></div>
  </section>
}

function ScopeAssignments({ session }: { session: SessionView }) {
  if (!session.assignments.length) return <p className="muted">目前沒有授權範圍。可使用頁首的示範身分選單。</p>
  return <ul className="scope-list">{session.assignments.map((assignment) => <li key={assignment.id}><span className="scope-kind">{assignment.scopeType === 'org' ? '企業' : assignment.scopeType === 'pool' ? '資源池' : '專案'}</span><div><code>{assignment.scopeId}</code>{assignment.stages && <span className="stage-list">{assignment.stages.join(' / ')}</span>}</div></li>)}</ul>
}

function FoundationNote() {
  return <aside className="foundation-note"><span className="foundation-marker">M0</span><div><h2>先看清楚共用基礎，再逐步開放業務流程</h2><p>本階段提供三中心、身分與 scope、資料保存和重置。完整 CMDB、自助申請、發布與觀測流程尚未開放。</p></div></aside>
}

function Guide({ session }: { session: SessionView }) {
  const guide = useQuery({ queryKey: queryKey('guide'), queryFn: () => api.getGuide() })
  const [ticks, setTicks] = useState(1)
  const [clockNotice, setClockNotice] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const advance = useMutation({ mutationFn: (count: number) => api.advanceClock(count) })
  const reset = useMutation({ mutationFn: () => api.reset() })
  const advanceClock = async () => {
    setClockNotice('')
    try { await advance.mutateAsync(ticks); setClockNotice(`演示時鐘已前進 ${ticks} 個 tick。`); await guide.refetch() } catch { /* Show command error, without resending the mutation. */ }
  }
  const resetSession = async () => {
    try { await reset.mutateAsync(); setResetOpen(false); setClockNotice('示範已重置。') } catch { /* Preserve confirmation and current session on failure. */ }
  }
  return <>
    <PageHeading eyebrow="DEMO GUIDE" title="示範導覽" description="用一個可重置的 session，探索三種角色的工作邊界。" />
    <div className="guide-layout">
      <section className="panel guide-steps"><div className="panel-title"><h2>從這裡開始</h2><span className="tag">M0 基礎探索</span></div><ol><li><span className="step-number">01</span><div><h3>選擇示範身分</h3><p>在頁首切換研發、維運或平台管理身分，查看對應工作區與授權範圍。</p></div></li><li><span className="step-number">02</span><div><h3>比較同一份資源視圖</h3><p>各中心從共同資料讀取摘要。切換身分保留 session 變更，只重新評估可見範圍。</p><Button asChild variant="outline" size="sm"><Link to={`/${session.centers[0] ?? 'guide'}`}>前往目前工作區<ArrowRight size={14} aria-hidden="true" /></Link></Button></div></li><li><span className="step-number">03</span><div><h3>測試保存與重置</h3><p>手動前進演示時鐘，重新整理觀察進度保存；需要重新開始時，確認重置此分頁的示範資料。</p></div></li></ol><div className="subtle-note">這是基礎操作導覽。完整發布與故障恢復故事將隨後續里程碑開放。</div></section>
      <section className="panel session-panel"><div className="panel-title"><Clock3 size={20} aria-hidden="true" /><h2>Session 控制</h2></div>{guide.isPending ? <LoadingState label="正在讀取演示進度…" /> : guide.isError ? <ErrorState error={guide.error} onRetry={() => void guide.refetch()} /> : <>
        <div className="clock-display"><span>演示時鐘</span><strong data-testid="logical-clock">{guide.data.logicalClock}<small>ticks</small></strong><p>只推進模擬時間，不影響真實環境。</p></div>
        <form className="clock-form" onSubmit={(event) => { event.preventDefault(); void advanceClock() }}><label htmlFor="clock-ticks">前進幅度</label><div><select id="clock-ticks" value={ticks} disabled={advance.isPending} onChange={(event) => setTicks(Number(event.target.value))}><option value={1}>1 tick</option><option value={5}>5 ticks</option><option value={10}>10 ticks</option><option value={60}>60 ticks</option></select><Button type="submit" disabled={advance.isPending || reset.isPending}><Clock3 size={16} aria-hidden="true" />{advance.isPending ? '正在前進…' : '前進演示時鐘'}</Button></div></form>
        <p role="status" className="command-notice">{clockNotice}</p>
        {advance.isError && <ErrorState error={advance.error} title="時鐘未更新" />}
        <dl className="session-facts"><div><dt>已提交指令</dt><dd>{guide.data.commandCount}</dd></div><div><dt>排程中工作</dt><dd>{guide.data.pendingTasks}</dd></div><div><dt>資料版本</dt><dd>{guide.data.storeRevision}</dd></div><div><dt>儲存方式</dt><dd>{session.storageMode === 'session' ? '此分頁 · 可刷新接續' : '暫存記憶體'}</dd></div><div><dt>Seed</dt><dd><code>{guide.data.seedVersion}</code></dd></div><div className="session-id-row"><dt>Session ID</dt><dd><code>{guide.data.sessionId}</code></dd></div></dl>
      </>}
      <div className="reset-section"><h3>重新開始</h3><p>清除此 session 的模擬變更、時鐘與排程，回到初始資料。</p><Dialog open={resetOpen} onOpenChange={(open) => { if (!reset.isPending) setResetOpen(open) }}><DialogTrigger asChild><Button variant="outline" disabled={advance.isPending}><RotateCcw size={16} aria-hidden="true" />重置示範</Button></DialogTrigger><DialogContent onEscapeKeyDown={(event) => { if (reset.isPending) event.preventDefault() }} onPointerDownOutside={(event) => { if (reset.isPending) event.preventDefault() }}><div className="dialog-warning-icon"><RotateCcw size={23} aria-hidden="true" /></div><DialogTitle>重置這個示範 session？</DialogTitle><DialogDescription>目前分頁的模擬變更、演示時鐘與排程會清除，並恢復初始資料。這個動作不會操作真實雲資源。</DialogDescription>{reset.isError && <ErrorState error={reset.error} title="重置未完成" />}<div className="dialog-actions"><DialogClose asChild><Button variant="outline" disabled={reset.isPending} autoFocus>保留目前進度</Button></DialogClose><Button variant="destructive" disabled={reset.isPending} onClick={() => void resetSession()}>{reset.isPending ? '正在重置…' : '確認重置示範'}</Button></div></DialogContent></Dialog></div>
      </section>
    </div>
  </>
}

function ForbiddenCenter({ center }: { center: Center }) {
  return <section className="access-state"><span className="access-icon"><Shield size={30} aria-hidden="true" /></span><p className="eyebrow">403 · 工作區權限</p><h1>目前身分無法進入{centerDetails[center].name}</h1><p>此工作區需要對應授權。請使用頁首的「示範身分」選單，選擇有權限的角色；現有資料與進度會保留。</p><Button asChild variant="outline"><Link to="/guide">查看示範導覽<ArrowRight size={16} aria-hidden="true" /></Link></Button></section>
}

function UnknownRoute({ session }: { session: SessionView }) {
  return <section className="access-state"><p className="eyebrow">404 · 找不到頁面</p><h1>此頁面尚未提供</h1><p>目前可使用中心摘要與示範導覽。後續模組會在功能可用時加入導覽。</p><Button asChild><Link to={`/${session.centers[0] ?? 'guide'}`}>回到目前工作區<ArrowRight size={16} aria-hidden="true" /></Link></Button></section>
}
