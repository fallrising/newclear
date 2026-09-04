import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ChevronRight, Lock, CircleDot, Layers, Search, X, GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { FieldConfigResponse, TfFieldNode } from '@/types/api';

export type Selection =
  | { kind: 'tree'; tfPath: string; node: TfFieldNode }
  | { kind: 'unmapped'; fieldKey: string };

export const TREE_DRAGGABLE_PREFIX = 'tree:';
export function treeDraggableId(tfPath: string): string {
  return `${TREE_DRAGGABLE_PREFIX}${tfPath}`;
}

type Filters = {
  query: string;
  configuredOnly: boolean;
  requiredOnly: boolean;
  hideComputed: boolean;
};

type Props = {
  fields: TfFieldNode[];
  unmappedConfigs: FieldConfigResponse[];
  configuredTfPaths: Set<string>;
  selection: Selection | null;
  onSelect: (sel: Selection) => void;
};

function nodeMatches(node: TfFieldNode, configured: boolean, f: Filters): boolean {
  if (f.requiredOnly && !node.required) return false;
  if (f.hideComputed && node.computed) return false;
  if (f.configuredOnly && !configured) return false;
  if (f.query) {
    const q = f.query.toLowerCase();
    const hay = `${node.tfPath} ${node.description ?? ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

type VisibilityMap = {
  visible: Set<string>;
  direct: Set<string>;
};

function computeVisibility(
  nodes: TfFieldNode[],
  configured: Set<string>,
  f: Filters,
): VisibilityMap {
  const visible = new Set<string>();
  const direct = new Set<string>();

  function walk(node: TfFieldNode): boolean {
    let childHit = false;
    for (const child of node.children) {
      if (walk(child)) childHit = true;
    }
    const selfHit = !node.nestedBlock && nodeMatches(node, configured.has(node.tfPath), f);
    if (selfHit) direct.add(node.tfPath);
    if (selfHit || childHit) {
      visible.add(node.tfPath);
      return true;
    }
    return false;
  }
  nodes.forEach(walk);
  return { visible, direct };
}

function filtersActive(f: Filters): boolean {
  return !!f.query || f.configuredOnly || f.requiredOnly || f.hideComputed;
}

export function SchemaTreePanel({
  fields,
  unmappedConfigs,
  configuredTfPaths,
  selection,
  onSelect,
}: Props) {
  const [filters, setFilters] = useState<Filters>({
    query: '',
    configuredOnly: false,
    requiredOnly: false,
    hideComputed: false,
  });

  const visibility = useMemo(
    () => computeVisibility(fields, configuredTfPaths, filters),
    [fields, configuredTfPaths, filters],
  );

  const active = filtersActive(filters);

  const filteredUnmapped = useMemo(() => {
    const q = filters.query.toLowerCase();
    return unmappedConfigs.filter((cfg) => {
      if (filters.requiredOnly && !cfg.required) return false;
      // configuredOnly: unmapped are configs by definition — pass through
      if (q) {
        const hay = `${cfg.fieldKey} ${cfg.displayName ?? ''} ${cfg.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [unmappedConfigs, filters]);

  const treeEmpty = active && visibility.visible.size === 0;
  const unmappedEmpty = active && filteredUnmapped.length === 0;

  const totalLeaves = useMemo(() => {
    let n = 0;
    const walk = (node: TfFieldNode) => {
      if (!node.nestedBlock) n++;
      node.children.forEach(walk);
    };
    fields.forEach(walk);
    return n;
  }, [fields]);
  const matchedLeaves = visibility.direct.size;

  const resetFilters = () =>
    setFilters({ query: '', configuredOnly: false, requiredOnly: false, hideComputed: false });

  return (
    <aside className="flex h-full min-h-0 flex-col gap-3 overflow-hidden rounded-lg border border-border bg-card p-3">
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.query}
            onChange={(e) => setFilters((p) => ({ ...p, query: e.target.value }))}
            placeholder="搜索 tfPath / description"
            className="h-8 pl-7 pr-7 text-xs"
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => setFilters((p) => ({ ...p, query: '' }))}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
              aria-label="clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <FilterChip
            label="Configured"
            on={filters.configuredOnly}
            onClick={() => setFilters((p) => ({ ...p, configuredOnly: !p.configuredOnly }))}
          />
          <FilterChip
            label="Required"
            on={filters.requiredOnly}
            onClick={() => setFilters((p) => ({ ...p, requiredOnly: !p.requiredOnly }))}
          />
          <FilterChip
            label="Hide computed"
            on={filters.hideComputed}
            onClick={() => setFilters((p) => ({ ...p, hideComputed: !p.hideComputed }))}
          />
          {active && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={resetFilters}
              className="h-6 px-2 text-[11px]"
            >
              清除
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto pr-1">
        <div className="space-y-1">
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Schema Tree
            </h3>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {active ? `${matchedLeaves} / ${totalLeaves}` : totalLeaves}
            </span>
          </div>
          {treeEmpty ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">無符合的欄位</p>
          ) : (
            <ul className="space-y-0.5">
              {fields
                .filter((n) => !active || visibility.visible.has(n.tfPath))
                .map((node) => (
                  <TreeNode
                    key={node.tfPath}
                    node={node}
                    depth={0}
                    configuredTfPaths={configuredTfPaths}
                    selection={selection}
                    onSelect={onSelect}
                    visibility={visibility}
                    filterActive={active}
                  />
                ))}
            </ul>
          )}
        </div>

        {unmappedConfigs.length > 0 && (
          <div className="space-y-1 border-t border-border pt-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Unmapped Configs
              </h3>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {active ? `${filteredUnmapped.length} / ${unmappedConfigs.length}` : unmappedConfigs.length}
              </span>
            </div>
            {unmappedEmpty ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">無符合的配置</p>
            ) : (
              <ul className="space-y-0.5">
                {filteredUnmapped.map((cfg) => {
                  const sel =
                    selection?.kind === 'unmapped' && selection.fieldKey === cfg.fieldKey;
                  return (
                    <li key={cfg.id}>
                      <button
                        type="button"
                        onClick={() => onSelect({ kind: 'unmapped', fieldKey: cfg.fieldKey })}
                        className={cn(
                          'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent',
                          sel && 'bg-accent text-accent-foreground',
                        )}
                      >
                        <CircleDot className="h-3 w-3 text-emerald-500" />
                        <span className="truncate">{cfg.displayName || cfg.fieldKey}</span>
                        <span className="ml-auto truncate text-xs text-muted-foreground">
                          {cfg.fieldKey}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function DragHandle({ tfPath }: { tfPath: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: treeDraggableId(tfPath),
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={cn(
        'flex h-5 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground touch-none hover:bg-accent hover:text-foreground',
        isDragging && 'cursor-grabbing',
      )}
      aria-label={`drag ${tfPath}`}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );
}

function FilterChip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={on ? 'default' : 'outline'}
      onClick={onClick}
      className="h-6 px-2 text-[11px]"
    >
      {label}
    </Button>
  );
}

type NodeProps = {
  node: TfFieldNode;
  depth: number;
  configuredTfPaths: Set<string>;
  selection: Selection | null;
  onSelect: (sel: Selection) => void;
  visibility: VisibilityMap;
  filterActive: boolean;
};

function TreeNode({
  node,
  depth,
  configuredTfPaths,
  selection,
  onSelect,
  visibility,
  filterActive,
}: NodeProps) {
  const [userOpen, setUserOpen] = useState(depth < 1);
  const isNested = node.nestedBlock;
  const hasChildren = node.children.length > 0;
  const configured = configuredTfPaths.has(node.tfPath);
  const active = selection?.kind === 'tree' && selection.tfPath === node.tfPath;
  const leafLabel = node.tfPath.split('.').pop() ?? node.tfPath;
  const open = filterActive ? true : userOpen;
  const directMatch = visibility.direct.has(node.tfPath);

  const handleClick = () => {
    if (hasChildren && !filterActive) setUserOpen((v) => !v);
    if (!isNested) onSelect({ kind: 'tree', tfPath: node.tfPath, node });
  };

  return (
    <li>
      <div
        className={cn(
          'flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-accent',
          active && 'bg-accent text-accent-foreground',
          filterActive && !directMatch && !isNested && 'opacity-60',
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {!isNested && <DragHandle tfPath={node.tfPath} />}
        <button type="button" onClick={handleClick} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {hasChildren ? (
            <ChevronRight
              className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')}
            />
          ) : (
            <span className="inline-block w-3" />
          )}
          {configured && !isNested && <CircleDot className="h-3 w-3 shrink-0 text-emerald-500" />}
          {isNested && <Layers className="h-3 w-3 shrink-0 text-amber-500" />}
          <span className="truncate font-mono text-[13px]">{leafLabel}</span>
          {node.required && (
            <span className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
          )}
          {node.computed && <Lock className="ml-1 h-3 w-3 shrink-0 text-muted-foreground" />}
          <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
            {isNested ? node.nestingMode ?? 'block' : node.tfType}
          </Badge>
        </button>
      </div>
      {hasChildren && open && (
        <ul className="space-y-0.5">
          {node.children
            .filter((c) => !filterActive || visibility.visible.has(c.tfPath))
            .map((child) => (
              <TreeNode
                key={child.tfPath}
                node={child}
                depth={depth + 1}
                configuredTfPaths={configuredTfPaths}
                selection={selection}
                onSelect={onSelect}
                visibility={visibility}
                filterActive={filterActive}
              />
            ))}
        </ul>
      )}
    </li>
  );
}
