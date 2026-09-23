import { useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, queryKey } from '../../api/client'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../components/ui/dialog'
import type { Integration, SessionView } from '../../domain/schemas'
import { ObservationAudit, timestamp, useObservationRefresh } from './shared'

export function IntegrationsPage({ session }: { session: SessionView }) {
  const [selection] = useSearchParams()
  const integrationId = selection.get('integrationId')
  const integrations = useQuery({ queryKey: queryKey('integrations'), queryFn: api.listIntegrations })
  return <div className="observation-page"><div className="page-heading"><div><p className="eyebrow">INTEGRATIONS · DEMO</p><h1>平台整合</h1><p className="page-description">檢視整合 metadata、欄位映射與模擬測試結果。此示範不持有憑證，也不發送外部連線。</p></div></div>{integrations.isPending ? <LoadingState label="正在讀取可見整合…" /> : integrations.isError ? <ErrorState error={integrations.error} onRetry={() => void integrations.refetch()} /> : integrations.data.filter(item => !integrationId || item.id === integrationId).length === 0 ? <section className="panel empty-state" role="status"><h2>目前範圍沒有整合</h2><p>只顯示目前身分可讀取的整合摘要。</p></section> : <div className="integration-grid">{integrations.data.filter(item => !integrationId || item.id === integrationId).map(integration => <IntegrationCard key={`${session.sessionId}:${session.identityEpoch}:${session.policyVersion}:${integration.id}`} integration={integration} canTest={session.effectiveActions.includes('integration.test')} />)}</div>}</div>
}

function IntegrationCard({ integration, canTest }: { integration: Integration; canTest: boolean }) {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState(integration.version)
  const [notice, setNotice] = useState('')
  const refresh = useObservationRefresh()
  const command = useMutation({ mutationFn: async () => { const receipt = await api.testIntegration(integration.id, version); await refresh(); return receipt } })
  const execute = async () => { if (!canTest || command.isPending || command.isError) return; try { await command.mutateAsync(); setOpen(false); setNotice('模擬測試操作已完成；以下結果由 API 重新讀取。') } catch { /* Never infer a successful connection from an error or missing result. */ } }
  return <section className="panel"><h2>{integration.displayName}</h2><p className="observation-note"><code>{integration.id}</code> · {integration.kind}</p><dl className="detail-list"><div><dt>狀態</dt><dd>{integration.state}</dd></div><div><dt>模擬端點標籤</dt><dd>{integration.endpointLabel}</dd></div><div><dt>資源池 scope</dt><dd>{integration.poolIds.length ? integration.poolIds.join('、') : '企業整合 metadata'}</dd></div><div><dt>最後模擬同步</dt><dd>{timestamp(integration.lastSyncAt)}</dd></div></dl><h3>欄位映射</h3>{Object.keys(integration.fieldMappings).length === 0 ? <p className="observation-note">尚無欄位映射。</p> : <dl className="detail-list">{Object.entries(integration.fieldMappings).map(([source, target]) => <div key={source}><dt>{source}</dt><dd>{target}</dd></div>)}</dl>}<h3>最近模擬測試</h3>{integration.lastTestResult ? <div className="observation-note"><p>{integration.lastTestResult.succeeded ? 'Demo 測試通過' : 'Demo 測試失敗'} · {timestamp(integration.lastTestResult.occurredAt)}</p><p>{integration.lastTestResult.summary}</p></div> : <p className="observation-note">尚未執行模擬測試；未驗證任何外部連線。</p>}{notice && <p className="observation-note" role="status">{notice}</p>}
    <Dialog open={open} onOpenChange={next => { if (command.isPending) return; if (next) { setVersion(integration.version); command.reset() } setOpen(next) }}><DialogTrigger asChild><Button variant="outline" disabled={!canTest}>模擬測試 · {integration.displayName}</Button></DialogTrigger><DialogContent className="observation-dialog"><DialogTitle>模擬整合測試</DialogTitle><DialogDescription>以固定示範情境測試整合 metadata；不會建立真實網路連線。結果與稽核紀錄由共用 API 保存。</DialogDescription><p>{integration.displayName} · <code>{integration.id}</code></p><p className="observation-note">已檢閱版本 {version} · {integration.endpointLabel}</p>{command.isError && <><ErrorState error={command.error} title="模擬測試未完成" /><Button variant="outline" onClick={() => { setOpen(false); void refresh() }}>重新讀取整合</Button></>}<div className="dialog-actions"><Button variant="outline" disabled={command.isPending} onClick={() => setOpen(false)}>返回</Button><Button disabled={!canTest || command.isPending || command.isError} onClick={() => void execute()}>{command.isPending ? '測試與更新中…' : '確認模擬測試'}</Button></div></DialogContent></Dialog>{!canTest && <p className="observation-note">目前身分可讀取整合摘要；模擬測試需要平台 Admin 權限。</p>}<details><summary>整合稽核歷史</summary><ObservationAudit entityId={integration.id} /></details>
  </section>
}
