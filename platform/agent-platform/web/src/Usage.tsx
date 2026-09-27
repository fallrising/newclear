import { useQuery, useQueryClient } from '@tanstack/react-query';
import { request, type Usage } from './api';

export function usageQueryKey(runId: string) {
  return ['usage', runId] as const;
}

export function UsagePanel({ runId }: { runId: string }) {
  const usage = useQuery({
    queryKey: usageQueryKey(runId),
    queryFn: () => request<Usage>(`/runs/${runId}/usage`),
  });
  if (usage.isPending) return <p className="muted">正在讀取模型用量…</p>;
  if (usage.isError || !usage.data) return <p className="muted">目前讀不到模型用量。</p>;
  const view = usage.data;
  return (
    <section className="usage" aria-label="模型用量">
      <h3>模型用量</h3>
      {!view.configured ? (
        <p className="muted">這個執行沒有啟用模型用量。</p>
      ) : (
        <>
          <dl className="run-facts">
            <div>
              <dt>請求</dt>
              <dd>
                {view.request_slots_consumed}
                {view.request_limit != null ? ` / ${view.request_limit}` : ''}
              </dd>
            </div>
            <div>
              <dt>Guest 通道</dt>
              <dd>{view.guest_connected ? '已接通' : '尚未接通'}</dd>
            </div>
            <div>
              <dt>金額</dt>
              <dd>未知，不是帳單</dd>
            </div>
          </dl>
          {view.uncertain_requests > 0 && (
            <p className="muted">{view.uncertain_requests} 筆用量尚未確定，已保留額度。</p>
          )}
          {view.published_price_preview && (
            <p className="muted">
              公開價目演練{' '}
              {view.quote_uncertain ? '尚有未確定的報價' : (view.quote_committed_usd ?? '尚無結算')}
              。這不是帳戶帳單。
            </p>
          )}
          {view.fixture_credit_limit_supported && (
            <p className="muted">
              合成 credits{' '}
              {view.fixture_credits_uncertain
                ? '尚有未確定的預留'
                : (view.fixture_credits_committed_microcredits ?? 0)}
              。這不是真實金額。
            </p>
          )}
          {view.hard_money_limit_supported && (
            <p className="notice">硬金額上限已開啟。這個畫面仍不把未知金額顯示成帳單。</p>
          )}
        </>
      )}
    </section>
  );
}

export function refreshUsage(cache: ReturnType<typeof useQueryClient>, runId: string) {
  void cache.invalidateQueries({ queryKey: usageQueryKey(runId) });
}
