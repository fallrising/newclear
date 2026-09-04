import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  dependsOnSchema,
  isValidJsonOfShape,
  parseOrNull,
  serialize,
} from './types';
import { JsonModeToggle } from './JsonModeToggle';
import { RawJsonInput } from './RawJsonInput';

type Props = {
  value: string | null;
  onChange: (v: string | null) => void;
  otherFieldKeys: string[];
};

export function DependsOnEditor({ value, onChange, otherFieldKeys }: Props) {
  const structuredOk = useMemo(() => isValidJsonOfShape(value, dependsOnSchema), [value]);
  const [mode, setMode] = useState<'structured' | 'raw'>(structuredOk ? 'structured' : 'raw');
  const selected = useMemo(() => parseOrNull(value, dependsOnSchema) ?? [], [value]);
  const [customInput, setCustomInput] = useState('');

  useEffect(() => {
    if (!structuredOk && mode === 'structured') setMode('raw');
  }, [structuredOk, mode]);

  function setSelected(next: string[]) {
    const dedup = Array.from(new Set(next.filter(Boolean)));
    onChange(serialize(dedup));
  }
  function toggle(key: string, on: boolean) {
    setSelected(on ? [...selected, key] : selected.filter((k) => k !== key));
  }
  function addCustom() {
    const k = customInput.trim();
    if (!k) return;
    setSelected([...selected, k]);
    setCustomInput('');
  }
  function remove(key: string) {
    setSelected(selected.filter((k) => k !== key));
  }

  const customSelected = selected.filter((k) => !otherFieldKeys.includes(k));

  return (
    <div className="space-y-2 rounded border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between">
        <Label className="font-mono text-xs">dependsOnJson</Label>
        <JsonModeToggle
          mode={mode}
          onChange={setMode}
          structuredAvailable={structuredOk}
        />
      </div>
      {mode === 'raw' ? (
        <RawJsonInput value={value} onChange={onChange} rows={3} />
      ) : (
        <div className="space-y-2">
          {otherFieldKeys.length > 0 ? (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">同模板的其他欄位</Label>
              <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto">
                {otherFieldKeys.map((k) => {
                  const on = selected.includes(k);
                  return (
                    <label key={k} className="flex items-center gap-1.5 text-xs">
                      <Checkbox
                        checked={on}
                        onCheckedChange={(c) => toggle(k, c === true)}
                      />
                      <span className="font-mono">{k}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">同模板尚無其他欄位可選</p>
          )}

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">手動加 fieldKey</Label>
            <div className="flex gap-2">
              <Input
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustom();
                  }
                }}
                placeholder="fieldKey"
                className="h-8 text-xs"
              />
              <Button type="button" size="sm" variant="outline" onClick={addCustom} className="h-8">
                加
              </Button>
            </div>
          </div>

          {customSelected.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {customSelected.map((k) => (
                <Badge key={k} variant="outline" className="gap-1 text-xs">
                  {k}
                  <button type="button" onClick={() => remove(k)}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
