import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  PendingCommand,
  errorText,
  request,
  type Artifact,
  type ExportOperation,
  type ExportPreview,
  type ExportTarget,
} from './api';

const states: Record<ExportOperation['state'], string> = {
  queued: '等待匯出',
  exporting: '正在匯出',
  succeeded: '已建立 Draft PR',
  failed: '匯出未完成',
  uncertain: '遠端結果尚待確認',
};
const verification: Record<string, string> = {
  passed: '通過',
  failed: '失敗',
  unknown: '尚未確認',
  not_run: '未執行',
};
const reasons: Record<string, string> = {
  export_base_changed: '目的地的來源分支已更新，請以新版本重新執行任務。',
  export_approval_changed: '匯出內容已改變，請重新檢視後授權。',
  export_artifact_changed: '封存結果與所選內容不相符，請重新載入。',
  export_branch_exists: '目的地分支已存在，請先確認 GitHub 現況。',
  export_base_unsupported: '目前 GitHub 匯出僅支援 SHA-1 repository，可先下載成果。',
  export_base_drift: '目的地的來源分支已更新，請以新版本重新執行任務。',
  export_patch_unsupported: '這份變更包含目前不支援匯出的檔案格式，可下載 diff 查看。',
  export_patch_invalid: '這份變更格式不完整，請下載結果檢查。',
  export_patch_conflict: '變更與來源檔案不相符，請以正確版本重新執行任務。',
  export_target_disabled: '這個匯出目的地目前未啟用。',
  export_target_not_allowed: '這個匯出目的地目前未啟用。',
  export_approval_invalid: '匯出內容已改變，請重新檢視後授權。',
  artifact_invalid: '封存結果未通過完整性檢查，無法匯出。',
  artifact_hash_mismatch: '封存結果與所選內容不相符，請重新載入。',
};
function exportError(error: unknown) {
  return error instanceof ApiError
    ? (reasons[error.message] ?? errorText(error))
    : errorText(error);
}
function prLink(operation: ExportOperation) {
  const prefix = `https://github.com/${operation.target_repo}/pull/`;
  return operation.state === 'succeeded' &&
    /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(operation.target_repo) &&
    operation.pr_url?.startsWith(prefix) &&
    /^[1-9][0-9]*$/.test(operation.pr_url.slice(prefix.length))
    ? operation.pr_url
    : null;
}

export function ExportPanel({ artifact }: { artifact: Artifact }) {
  const cache = useQueryClient();
  const path = `/runs/${encodeURIComponent(artifact.run_id)}/exports`;
  const queryKey = ['exports', artifact.run_id];
  const [targetKey, setTargetKey] = useState('');
  const approvalCommand = useRef(new PendingCommand());
  const reconcileCommand = useRef(new PendingCommand());
  const targets = useQuery({
    queryKey: ['export-targets'],
    queryFn: ({ signal }) => request<{ items: ExportTarget[] }>('/export-targets', { signal }),
  });
  const history = useQuery({
    queryKey,
    queryFn: ({ signal }) => request<{ items: ExportOperation[] }>(path, { signal }),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ['queued', 'exporting', 'uncertain'].includes(item.state),
      )
        ? 1500
        : false,
  });
  const target =
    targets.data?.items.find((item) => `${item.repo}@${item.base_branch}` === targetKey) ??
    targets.data?.items[0];
  const preview = useMutation({
    mutationFn: () =>
      request<ExportPreview>(`${path}/preview`, {
        method: 'POST',
        body: JSON.stringify({
          artifact_id: artifact.id,
          artifact_sha256: artifact.sha256,
          target_repo: target!.repo,
          base_branch: target!.base_branch,
        }),
      }),
  });
  function refresh(value: ExportOperation) {
    cache.setQueryData<{ items: ExportOperation[] }>(queryKey, (old) => ({
      items: [value, ...(old?.items ?? []).filter((item) => item.id !== value.id)],
    }));
    void cache.invalidateQueries({ queryKey });
  }
  function authError(error: unknown) {
    if (error instanceof ApiError && error.status === 401)
      void cache.invalidateQueries({ queryKey: ['session'] });
  }
  const approve = useMutation({
    mutationFn: (value: ExportPreview) =>
      approvalCommand.current.send<ExportOperation>(path, {
        artifact_id: value.artifact_id,
        artifact_sha256: value.artifact_sha256,
        target_repo: value.target_repo,
        base_branch: value.base_branch,
        base_sha: value.base_sha,
        branch: value.branch,
        approval_digest: value.approval_digest,
        approved: true,
      }),
    onSuccess: (value) => {
      refresh(value);
      preview.reset();
    },
    onError: authError,
  });
  const reconcile = useMutation({
    mutationFn: (id: string) =>
      reconcileCommand.current.send<ExportOperation>(
        `${path}/${encodeURIComponent(id)}/reconcile`,
        {},
      ),
    onSuccess: refresh,
    onError: authError,
  });
  const busy = preview.isPending || approve.isPending;
  const reviewed = preview.data;
  const alreadyExists =
    reviewed &&
    history.data?.items.some(
      (item) =>
        item.branch === reviewed.branch &&
        item.target_repo === reviewed.target_repo &&
        item.artifact_sha256 === reviewed.artifact_sha256,
    );
  return (
    <section className="export-panel" aria-label="GitHub 匯出">
      <h4>GitHub 匯出</h4>
      {targets.isPending ? (
        <p role="status">正在載入匯出目的地…</p>
      ) : targets.isError ? (
        <>
          <p role="alert" className="error">
            無法載入匯出目的地。
          </p>
          <button onClick={() => void targets.refetch()}>重新載入目的地</button>
        </>
      ) : !target ? (
        <p className="muted">GitHub 匯出尚未設定目的地。</p>
      ) : (
        <>
          <label>
            GitHub 匯出目的地
            <select
              value={`${target.repo}@${target.base_branch}`}
              disabled={busy}
              onChange={(event) => {
                setTargetKey(event.target.value);
                preview.reset();
                approve.reset();
              }}
            >
              {targets.data.items.map((item) => (
                <option
                  key={`${item.repo}@${item.base_branch}`}
                  value={`${item.repo}@${item.base_branch}`}
                >
                  {item.repo} → {item.base_branch}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || history.isPending || history.isError}
            onClick={() => {
              approve.reset();
              preview.mutate();
            }}
          >
            {preview.isPending ? '正在檢視…' : '檢視匯出內容'}
          </button>
        </>
      )}
      {reviewed && (
        <div className="export-preview">
          <p>將這份封存的檔案變更送到 {reviewed.target_repo}，建立新分支與 Draft PR。</p>
          <p>驗證狀態：{verification[reviewed.verification_status] ?? '尚未確認'}</p>
          <dl>
            <dt>來源 commit</dt>
            <dd className="mono">{reviewed.base_sha}</dd>
            <dt>封存 SHA-256</dt>
            <dd className="mono">{reviewed.artifact_sha256}</dd>
            <dt>新分支</dt>
            <dd className="mono">{reviewed.branch}</dd>
            <dt>PR 目標分支</dt>
            <dd>{reviewed.base_branch}</dd>
          </dl>
          <p>變更檔案</p>
          <ul>
            {reviewed.files.map((file) => (
              <li key={file} className="mono">
                {file}
              </li>
            ))}
          </ul>
          <details>
            <summary>檢視封存的 diff</summary>
            <pre className="diff">{reviewed.diff}</pre>
          </details>
          {alreadyExists ? (
            <p className="muted">這份成果已有匯出紀錄，請查看下方狀態。</p>
          ) : (
            <button
              disabled={busy || history.isError || history.isPending}
              onClick={() => approve.mutate(reviewed)}
            >
              {approve.isPending ? '正在送出授權…' : '授權建立分支與 Draft PR'}
            </button>
          )}
        </div>
      )}
      {[preview.error, approve.error, reconcile.error].filter(Boolean).map((error, index) => (
        <p key={index} role="alert" className="error">
          {exportError(error)}
        </p>
      ))}
      {history.isPending ? (
        <p role="status">正在載入匯出紀錄…</p>
      ) : history.isError ? (
        <>
          <p role="alert" className="error">
            無法載入匯出紀錄。
          </p>
          <button onClick={() => void history.refetch()}>重新載入匯出紀錄</button>
        </>
      ) : (
        <ul className="export-history">
          {history.data.items.map((item) => {
            const url = prLink(item);
            return (
              <li key={item.id}>
                <strong>{states[item.state] ?? '匯出狀態尚待確認'}</strong>
                <p>
                  {item.target_repo} → {item.base_branch}
                </p>
                <p className="mono">{item.branch}</p>
                {item.reason && reasons[item.reason] && <p>{reasons[item.reason]}</p>}
                {url && (
                  <a href={url} target="_blank" rel="noreferrer noopener">
                    開啟 Draft PR
                  </a>
                )}
                {(item.state === 'uncertain' || item.state === 'exporting') && (
                  <>
                    <p className="muted">查核只讀取 GitHub 現況，不會重複建立分支或 PR。</p>
                    <button
                      disabled={reconcile.isPending}
                      onClick={() => reconcile.mutate(item.id)}
                    >
                      {reconcile.isPending ? '正在查核…' : '重新查核 GitHub 結果'}
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
