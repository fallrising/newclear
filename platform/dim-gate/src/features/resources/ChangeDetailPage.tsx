import { useRef, useState } from 'react'
import { useIsMutating, useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { api, queryKey } from '../../api/client'
import type { ChangeAction } from '../../api/clients/resources'
import { demoClockMutationKey } from '../../api/query-definitions'
import { PageHeading } from '../../components/shared/page-heading'
import { ErrorState, LoadingState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog'
import type { SessionView } from '../../domain/schemas'
import { ChangeForm } from './ChangeForm'
import { actionLabel, changeKindLabel, changeStateLabel, dateLabel, isMissing, MissingResource, QuotaView, purposeLabel, WorkSummary } from './shared'

export function ChangeDetailPage({ center, session }: { center: 'rd' | 'ops'; session: SessionView }) {
  const { changeId='' }=useParams()
  const detail=useQuery({ queryKey:queryKey('change',changeId), queryFn:()=>api.getChange(changeId), enabled:Boolean(changeId) })
  const audit=useQuery({ queryKey:queryKey('audit',null,{ correlationId:detail.data?.change.correlationId }), queryFn:()=>api.listAudit({ correlationId:detail.data!.change.correlationId, pageSize:100, sort:'occurredAt',order:'asc' }), enabled:Boolean(detail.data) })
  const actionTrigger = useRef<HTMLButtonElement | null>(null)
  const [action,setAction]=useState<ChangeAction|null>(null)
  const [reason,setReason]=useState('')
  const [edit,setEdit]=useState(false)
  const [copy,setCopy]=useState(false)
  const [notice,setNotice]=useState('')
  const refresh=async()=>{ await detail.refetch(); await audit.refetch() }
  const mutation=useMutation({ mutationFn:()=>api.changeAction(changeId,action!,detail.data!.change.version,reason.trim()) })
  const clockPending=useIsMutating({ mutationKey:demoClockMutationKey })>0
  const clock=useMutation({ mutationKey:demoClockMutationKey, mutationFn:async()=>{ await api.advanceClock(1); await refresh() } })
  const fault=useMutation({ mutationFn:()=>api.setScenario('resource-failure',{executionId:detail.data!.change.latestExecutionId}) })
  const confirm=async()=>{ try { await mutation.mutateAsync(); setAction(null); setReason(''); await refresh(); setNotice('已重新讀取同一工作單的決策與執行狀態。') } catch { /* Exact domain refusal below. */ } }
  if (!changeId || isMissing(detail.error)) return <MissingResource back={`/${center}/requests`} />
  if (detail.isPending) return <LoadingState label="正在讀取資源工作單…" />
  if (detail.isError) return <ErrorState error={detail.error} onRetry={()=>void detail.refetch()} />
  const data=detail.data, change=data.change, spec=change.specSnapshot??change.spec
  const requiresReason=action!==null&&!['submit','execute'].includes(action)
  return <article className="resource-change-detail">
    <PageHeading eyebrow={`${center.toUpperCase()} · RESOURCE CHANGE`} title="資源變更詳情" description={`${changeKindLabel[change.kind]} · ${changeStateLabel[change.state]}`} action={<Button asChild variant="outline"><Link to={`/${center}/requests`}><ArrowLeft size={16} aria-hidden="true" />工作單清單</Link></Button>} />
    <p className="change-identity"><code>{change.id}</code> · <code>{change.correlationId}</code> · v{change.version}</p>
    {notice && <p role="status" className="command-notice">{notice}</p>}
    <div className="detail-status-grid"><section className="panel"><div className="panel-title"><h2>內容與版本</h2><span className="tag">{changeStateLabel[change.state]}</span></div><dl className="detail-list"><div><dt>來源 ID</dt><dd><code>{change.id}</code></dd></div><div><dt>申請者</dt><dd><code>{change.requesterId}</code></dd></div><div><dt>服務／環境</dt><dd>{spec.applicationId ? <Link to={`/rd/apps/${spec.applicationId}/resources?environmentId=${encodeURIComponent(spec.environmentId!)}`}>{spec.applicationId} / {spec.environmentId}</Link> : 'Ops 共享資源維護'}</dd></div><div><dt>目標 CI／pool</dt><dd><Link to={`/ops/cmdb/${spec.targetCiId}`}>{spec.targetCiId}</Link> · <code>{change.poolId}</code></dd></div><div><dt>模板快照</dt><dd>{spec.catalogItemId} · revision {spec.catalogRevision} · {change.catalogSnapshot?'已凍結':'草稿尚未凍結'}</dd></div><div><dt>申請理由</dt><dd>{spec.reason}</dd></div>
      {'resourceObjectId' in spec && spec.resourceObjectId && <div><dt>Object</dt><dd><code>{spec.resourceObjectId}</code> · v{spec.resourceObjectVersion}</dd></div>}
      {'quotaMiB' in spec && spec.quotaMiB!==undefined && <div><dt>期望配額</dt><dd>{spec.quotaMiB} MiB</dd></div>}
      {spec.kind==='kafka.topic.create' && <><div><dt>Topic／namespace</dt><dd>{spec.topicName} / {spec.namespace??'預設'}</dd></div><div><dt>期望設定</dt><dd>{spec.partitions} partitions · {spec.retentionHours} 小時 · {spec.throughputKiBPerSecond} KiB/s</dd></div></>}
      {'purpose' in spec && <div><dt>用途／安全 profile</dt><dd>{purposeLabel[spec.purpose]} · <code>{spec.accessProfileRef}</code></dd></div>}
      <div><dt>更新／資料時間</dt><dd>{dateLabel(change.updatedAt)} / {dateLabel(data.dataAsOf)}</dd></div></dl><h3>目標版本 guards</h3>{change.targetVersions.map(target=><p key={`${target.entityType}:${target.entityId}`}><code>{target.entityId}</code> · v{target.version}</p>)}</section>
      <section className="panel"><h2>決策與下一步</h2><p>核准只保留配額。執行成功才更新資源；任何失敗會保留先前 active 狀態。</p><div className="resource-action-row">{data.availableActions.map(value=>value==='edit'?<Button key={value} variant="outline" onClick={()=>{setEdit(!edit);setCopy(false)}}>{edit?'收起草稿編輯':actionLabel[value]}</Button>:<Button key={value} variant={value==='reject'||value==='cancel'?'destructive':'default'} disabled={mutation.isPending||clockPending} onClick={event=>{actionTrigger.current=event.currentTarget;mutation.reset();setAction(value);setReason('')}}>{actionLabel[value]}</Button>)}</div>
        {data.availableActions.length===0 && <p className="muted">目前身分與狀態沒有可執行的變更動作。</p>}
        {['rejected','failed','cancelled','succeeded'].includes(change.state) && session.effectiveActions.includes('change.create') && <Button variant="outline" onClick={()=>{setCopy(!copy);setEdit(false)}}>{copy?'收起新草稿':'複製內容為新草稿'}</Button>}
        {change.state==='executing' && <div className="scenario-control"><p>Demo：推進共用邏輯時鐘，執行器逐步驗證；不是手動將工作單設為成功。</p><Button disabled={clockPending} onClick={()=>clock.mutate()}>{clockPending?'正在執行並讀回…':'推進示範時鐘 1 tick'}</Button>{center==='ops'&&session.effectiveActions.includes('change.execute')&&<Button variant="outline" disabled={fault.isPending||fault.isSuccess||clockPending} onClick={()=>fault.mutate()}>在 configure 注入資源失敗</Button>}{fault.isSuccess&&<p role="status">已設定這次 attempt 的模擬 configure 失敗。</p>}</div>}
        {clock.isError&&<ErrorState error={clock.error} title="示範時鐘未完成" />}{fault.isError&&<ErrorState error={fault.error} title="故障情境未設定" />}
        <h3>審批決策歷史</h3>{change.decisions.length===0?<p className="muted">尚無決策。</p>:change.decisions.map((decision,index)=><p key={index}><code>{decision.actorId}</code> · {decision.decision} · {dateLabel(decision.occurredAt)}<br/>{decision.reason}</p>)}
      </section></div>
    {edit&&change.state==='draft'&&<ChangeForm key={`${change.id}:${change.version}`} original={change} center={center} catalogId={spec.catalogItemId} onSaved={async()=>{await refresh();setEdit(false)}} />}
    {copy&&<ChangeForm key={`copy:${change.id}`} copyFrom={change} center={center} catalogId={spec.catalogItemId} />}
    <section className="panel"><h2>影響與配額</h2><WorkSummary summary={data.summary}/>{data.impact.incomplete?<p role="status">影響範圍未完整授權，不能宣稱已完整核對。</p>:data.impact.consumers.map(consumer=><p key={consumer.environmentId}>{consumer.applicationName} / {consumer.environmentName} · {consumer.stage}</p>)}<QuotaView capacity={data.capacity}/></section>
    <section className="panel"><div className="panel-title"><h2>執行歷史</h2><span className="tag">{data.executions.length} attempts</span></div>{data.executions.length===0?<p className="muted">尚未啟動執行；不會提前建立 ready 的 object 或 Binding。</p>:<div className="change-history">{data.executions.map(execution=><article className="resource-object" key={execution.id}><h3>{execution.id} · attempt {execution.attempt} · {execution.state}</h3><p>Correlation <code>{execution.correlationId}</code> · {dateLabel(execution.startedAt)} → {execution.completedAt?dateLabel(execution.completedAt):'尚未完成'}</p><p>預定 Object IDs：<code>{execution.plannedObjectIds.join(', ')||'使用既有 object'}</code></p><p>預定 Binding IDs：<code>{execution.plannedBindingIds.join(', ')||'不新增綁定'}</code></p>{execution.failureCode&&<p role="status">失敗原因：<code>{execution.failureCode}</code>；保留原 active 與歷史，重新送審需要新決策。</p>}<ol className="change-steps">{execution.stepResults.map(step=><li key={step.name}><strong>{step.name}</strong><p>{step.state}</p>{step.occurredAt&&<small>{dateLabel(step.occurredAt)}</small>}</li>)}</ol></article>)}</div>}</section>
    <section className="panel"><h2>同一 correlation 的稽核</h2>{audit.isPending?<LoadingState label="正在讀取稽核…"/>:audit.isError?<ErrorState error={audit.error} onRetry={()=>void audit.refetch()}/>:audit.data.items.length===0?<p>目前沒有可見的稽核紀錄。</p>:<ol>{audit.data.items.map(event=><li key={event.id}><code>{event.id}</code> · {event.action} · {event.outcome} · {dateLabel(event.occurredAt)}<p>Actor <code>{event.actorId}</code> · {event.reason??event.diffSummary.join('、')}</p></li>)}</ol>}</section>
    <Dialog open={action!==null} onOpenChange={open=>{if(!open&&!mutation.isPending)setAction(null)}}><DialogContent onCloseAutoFocus={event=>{event.preventDefault();actionTrigger.current?.focus()}}><DialogTitle>{action?actionLabel[action]:'變更確認'}</DialogTitle><DialogDescription>核對同一工作單、目標版本及原始快照後確認。系統會重新驗證授權與容量。</DialogDescription><div className="resource-proposal"><p><code>{change.id}</code> · v{change.version}</p><p>{spec.reason}</p><WorkSummary summary={data.summary}/><p>{changeKindLabel[change.kind]} · {spec.targetCiId} · catalog revision {spec.catalogRevision}</p>{action==='approve'&&<p>核准後僅保留配額，尚未配置資源。</p>}{action==='retry'&&<p>原始失敗 attempt 保留；重新送審後需另一位 Ops 做新決策。</p>}</div>{requiresReason&&<label>決策／操作理由<textarea required rows={3} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></label>}{mutation.isError&&<ErrorState error={mutation.error} title="操作未完成"/>}<div className="resource-action-row"><Button variant="outline" disabled={mutation.isPending} onClick={()=>setAction(null)}>取消</Button><Button disabled={mutation.isPending||requiresReason&&!reason.trim()} onClick={()=>void confirm()}>{mutation.isPending?'正在提交…':'確認操作'}</Button></div></DialogContent></Dialog>
  </article>
}
