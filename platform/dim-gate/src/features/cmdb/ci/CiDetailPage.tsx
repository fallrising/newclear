import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Database, RefreshCw } from 'lucide-react'
import { api, queryKey } from '../../../api/client'
import type { CIView, SessionView } from '../../../domain/schemas'
import { PageHeading } from '../../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../../components/shared/states'
import { Button } from '../../../components/ui/button'
import { CiMetadataDialog } from './CiMetadataDialog'
import { displayValue, freshnessOf, freshnessText, healthLabels, kindLabels, providerLabels } from './ci-view'

const attributeLabels: Record<string, string> = {
  instanceType: 'Instance type', vpcId: 'VPC ID', subnetId: 'Subnet ID', vSwitchId: 'vSwitch ID',
  privateIp: 'Private IP', imageId: 'Image ID', cpu: 'CPU', memoryMiB: 'Memory (MiB)',
  assetTag: 'Asset tag', serialRef: 'Serial reference', hypervisor: 'Hypervisor', hostCiId: 'Host CI',
  managementIp: 'Management IP', orchestrator: 'Orchestrator', versionLabel: 'Version', engine: 'Engine',
  endpointLabel: 'Endpoint', cidr: 'CIDR', scheme: 'Scheme', storageClass: 'Storage class', capacityGiB: 'Capacity (GiB)',
  native: 'Provider native extras',
}

function IdentityDetails({ ci }: { ci: CIView }) {
  return <dl className="detail-list">
    <div><dt>CI ID</dt><dd><code>{ci.id}</code></dd></div>
    <div><dt>Provider</dt><dd>{providerLabels[ci.provider]}</dd></div>
    <div><dt>Kind</dt><dd>{kindLabels[ci.kind]}</dd></div>
    <div><dt>External ID</dt><dd><code>{ci.externalId}</code></dd></div>
    <div><dt>Account</dt><dd>{ci.accountId ? <code>{ci.accountId}</code> : '不適用（on-prem）'}</dd></div>
    <div><dt>Location</dt><dd><code>{ci.locationId}</code></dd></div>
    <div><dt>Pool</dt><dd><code>{ci.poolId}</code></dd></div>
    <div><dt>Owner team</dt><dd><code>{ci.ownerTeamId}</code></dd></div>
    <div><dt>Lifecycle</dt><dd>{ci.lifecycle}</dd></div>
    <div><dt>Version</dt><dd>{ci.version}</dd></div>
  </dl>
}

export function CiDetailPage({ session, ciId: explicitId }: { session: SessionView; ciId?: string }) {
  const params = useParams<{ ciId: string }>()
  const ciId = explicitId ?? params.ciId
  const detail = useQuery({
    queryKey: queryKey('ci', ciId ?? null, null),
    queryFn: () => api.getCi(ciId!),
    enabled: Boolean(ciId),
  })
  if (!ciId) return <ErrorState error={{ code: 'NOT_FOUND', message: '未提供配置項 ID。' }} title="找不到配置項" />
  if (detail.isPending) return <LoadingState label="正在讀取配置項詳情…" />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} title="找不到或無法讀取配置項" />
  const ci = detail.data
  const freshness = freshnessOf(ci, session.logicalClock)
  const canUpdate = session.effectiveActions.includes('ci.update')
  return <article className="ci-detail" aria-label="配置項詳情">
    <Link className="back-link" to="/ops/cmdb"><ArrowLeft size={15} aria-hidden="true" />返回 CMDB</Link>
    <PageHeading eyebrow={`${providerLabels[ci.provider]} · ${ci.id}`} title={ci.name} description="Ops 與 RD deep link 指向同一 canonical CI ID；scope 外詳情以 404 呈現。" action={canUpdate ? <CiMetadataDialog ci={ci} onReload={() => detail.refetch()} /> : undefined} />
    <div className="detail-status-grid">
      <section className="panel"><h2>目前狀態</h2><dl className="detail-list"><div><dt>健康度</dt><dd><span className={`status status-${ci.health}`}>{healthLabels[ci.health]}</span></dd></div><div><dt>資料新鮮度</dt><dd><span className={`status freshness-${freshness}`}>{freshnessText(ci, session.logicalClock)}</span>{freshness === 'stale' && <Button variant="ghost" onClick={() => void detail.refetch()}><RefreshCw size={14} aria-hidden="true" />重新整理</Button>}</dd></div><div><dt>來源</dt><dd>{ci.source === 'manual' ? '手動納管' : ci.source === 'discovered' ? '探索匯入' : '交付建立'}</dd></div></dl></section>
      <section className="panel"><h2>Canonical identity</h2><IdentityDetails ci={ci} /></section>
    </div>
    <section className="panel" aria-labelledby="provider-attributes"><h2 id="provider-attributes"><Database size={17} aria-hidden="true" />Provider attributes</h2><dl className="attribute-grid">{Object.entries(ci.attributes).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => <div key={key}><dt>{attributeLabels[key] ?? key}</dt><dd>{displayValue(value)}</dd></div>)}</dl><p className="data-caption">數值 0 是已知量測，明確顯示為 0；只有 null 或未提供欄位才標示未知。</p></section>
    <section className="panel"><h2>Metadata</h2><dl className="detail-list"><div><dt>可見專案</dt><dd>{ci.visibilityProjectIds.length ? ci.visibilityProjectIds.map((id) => <code key={id}>{id}</code>) : '目前 pool scope 可讀；沒有 project projection'}</dd></div><div><dt>Tags</dt><dd>{Object.keys(ci.tags).length ? Object.entries(ci.tags).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => <span className="tag" key={key}>{key}={value}</span>) : '空白（無標籤）'}</dd></div><div><dt>Custom fields</dt><dd>{Object.keys(ci.customFields).length ? Object.entries(ci.customFields).map(([key, value]) => <span className="tag" key={key}>{key}={displayValue(value)}</span>) : '空白（無自訂欄位）'}</dd></div></dl></section>
  </article>
}
