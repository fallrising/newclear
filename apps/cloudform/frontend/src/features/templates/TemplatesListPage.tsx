import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Database, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { Header } from '@/components/layout/Header';
import type { PageResponse, TemplateStatus, TemplateSummary } from '@/types/api';

const STATUS_STYLES: Record<TemplateStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PUBLISHED: 'bg-primary/20 text-primary',
  ARCHIVED: 'bg-destructive/20 text-destructive',
};

const STATUS_LABEL: Record<TemplateStatus, string> = {
  DRAFT: '草稿',
  PUBLISHED: '已發布',
  ARCHIVED: '已歸檔',
};

function StatusBadge({ status }: { status: TemplateStatus }) {
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_STYLES[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function TemplatesListPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.templates.list(),
    queryFn: async () => {
      const resp = await api.get<PageResponse<TemplateSummary>>('/templates');
      return resp.data;
    },
  });

  return (
    <>
      <Header
        title="資源模板"
        description="OPs 配置好的雲資源模板，供使用者申請"
        actions={
          <Link
            to="/templates/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-smooth"
          >
            <Plus className="size-4" /> 新增模板
          </Link>
        }
      />

      <div className="flex-1 p-8">
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-32 rounded-lg" />
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            無法載入模板列表：{(error as Error).message}
          </div>
        )}

        {data && data.content.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <Database className="mx-auto size-12 text-muted-foreground/60" />
            <p className="mt-3 text-muted-foreground">還沒有任何模板</p>
            <Link
              to="/templates/new"
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="size-4" /> 建立第一個模板
            </Link>
          </div>
        )}

        {data && data.content.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.content.map((t) => (
              <Link
                key={t.id}
                to={`/templates/${t.id}/design`}
                className="card-hover glass rounded-lg p-5 block"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider">
                      {t.cloudProvider} · {t.resourceType}
                    </div>
                    <h3 className="mt-1 text-base font-semibold">{t.displayName}</h3>
                  </div>
                  <StatusBadge status={t.status} />
                </div>
                <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
                  {t.description ?? '無描述'}
                </p>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <code className="bg-muted/40 px-1.5 py-0.5 rounded">{t.tfResourceName}</code>
                  {t.tfProviderVersion && <span>v{t.tfProviderVersion}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
