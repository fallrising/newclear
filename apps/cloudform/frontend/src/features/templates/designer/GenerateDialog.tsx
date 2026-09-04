import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { GenerationResponse } from '@/types/api';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: GenerationResponse | null;
};

export function GenerateDialog({ open, onOpenChange, result }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>生成結果</DialogTitle>
          <DialogDescription>
            FormConfig JSON 已寫入 template；TF 模板與 Required APIs 僅在本次回應中。
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <Tabs defaultValue="formConfig" className="flex flex-col gap-3">
            <TabsList className="grid w-fit grid-cols-3">
              <TabsTrigger value="formConfig">Form Config</TabsTrigger>
              <TabsTrigger value="tf">TF Template</TabsTrigger>
              <TabsTrigger value="apis">Required APIs</TabsTrigger>
            </TabsList>
            <TabsContent value="formConfig">
              <CodeBlock content={JSON.stringify(result.formConfig, null, 2)} language="json" />
            </TabsContent>
            <TabsContent value="tf">
              <CodeBlock content={result.terraformTemplate} language="hcl" />
            </TabsContent>
            <TabsContent value="apis">
              <ApiList apis={result.requiredApis} />
            </TabsContent>
          </Tabs>
        ) : (
          <p className="text-sm text-muted-foreground">尚未生成</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CodeBlock({ content, language }: { content: string; language: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <div className="relative">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={copy}
        className="absolute right-2 top-2 z-10 h-7 gap-1 text-xs"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed">
        <code data-lang={language}>{content}</code>
      </pre>
    </div>
  );
}

function ApiList({ apis }: { apis: GenerationResponse['requiredApis'] }) {
  if (apis.length === 0) {
    return <p className="text-sm text-muted-foreground">沒有 API 依賴</p>;
  }
  return (
    <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="border-b border-border bg-muted/40 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Method</th>
            <th className="px-3 py-2 font-medium">Path</th>
            <th className="px-3 py-2 font-medium">Params</th>
            <th className="px-3 py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {apis.map((a) => (
            <tr key={a.method + a.path} className="border-b border-border/50 last:border-0">
              <td className="px-3 py-2 font-mono">{a.method}</td>
              <td className="px-3 py-2 font-mono">{a.path}</td>
              <td className="px-3 py-2">
                {a.params.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {a.params.map((p) => (
                      <Badge key={p} variant="outline" className="font-mono text-[10px]">
                        {p}
                      </Badge>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{a.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
