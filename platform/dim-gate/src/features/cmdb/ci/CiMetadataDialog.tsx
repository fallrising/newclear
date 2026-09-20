import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { api } from '../../../api/client'
import type { PatchCiInput } from '../../../api/clients/cmdb'
import type { CIView } from '../../../domain/schemas'
import { errorDetails } from '../../../components/shared/states'
import { Button } from '../../../components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../../components/ui/dialog'
import { errorStatus, fieldErrors } from './ci-view'
import { invalidateAfterCiUpdate } from './query-invalidation'

function serializeTags(tags: CIView['tags']) {
  return Object.entries(tags).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('\n')
}

function parseTags(value: string): { tags?: Record<string, string>; error?: string } {
  const tags: Record<string, string> = {}
  for (const [index, raw] of value.split('\n').entries()) {
    const line = raw.trim()
    if (!line) continue
    const separator = line.indexOf('=')
    if (separator < 1) return { error: `第 ${index + 1} 行必須使用 key=value。` }
    const key = line.slice(0, separator).trim()
    if (key in tags) return { error: `標籤 ${key} 重複。` }
    tags[key] = line.slice(separator + 1).trim()
  }
  return { tags }
}

export function CiMetadataDialog({ ci, onReload }: { ci: CIView; onReload: () => Promise<unknown> | void }) {
  const cache = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(ci.name)
  const [tagsText, setTagsText] = useState(serializeTags(ci.tags))
  const [localError, setLocalError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) { setName(ci.name); setTagsText(serializeTags(ci.tags)); setLocalError(null) }
  }, [ci, open])
  const mutation = useMutation({
    mutationFn: (input: PatchCiInput) => api.patchCi(ci.id, input),
    onSuccess: async () => { await invalidateAfterCiUpdate(cache); setOpen(false) },
  })
  const errors = fieldErrors(mutation.error)
  const details = mutation.error ? errorDetails(mutation.error) : null
  const submit = (event: FormEvent) => {
    event.preventDefault()
    mutation.reset()
    const parsed = parseTags(tagsText)
    if (parsed.error) { setLocalError(parsed.error); return }
    setLocalError(null)
    mutation.mutate({ expectedVersion: ci.version, name: name.trim(), tags: parsed.tags! })
  }
  const reload = async () => {
    await onReload()
    mutation.reset()
  }
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) mutation.reset() }}>
    <DialogTrigger asChild><Button variant="outline"><Pencil size={15} aria-hidden="true" />編輯 metadata</Button></DialogTrigger>
    <DialogContent className="ci-dialog">
      <DialogTitle>編輯 CI metadata</DialogTitle>
      <DialogDescription>只修改名稱與標籤；provider、account、location、kind、external ID 與 pool identity 保持不變。</DialogDescription>
      <form className="ci-form" onSubmit={submit} noValidate>
        <div className="identity-lock" aria-label="不可變 canonical identity"><strong>Canonical identity 已鎖定</strong><code>{ci.provider} / {ci.locationId} / {ci.kind} / {ci.externalId}</code></div>
        <label>名稱<input required value={name} onChange={(event) => setName(event.target.value)} aria-describedby={errors.name ? 'metadata-name-error' : undefined} />{errors.name && <span className="field-error" id="metadata-name-error">{errors.name.join('；')}</span>}</label>
        <label>標籤<textarea rows={6} value={tagsText} onChange={(event) => setTagsText(event.target.value)} aria-describedby={localError || errors.tags ? 'metadata-tags-error' : undefined} /><span className="field-hint">每行一筆 key=value；數字 0 會保留為文字值。</span>{(localError || errors.tags) && <span className="field-error" id="metadata-tags-error">{localError ?? errors.tags?.join('；')}</span>}</label>
        {details && <div className={errorStatus(mutation.error) === 409 ? 'conflict-state' : 'form-error'} role="alert">
          <strong>{errorStatus(mutation.error) === 409 ? '資料版本已更新' : '無法儲存 metadata'}</strong><p>{details.message}</p><code>{details.code} · {details.requestId}</code>
          {errorStatus(mutation.error) === 409 && <Button variant="outline" onClick={() => void reload()}>重新讀取最新版本</Button>}
        </div>}
        <div className="dialog-actions"><DialogClose asChild><Button variant="outline" disabled={mutation.isPending}>取消</Button></DialogClose><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? '正在儲存…' : '儲存 metadata'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}
