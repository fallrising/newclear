import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  isValidJsonOfShape,
  parseOrNull,
  serialize,
  validationSchema,
  type ValidationValue,
} from './types';
import { JsonModeToggle } from './JsonModeToggle';
import { RawJsonInput } from './RawJsonInput';

type Props = {
  value: string | null;
  onChange: (v: string | null) => void;
};

type FieldSpec = {
  key: keyof ValidationValue;
  label: string;
  type: 'number' | 'string';
  placeholder?: string;
  colSpan?: number;
};

const FIELDS: FieldSpec[] = [
  { key: 'minLength', label: 'minLength', type: 'number' },
  { key: 'maxLength', label: 'maxLength', type: 'number' },
  { key: 'min', label: 'min', type: 'number' },
  { key: 'max', label: 'max', type: 'number' },
  { key: 'pattern', label: 'pattern (regex)', type: 'string', placeholder: '^[a-z]+$', colSpan: 2 },
  {
    key: 'patternMessage',
    label: 'patternMessage',
    type: 'string',
    placeholder: '只能輸入小寫字母',
    colSpan: 2,
  },
];

export function ValidationEditor({ value, onChange }: Props) {
  const structuredOk = useMemo(() => isValidJsonOfShape(value, validationSchema), [value]);
  const [mode, setMode] = useState<'structured' | 'raw'>(structuredOk ? 'structured' : 'raw');
  const parsed = useMemo(() => parseOrNull(value, validationSchema) ?? {}, [value]);

  useEffect(() => {
    if (!structuredOk && mode === 'structured') setMode('raw');
  }, [structuredOk, mode]);

  function update(patch: Partial<ValidationValue>) {
    const next: ValidationValue = { ...parsed, ...patch };
    (Object.keys(next) as Array<keyof ValidationValue>).forEach((k) => {
      const v = next[k];
      if (v === undefined || v === null || v === '') delete next[k];
    });
    onChange(serialize(next));
  }

  return (
    <div className="space-y-2 rounded border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between">
        <Label className="font-mono text-xs">validationJson</Label>
        <JsonModeToggle
          mode={mode}
          onChange={setMode}
          structuredAvailable={structuredOk}
        />
      </div>
      {mode === 'raw' ? (
        <RawJsonInput value={value} onChange={onChange} />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {FIELDS.map((f) => {
            const raw = parsed[f.key];
            const display = raw == null ? '' : String(raw);
            return (
              <div
                key={f.key}
                className={f.colSpan === 2 ? 'col-span-2 space-y-1' : 'space-y-1'}
              >
                <Label className="text-xs text-muted-foreground">{f.label}</Label>
                <Input
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={display}
                  placeholder={f.placeholder}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') update({ [f.key]: undefined } as Partial<ValidationValue>);
                    else if (f.type === 'number')
                      update({ [f.key]: Number(v) } as Partial<ValidationValue>);
                    else update({ [f.key]: v } as Partial<ValidationValue>);
                  }}
                  className="h-8 text-xs"
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
