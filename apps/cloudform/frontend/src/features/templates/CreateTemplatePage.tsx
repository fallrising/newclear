import { Header } from '@/components/layout/Header';

export function CreateTemplatePage() {
  return (
    <>
      <Header title="新增模板" description="選擇 Provider / Version / Resource（Phase 2 實作）" />
      <div className="flex-1 p-8">
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          建立流程將整合 TF Schema 選擇器，Phase 2 再實作。
        </div>
      </div>
    </>
  );
}
