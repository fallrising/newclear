import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  mode: 'structured' | 'raw';
  onChange: (mode: 'structured' | 'raw') => void;
  structuredAvailable: boolean;
  className?: string;
};

export function JsonModeToggle({ mode, onChange, structuredAvailable, className }: Props) {
  return (
    <div className={cn('inline-flex overflow-hidden rounded-md border border-border text-xs', className)}>
      <Button
        type="button"
        size="sm"
        variant={mode === 'structured' ? 'default' : 'ghost'}
        onClick={() => onChange('structured')}
        disabled={!structuredAvailable}
        className="h-6 rounded-none px-2"
      >
        Structured
      </Button>
      <Button
        type="button"
        size="sm"
        variant={mode === 'raw' ? 'default' : 'ghost'}
        onClick={() => onChange('raw')}
        className="h-6 rounded-none px-2"
      >
        Raw JSON
      </Button>
    </div>
  );
}
