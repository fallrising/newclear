import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/button'
import type { ResourceCapacity, ResourceObject, WorkItem } from '../../domain/schemas'

export const kindLabel = { cache: 'Redis 快取', queue: 'Kafka 訊息', cluster: 'Kubernetes 叢集' } as const
export const objectKindLabel = { cache_allocation: 'Redis allocation', kafka_topic: 'Kafka topic', kubernetes_namespace: 'Kubernetes namespace' } as const
export const changeKindLabel = { 'resource.bind': '資源綁定', 'resource.resize': 'Redis 配額調整', 'kafka.topic.create': 'Kafka topic 建立' } as const
export const changeStateLabel = { draft: '草稿', submitted: '待審核', approved: '已核准，待執行', rejected: '已拒絕', cancelled: '已撤回', executing: '執行中', succeeded: '已成功', failed: '執行失敗' } as const
export const actionLabel = { edit: '編輯草稿', submit: '提交審核', approve: '核准並保留配額', reject: '拒絕變更', cancel: '撤回變更', execute: '啟動資源執行', retry: '重新送審' } as const
export const purposeLabel = { runtime: '服務運行', producer: '訊息生產者', consumer: '訊息消費者' } as const
export const stageLabel = { dev: '開發', staging: '預備', prod: '正式' } as const
export const providerLabel = { aws: 'AWS', aliyun: 'Aliyun', onprem: 'On-prem IDC' } as const
export const dateLabel = (date: string | null | undefined) => date ? new Date(date).toLocaleString('zh-TW') : '未知，尚無觀測樣本'
export const resourcePath = (kind: string, id: string) => `/ops/${kind === 'cache' ? 'caches' : kind === 'queue' ? 'messaging' : kind === 'cluster' ? 'clusters' : 'cmdb'}/${encodeURIComponent(id)}`
export const isMissing = (error: unknown) => typeof error === 'object' && error !== null && (error as { status?: number }).status === 404

export function MissingResource({ back = '/rd/apps' }: { back?: string }) {
  return <section className="access-state" role="status"><p className="eyebrow">404 · 找不到資料</p><h1>找不到這個資源或工作單</h1><p>資料可能不存在，或不在目前身分的授權範圍。</p><Button asChild variant="outline"><Link to={back}><ArrowLeft size={16} aria-hidden="true" />返回清單</Link></Button></section>
}

export function ObjectSpec({ object }: { object: ResourceObject }) {
  if (object.kind === 'cache_allocation') return <span>{object.spec.quotaMiB} MiB 配額</span>
  if (object.kind === 'kafka_topic') return <span>{object.spec.partitions} partitions · 保留 {object.spec.retentionHours} 小時 · {object.spec.throughputKiBPerSecond} KiB/s 配額；lag 未知</span>
  return <span>{object.spec.workloads.length} 個可見 workload · {object.spec.nodes.length} 個可見 node；唯讀樣本</span>
}

export function QuotaView({ capacity }: { capacity: ResourceCapacity | null }) {
  if (!capacity) return <p className="muted">此資源沒有可讀的配額量測；未知不代表用量為零。</p>
  const label = { quotaMiB: 'Redis 配額 MiB', topics: 'Kafka topics', partitions: 'Kafka partitions', throughputKiBPerSecond: 'Kafka KiB/s' }
  return <div className="resource-quota"><p className="muted">配額與實體容量分開；保留量尚未生效。資料時間：{dateLabel(capacity.dataAsOf)}</p>
    {capacity.impactIncomplete && <p className="scope-notice" role="status">影響範圍未完整授權；不提供隱藏資源的用量或數量。</p>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label="資源配額，可水平捲動"><table><caption>目前可讀的資源配額</caption><thead><tr><th scope="col">單位</th><th scope="col">上限</th><th scope="col">已配置</th><th scope="col">已保留</th><th scope="col">可用</th><th scope="col">觀測用量</th></tr></thead><tbody>{capacity.dimensions.map(d => <tr key={d.name}><th scope="row">{label[d.name]}</th><td>{d.capacity}</td><td>{d.used ?? '未授權'}</td><td>{d.reserved ?? '未授權'}</td><td>{d.available ?? '未授權'}</td><td>{d.observed ?? '未知'}</td></tr>)}</tbody></table></div>
  </div>
}


export function WorkSummary({ summary }: { summary: WorkItem['summary'] }) {
  if ('revision' in summary) return <div className="work-summary"><strong>{{ 'pipelineDefinition.activate': '交付定義啟用', 'serviceConfig.apply': '服務配置套用', 'trafficPolicy.rollout': '業務流量灰度' }[summary.kind]} · 修訂 {summary.revision}</strong><p>風險：{summary.productionRisk ? '正式環境，需獨立批准' : '非正式環境'}</p>{summary.diff.map(item => <p key={item.key}><code>{item.key}</code>：{item.before ? String(item.before.value) : '尚未設定'} → {item.after ? String(item.after.value) : '移除'}（{item.change}）</p>)}{summary.weights.map(item => <p key={item.releaseId}><code>{item.releaseId}</code>：期望 {item.weight}%</p>)}</div>
  const labels = { ...changeKindLabel, 'environment.create': '建立環境', 'release.deploy': '業務部署', 'release.rollback': '業務回滾' }
  const units = { cpu: ['CPU', 'vCPU'], memoryMiB: ['記憶體', 'MiB'], quotaMiB: ['Redis 配額', 'MiB'], topics: ['Kafka topics', 'topics'], partitions: ['Kafka partitions', 'partitions'], throughputKiBPerSecond: ['Kafka throughput', 'KiB/s'] }
  return <div className="work-summary"><strong>{labels[summary.kind]}</strong><p>風險：{summary.riskClass === 'shared' ? '共享影響 · shared' : summary.riskClass === 'standard' ? '一般 · standard' : '不適用'}</p>
    {summary.dimensions.map(d => <p key={d.name}>{units[d.name][0]}：{d.current ?? '未知'} → {d.desired} {units[d.name][1]}（差額 {d.delta === null ? '未知' : `${d.delta > 0 ? '+' : ''}${d.delta} ${units[d.name][1]}`}）</p>)}
    {summary.basis === 'existing' && <p>綁定已有物件，不增加資源配額（差額 0）。</p>}
    {summary.basis === 'not-applicable' && <p>容量差額不適用；由發布健康驗證決定生效。</p>}
    {summary.basis === 'unavailable' && <p className="muted">目標版本已變或歷史基準不可用，差額未知；原始快照保留，操作時重驗版本。</p>}
  </div>
}
