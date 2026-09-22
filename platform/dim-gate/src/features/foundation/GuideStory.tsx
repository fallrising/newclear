import { useState } from 'react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
import { api, queryKey } from '../../api/client'
import { demoClockMutationKey } from '../../api/query-definitions'
import type { GuideView, SessionView } from '../../domain/schemas'
import { canPerformProjectAction } from '../../domain/policy'
import { Button } from '../../components/ui/button'
import { ErrorState, LoadingState } from '../../components/shared/states'

export function GuideStory({ data, session }: { data: GuideView; session: SessionView }) {
  const client = useQueryClient()
  const applications = useQuery({ queryKey: queryKey('applications', null, { pageSize: 100 }), queryFn: () => api.listApplications({ pageSize: 100 }) })
  const [selectedApp, setSelectedApp] = useState('')
  const [selectedEnv, setSelectedEnv] = useState('')
  const [notice, setNotice] = useState('')
  const applicationId = selectedApp || data.applicationId || applications.data?.items[0]?.id || ''
  const application = useQuery({ queryKey: queryKey('application', applicationId), queryFn: () => api.getApplication(applicationId), enabled: !!applicationId })
  const environments = application.data?.environments ?? []
  const environmentId = selectedEnv || (environments.some(env => env.id === data.environmentId) ? data.environmentId! : environments.find(env => env.activeReleaseId)?.id) || environments[0]?.id || ''
  const environment = environments.find(env => env.id === environmentId)
  const authorized = !!application.data && !!environment && canPerformProjectAction(session, 'observation.read', application.data.application.projectId, environment.stage)
  const clockPending = useIsMutating({ mutationKey: demoClockMutationKey }) > 0
  const scenario = useMutation({ mutationKey: demoClockMutationKey, mutationFn: async (scenarioKey: 'post-release-latency' | 'recovery-samples') => {
    const receipt = await api.setScenario(scenarioKey, { environmentId })
    await client.invalidateQueries()
    return receipt
  } })
  const inject = async (key: 'post-release-latency' | 'recovery-samples') => {
    setNotice('')
    try { await scenario.mutateAsync(key); setNotice(key === 'post-release-latency' ? '已注入三個一分鐘異常樣本；可前往觀測與事件詳情。' : '已注入三個一分鐘健康樣本；事件結果依觀測規則更新。') } catch { /* The API error is displayed; no automatic command retry. */ }
  }
  return <section className="panel guide-story">
    <div className="panel-title"><h2>發布與恢復故事</h2><span className="tag">依資料判定進度</span></div>
    <p className="muted">依下列角色完成同一條交付流程。完成標記來自已保存的狀態與稽核，切換身分不會直接完成步驟。</p>
    <div className="guide-preparation"><h3>演示準備與稽核</h3><p>先以 Admin 檢查目錄與 scope、儲存一個導航名稱，再以 Ops 篩選三種來源並查看共享依賴。這些檢查連結不代表已執行操作；下方進度只依保存的交付證據判定。</p><div className="guide-scenario-actions">
      {session.centers.includes('admin') && <><Button asChild variant="outline"><Link to="/admin/catalog">檢查服務目錄</Link></Button><Button asChild variant="outline"><Link to="/admin/access">檢查角色範圍</Link></Button><Button asChild variant="outline"><Link to="/admin/navigation">設定導航名稱</Link></Button><Button asChild variant="outline"><Link to="/admin/audit">查看完整管理稽核</Link></Button></>}
      {session.centers.includes('ops') && <><Button asChild variant="outline"><Link to="/ops/cmdb">檢查三種資源來源</Link></Button><Button asChild variant="outline"><Link to="/ops/topology">檢查共享依賴</Link></Button></>}
    </div><p className="muted">各筆申請、發布與事件詳情均保留目前授權可讀的稽核。完成故事後可使用本頁的「重置示範」回到基線。</p></div>
    <ol>{data.steps.map((step, index) => <li key={step.id} data-testid={`guide-step-${step.id}`} data-completed={step.completed}>
      <span className="step-number" aria-hidden="true">{step.completed ? <Check size={18} /> : String(index + 1).padStart(2, '0')}</span>
      <div><h3>{step.title}</h3><span className="tag">{step.persona === 'any' ? '任一授權角色' : step.persona.toUpperCase()}</span> <strong>{step.completed ? '已完成' : '待完成'}</strong><p>{step.description}</p>
        {step.route && <Button asChild size="sm" variant="outline"><Link to={step.route}>前往此步驟<ArrowRight size={14} aria-hidden="true" /></Link></Button>}
      </div>
    </li>)}</ol>
    <div className="guide-scenarios"><h2>觀測情境控制</h2><p>明示注入示範樣本，每次推進三分鐘模擬時間。這些數值不是實際監測結果；無需連接外部 APM。</p>
      {applications.isPending ? <LoadingState /> : applications.isError ? <ErrorState error={applications.error} onRetry={() => void applications.refetch()} /> : <label>情境應用<select aria-label="情境應用" value={applicationId} disabled={clockPending} onChange={event => { setSelectedApp(event.target.value); setSelectedEnv(''); setNotice('') }}>{applications.data.items.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}</select></label>}
      {application.isPending && applicationId ? <LoadingState /> : application.isError ? <ErrorState error={application.error} onRetry={() => void application.refetch()} /> : <label>情境環境<select aria-label="情境環境" value={environmentId} disabled={clockPending} onChange={event => { setSelectedEnv(event.target.value); setNotice('') }}><option value="">選擇環境</option>{environments.map(env => <option key={env.id} value={env.id}>{env.name} · {env.stage} · {env.status}</option>)}</select></label>}
      <div className="guide-scenario-actions"><Button disabled={clockPending || !authorized || !environment?.activeReleaseId || environment.status !== 'ready'} onClick={() => void inject('post-release-latency')}>注入發布後延遲</Button><Button variant="outline" disabled={clockPending || !authorized || !environment?.activeReleaseId} onClick={() => void inject('recovery-samples')}>注入恢復樣本</Button></div>
      <p className="muted">異常注入需要目前成功發布與閒置環境。恢復樣本僅供仍有活動事件的替代演示分支；一般回滾會在健康檢查成功後排程樣本，每 60 ticks 一筆，第三筆才解除事件。</p>
      {!authorized && <p>目前身分沒有此環境的 RD／Ops 觀測情境操作權限。</p>}
      {scenario.isError && <ErrorState error={scenario.error} title="情境未套用" />}
      <p role="status">{notice}</p>
    </div>
  </section>
}
