import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, PendingCommand, errorText, request, type Run } from './api';

type Approval = {
  id: string;
  generation: number;
  action_digest: string;
  status: string;
  expires_at: string;
  normalized_action: { actions: { id: string; tool_name: string; action: unknown }[] };
};

export function Approvals({ run }: { run: Run }) {
  const query = useQuery({
    queryKey: ['approvals', run.id],
    queryFn: () => request<{ items: Approval[] }>(`/runs/${run.id}/approvals`),
    refetchInterval: 1000,
  });
  if (query.error) return <p role="alert">{errorText(query.error)}</p>;
  const latest = query.data?.items.at(-1);
  if (!latest) return null;
  return <ApprovalDecision key={latest.id} approval={latest} run={run} />;
}

function ApprovalDecision({ approval, run }: { approval: Approval; run: Run }) {
  const cache = useQueryClient();
  const command = useRef(new PendingCommand());
  const payload = useRef<Record<string, unknown> | null>(null);
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['approvals', run.id] });
    void cache.invalidateQueries({ queryKey: ['task', run.task_id] });
    void cache.invalidateQueries({ queryKey: ['tasks'] });
    void cache.invalidateQueries({ queryKey: ['runtime'] });
  };
  const decision = useMutation({
    mutationFn: (choice: 'approve' | 'deny') => {
      payload.current ??= {
        decision: choice,
        action_digest: approval.action_digest,
        generation: approval.generation,
        expected_state_version: run.state_version,
      };
      return command.current.send(`/approvals/${approval.id}/decision`, payload.current);
    },
    onSuccess: refresh,
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) payload.current = null;
      refresh();
    },
  });
  const expired = Date.parse(approval.expires_at) <= Date.now();
  const enabled = approval.status === 'pending' && !expired && run.state === 'awaiting_approval';
  const uncertain = decision.isError && payload.current !== null;
  const names: Record<string, string> = {
    pending: expired ? '審批已逾期' : '等待審批',
    approved: '已核准，等待執行',
    applied: '核准已送至執行環境',
    denied: run.state === 'cancelled' ? '已拒絕，任務已取消' : '已拒絕，正在停止環境',
    expired: '審批已逾期',
    invalidated: '審批已失效',
  };
  return (
    <section className="approval-panel" aria-label="工具審批">
      <h3>{names[approval.status] ?? approval.status}</h3>
      <p>核准只適用於下列這一批操作。等待期間仍占用容量；拒絕會取消本次任務。</p>
      {approval.normalized_action.actions.map((action) => (
        <div key={action.id}>
          <strong>{action.tool_name}</strong>
          <pre>{JSON.stringify(action.action, null, 2)}</pre>
        </div>
      ))}
      <p className="muted">有效至 {new Date(approval.expires_at).toLocaleString()}</p>
      <div className="run-actions">
        {(['approve', 'deny'] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            disabled={
              !enabled ||
              decision.isPending ||
              decision.isSuccess ||
              (uncertain && payload.current?.decision !== choice)
            }
            onClick={() => decision.mutate(choice)}
          >
            {uncertain && payload.current?.decision === choice
              ? '重試原決定'
              : choice === 'approve'
                ? '核准這批操作'
                : '拒絕並取消'}
          </button>
        ))}
      </div>
      {decision.isSuccess && <p role="status">決定已受理，正在核對執行狀態。</p>}
      {decision.error && <p role="alert">{errorText(decision.error)}</p>}
    </section>
  );
}
