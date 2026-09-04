import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';

type Props = {
  value: string | null;
  onChange: (v: string | null) => void;
  rows?: number;
};

export function RawJsonInput({ value, onChange, rows = 5 }: Props) {
  const [error, setError] = useState<string | null>(null);

  function handleChange(next: string) {
    if (next.trim() === '') {
      setError(null);
      onChange(null);
      return;
    }
    try {
      JSON.parse(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    }
    onChange(next);
  }

  return (
    <div className="space-y-1">
      <Textarea
        value={value ?? ''}
        onChange={(e) => handleChange(e.target.value)}
        rows={rows}
        className="font-mono text-xs"
        placeholder="JSON"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
