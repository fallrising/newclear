import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, errorText, PendingCommand, type Run } from './api';

type Action = 'pause' | 'resume' | 'cancel';
type Payload = { action: Action; expected_state_version: number };
const labels = { pause: '暫停', resume: '繼續', cancel: '取消' };

export function RunControls({ run }: { run: Run }) {
  const cache = useQueryClient();
  const command = useRef(new PendingCommand());
  const payload = useRef<Payload | null>(null);
  const [acceptedVersion, setAcceptedVersion] = useState<number | null>(null);
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['task', run.task_id] });
    void cache.invalidateQueries({ queryKey: ['tasks'] });
    void cache.invalidateQueries({ queryKey: ['runtime'] });
  };
  const control = useMutation({
    mutationFn: (action: Action) => {
      payload.current ??= { action, expected_state_version: run.state_version };
      return command.current.send(`/runs/${run.id}/actions`, payload.current);
    },
    onSuccess: () => {
      setAcceptedVersion(payload.current!.expected_state_version);
      payload.current = null;
      refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) payload.current = null;
      refresh();
    },
  });
  const ready: Record<Action, boolean> = {
    pause: ['running', 'awaiting_approval'].includes(run.state) && !!run.backend_cursor,
    resume: run.state === 'paused',
    cancel: !['cancelling', 'cancelled', 'succeeded', 'failed', 'finalizing'].includes(run.state),
  };
  return (
    <>
      <div className="run-actions" aria-label="執行操作">
        {(['pause', 'resume', 'cancel'] as const).map((action) => (
          <button
            key={action}
            type="button"
            disabled={
              !run.capabilities?.[action] ||
              control.isPending ||
              acceptedVersion === run.state_version ||
              (payload.current ? payload.current.action !== action : !ready[action])
            }
            onClick={() => control.mutate(action)}
            title={run.capabilities?.[action] ? labels[action] : '此版本尚未提供安全的操作流程'}
          >
            {labels[action]}
          </button>
        ))}
        {!run.capabilities?.approval && (
          <button type="button" disabled title="此版本尚未提供安全的操作流程">
            審批
          </button>
        )}
      </div>
      <p className="muted">
        {run.capabilities?.pause
          ? '暫停會等待目前操作結束，保留執行環境與原期限。繼續後仍遵守原本的審批設定。'
          : run.capabilities?.cancel
            ? '取消會停止本次執行。啟用審批的任務會顯示待核准操作。'
            : '此執行方式尚不支援暫停、繼續、取消與審批。'}
      </p>
      {run.state === 'pausing' && (
        <p className="notice" role="status">
          正在等待目前操作及背景程序結束；確認前仍保留容量，可取消本次執行。
        </p>
      )}
      {run.state === 'paused' && (
        <p className="notice" role="status">
          執行已暫停，環境與容量仍保留。到達原定期限後會停止並回收。
        </p>
      )}
      {run.state === 'resuming' && (
        <p className="notice" role="status">
          正在核對原執行環境並恢復；確認前仍保留容量，可取消本次執行。
        </p>
      )}
      {run.state === 'cancelling' && (
        <p className="notice" role="status">
          正在確認執行環境已停止；確認前仍保留容量。環境失聯時會繼續核對。
        </p>
      )}
      {control.isSuccess &&
        acceptedVersion === run.state_version &&
        !['pausing', 'paused', 'resuming', 'cancelling', 'cancelled'].includes(run.state) && (
          <p className="notice" role="status">
            {labels[control.variables!]}請求已送出，正在更新狀態…
          </p>
        )}
      {control.error && (
        <p className="error" role="alert">
          {errorText(control.error)}
          {payload.current && ` 請重試「${labels[payload.current.action]}」以確認原請求。`}
        </p>
      )}
    </>
  );
}
