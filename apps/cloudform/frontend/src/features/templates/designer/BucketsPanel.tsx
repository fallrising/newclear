import { useMemo } from 'react';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { FieldConfigResponse, FormTarget } from '@/types/api';

export const BUCKETS: { target: FormTarget; label: string; hint: string }[] = [
  { target: 'USER_FORM', label: 'User Form', hint: '業務使用者填寫的欄位' },
  { target: 'OPS_FORM', label: 'OPs Form', hint: '含 User Form 欄位 + OPs 補充項' },
  { target: 'HIDDEN', label: 'Hidden', hint: '不顯示，由 FIXED / SYSTEM_DEFAULT 給值' },
];

export function bucketDroppableId(target: FormTarget): string {
  return `bucket:${target}`;
}
export function bucketItemId(target: FormTarget, fieldKey: string): string {
  return `${target}:${fieldKey}`;
}
export function parseBucketItemId(id: string): { target: FormTarget; fieldKey: string } | null {
  const m = /^(USER_FORM|OPS_FORM|HIDDEN|RESULT_ONLY):(.+)$/.exec(id);
  if (!m) return null;
  return { target: m[1] as FormTarget, fieldKey: m[2]! };
}

type Props = {
  fields: FieldConfigResponse[];
  selectedFieldKey: string | null;
  onSelectField: (fieldKey: string) => void;
};

export function BucketsPanel({ fields, selectedFieldKey, onSelectField }: Props) {
  const byBucket = useMemo(() => {
    const grouped: Record<FormTarget, FieldConfigResponse[]> = {
      USER_FORM: [],
      OPS_FORM: [],
      HIDDEN: [],
      RESULT_ONLY: [],
    };
    for (const f of fields) grouped[f.formTarget]?.push(f);
    for (const t of Object.keys(grouped) as FormTarget[]) {
      grouped[t].sort((a, b) => a.displayOrder - b.displayOrder);
    }
    return grouped;
  }, [fields]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      {BUCKETS.map((b) => (
        <BucketColumn
          key={b.target}
          target={b.target}
          label={b.label}
          hint={b.hint}
          items={byBucket[b.target]}
          selectedFieldKey={selectedFieldKey}
          onSelectField={onSelectField}
        />
      ))}
    </div>
  );
}

type BucketProps = {
  target: FormTarget;
  label: string;
  hint: string;
  items: FieldConfigResponse[];
  selectedFieldKey: string | null;
  onSelectField: (fieldKey: string) => void;
};

function BucketColumn({ target, label, hint, items, selectedFieldKey, onSelectField }: BucketProps) {
  const { setNodeRef, isOver } = useDroppable({ id: bucketDroppableId(target) });
  const itemIds = items.map((it) => bucketItemId(target, it.fieldKey));

  return (
    <Card
      ref={setNodeRef}
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3 transition-colors',
        isOver && 'border-primary bg-primary/5',
      )}
    >
      <div className="flex items-baseline justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </h3>
          <p className="text-[10px] text-muted-foreground">{hint}</p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {items.length}
        </Badge>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {items.length === 0 && (
              <li className="rounded border border-dashed border-border px-2 py-3 text-center text-[11px] text-muted-foreground">
                拖欄位過來
              </li>
            )}
            {items.map((it) => (
              <BucketItem
                key={it.fieldKey}
                target={target}
                config={it}
                selected={selectedFieldKey === it.fieldKey}
                onSelect={() => onSelectField(it.fieldKey)}
              />
            ))}
          </ul>
        </SortableContext>
      </div>
    </Card>
  );
}

function BucketItem({
  target,
  config,
  selected,
  onSelect,
}: {
  target: FormTarget;
  config: FieldConfigResponse;
  selected: boolean;
  onSelect: () => void;
}) {
  const id = bucketItemId(target, config.fieldKey);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const { over, active } = useDndContext();
  const showInsertLine =
    !!over && over.id === id && active?.id !== id && !isDragging;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1.5 text-xs',
        selected && 'border-primary bg-accent',
        isDragging && 'opacity-50',
        showInsertLine && 'before:absolute before:-top-1 before:left-0 before:right-0 before:h-0.5 before:rounded-full before:bg-primary',
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
        aria-label="drag handle"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-1 items-center gap-1.5 text-left"
      >
        <span className="truncate">{config.displayName || config.fieldKey}</span>
        <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
          {config.fieldKey}
        </span>
      </button>
    </li>
  );
}
