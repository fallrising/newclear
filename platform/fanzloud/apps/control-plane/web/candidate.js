// CU-M3-C02/03: verify AP's immutable archive; never synthesize a review input.
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const sha = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const base = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const fail = () => { throw new Error('固定審查候選無法確認；未開始審查，請重新讀取。'); };
const stable = value => JSON.stringify(value, function (_key, item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  return item;
});
const bytes = value => new TextEncoder().encode(value);
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(value))), b => b.toString(16).padStart(2, '0')).join('');

/** Read and verify the exact AP archive for the captured successful writer run. */
async function readArchive(run, request) {
  if (!run || run.state !== 'succeeded' || !uuid(run.id) || !uuid(run.task_id) || !uuid(run.profile_revision)
      || !base(run.base_sha) || !Number.isSafeInteger(run.attempt_no) || run.attempt_no < 1
      || typeof run.goal !== 'string' || !run.result) fail();
  const listing = await request(`/runs/${run.id}/artifacts`);
  if (!Array.isArray(listing?.items) || listing.items.length !== 1) fail();
  const meta = listing.items[0];
  if (!meta || !uuid(meta.id) || meta.run_id !== run.id || meta.kind !== 'result' || meta.mime !== 'application/json'
      || meta.pruned_at !== null || !sha(meta.sha256) || !Number.isSafeInteger(meta.size) || meta.size < 1 || meta.size > 1024 * 1024) fail();
  const raw = await request(`/runs/${run.id}/artifacts/${meta.id}`, {text: true});
  if (typeof raw !== 'string' || raw.length > 1024 * 1024 || bytes(raw).length !== meta.size || await digest(raw) !== meta.sha256) fail();
  let value;
  try { value = JSON.parse(raw); } catch { fail(); }
  if (!value || value.schema_version !== 'result-archive-v1' || value.artifact_id !== meta.id
      || value.run_id !== run.id || value.task_id !== run.task_id || value.profile_revision !== run.profile_revision
      || value.base_sha !== run.base_sha || value.attempt_no !== run.attempt_no || value.goal !== run.goal) fail();
  return {raw, value, meta};
}

export async function readCandidate(run, request) {
  const {raw, value, meta} = await readArchive(run, request);
  const result = value.result;
  if (!result || result.base_sha !== run.base_sha || result.diff !== run.result.diff
      || !sha(result.diff_sha256) || result.diff_sha256 !== run.result.diff_sha256
      || bytes(result.diff).length !== result.diff_bytes || result.diff_bytes !== run.result.diff_bytes
      || await digest(result.diff) !== result.diff_sha256 || !result.verification
      || !['passed', 'failed', 'unknown', 'not_run'].includes(result.verification.status)
      || stable(result.verification) !== stable(run.result.verification)) fail();
  return {raw, sha256: meta.sha256, artifact_id: meta.id, run_id: run.id, base_sha: run.base_sha,
    profile_revision: run.profile_revision, diff_sha256: result.diff_sha256, verification: result.verification};
}

/** Validate the typed result against the immutable run admission, before presentation. */
export function reviewResult(run) {
  const context = run?.review_context, result = run?.result?.review;
  if (run?.purpose !== 'review' || run.state !== 'succeeded' || !context || !result
      || !uuid(context.root_writer_run_id) || !uuid(context.writer_run_id) || !uuid(context.artifact_id)
      || !uuid(context.reviewer_profile_revision) || context.reviewer_profile_revision !== run.profile_revision
      || !sha(context.candidate_sha256) || ![1,2].includes(context.review_round)
      || result.reviewer_run_id !== run.id || !['accept','request_changes','reject'].includes(result.verdict)
      || !Array.isArray(result.reasons) || result.reasons.length < 1 || result.reasons.length > 8
      || result.reasons.some(x => typeof x !== 'string' || !x.trim() || Array.from(x).length > 2000)
      || bytes(JSON.stringify(result)).length > 32768
      || Object.keys(context).some(k => stable(result[k]) !== stable(context[k]))) fail();
  return result;
}

export async function readReview(run, request) {
  const expected = reviewResult(run);
  const {raw, value, meta} = await readArchive(run, request);
  if (stable(value.result.review) !== stable(expected)) fail();
  return {raw, sha256: meta.sha256, review: expected};
}
