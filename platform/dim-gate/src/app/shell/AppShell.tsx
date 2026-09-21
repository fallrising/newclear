import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { ArrowRight, BookOpen, ChevronRight, FlaskConical, Menu, Moon, Sun, X } from 'lucide-react'
import { api, queryKey } from '../../api/client'
import type { NavigationItem, SessionView } from '../../domain/schemas'
import { Brand } from '../../components/shared/brand'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import { centerDetails } from '../../features/foundation'
import { AppRoutes } from '../routes/AppRoutes'
import { GlobalSearch } from './GlobalSearch'
import { routeForPath, visibleNavigation } from '../routes/registry'

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
  const [switching, setSwitching] = useState(false)
  const [notice, setNotice] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const personas = useQuery({ queryKey: queryKey('personas'), queryFn: () => api.getPersonas() })
  const navigationQueries = useQueries({ queries: session.centers.map((center) => ({
    queryKey: queryKey('navigation', center), queryFn: () => api.getNavigation(center),
  })) })
  const personaMutation = useMutation({ mutationFn: (id: string) => api.setPersona(id) })

  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme
    document.documentElement.dataset.density = preferences.density
    try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)) } catch { /* Display preferences can remain local to this render. */ }
  }, [preferences])

  const currentRoute = routeForPath(location.pathname)
  const navigationByKey = new Map<string, NavigationItem>(navigationQueries.flatMap((query) => query.data ?? []).map((item) => [item.routeKey, item]))
  const navigationPending = navigationQueries.some((query) => query.isPending)
  const navigationError = navigationQueries.some((query) => query.isError)
  const configuredRoutes = visibleNavigation(session).filter((route) => navigationPending || navigationError || navigationByKey.has(route.key)).map((route) => {
    const item = navigationByKey.get(route.key)
    return item ? { ...route, navigation: { ...route.navigation, label: item.label, group: item.group, order: item.order } } : route
  }).sort((left, right) => left.navigation.order - right.navigation.order)
  const currentLabel = navigationByKey.get(currentRoute?.key ?? 'guide')?.label ?? currentRoute?.navigation.label ?? '工作區'
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

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳到主要內容</a>
    <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`} id="workspace-navigation" aria-label="工作區導覽">
      <Brand />
      <div className="sidebar-section-label">工作空間</div>
      <nav aria-label="中心導覽">
        {configuredRoutes.map((route) => {
          if (!route.center) return <NavLink key={route.key} to={route.path} end aria-label={route.navigation.label} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMobileMenu(false)}><BookOpen size={19} aria-hidden="true" /><span className="nav-label">{route.navigation.label}</span></NavLink>
          const details = centerDetails[route.center]
          const Icon = details.icon
          return <NavLink key={route.key} to={route.path} end aria-label={route.navigation.label} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMobileMenu(false)}><Icon size={19} aria-hidden="true" /><span className="nav-label">{route.navigation.label}</span><span className="nav-code">{details.short}</span></NavLink>
        })}
      </nav>
      <div className="sidebar-bottom"><div className="foundation-label"><span className="status-dot" />M2 · 自助申請與治理</div><p>共用資產、申請、容量與交付作業。</p><span className="sidebar-version">dim-gate / M2 development</span></div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <Button variant="ghost" size="icon" className="mobile-menu-button" aria-label={mobileMenu ? '收起導覽' : '開啟導覽'} aria-controls="workspace-navigation" aria-expanded={mobileMenu} onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X size={20} /> : <Menu size={20} />}</Button>
        <div className="breadcrumb"><span>工作台</span><ChevronRight size={14} aria-hidden="true" /><strong>{currentLabel}</strong></div>
        <GlobalSearch session={session} disabled={switching} />
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
        {switching ? <LoadingState label="正在切換身分，重新確認可見範圍…" /> : <AppRoutes session={session} />}
      </main>
      <footer className="workspace-footer"><span>單企業 · 多團隊 · 共同資源視圖</span><span>每個分頁使用獨立示範 session</span></footer>
    </div>
  </div>
}
