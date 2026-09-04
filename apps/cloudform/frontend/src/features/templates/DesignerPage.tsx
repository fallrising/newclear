import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/layout/Header';
import { GenerateDialog } from './designer/GenerateDialog';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import {
  SchemaTreePanel,
  TREE_DRAGGABLE_PREFIX,
  type Selection,
} from './designer/SchemaTreePanel';
import { FieldConfigPanel } from './designer/FieldConfigPanel';
import {
  BucketsPanel,
  bucketDroppableId,
  parseBucketItemId,
} from './designer/BucketsPanel';
import {
  useBatchUpsertFieldConfig,
  useFieldConfigs,
  useGenerate,
  useSchemaTree,
  useTemplate,
} from './designer/hooks';
import { defaultDraftForTfField } from './designer/fieldConfigSchema';
import type {
  CloudProvider,
  FieldConfigResponse,
  FieldConfigUpdateRequest,
  FormTarget,
  GenerationResponse,
  SchemaSourceItem,
  TfFieldNode,
} from '@/types/api';

const PROVIDER_TO_SCHEMA: Record<CloudProvider, string> = {
  ALIYUN: 'alicloud',
  AWS: 'aws',
};

function flattenLeafTfPaths(nodes: TfFieldNode[]): Map<string, TfFieldNode> {
  const map = new Map<string, TfFieldNode>();
  function walk(node: TfFieldNode) {
    if (!node.nestedBlock) map.set(node.tfPath, node);
    node.children.forEach(walk);
  }
  nodes.forEach(walk);
  return map;
}

function toUpdateRequest(c: FieldConfigResponse): FieldConfigUpdateRequest {
  return {
    fieldKey: c.fieldKey,
    tfPath: c.tfPath,
    displayName: c.displayName,
    description: c.description,
    groupKey: c.groupKey,
    formTarget: c.formTarget,
    valueSource: c.valueSource,
    componentType: c.componentType,
    required: c.required,
    editable: c.editable,
    displayOrder: c.displayOrder,
    fixedValueJson: c.fixedValueJson,
    defaultValueJson: c.defaultValueJson,
    dataSourceJson: c.dataSourceJson,
    validationJson: c.validationJson,
    dependsOnJson: c.dependsOnJson,
  };
}

function parseDropTarget(overId: string | null): FormTarget | null {
  if (!overId) return null;
  if (overId.startsWith('bucket:')) {
    return overId.slice('bucket:'.length) as FormTarget;
  }
  const item = parseBucketItemId(overId);
  return item?.target ?? null;
}

type DragSource =
  | { kind: 'tree'; tfPath: string }
  | { kind: 'bucket'; target: FormTarget; fieldKey: string };

function parseDragSource(activeId: string): DragSource | null {
  if (activeId.startsWith(TREE_DRAGGABLE_PREFIX)) {
    return { kind: 'tree', tfPath: activeId.slice(TREE_DRAGGABLE_PREFIX.length) };
  }
  const item = parseBucketItemId(activeId);
  if (item) return { kind: 'bucket', target: item.target, fieldKey: item.fieldKey };
  return null;
}

export function DesignerPage() {
  const { id } = useParams<{ id: string }>();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [generationResult, setGenerationResult] = useState<GenerationResponse | null>(null);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);

  const templateQ = useTemplate(id);
  const template = templateQ.data;

  const schemaProvider = template ? PROVIDER_TO_SCHEMA[template.cloudProvider] : null;

  const sourcesQ = useQuery({
    queryKey: queryKeys.schemas.sources(),
    enabled: !!template && !template.tfProviderVersion,
    queryFn: async () => {
      const { data } = await api.get<SchemaSourceItem[]>('/tf-schemas');
      return data;
    },
  });

  const effectiveVersion = useMemo(() => {
    if (template?.tfProviderVersion) return template.tfProviderVersion;
    if (!schemaProvider || !sourcesQ.data) return null;
    return sourcesQ.data.find((s) => s.provider === schemaProvider)?.version ?? null;
  }, [template?.tfProviderVersion, schemaProvider, sourcesQ.data]);

  const treeQ = useSchemaTree(schemaProvider, effectiveVersion, template?.tfResourceName);
  const fieldsQ = useFieldConfigs(id);

  const tree = treeQ.data?.fields ?? [];
  const fields = fieldsQ.data ?? [];

  const leafIndex = useMemo(() => flattenLeafTfPaths(tree), [tree]);

  const configuredTfPaths = useMemo(
    () => new Set(fields.filter((f) => f.tfPath != null).map((f) => f.tfPath as string)),
    [fields],
  );

  const unmappedConfigs = useMemo(() => fields.filter((f) => f.tfPath == null), [fields]);

  const selectedConfig: FieldConfigResponse | null = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === 'unmapped') {
      return fields.find((f) => f.fieldKey === selection.fieldKey) ?? null;
    }
    const matches = fields.filter((f) => f.tfPath === selection.tfPath);
    if (matches.length === 0) return null;
    return matches.find((m) => m.fieldKey === selection.tfPath) ?? matches[0]!;
  }, [selection, fields]);

  const selectedNode: TfFieldNode | null = useMemo(() => {
    if (selection?.kind !== 'tree') return null;
    return selection.node ?? leafIndex.get(selection.tfPath) ?? null;
  }, [selection, leafIndex]);

  const currentFieldKey = selectedConfig?.fieldKey ?? null;
  const otherFieldKeys = useMemo(
    () => fields.map((f) => f.fieldKey).filter((k) => k !== currentFieldKey),
    [fields, currentFieldKey],
  );

  const batchUpsert = useBatchUpsertFieldConfig(id);
  const generate = useGenerate(id);

  function handleGenerate() {
    generate.mutate(undefined, {
      onSuccess: (data) => {
        setGenerationResult(data);
        setGenerateDialogOpen(true);
      },
    });
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function selectFieldByKey(fieldKey: string) {
    const cfg = fields.find((f) => f.fieldKey === fieldKey);
    if (!cfg) return;
    if (cfg.tfPath) {
      const node = leafIndex.get(cfg.tfPath);
      if (node) setSelection({ kind: 'tree', tfPath: cfg.tfPath, node });
      else setSelection({ kind: 'unmapped', fieldKey });
    } else {
      setSelection({ kind: 'unmapped', fieldKey });
    }
  }

  function onDragStart(e: DragStartEvent) {
    const src = parseDragSource(String(e.active.id));
    if (!src) return setDragLabel(null);
    if (src.kind === 'tree') setDragLabel(src.tfPath);
    else {
      const cfg = fields.find((f) => f.fieldKey === src.fieldKey);
      setDragLabel(cfg?.displayName || src.fieldKey);
    }
  }

  function onDragEnd(e: DragEndEvent) {
    setDragLabel(null);
    const src = parseDragSource(String(e.active.id));
    if (!src) return;
    const overId = e.over ? String(e.over.id) : null;
    const target = parseDropTarget(overId);
    if (!target) return;

    const overItem = overId ? parseBucketItemId(overId) : null;
    const beforeKey = overItem && overItem.fieldKey !== (src.kind === 'bucket' ? src.fieldKey : '')
      ? overItem.fieldKey
      : undefined;

    let payload: FieldConfigUpdateRequest | null;
    if (src.kind === 'tree') {
      payload = buildFromTree(src.tfPath, target);
    } else {
      payload = buildFromExisting(src.fieldKey, target);
    }
    if (!payload) return;

    // No-op guards: same bucket, no specific position change
    if (src.kind === 'bucket' && src.target === target && !beforeKey) return;

    insertIntoBucket(payload, target, beforeKey);
  }

  function buildFromTree(tfPath: string, target: FormTarget): FieldConfigUpdateRequest | null {
    const existing = fields.find((f) => f.tfPath === tfPath);
    if (existing) {
      const r = toUpdateRequest(existing);
      r.formTarget = target;
      return r;
    }
    const node = leafIndex.get(tfPath);
    if (!node) return null;
    const draft = defaultDraftForTfField(node);
    draft.formTarget = target;
    draft.valueSource =
      target === 'HIDDEN' ? 'FIXED' : target === 'OPS_FORM' ? 'OPS_INPUT' : 'USER_INPUT';
    return {
      ...draft,
      tfPath: draft.tfPath ?? null,
      displayName: draft.displayName ?? null,
      description: draft.description ?? null,
      groupKey: draft.groupKey ?? null,
      fixedValueJson: null,
      defaultValueJson: null,
      dataSourceJson: null,
      validationJson: null,
      dependsOnJson: null,
    };
  }

  function buildFromExisting(fieldKey: string, target: FormTarget): FieldConfigUpdateRequest | null {
    const cfg = fields.find((f) => f.fieldKey === fieldKey);
    if (!cfg) return null;
    const r = toUpdateRequest(cfg);
    r.formTarget = target;
    return r;
  }

  function insertIntoBucket(
    incoming: FieldConfigUpdateRequest,
    target: FormTarget,
    beforeKey: string | undefined,
  ) {
    const targetItems = fields
      .filter((f) => f.formTarget === target && f.fieldKey !== incoming.fieldKey)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(toUpdateRequest);

    const insertIdx = beforeKey ? targetItems.findIndex((it) => it.fieldKey === beforeKey) : -1;
    if (insertIdx >= 0) targetItems.splice(insertIdx, 0, incoming);
    else targetItems.push(incoming);

    const ordered = targetItems.map((it, i) => ({ ...it, displayOrder: i + 1 }));
    batchUpsert.mutate(ordered, { onSuccess: () => selectFieldByKey(incoming.fieldKey) });
  }

  if (templateQ.isLoading) {
    return <DesignerStatus message="載入模板中…" />;
  }
  if (templateQ.error || !template) {
    return <DesignerStatus message="模板載入失敗" />;
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <Header
        title={template.displayName}
        description={`${template.cloudProvider} · ${template.tfResourceName}`}
        actions={
          <>
            <Badge variant="outline">{template.status}</Badge>
            <Button
              type="button"
              size="sm"
              onClick={handleGenerate}
              disabled={generate.isPending}
            >
              {generate.isPending ? 'Generating…' : 'Generate'}
            </Button>
          </>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_320px] gap-4 overflow-hidden p-4">
        {treeQ.isLoading || fieldsQ.isLoading ? (
          <Card className="p-4 text-sm text-muted-foreground">載入 Schema…</Card>
        ) : treeQ.error ? (
          <Card className="p-4 text-sm text-destructive">Schema 載入失敗</Card>
        ) : (
          <SchemaTreePanel
            fields={tree}
            unmappedConfigs={unmappedConfigs}
            configuredTfPaths={configuredTfPaths}
            selection={selection}
            onSelect={setSelection}
          />
        )}

        <FieldConfigPanel
          templateId={id!}
          selectedNode={selectedNode}
          selectedConfig={selectedConfig}
          otherFieldKeys={otherFieldKeys}
        />

        <BucketsPanel
          fields={fields}
          selectedFieldKey={selectedConfig?.fieldKey ?? null}
          onSelectField={selectFieldByKey}
        />
      </div>
      <DragOverlay>
        {dragLabel && (
          <div className="rounded border border-border bg-card px-2 py-1 text-xs shadow-lg">
            {dragLabel}
          </div>
        )}
      </DragOverlay>
      <GenerateDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
        result={generationResult}
      />
    </DndContext>
  );
}

function DesignerStatus({ message }: { message: string }) {
  return (
    <>
      <Header title="表單設計器" />
      <div className="flex-1 p-8 text-sm text-muted-foreground">{message}</div>
    </>
  );
}
