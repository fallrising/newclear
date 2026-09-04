import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  dataSourceSchema,
  isValidJsonOfShape,
  parseOrNull,
  serialize,
  type DataSourceValue,
} from './types';
import { JsonModeToggle } from './JsonModeToggle';
import { RawJsonInput } from './RawJsonInput';

type Props = {
  value: string | null;
  onChange: (v: string | null) => void;
};

const DEFAULT_STATIC: DataSourceValue = { type: 'STATIC', options: [] };
const DEFAULT_API: DataSourceValue = {
  type: 'API',
  endpoint: '',
  method: 'GET',
  params: {},
  responseMapping: { labelField: '', valueField: '' },
};

export function DataSourceEditor({ value, onChange }: Props) {
  const structuredOk = useMemo(() => isValidJsonOfShape(value, dataSourceSchema), [value]);
  const [mode, setMode] = useState<'structured' | 'raw'>(structuredOk ? 'structured' : 'raw');
  const parsed = useMemo(() => parseOrNull(value, dataSourceSchema), [value]);

  useEffect(() => {
    if (!structuredOk && mode === 'structured') setMode('raw');
  }, [structuredOk, mode]);

  function setStructured(next: DataSourceValue) {
    onChange(serialize(next));
  }

  return (
    <div className="space-y-2 rounded border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between">
        <Label className="font-mono text-xs">dataSourceJson</Label>
        <JsonModeToggle
          mode={mode}
          onChange={setMode}
          structuredAvailable={structuredOk}
        />
      </div>
      {mode === 'raw' ? (
        <RawJsonInput value={value} onChange={onChange} />
      ) : parsed ? (
        parsed.type === 'STATIC' ? (
          <StaticEditor value={parsed} onChange={setStructured} />
        ) : (
          <ApiEditor value={parsed} onChange={setStructured} />
        )
      ) : (
        <TypePicker
          onPick={(type) => setStructured(type === 'STATIC' ? DEFAULT_STATIC : DEFAULT_API)}
        />
      )}
    </div>
  );
}

function TypePicker({ onPick }: { onPick: (t: 'STATIC' | 'API') => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">尚未配置，選擇來源類型：</span>
      <Button type="button" size="sm" variant="outline" onClick={() => onPick('STATIC')}>
        STATIC
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => onPick('API')}>
        API
      </Button>
    </div>
  );
}

function StaticEditor({
  value,
  onChange,
}: {
  value: Extract<DataSourceValue, { type: 'STATIC' }>;
  onChange: (v: DataSourceValue) => void;
}) {
  function updateOption(i: number, patch: Partial<{ label: string; value: string }>) {
    const next = value.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o));
    onChange({ ...value, options: next });
  }
  function addOption() {
    onChange({ ...value, options: [...value.options, { label: '', value: '' }] });
  }
  function removeOption(i: number) {
    onChange({ ...value, options: value.options.filter((_, idx) => idx !== i) });
  }
  function switchType() {
    onChange(DEFAULT_API);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">STATIC · 固定選項</span>
        <Button type="button" size="sm" variant="ghost" onClick={switchType}>
          切換到 API
        </Button>
      </div>
      <div className="space-y-1.5">
        {value.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              placeholder="label"
              value={opt.label}
              onChange={(e) => updateOption(i, { label: e.target.value })}
              className="h-8 text-xs"
            />
            <Input
              placeholder="value"
              value={opt.value}
              onChange={(e) => updateOption(i, { value: e.target.value })}
              className="h-8 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => removeOption(i)}
              className="h-8 w-8 shrink-0 p-0"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={addOption} className="h-7">
          <Plus className="mr-1 h-3 w-3" /> 加一個選項
        </Button>
      </div>
    </div>
  );
}

function ApiEditor({
  value,
  onChange,
}: {
  value: Extract<DataSourceValue, { type: 'API' }>;
  onChange: (v: DataSourceValue) => void;
}) {
  const params = value.params ?? {};
  const paramEntries = Object.entries(params);

  function patch(p: Partial<typeof value>) {
    onChange({ ...value, ...p });
  }
  function setParam(key: string, val: string, oldKey?: string) {
    const next = { ...params };
    if (oldKey && oldKey !== key) delete next[oldKey];
    next[key] = val;
    patch({ params: next });
  }
  function deleteParam(key: string) {
    const next = { ...params };
    delete next[key];
    patch({ params: next });
  }
  function addParam() {
    patch({ params: { ...params, '': '' } });
  }
  function switchType() {
    onChange(DEFAULT_STATIC);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">API · 動態請求</span>
        <Button type="button" size="sm" variant="ghost" onClick={switchType}>
          切換到 STATIC
        </Button>
      </div>
      <div className="grid grid-cols-[80px_1fr] items-center gap-2">
        <Select value={value.method} onValueChange={(m) => patch({ method: m as typeof value.method })}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['GET', 'POST', 'PUT', 'DELETE'] as const).map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="endpoint, e.g. /api/v1/cloud/aliyun/regions"
          value={value.endpoint}
          onChange={(e) => patch({ endpoint: e.target.value })}
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">params (支援 ${'{fieldKey}'} 插值)</Label>
        {paramEntries.map(([k, v], i) => (
          <div key={`${k}-${i}`} className="flex items-center gap-2">
            <Input
              placeholder="key"
              defaultValue={k}
              onBlur={(e) => setParam(e.target.value, v, k)}
              className="h-8 text-xs"
            />
            <Input
              placeholder="value"
              value={v}
              onChange={(e) => setParam(k, e.target.value)}
              className="h-8 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => deleteParam(k)}
              className="h-8 w-8 shrink-0 p-0"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={addParam} className="h-7">
          <Plus className="mr-1 h-3 w-3" /> 加 param
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">responseMapping</Label>
        <div className="grid grid-cols-3 gap-2">
          <Input
            placeholder="labelField"
            value={value.responseMapping.labelField}
            onChange={(e) =>
              patch({ responseMapping: { ...value.responseMapping, labelField: e.target.value } })
            }
            className="h-8 text-xs"
          />
          <Input
            placeholder="valueField"
            value={value.responseMapping.valueField}
            onChange={(e) =>
              patch({ responseMapping: { ...value.responseMapping, valueField: e.target.value } })
            }
            className="h-8 text-xs"
          />
          <Input
            placeholder="descriptionField (optional)"
            value={value.responseMapping.descriptionField ?? ''}
            onChange={(e) =>
              patch({
                responseMapping: {
                  ...value.responseMapping,
                  descriptionField: e.target.value || undefined,
                },
              })
            }
            className="h-8 text-xs"
          />
        </div>
      </div>
    </div>
  );
}
