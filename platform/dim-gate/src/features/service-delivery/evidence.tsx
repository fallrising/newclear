import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, queryKey } from '../../api/client'
import { ErrorState, LoadingState } from '../../components/shared/states'
import type { DeliveryOptions, ServiceConfig, ServiceConfigDetail, ServiceExecution, ServiceSource, TrafficDistribution } from '../../domain/schemas'
import { sectionTitle, sourcePath, stateLabel, timeLabel, type ServiceDetail } from './model'
import { ServiceNotice, ServiceTable } from './ui'

type Entry = ServiceConfig['spec']['entries'][number]
function entryValue(entry: Entry | null) { return entry === null ? '不存在' : `${entry.valueType === 'secretRef' ? 'reference：' : ''}${String(entry.value)}` }

export function SourceMetadata({ detail }: { detail: ServiceDetail }) {
  const source = detail.source
  return <section className="panel"><div className="panel-title"><h2>{sectionTitle[source.sourceType]} · revision {source.revision}</h2><span className={`service-state service-state-${source.state}`}>{stateLabel[source.state]}</span></div>
    <dl className="detail-list"><div><dt>來源 ID</dt><dd><code>{source.id}</code></dd></div><div><dt>申請者</dt><dd><code>{source.requesterId}</code></dd></div><div><dt>變更理由</dt><dd>{source.reason}</dd></div><div><dt>版本檢查</dt><dd>目前 v{source.version}{'targetEnvironmentVersion' in source && ` · 環境 v${source.targetEnvironmentVersion}`}</dd></div><div><dt>原生效版本</dt><dd>{source.baseActiveRevisionId ? <code>{source.baseActiveRevisionId}</code> : '當時尚無生效版本'}</dd></div><div><dt>來源內容</dt><dd>{source.specSnapshot ? '已凍結執行快照' : '尚未凍結的草稿'}</dd></div>{source.previousRevisionId && <div><dt>上一版本</dt><dd><code>{source.previousRevisionId}</code></dd></div>}{source.restoredFromId && <div><dt>回復內容來源</dt><dd><code>{source.restoredFromId}</code> · 本次是新草稿</dd></div>}<div><dt>Correlation</dt><dd><code>{source.correlationId}</code></dd></div><div><dt>資料時間</dt><dd>{timeLabel(detail.dataAsOf)}</dd></div></dl>
    <ServiceNotice>{detail.productionRisk ? '包含正式環境影響，必須由另一位具完整範圍的 Ops 核准。核准後仍需申請者明確執行。' : '非正式環境；驗證後仍需明確確認，才會啟用或執行。'}</ServiceNotice>
    <h3>驗證結果</h3>{source.validationResult === null ? <p>尚未驗證。儲存或編輯草稿不代表可生效。</p> : <><p>{source.validationResult.valid ? '驗證通過' : '驗證未通過'} · {timeLabel(source.validationResult.checkedAt)}</p>{source.validationResult.errors.length > 0 && <ul aria-label="驗證欄位錯誤">{source.validationResult.errors.map((error, index) => <li key={`${error.field}:${index}`}><code>{error.field}</code>：{error.message}</li>)}</ul>}</>}
  </section>
}

export function ConfigValues({ entries, label = '型別化配置內容' }: { entries: Entry[]; label?: string }) {
  if (entries.length === 0) return <p>這個版本明確包含零個設定項目。</p>
  return <ServiceTable label={label}><table><caption>{label}</caption><thead><tr><th scope="col">設定名稱</th><th scope="col">型別</th><th scope="col">值／reference</th><th scope="col">說明</th></tr></thead><tbody>{entries.map((entry, index) => <tr key={`${entry.key}:${index}`}><th scope="row"><code>{entry.key}</code></th><td>{entry.valueType}</td><td><code>{entryValue(entry)}</code></td><td>{entry.description || '未填寫'}</td></tr>)}</tbody></table></ServiceTable>
}

export function Weights({ weights, label, center = 'rd' }: { weights: TrafficDistribution['weights']; label: string; center?: 'rd' | 'ops' }) {
  return <div className="service-weights" aria-label={label}>{weights.length === 0 ? <p>尚無可確認的權重資料。</p> : weights.map(weight => <div className="service-weight-row" key={weight.releaseId}><Link to={`/${center}/releases/${encodeURIComponent(weight.releaseId)}`}><code>{weight.releaseId}</code></Link><strong>{weight.weight}%</strong></div>)}</div>
}

export function SourceSpec({ source, center }: { source: ServiceSource; center: 'rd' | 'ops' }) {
  if (source.sourceType === 'pipelineDefinition') {
    const spec = source.specSnapshot ?? source.spec
    return <section className="panel"><h2>交付定義內容</h2><dl className="detail-list"><div><dt>定義名稱／系列</dt><dd>{source.name}<br /><code>{source.familyId}</code></dd></div><div><dt>原始碼倉庫</dt><dd><code>{spec.repositoryRef}</code></dd></div><div><dt>允許的來源分支</dt><dd><code>{spec.refPattern}</code></dd></div><div><dt>建置配方</dt><dd><code>{spec.recipeRef}</code></dd></div><div><dt>產物倉庫</dt><dd><code>{spec.artifactRepositoryRef}</code></dd></div><div><dt>審批政策</dt><dd><code>{spec.approvalPolicyRef}</code></dd></div></dl><h3>目標環境</h3><ul>{spec.targetEnvironmentIds.map(id => <li key={id}><Link to={`/rd/apps/${source.applicationId}/environments/${id}`}><code>{id}</code></Link></li>)}</ul></section>
  }
  if (source.sourceType === 'serviceConfig') return <section className="panel"><h2>配置版本內容</h2><ConfigValues entries={(source.specSnapshot ?? source.spec).entries} /></section>
  const spec = source.specSnapshot ?? source.spec
  return <section className="panel"><h2>期望流量與健康門檻</h2><dl className="detail-list"><div><dt>服務端點</dt><dd><code>{spec.endpointRef}</code></dd></div><div><dt>請求比對</dt><dd><code>{spec.matchRef}</code></dd></div><div><dt>健康窗口／等待上限</dt><dd>{spec.healthWindowSeconds} 秒 / {spec.timeoutSeconds} 秒</dd></div><div><dt>p95 延遲門檻</dt><dd>{spec.thresholds.p95LatencyMs} ms</dd></div><div><dt>錯誤率門檻</dt><dd>{spec.thresholds.errorRate * 100}%</dd></div></dl><Weights weights={spec.targets} label="期望最終權重" center={center} /><ServiceNotice>候選版本固定經 10% → 50% → 100%。這是期望目標，實際權重以最後通過健康窗口的紀錄為準。</ServiceNotice></section>
}

export function ConfigurationDiff({ diff }: { diff: ServiceConfigDetail['diff'] }) {
  return <section className="panel"><h2>與目前生效配置的差異</h2>{diff.length === 0 ? <p>目前沒有內容差異；仍需驗證及合法的生效操作。</p> : <ServiceTable label="配置差異"><table><caption>提案相對於目前生效版本</caption><thead><tr><th scope="col">設定</th><th scope="col">差異</th><th scope="col">目前值</th><th scope="col">提案值</th></tr></thead><tbody>{diff.map(item => <tr key={item.key}><th scope="row"><code>{item.key}</code></th><td>{{ added: '新增', removed: '移除', changed: '變更' }[item.change]}</td><td>{item.before?.valueType ?? '—'}<br /><code>{entryValue(item.before)}</code></td><td>{item.after?.valueType ?? '—'}<br /><code>{entryValue(item.after)}</code></td></tr>)}</tbody></table></ServiceTable>}</section>
}

export function ActiveState({ detail, center }: { detail: ServiceDetail; center: 'rd' | 'ops' }) {
  if ('effective' in detail) return <section className="panel"><h2>目前有效流量</h2><p>{detail.effective.origin === 'unknown' ? '尚無可確認流量。' : detail.effective.origin === 'activeReleaseFallback' ? '尚無已執行流量策略；回退至目前已驗證部署版本，這不是流量量測。' : '使用最後通過健康窗口的權重；失敗不會刪除此紀錄。'}</p><Weights label="目前有效權重" weights={detail.effective.weights} center={center} /><p>最後驗證：{timeLabel(detail.effective.verifiedAt)}</p><p>目前待驗步驟：{detail.currentStep === null ? '無執行中的步驟' : `候選 ${detail.currentStep}%`}</p>{detail.effective.policyId && <p>來源策略 <code>{detail.effective.policyId}</code> · checkpoint <code>{detail.effective.checkpointId ?? '尚無'}</code></p>}</section>
  return <section className="panel"><h2>目前生效版本</h2>{detail.active === null ? <ServiceNotice>此範圍尚無已生效的{sectionTitle[detail.source.sourceType]}。</ServiceNotice> : <><p>revision {detail.active.revision} · <code>{detail.active.id}</code></p>{detail.active.sourceType === 'serviceConfig' ? <ConfigValues entries={(detail.active.specSnapshot ?? detail.active.spec).entries} label="目前生效配置" /> : <p>{detail.active.name} · 已啟用的定義可建立新 run，既有 run 仍保留自己的快照。</p>}</>}</section>
}

export function SourceHistory({ detail, center, environmentId }: { detail: ServiceDetail; center: 'rd' | 'ops'; environmentId: string }) {
  return <section className="panel"><h2>同一系列的版本歷史</h2><div className="service-revisions">{detail.history.map(source => <Link className="service-revision" key={source.id} to={sourcePath(source, center, environmentId)} aria-current={source.id === detail.source.id ? 'true' : undefined}><strong>revision {source.revision} · {stateLabel[source.state]}</strong><code>{source.id}</code><span>{source.reason}</span><small>{timeLabel(source.updatedAt)}</small></Link>)}</div></section>
}

export function DecisionHistory({ source }: { source: ServiceSource }) {
  return <section className="panel"><h2>獨立審批決策</h2>{source.decisions.length === 0 ? <p>尚無審批決策。</p> : <ol className="service-evidence">{source.decisions.map((decision, index) => <li key={index}><strong>{decision.decision === 'approved' ? '核准' : '拒絕'}</strong> · <code>{decision.actorId}</code><p>{decision.reason}</p><time dateTime={decision.occurredAt}>{timeLabel(decision.occurredAt)}</time></li>)}</ol>}</section>
}

export function ExecutionEvidence({ executions, center }: { executions: ServiceExecution[]; center: 'rd' | 'ops' }) {
  return <section className="panel"><h2>執行結果與證據</h2>{executions.length === 0 ? <p>尚未啟動執行；驗證與核准不會產生已完成的執行結果。</p> : executions.map(execution => <article className="service-revision" key={execution.id}><h3>{execution.kind === 'config' ? '配置執行' : '流量執行'} · {execution.state}</h3><code>{execution.id}</code><p>{timeLabel(execution.startedAt)} → {timeLabel(execution.completedAt)}</p><p>Correlation <code>{execution.correlationId}</code></p>{execution.failureCode && <ServiceNotice>執行失敗：<code>{execution.failureCode}</code>。既有生效內容／最後驗證權重保留；重新嘗試需建立新的版本。</ServiceNotice>}
    <ol className="service-evidence">{execution.stepResults.map((step, index) => <li key={index}><strong>{'name' in step ? ({ validate: '驗證', render: '準備配置', activate: '啟用配置' }[step.name]) : `候選 ${step.weight}%`}</strong> · {step.state}<p>{timeLabel(step.startedAt)} → {timeLabel(step.completedAt)}</p></li>)}</ol>
    {execution.kind === 'traffic' && <><h4>已通過的健康窗口</h4>{execution.checkpoints.length === 0 ? <p>尚無通過的健康窗口；先前有效權重保持不變。</p> : execution.checkpoints.map(checkpoint => <section key={checkpoint.id}><h4>候選 {checkpoint.step}% · 已驗證</h4><Weights weights={checkpoint.weights} label={`checkpoint ${checkpoint.step}% 權重`} center={center} /><p>{timeLabel(checkpoint.windowStart)} → {timeLabel(checkpoint.verifiedAt)}</p><p>樣本 <code>{checkpoint.sampleIds.join(', ')}</code></p></section>)}<h4>來源時間樣本</h4>{execution.samples.length === 0 ? <p>尚無樣本；不以零值代替未知。</p> : <ServiceTable label="流量健康樣本"><table><caption>與本次策略／執行／候選版本綁定的 Demo 樣本</caption><thead><tr><th scope="col">樣本／步驟</th><th scope="col">來源時間窗口</th><th scope="col">p95 延遲</th><th scope="col">錯誤率</th><th scope="col">候選版本</th></tr></thead><tbody>{execution.samples.map(sample => <tr key={sample.id}><th scope="row"><code>{sample.id}</code><br />候選 {sample.step}%</th><td>{timeLabel(sample.from)}<br />{timeLabel(sample.to)}</td><td>{sample.p95LatencyMs === null ? '未知' : `${sample.p95LatencyMs} ms`}</td><td>{sample.errorRate === null ? '未知' : `${sample.errorRate * 100}%`}</td><td><code>{sample.candidateReleaseId}</code></td></tr>)}</tbody></table></ServiceTable>}</>}
  </article>)}</section>
}

export function NetworkReferences({ options }: { options: DeliveryOptions }) {
  return <section className="panel"><h2>已知網路關聯</h2>{options.network.status === 'unknown' ? <p>尚無可確認的實體網路映射；服務端點 reference 不代表已控制負載平衡器或 gateway。</p> : <ul>{options.network.refs.map(ref => <li key={`${ref.relationId}:${ref.ciId}`}><Link to={`/ops/cmdb/${ref.ciId}`}>{ref.name} · <code>{ref.ciId}</code></Link><p>工作負載 <code>{ref.workloadCiId}</code> · 關聯 <code>{ref.relationId}</code></p></li>)}</ul>}</section>
}

export function ServiceAudit({ correlationId }: { correlationId: string }) {
  const filters = { correlationId, pageSize: 100, sort: 'occurredAt' as const, order: 'asc' as const }
  const audit = useQuery({ queryKey: queryKey('audit', null, filters), queryFn: () => api.listAudit(filters) })
  return <section className="panel"><h2>同一變更的稽核</h2>{audit.isPending ? <LoadingState label="正在讀取變更稽核…" /> : audit.isError ? <ErrorState error={audit.error} onRetry={() => void audit.refetch()} /> : audit.data.items.length === 0 ? <p>目前沒有可見的稽核事件。</p> : <ol className="service-evidence">{audit.data.items.map(event => <li key={event.id}><code>{event.id}</code> · {event.action} · {event.outcome}<p><code>{event.actorId}</code> · {timeLabel(event.occurredAt)}</p><p>{event.reason ?? event.diffSummary.join('；')}</p></li>)}</ol>}{audit.data && audit.data.total > audit.data.items.length && <p>顯示最早 {audit.data.items.length} 筆，共 {audit.data.total} 筆可見事件。</p>}</section>
}
