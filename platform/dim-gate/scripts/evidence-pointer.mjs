export const SOURCE_TAG = 'team-archive-20261018'

const POINTER = /^archive\/team-ledgers\/newclear\/(?:[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/)?\.team(?:\/[A-Za-z0-9._-]+)*#team-archive-20261018#[0-9a-f]{40}$/

export function journalPointerOk(value) {
  if (typeof value !== 'string' || !POINTER.test(value)) return false
  const path = value.split('#', 1)[0]
  return path.split('/').every(part => part !== '.' && part !== '..')
}

export function evidenceRecordOk(record) {
  if (record === null || typeof record !== 'object') return false
  const { journal_path: journalPath, source_tag: sourceTag, source_sha: sourceSha } = record
  if (sourceTag !== SOURCE_TAG || typeof journalPath !== 'string' || typeof sourceSha !== 'string') return false
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) return false
  return journalPointerOk(`${journalPath}#${sourceTag}#${sourceSha}`)
}
