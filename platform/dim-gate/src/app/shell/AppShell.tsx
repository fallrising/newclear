import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, BookOpen, ChevronRight, FlaskConical, Menu, Moon, Sun, X } from 'lucide-react'
import { api, queryKey } from '../../api/client'
import { demoClockMutationKey, serviceDeliveryMutationKey } from '../../api/query-definitions'
import type { Center, SessionView } from '../../domain/schemas'
import { Brand } from '../../components/shared/brand'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import { centerDetails } from '../../features/foundation'
import { AppRoutes } from '../routes/AppRoutes'
import { Notifications } from './Notifications'
import { GlobalSearch } from './GlobalSearch'
import { routeForPath, visibleNavigation, workspaceGroup } from '../routes/registry'

const workspaceNames = { rd: 'RD 業務研發', ops: 'Ops 維運', admin: 'Admin 平台管理' }
type WorkspacePreference = { center: Center; returnPath: string }
function storedWorkspace(session: SessionView): WorkspacePreference | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(`dim-gate.workspace.${session.sessionId}.${session.user.id}`) || 'null') as WorkspacePreference | null
    if (value && session.centers.includes(value.center) && value.returnPath.startsWith(`/${value.center}`)) return value
  } catch { /* A missing UI preference must not affect the domain session. */ }
}

type Preferences = { theme: 'light' | 'dark'; density: 'normal' | 'compact' }
const preferenceKey = 'dim-gate.ui.v1'
function readPreferences(): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey) || '{}') as Partial<Preferences>
    return { theme: stored.theme === 'dark' ? 'dark' : 'light', density: stored.density === 'compact' ? 'compact' : 'normal' }
  } catch { return { theme: 'light', density: 'normal' } }
}

export function AppShell({ session }: { session: SessionView }) {
  const [preferences, setPreferences] = useState(readPreferences)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [switching, setSwitching] = useState<'identity' | 'workspace' | null>(null)
  const [notice, setNotice] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const personas = useQuery({ queryKey: queryKey('personas'), queryFn: () => api.getPersonas() })
  const currentRoute = routeForPath(location.pathname)
  const stored = storedWorkspace(session)
  const routeCenter = currentRoute?.center
  const diagnostic = !!currentRoute?.crossCenterRead && routeCenter !== (stored?.center ?? session.centers[0])
  const activeWorkspace = diagnostic && stored ? stored.center : routeCenter && session.centers.includes(routeCenter) ? routeCenter : stored?.center ?? session.centers[0]
  const crossWorkspace = diagnostic && routeCenter !== activeWorkspace
  const navigation = useQuery({ queryKey: queryKey('navigation', activeWorkspace),
    queryFn: () => api.getNavigation(activeWorkspace!), enabled: !!activeWorkspace })
  useEffect(() => {
    if (!activeWorkspace || crossWorkspace) return
    try { sessionStorage.setItem(`dim-gate.workspace.${session.sessionId}.${session.user.id}`, JSON.stringify({ center: activeWorkspace, returnPath: location.pathname.startsWith(`/${activeWorkspace}`) ? location.pathname + location.search : `/${activeWorkspace}` })) } catch { /* UI preference is optional. */ }
  }, [activeWorkspace, crossWorkspace, location.pathname, location.search, session.sessionId, session.user.id])
  const cache = useQueryClient()
  const serviceCommandPending = useIsMutating({ mutationKey: serviceDeliveryMutationKey }) > 0
  const clockPending = useIsMutating({ mutationKey: demoClockMutationKey }) > 0
  const personaMutation = useMutation({ mutationFn: (id: string) => api.setPersona(id) })

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme
    document.documentElement.dataset.density = preferences.density
    try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)) } catch { /* Display preferences can remain local to this render. */ }
  }, [preferences])

  const navigationByKey = new Map<string, NonNullable<typeof navigation.data>[number]>((navigation.data ?? []).map((item) => [item.routeKey, item]))
  const configuredRoutes = visibleNavigation(session).filter(route => !route.center || route.center === activeWorkspace)
    .filter(route => route.key === 'guide' || navigation.isPending || navigation.isError || navigationByKey.has(route.key)).map(route => {
      const item = navigationByKey.get(route.key)
      return { ...route, navigation: { ...route.navigation, ...(item ? { label: item.label, order: item.order } : {}), group: workspaceGroup(route, item && item.version > 1 ? item.group : undefined) } }
    }).sort((left, right) => left.navigation.order - right.navigation.order)
  const groups = [...new Set(configuredRoutes.map(route => route.navigation.group))]
  const switchWorkspace = async (center: Center) => {
    if (!session.centers.includes(center) || switching) return
    const filters = new URLSearchParams(location.search)
    const kept = new URLSearchParams()
    setSwitching('workspace')
    setNotice('')
    try {
      const projectId = filters.get('projectId'), environmentId = filters.get('environmentId')
      if (projectId || environmentId) {
        let { scope } = await api.getDashboard(center, projectId ? { projectId } : {})
        if (projectId && scope.projects.some(project => project.id === projectId)) kept.set('projectId', projectId)
        else if (projectId && environmentId) {
          // Invalid project context must not discard an independently authorized environment.
          scope = (await api.getDashboard(center)).scope
        }
        if (environmentId && scope.environments.some(environment => environment.id === environmentId)) kept.set('environmentId', environmentId)
      }
      if (center === 'rd' && ['all', 'mine'].includes(filters.get('workOwner') ?? '')) kept.set('workOwner', filters.get('workOwner')!)
      setNotice([...filters.keys()].some(key => !kept.has(key)) ? '已切換工作區；不適用的篩選已清除。' : '已切換工作區；身分與授權保持不變。')
      setMobileMenu(false)
      navigate(`/${center}${kept.size ? `?${kept}` : ''}`)
    } catch {
      setNotice('工作區未切換：暫時無法確認授權範圍。原篩選已保留，請重新選擇工作區再試一次。')
    } finally { setSwitching(null) }
  }
  const currentLabel = navigationByKey.get(currentRoute?.key ?? 'guide')?.label ?? currentRoute?.navigation.label ?? '工作區'
  const switchPersona = async (id: string) => {
    if (id === session.user.id || cache.isMutating({ mutationKey: serviceDeliveryMutationKey }) || cache.isMutating({ mutationKey: demoClockMutationKey })) return
    setSwitching('identity')
    setNotice('')
    try {
      const next = await personaMutation.mutateAsync(id)
      const destination = `/${next.centers[0] ?? 'guide'}`
      navigate(destination, { replace: true })
      setNotice('示範身分已切換；工作區與可見資料已依新授權重新讀取。')
    } catch { /* The mutation error is displayed beside the persona selector. */ }
    finally { setSwitching(null) }
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳到主要內容</a>
    <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`} id="workspace-navigation" aria-label="工作區導覽">
      <Brand />
      <nav aria-label="中心導覽">
        {groups.map(group => <div className="nav-group" key={group}><div className="sidebar-section-label">{group}</div>{configuredRoutes.filter(route => route.navigation.group === group).map(route => {
          const Icon = route.center ? centerDetails[route.center].icon : BookOpen
          return <NavLink key={route.key} to={route.path} end aria-label={route.navigation.label} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMobileMenu(false)}><Icon size={18} aria-hidden="true" /><span className="nav-label">{route.navigation.label}</span></NavLink>
        })}</div>)}
      </nav>
      <div className="sidebar-bottom"><div className="foundation-label"><span className="status-dot" />示範工作台</div><p>從發布追查觀測證據、事件與恢復樣本。</p><span className="sidebar-version">dim-gate / demo</span></div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <Button variant="ghost" size="icon" className="mobile-menu-button" aria-label={mobileMenu ? '收起導覽' : '開啟導覽'} aria-controls="workspace-navigation" aria-expanded={mobileMenu} onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X size={20} /> : <Menu size={20} />}</Button>
        <div className="workspace-selector"><label htmlFor="active-workspace">工作區</label><select id="active-workspace" aria-label="工作區" value={activeWorkspace ?? ''} disabled={!!switching || !activeWorkspace} onChange={event => void switchWorkspace(event.target.value as Center)}>{!activeWorkspace && <option value="">沒有已授權工作區</option>}{session.centers.map(center => <option value={center} key={center}>{workspaceNames[center]}</option>)}</select></div>
        <div className="breadcrumb"><span>工作台</span><ChevronRight size={14} aria-hidden="true" /><strong>{currentLabel}</strong></div>
        <GlobalSearch session={session} disabled={!!switching} />
        <div className="toolbar">
          <Notifications session={session} />
          <Button variant="ghost" size="icon" aria-label={preferences.theme === 'light' ? '切換深色主題' : '切換淺色主題'} onClick={() => setPreferences({ ...preferences, theme: preferences.theme === 'light' ? 'dark' : 'light' })}>{preferences.theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}</Button>
          <label className="density-control"><span className="sr-only">顯示密度</span><select aria-label="顯示密度" value={preferences.density} onChange={(event) => setPreferences({ ...preferences, density: event.target.value as Preferences['density'] })}><option value="normal">舒適</option><option value="compact">緊湊</option></select></label>
          <div className="toolbar-divider" />
          <div className="persona-control"><span className="avatar" aria-hidden="true">{session.user.displayName.slice(0, 1)}</span><label><span className="persona-caption">Demo · 體驗其他角色</span><select aria-label="示範身分" disabled={!!switching || serviceCommandPending || clockPending || personas.isPending || personas.isError} value={session.user.id} onChange={(event) => void switchPersona(event.target.value)}>{personas.data ? personas.data.map((persona) => <option key={persona.id} value={persona.id}>{persona.displayName}</option>) : <option value={session.user.id}>{session.user.displayName}</option>}</select></label></div>
        </div>
      </header>
      <div className="demo-banner" role="note"><FlaskConical size={16} aria-hidden="true" /><span><strong>示範資料</strong><span className="demo-description"> · 所有資源與操作均為模擬，未連接真實雲端。</span></span><Link to="/guide">Session 控制<ArrowRight size={14} aria-hidden="true" /></Link></div>
      {session.storageMode === 'memory' && <div className="memory-banner" role="status">目前使用暫存記憶體模式；重新整理後，這次的變更會遺失。</div>}
      <main id="main-content" className="main-content" tabIndex={-1}>
        {notice && <p className="workspace-notice" role="status" aria-live="polite">{notice}</p>}
        {crossWorkspace && <aside className="workspace-context"><Link to={stored?.returnPath ?? `/${activeWorkspace ?? 'guide'}`}>← 返回{activeWorkspace ? workspaceNames[activeWorkspace] : '示範導覽'}</Link><p>跨工作區診斷視圖 · 依既有讀取授權顯示；此連結不新增列表或操作權限。</p></aside>}
        {!activeWorkspace && <section className="panel"><h1>目前沒有已授權工作區</h1><p>組織成員身分不等於操作授權。可由頁首「Demo · 體驗其他角色」選擇示範身分。</p></section>}
        {personas.isError && <ErrorState error={personas.error} title="示範身分清單無法讀取" onRetry={() => void personas.refetch()} />}
        {personaMutation.isError && <ErrorState error={personaMutation.error} title="示範身分未切換" />}
        {switching ? <LoadingState label={switching === 'identity' ? '正在切換身分，重新確認可見範圍…' : '正在確認工作區範圍…'} /> : <AppRoutes session={session} />}
      </main>
      <footer className="workspace-footer"><span>單企業 · 多團隊 · 共同資源視圖</span><span>每個分頁使用獨立示範 session</span></footer>
    </div>
  </div>
}
