import { useState } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { api } from '../../api/client'
import { demoClockMutationKey } from '../../api/query-definitions'
import { Button } from '../../components/ui/button'
import { ErrorState } from '../../components/shared/states'
import type { SessionView } from '../../domain/schemas'
import { useServiceCommand } from './commands'
import { getServiceDetail, type ServiceDetail } from './model'
import { ServiceNotice } from './ui'

type Control = 'clock' | 'config-failure' | 'traffic-abnormal' | 'traffic-missing'
export function ServiceDemoControls({ detail, session, canInject }: { detail: ServiceDetail; session: SessionView; canInject: boolean }) {
  const [ticks, setTicks] = useState(1)
  const [notice, setNotice] = useState('')
  const [injected, setInjected] = useState<Control[]>([])
  const sharedPending = useIsMutating({ mutationKey: demoClockMutationKey }) > 0
  const servicePending = useIsMutating({ mutationKey: ['service-delivery-command'] }) > 0
  const execution = 'executions' in detail ? detail.executions.find(item => item.id === ('latestExecutionId' in detail.source ? detail.source.latestExecutionId : undefined) && ['queued', 'running'].includes(item.state)) : undefined
  const command = useServiceCommand(async receipt => {
    await getServiceDetail(detail.source.sourceType, detail.source.id)
    await api.listAudit({ correlationId: receipt.correlationId, pageSize: 100 })
  }, demoClockMutationKey)
  const execute = async (kind: Control) => {
    if (!command.committed) command.reset()
    try {
      await command.mutateAsync(() => kind === 'clock' ? api.advanceClock(ticks) : api.setScenario(kind, { executionId: execution?.id }))
      setNotice(kind === 'clock' ? `示範時鐘已前進 ${ticks} 秒，已讀回執行與稽核結果。` : '已設定本次執行的示範情境；推進時鐘後查看實際結果。')
      if (kind !== 'clock') setInjected(current => [...current, kind])
      command.reset()
    } catch { /* Preserve the receipt for read-only retry after a successful command. */ }
  }
  const busy = sharedPending || servicePending
  return <section className="panel" aria-label="服務交付模擬控制"><h2>示範時鐘與情境</h2><p>目前 tick {session.logicalClock}。每 tick 為一秒；配置需三步，流量每 30 秒產生樣本。手動推進此 session 所有排程工作，重新整理不會自行補跑。</p><div className="service-actions"><label>前進秒數<select disabled={busy || command.committed} value={ticks} onChange={event => setTicks(Number(event.target.value))}><option value={1}>1 秒</option><option value={3}>3 秒 · 配置步驟</option><option value={30}>30 秒 · 流量樣本</option><option value={60}>60 秒 · 最短健康窗口</option></select></label><Button variant="outline" disabled={busy} onClick={() => void execute('clock')}>{command.committed ? '重新讀取模擬結果' : '推進示範時鐘'}</Button></div>
    {canInject && execution && <div className="service-actions">{(execution.kind === 'config' ? ['config-failure'] as const : ['traffic-abnormal', 'traffic-missing'] as const).map(kind => <Button key={kind} variant="outline" disabled={busy || command.committed || injected.includes(kind)} onClick={() => void execute(kind)}>{{ 'config-failure': '模擬配置套用失敗', 'traffic-abnormal': '模擬流量健康異常', 'traffic-missing': '模擬流量樣本缺漏' }[kind]}</Button>)}</div>}
    {notice && <p role="status">{notice}</p>}{command.committed && command.error && <ServiceNotice>示範操作已受理。重新讀取結果不會再次推進時鐘或設定情境。</ServiceNotice>}{command.error && <ErrorState error={command.error} title="示範操作尚未完成" />}
  </section>
}
