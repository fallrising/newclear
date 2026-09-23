import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, queryKey } from '../../api/client'
import { ErrorState, LoadingState } from '../../components/shared/states'
import type { DeliveryOptions, ServiceConfig } from '../../domain/schemas'
import { ServiceTable } from './ui'
import { timeLabel } from './model'

function value(source: ServiceConfig | undefined, key: string) {
  if (!source) return '尚無生效配置'
  const entry = (source.specSnapshot ?? source.spec).entries.find(item => item.key === key)
  return entry ? `${entry.valueType} · ${String(entry.value)}` : '此版本未設定'
}
export function ConfigurationComparison({ options, active }: { options: DeliveryOptions; active: ServiceConfig | null }) {
  const [targetId, setTargetId] = useState('')
  const target = options.environments.find(environment => environment.id === targetId && environment.id !== options.environment.id)
  const filters = { applicationId: options.application.id, environmentId: target?.id, state: 'active' as const, pageSize: 1 }
  const comparison = useQuery({ queryKey: queryKey('service-configs', options.application.id, filters), queryFn: () => api.listServiceConfigs(filters), enabled: Boolean(target) })
  const current = comparison.data?.items[0]
  const keys = [...new Set([...(active?.specSnapshot ?? active?.spec)?.entries.map(entry => entry.key) ?? [], ...(current?.specSnapshot ?? current?.spec)?.entries.map(entry => entry.key) ?? []])].sort()
  return <section className="panel"><h2>比較授權環境的生效配置</h2><label>對照環境<select value={target?.id ?? ''} onChange={event => setTargetId(event.target.value)}><option value="">選擇同服務的其他授權環境</option>{options.environments.filter(environment => environment.id !== options.environment.id).map(environment => <option key={environment.id} value={environment.id}>{environment.name} · {environment.stage}</option>)}</select></label>
    {!target ? <p>只列出目前可讀的環境；未授權或無法讀取的配置不會當作空配置。</p> : comparison.isPending ? <LoadingState label="正在讀取對照環境的生效配置…" /> : comparison.isError ? <ErrorState error={comparison.error} title="對照配置無法讀取" onRetry={() => void comparison.refetch()} /> : <><p>{options.environment.name}：{active ? `revision ${active.revision}` : '尚無生效配置'}；{target.name}：{current ? `revision ${current.revision}` : '尚無生效配置'}</p><p className="muted">目前頁面資料時間：{timeLabel(options.dataAsOf)}；對照版本更新：{timeLabel(current?.updatedAt)}</p>{keys.length === 0 ? <p>兩個可讀環境均沒有可比較的設定項目。</p> : <ServiceTable label="跨環境配置比較"><table><caption>已授權生效版本的設定比較</caption><thead><tr><th scope="col">設定</th><th scope="col">{options.environment.name}</th><th scope="col">{target.name}</th></tr></thead><tbody>{keys.map(key => <tr key={key}><th scope="row"><code>{key}</code></th><td><code>{value(active ?? undefined, key)}</code></td><td><code>{value(current, key)}</code></td></tr>)}</tbody></table></ServiceTable>}</>}
  </section>
}
