export const taskStateNames: Record<string, string> = {
  queued: '排隊中',
  provisioning: '準備環境',
  running: '執行中',
  finalizing: '保存結果',
  succeeded: '已完成',
  failed: '失敗',
  interrupted: '需要處理',
  pausing: '正在暫停',
  paused: '已暫停',
  resuming: '正在恢復',
  cancelled: '已取消',
  cancelling: '正在取消',
  awaiting_approval: '等待審批',
};

export type TaskFilters = { q: string; project_id: string; state: string };
const ownedKeys = ['q', 'project_id', 'state'] as const;
const emptyFilters = (): TaskFilters => ({ q: '', project_id: '', state: '' });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readTaskLocation(search: string): { filters: TaskFilters; invalid: boolean } {
  const params = new URLSearchParams(search);
  const q = params.get('q') ?? '';
  const project = params.get('project_id');
  const state = params.get('state');
  if (
    ownedKeys.some((key) => params.getAll(key).length > 1) ||
    [...q].length > 200 ||
    q.includes('\0') ||
    (project !== null && !uuid.test(project)) ||
    (state !== null && !Object.hasOwn(taskStateNames, state))
  )
    return { filters: emptyFilters(), invalid: true };
  return {
    filters: { q: q.trim(), project_id: project?.toLowerCase() ?? '', state: state ?? '' },
    invalid: false,
  };
}

export function taskLocationHref(href: string, filters: TaskFilters): string {
  const url = new URL(href);
  for (const key of ownedKeys) {
    url.searchParams.delete(key);
    if (filters[key]) url.searchParams.set(key, filters[key]);
  }
  return url.pathname + url.search + url.hash;
}
