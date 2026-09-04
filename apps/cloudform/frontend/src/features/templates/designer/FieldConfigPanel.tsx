import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useUpsertFieldConfig } from './hooks';
import {
  COMPONENT_TYPES,
  FORM_TARGETS,
  VALUE_SOURCES,
  defaultDraftForTfField,
  fieldConfigUpdateSchema,
  warnMappingMismatch,
  type FieldConfigFormValues,
} from './fieldConfigSchema';
import type { FieldConfigResponse, TfFieldNode } from '@/types/api';
import { DataSourceEditor } from './jsonEditors/DataSourceEditor';
import { ValidationEditor } from './jsonEditors/ValidationEditor';
import { DependsOnEditor } from './jsonEditors/DependsOnEditor';

type Props = {
  templateId: string;
  selectedNode: TfFieldNode | null;
  selectedConfig: FieldConfigResponse | null;
  otherFieldKeys: string[];
};

function configToFormValues(c: FieldConfigResponse): FieldConfigFormValues {
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

export function FieldConfigPanel({ templateId, selectedNode, selectedConfig, otherFieldKeys }: Props) {
  const defaults = useMemo<FieldConfigFormValues | null>(() => {
    if (selectedConfig) return configToFormValues(selectedConfig);
    if (selectedNode) return defaultDraftForTfField(selectedNode);
    return null;
  }, [selectedConfig, selectedNode]);

  if (!defaults) {
    return (
      <section className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
        從左側選一個欄位開始配置
      </section>
    );
  }

  const formKey = selectedConfig?.id ?? `draft:${selectedNode?.tfPath ?? defaults.fieldKey}`;
  return (
    <FieldConfigForm
      key={formKey}
      templateId={templateId}
      defaults={defaults}
      otherFieldKeys={otherFieldKeys}
    />
  );
}

type FormProps = {
  templateId: string;
  defaults: FieldConfigFormValues;
  otherFieldKeys: string[];
};

function FieldConfigForm({ templateId, defaults, otherFieldKeys }: FormProps) {
  const upsert = useUpsertFieldConfig(templateId);
  const form = useForm<FieldConfigFormValues>({
    resolver: zodResolver(fieldConfigUpdateSchema) as never,
    defaultValues: defaults,
  });

  const watchedTarget = form.watch('formTarget');
  const watchedSource = form.watch('valueSource');
  const mismatch = warnMappingMismatch(watchedTarget, watchedSource);

  const onSubmit = form.handleSubmit((values) => {
    const parsed = fieldConfigUpdateSchema.parse(values);
    upsert.mutate(parsed);
  });

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm">{defaults.fieldKey}</span>
          {defaults.tfPath && (
            <span className="text-xs text-muted-foreground">tfPath: {defaults.tfPath}</span>
          )}
        </div>
      </header>

      <Form {...form}>
        <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
          <Tabs defaultValue="basic" className="flex flex-1 flex-col overflow-hidden">
            <TabsList className="mx-4 mt-3 grid w-fit grid-cols-4">
              <TabsTrigger value="basic">Basic</TabsTrigger>
              <TabsTrigger value="mapping">Mapping</TabsTrigger>
              <TabsTrigger value="component">Component</TabsTrigger>
              <TabsTrigger value="values">Values</TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto p-4">
              <TabsContent value="basic" className="space-y-4">
                <FormField
                  control={form.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display Name</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea {...field} value={field.value ?? ''} rows={3} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="groupKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Group Key</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ''} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="displayOrder"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Order</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            {...field}
                            value={field.value ?? 0}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              <TabsContent value="mapping" className="space-y-4">
                <FormField
                  control={form.control}
                  name="formTarget"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Form Target</FormLabel>
                      <FormControl>
                        <RadioGroup
                          value={field.value}
                          onValueChange={field.onChange}
                          className="grid grid-cols-2 gap-2"
                        >
                          {FORM_TARGETS.map((t) => (
                            <Label
                              key={t}
                              className="flex items-center gap-2 rounded border border-border p-2"
                            >
                              <RadioGroupItem value={t} />
                              <span className="text-sm">{t}</span>
                            </Label>
                          ))}
                        </RadioGroup>
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="valueSource"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Value Source</FormLabel>
                      <FormControl>
                        <RadioGroup
                          value={field.value}
                          onValueChange={field.onChange}
                          className="grid grid-cols-2 gap-2"
                        >
                          {VALUE_SOURCES.map((v) => (
                            <Label
                              key={v}
                              className="flex items-center gap-2 rounded border border-border p-2"
                            >
                              <RadioGroupItem value={v} />
                              <span className="text-sm">{v}</span>
                            </Label>
                          ))}
                        </RadioGroup>
                      </FormControl>
                    </FormItem>
                  )}
                />
                {mismatch && (
                  <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                    ⚠ {mismatch}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="required"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded border border-border p-2">
                        <FormLabel className="m-0">Required</FormLabel>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="editable"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded border border-border p-2">
                        <FormLabel className="m-0">Editable</FormLabel>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              <TabsContent value="component" className="space-y-4">
                <FormField
                  control={form.control}
                  name="componentType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Component Type</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {COMPONENT_TYPES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="fieldKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Field Key</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              <TabsContent value="values" className="space-y-3">
                {(['fixedValueJson', 'defaultValueJson'] as const).map((name) => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-mono text-xs">{name}</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            value={field.value ?? ''}
                            rows={3}
                            className="font-mono text-xs"
                            placeholder="JSON"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}

                <FormField
                  control={form.control}
                  name="dataSourceJson"
                  render={({ field }) => (
                    <DataSourceEditor value={field.value ?? null} onChange={field.onChange} />
                  )}
                />
                <FormField
                  control={form.control}
                  name="validationJson"
                  render={({ field }) => (
                    <ValidationEditor value={field.value ?? null} onChange={field.onChange} />
                  )}
                />
                <FormField
                  control={form.control}
                  name="dependsOnJson"
                  render={({ field }) => (
                    <DependsOnEditor
                      value={field.value ?? null}
                      onChange={field.onChange}
                      otherFieldKeys={otherFieldKeys}
                    />
                  )}
                />
              </TabsContent>
            </div>
          </Tabs>

          <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => defaults && form.reset(defaults)}
              disabled={!form.formState.isDirty || upsert.isPending}
            >
              Discard
            </Button>
            <Button type="submit" disabled={upsert.isPending}>
              {upsert.isPending ? 'Saving…' : 'Save'}
            </Button>
          </footer>
        </form>
      </Form>
    </section>
  );
}
