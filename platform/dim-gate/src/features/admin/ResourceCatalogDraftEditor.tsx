import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../api/client'
import { ErrorState } from '../../components/shared/states'
import { Button } from '../../components/ui/button'
import { resourceAccessProfiles, type CatalogItem, type Provider } from '../../domain/schemas'

type ResourceTemplate = Exclude<CatalogItem['template'], { resourceKind:'compute' }>
type ResourceCatalog = Omit<CatalogItem,'template'> & { template:ResourceTemplate }
const splitIds = (value:string)=>[...new Set(value.split(',').map(id=>id.trim()).filter(Boolean))]
const numericLabels:Record<string,string> = { quotaMiB:'配額 MiB', minQuotaMiB:'最小配額 MiB', maxQuotaMiB:'最大配額 MiB', partitions:'Partitions', minPartitions:'最少 partitions', maxPartitions:'最多 partitions', retentionHours:'保留時數', minRetentionHours:'最少保留時數', maxRetentionHours:'最多保留時數', throughputKiBPerSecond:'Throughput KiB/s', minThroughputKiBPerSecond:'最小 KiB/s', maxThroughputKiBPerSecond:'最大 KiB/s' }
export function ResourceCatalogDraftEditor({item,committed}:{item:ResourceCatalog;committed:()=>Promise<unknown>}) {
  const [name,setName]=useState(item.name), [description,setDescription]=useState(item.description)
  const [projects,setProjects]=useState(item.allowedProjectIds.join(', ')), [pools,setPools]=useState(item.template.allowedPoolIds.join(', '))
  const [parents,setParents]=useState(item.template.allowedParentCiIds.join(', '))
  const [template,setTemplate]=useState<ResourceTemplate>(structuredClone(item.template))
  const mutation=useMutation({mutationFn:()=>api.patchCatalog(item,{name,description,allowedProjectIds:splitIds(projects),template:{...template,allowedPoolIds:splitIds(pools),allowedParentCiIds:splitIds(parents)}})})
  const profiles=resourceAccessProfiles.filter(profile=>profile.resourceKind===template.resourceKind)
  const updateNumber=(section:'defaults'|'limits',key:string,value:number)=>setTemplate(current=>({...current,[section]:{...current[section],[key]:value}}))
  const valid=Boolean(name.trim()&&description.trim()&&splitIds(projects).length&&splitIds(pools).length&&splitIds(parents).length&&template.allowedProviders.length&&template.allowedStages.length&&template.accessProfiles.length)
  return <div className="admin-inline-editor">
    <h3>{template.resourceKind==='redis'?'Redis allocation':'Kafka topic'} 型別化草稿</h3>
    <label>Draft name<input value={name} onChange={event=>setName(event.target.value)}/></label><label>Description<textarea rows={3} value={description} onChange={event=>setDescription(event.target.value)}/></label>
    <label>Allowed project IDs<input value={projects} onChange={event=>setProjects(event.target.value)}/></label><label>Allowed pool IDs<input value={pools} onChange={event=>setPools(event.target.value)}/></label><label>Allowed parent CI IDs<input value={parents} onChange={event=>setParents(event.target.value)}/></label>
    <label>Allowed providers<select multiple value={template.allowedProviders} onChange={event=>setTemplate({...template,allowedProviders:Array.from(event.target.selectedOptions,option=>option.value as Provider)})}><option value="aws">AWS</option><option value="aliyun">Aliyun</option><option value="onprem">On-prem IDC</option></select></label>
    <label>Allowed stages<select multiple value={template.allowedStages} onChange={event=>setTemplate({...template,allowedStages:Array.from(event.target.selectedOptions,option=>option.value as ResourceTemplate['allowedStages'][number])})}><option value="dev">開發</option><option value="staging">預備</option><option value="prod">正式</option></select></label>
    <label>Registered access profiles<select multiple value={template.accessProfiles.map(profile=>profile.id)} onChange={event=>{const selected=Array.from(event.target.selectedOptions,option=>option.value);setTemplate({...template,accessProfiles:profiles.filter(profile=>selected.includes(profile.id)).map(profile=>({id:profile.id,label:profile.label,purposes:[...profile.purposes]}))})}}>{profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.label} · {profile.purposes.join('/')}</option>)}</select></label>
    <div className="catalog-spec-grid">{(['defaults','limits'] as const).flatMap(section=>Object.entries(template[section]).map(([key,value])=><label key={`${section}:${key}`}>{section==='defaults'?'預設':'限制'} · {numericLabels[key]}<input required type="number" min={1} step={1} value={value} onChange={event=>updateNumber(section,key,Number(event.target.value))}/></label>))}</div>
    <p className="muted">只可選已註冊安全 profile；不存秘密或任意執行內容。發布會驗證上下限、provider、pool、parent CI 與 profile 相容性。</p>
    <Button size="sm" variant="outline" disabled={mutation.isPending||!valid} onClick={async()=>{try{await mutation.mutateAsync();await committed()}catch{/* Exact API error below. */}}}>儲存草稿內容</Button>
    {mutation.isError&&<ErrorState error={mutation.error} title="資源模板尚未儲存"/>}{mutation.isSuccess&&<p role="status">資源模板草稿已重新讀取。</p>}
  </div>
}
