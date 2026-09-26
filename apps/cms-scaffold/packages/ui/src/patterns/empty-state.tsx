import type { ReactNode } from "react";
import { InboxIcon } from "lucide-react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  testId?: string;
}

export function EmptyState({ title, description, action, testId = "empty-state" }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border bg-surface px-6 py-10 text-center" data-testid={testId}>
      <InboxIcon className="size-8 text-subdued" aria-hidden="true" />
      <h2 className="text-card-title">{title}</h2>
      {description ? <p className="text-subdued">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
