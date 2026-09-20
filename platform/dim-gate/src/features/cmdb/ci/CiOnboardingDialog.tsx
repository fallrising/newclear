import { useId, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { api } from '../../../api/client'
import type { CreateCiInput } from '../../../api/clients/cmdb'
import type { Provider } from '../../../domain/schemas'
import { Button } from '../../../components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../../components/ui/dialog'
import { errorDetails } from '../../../components/shared/states'
import { errorStatus, fieldErrors, providerLabels } from './ci-view'
import { invalidateAfterCiCreate } from './query-invalidation'

const providerIdentity = {
  aws: { accountId: 'account-aws-demo', locationId: 'location-aws-sg', poolId: 'pool-aws-sg' },
  aliyun: { accountId: 'account-aliyun-demo', locationId: 'location-aliyun-sg', poolId: 'pool-aliyun-sg' },
  onprem: { accountId: '', locationId: 'location-idc-sg', poolId: 'pool-idc-sg' },
} as const

const projects = [
  { id: 'project-store', label: 'Store', teamId: 'team-commerce' },
  { id: 'project-payments', label: 'Payments', teamId: 'team-commerce' },
  { id: 'project-data', label: 'Data', teamId: 'team-data' },
  { id: 'project-insights', label: 'Insights', teamId: 'team-data' },
]

type Draft = {
  provider: Provider; name: string; externalId: string; accountId: string; locationId: string; poolId: string
  projectId: string; cpu: string; memoryMiB: string; instanceType: string; vpcId: string; subnetId: string
  vSwitchId: string; assetTag: string; serialRef: string; hypervisor: 'baremetal' | 'kvm' | 'vmware'
}

function initialDraft(): Draft {
  return {
    provider: 'aws', name: '', externalId: '', ...providerIdentity.aws, projectId: 'project-store', cpu: '1',
    memoryMiB: '1024', instanceType: 'demo.compute.small', vpcId: 'vpc-demo', subnetId: 'subnet-demo',
    vSwitchId: 'vsw-demo', assetTag: '', serialRef: '', hypervisor: 'kvm',
  }
}

function buildInput(draft: Draft): CreateCiInput {
  const project = projects.find((entry) => entry.id === draft.projectId)!
  const common = {
    name: draft.name.trim(), kind: 'compute' as const, provider: draft.provider,
    externalId: draft.externalId.trim(), locationId: draft.locationId.trim(), poolId: draft.poolId.trim(),
    ownerTeamId: project.teamId, visibilityProjectIds: [project.id], lifecycle: 'active' as const,
    tags: { mode: 'demo', onboarded: 'manual' }, customFields: {},
  }
  const capacity = { cpu: draft.cpu === '' ? Number.NaN : Number(draft.cpu), memoryMiB: draft.memoryMiB === '' ? Number.NaN : Number(draft.memoryMiB) }
  if (draft.provider === 'aws') return {
    ...common, accountId: draft.accountId.trim(), attributes: {
      ...capacity, instanceType: draft.instanceType.trim(), vpcId: draft.vpcId.trim(), subnetId: draft.subnetId.trim(),
    },
  }
  if (draft.provider === 'aliyun') return {
    ...common, accountId: draft.accountId.trim(), attributes: {
      ...capacity, instanceType: draft.instanceType.trim(), vpcId: draft.vpcId.trim(), vSwitchId: draft.vSwitchId.trim(),
    },
  }
  return { ...common, attributes: {
    ...capacity, assetTag: draft.assetTag.trim(), serialRef: draft.serialRef.trim(), hypervisor: draft.hypervisor,
  } }
}

function InputError({ name, errors }: { name: string; errors: Record<string, string[]> }) {
  const messages = errors[name] ?? errors[`attributes.${name}`]
  return messages ? <span className="field-error" id={`create-${name}-error`}>{messages.join('；')}</span> : null
}

export function CiOnboardingDialog({ onCommitted }: { onCommitted?: (ciId: string) => void }) {
  const cache = useQueryClient()
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(initialDraft)
  const mutation = useMutation({
    mutationFn: (input: CreateCiInput) => api.createCi(input),
    onSuccess: async (receipt) => {
      await invalidateAfterCiCreate(cache)
      onCommitted?.(receipt.entityId)
      setDraft(initialDraft())
      setOpen(false)
    },
  })
  const errors = fieldErrors(mutation.error)
  const details = mutation.error ? errorDetails(mutation.error) : null
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const chooseProvider = (provider: Provider) => {
    mutation.reset()
    setDraft((current) => ({ ...current, provider, ...providerIdentity[provider] }))
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    mutation.reset()
    mutation.mutate(buildInput(draft))
  }
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) mutation.reset() }}>
    <DialogTrigger asChild><Button><Plus size={16} aria-hidden="true" />手動納管 CI</Button></DialogTrigger>
    <DialogContent className="ci-dialog">
      <DialogTitle>手動納管配置項</DialogTitle>
      <DialogDescription>建立真實示範狀態。canonical identity 建立後不可由 metadata 表單修改。</DialogDescription>
      <form id={formId} className="ci-form" onSubmit={submit} noValidate>
        <label>Provider
          <select value={draft.provider} onChange={(event) => chooseProvider(event.target.value as Provider)} disabled={mutation.isPending}>
            {(Object.keys(providerLabels) as Provider[]).map((provider) => <option value={provider} key={provider}>{providerLabels[provider]}</option>)}
          </select>
        </label>
        <label>名稱<input required value={draft.name} onChange={(event) => set('name', event.target.value)} aria-describedby={errors.name ? 'create-name-error' : undefined} /><InputError name="name" errors={errors} /></label>
        <label>外部識別碼<input required value={draft.externalId} onChange={(event) => set('externalId', event.target.value)} aria-describedby={errors.externalId ? 'create-externalId-error' : undefined} /><InputError name="externalId" errors={errors} /></label>
        <label>可見專案<select value={draft.projectId} onChange={(event) => set('projectId', event.target.value)}>{projects.map((project) => <option value={project.id} key={project.id}>{project.label}</option>)}</select></label>
        {draft.provider !== 'onprem' && <label>Provider account<input required value={draft.accountId} onChange={(event) => set('accountId', event.target.value)} aria-describedby={errors.accountId ? 'create-accountId-error' : undefined} /><InputError name="accountId" errors={errors} /></label>}
        <label>{draft.provider === 'onprem' ? 'Site location ID' : 'Region location ID'}<input required value={draft.locationId} onChange={(event) => set('locationId', event.target.value)} aria-describedby={errors.locationId ? 'create-locationId-error' : errors.provider ? 'create-provider-error' : undefined} /><InputError name="locationId" errors={errors} />{errors.provider && <span className="field-error" id="create-provider-error">{errors.provider.join('；')}</span>}</label>
        <label>資源池 ID<input required value={draft.poolId} onChange={(event) => set('poolId', event.target.value)} aria-describedby={errors.poolId ? 'create-poolId-error' : undefined} /><InputError name="poolId" errors={errors} /></label>
        <label>CPU<input required type="number" min="0" step="1" value={draft.cpu} onChange={(event) => set('cpu', event.target.value)} aria-describedby={errors['attributes.cpu'] ? 'create-cpu-error' : undefined} /><InputError name="cpu" errors={errors} /></label>
        <label>Memory (MiB)<input required type="number" min="0" step="1" value={draft.memoryMiB} onChange={(event) => set('memoryMiB', event.target.value)} aria-describedby={errors['attributes.memoryMiB'] ? 'create-memoryMiB-error' : undefined} /><InputError name="memoryMiB" errors={errors} /></label>
        {draft.provider === 'onprem' ? <>
          <label>Asset tag<input required value={draft.assetTag} onChange={(event) => set('assetTag', event.target.value)} /><InputError name="assetTag" errors={errors} /></label>
          <label>Serial reference<input required value={draft.serialRef} onChange={(event) => set('serialRef', event.target.value)} /><InputError name="serialRef" errors={errors} /></label>
          <label>Hypervisor<select value={draft.hypervisor} onChange={(event) => set('hypervisor', event.target.value as Draft['hypervisor'])}><option value="baremetal">baremetal</option><option value="kvm">kvm</option><option value="vmware">vmware</option></select></label>
        </> : <>
          <label>Instance type<input required value={draft.instanceType} onChange={(event) => set('instanceType', event.target.value)} /><InputError name="instanceType" errors={errors} /></label>
          <label>VPC ID<input required value={draft.vpcId} onChange={(event) => set('vpcId', event.target.value)} /><InputError name="vpcId" errors={errors} /></label>
          {draft.provider === 'aws'
            ? <label>Subnet ID<input required value={draft.subnetId} onChange={(event) => set('subnetId', event.target.value)} /><InputError name="subnetId" errors={errors} /></label>
            : <label>vSwitch ID<input required value={draft.vSwitchId} onChange={(event) => set('vSwitchId', event.target.value)} /><InputError name="vSwitchId" errors={errors} /></label>}
        </>}
        {details && <div className={errorStatus(mutation.error) === 409 ? 'conflict-state' : 'form-error'} role="alert">
          <strong>{errorStatus(mutation.error) === 409 ? '無法納管：canonical identity 衝突' : '請修正無法納管的欄位'}</strong>
          <p>{details.message}</p><code>{details.code} · {details.requestId}</code>
        </div>}
        <div className="dialog-actions"><DialogClose asChild><Button variant="outline" disabled={mutation.isPending}>取消</Button></DialogClose><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? '正在納管…' : '確認納管'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}
