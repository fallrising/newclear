import { useState } from "react";
import { Controller, type Control } from "react-hook-form";
import Markdown from "react-markdown";
import type { WorkField } from "@cms/api";
import {
  Alert,
  AlertDescription,
  Button,
  Calendar,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@cms/ui";
import { fieldsCopy, type FieldsCopyKey } from "./copy";
import { formatDate } from "./format";
import { isKnown, type FormValues } from "./form";
import { enumLabel, fieldLabel } from "./labels";
import { MediaValue, RefValue } from "./values";

const NONE = "__none__";
/** 01 §6.4: enums with up to five options use radio buttons, more use a select. */
export const RADIO_LIMIT = 5;

export interface FieldWidgetProps {
  field: WorkField;
  control: Control<FormValues>;
  disabled?: boolean;
}

function errorText(message: string | undefined): string | null {
  if (!message) return null;
  const key = `fields.error.${message}` as FieldsCopyKey;
  return fieldsCopy[key] ?? fieldsCopy["fields.error.WRONG_TYPE"];
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Local date + local time → UTC ISO string (01 §6.4, fixes C-09 for the editor). */
function combine(date: Date, time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h || 0, m || 0).toISOString();
}

function DatetimeWidget({ id, value, onChange, disabled, required, invalid, described }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean; required: boolean; invalid: boolean; described?: string }) {
  const [open, setOpen] = useState(false);
  const current = value && !Number.isNaN(Date.parse(value)) ? new Date(value) : null;
  const time = current ? `${pad(current.getHours())}:${pad(current.getMinutes())}` : "";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" id={id} aria-invalid={invalid} aria-describedby={described} variant="outline" disabled={disabled} className="min-w-40 justify-start font-normal" data-testid={`${id}-date`}>
            {current ? formatDate(current) : fieldsCopy["fields.datetime.pick"]}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={current ?? undefined}
            defaultMonth={current ?? undefined}
            onSelect={(day) => {
              if (day) onChange(combine(day, time || "00:00"));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <Input
        type="time"
        aria-invalid={invalid}
        aria-describedby={described}
        aria-label={fieldsCopy["fields.datetime.time"]}
        className="w-32"
        value={time}
        disabled={disabled || !current}
        onChange={(event) => current && onChange(combine(current, event.target.value))}
        data-testid={`${id}-time`}
      />
      {!required && current ? (
        <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange("")}>
          {fieldsCopy["fields.datetime.clear"]}
        </Button>
      ) : null}
    </div>
  );
}

function MarkdownWidget({ id, value, onChange, disabled, invalid, described }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean; invalid: boolean; described?: string }) {
  return (
    <Tabs defaultValue="edit">
      <TabsList>
        <TabsTrigger value="edit">{fieldsCopy["fields.markdown.edit"]}</TabsTrigger>
        <TabsTrigger value="preview" data-testid={`${id}-preview-tab`}>{fieldsCopy["fields.markdown.preview"]}</TabsTrigger>
      </TabsList>
      <TabsContent value="edit">
        <Textarea id={id} value={value} disabled={disabled} aria-invalid={invalid} aria-describedby={described} onChange={(event) => onChange(event.target.value)} className="min-h-32" />
      </TabsContent>
      <TabsContent value="preview">
        {/* D-08: react-markdown without rehype-raw, so raw HTML is not rendered. */}
        <div className="markdown-preview rounded-md border bg-surface-subdued p-3" data-testid={`${id}-preview`}>
          {value.trim() ? <Markdown>{value}</Markdown> : <p className="text-subdued">{fieldsCopy["fields.markdown.empty"]}</p>}
        </div>
      </TabsContent>
    </Tabs>
  );
}

/** One schema field as a labelled control (01 §6.4). The label shows "*" for fields required at publish. */
export function FieldWidget({ field, control, disabled }: FieldWidgetProps) {
  const id = `field-${field.key}`;
  const label = fieldLabel(field);
  return (
    <Controller
      name={field.key}
      control={control}
      render={({ field: input, fieldState }) => {
        const error = errorText(fieldState.error?.message);
        const described = [field.helpText ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
        const raw = field.type === "media-ref" && input.value && typeof input.value === "object" && "mediaId" in input.value ? input.value.mediaId : input.value;
        const text = typeof raw === "string" ? raw : "";
        let control;
        switch (field.type) {
          case "string":
            control = <Input id={id} value={text} disabled={disabled} placeholder={field.placeholder ?? undefined} aria-invalid={!!error} aria-describedby={described} onChange={input.onChange} onBlur={input.onBlur} />;
            break;
          case "markdown":
            control = <MarkdownWidget id={id} value={text} disabled={disabled} invalid={!!error} described={described} onChange={input.onChange} />;
            break;
          case "int":
            control = <Input id={id} type="text" inputMode="numeric" value={text} disabled={disabled} aria-invalid={!!error} aria-describedby={described} onChange={input.onChange} onBlur={input.onBlur} className="w-40" />;
            break;
          case "boolean":
            control = <div className="flex items-center gap-2">
              <Switch id={id} checked={input.value === true} disabled={disabled} aria-invalid={!!error} aria-describedby={described} onCheckedChange={input.onChange} />
              {input.value == null ? <span className="text-subdued">{fieldsCopy["fields.unset"]}</span> : null}
              {!field.required && input.value != null ? <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`${fieldsCopy["fields.clear"]}${label}`} onClick={() => input.onChange(null)}>{fieldsCopy["fields.clear"]}</Button> : null}
            </div>;
            break;
          case "enum":
            control =
              field.enumValues.length <= RADIO_LIMIT ? (
                <RadioGroup id={id} aria-invalid={!!error} aria-describedby={described} value={text} onValueChange={input.onChange} disabled={disabled} aria-labelledby={`${id}-label`} className="flex flex-wrap gap-4" data-testid={`${id}-radio`}>
                  {(field.required ? [] : [""]).concat(field.enumValues).map((option) => (
                    <div key={option || NONE} className="flex items-center gap-2">
                      <RadioGroupItem id={`${id}-${option || NONE}`} value={option} />
                      <Label htmlFor={`${id}-${option || NONE}`} className="font-normal">
                        {option ? enumLabel(field, option) : fieldsCopy["fields.unset"]}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              ) : (
                <Select value={text || NONE} onValueChange={(value) => input.onChange(value === NONE ? "" : value)} disabled={disabled}>
                  <SelectTrigger id={id} aria-invalid={!!error} aria-describedby={described} className="w-56" data-testid={`${id}-select`}>
                    <SelectValue placeholder={fieldsCopy["fields.choose"]} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{field.required ? fieldsCopy["fields.choose"] : fieldsCopy["fields.unset"]}</SelectItem>
                    {field.enumValues.map((option) => (
                      <SelectItem key={option} value={option}>
                        {enumLabel(field, option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            break;
          case "datetime":
            control = <DatetimeWidget id={id} value={text} disabled={disabled} required={field.required} invalid={!!error} described={described} onChange={input.onChange} />;
            break;
          case "ref":
            control = text ? <RefValue id={text} /> : <span className="text-subdued">{fieldsCopy["fields.unset"]}</span>;
            break;
          case "media-ref":
            control = text ? <MediaValue id={text} /> : <span className="text-subdued">{fieldsCopy["fields.unset"]}</span>;
            break;
          case "principal-ref":
            control = <span className={text ? undefined : "text-subdued"}>{text ? fieldsCopy["fields.principal.linked"] : fieldsCopy["fields.unset"]}</span>;
            break;
          default:
            control = (
              <div className="flex flex-col gap-2" data-testid={`${id}-unknown`}>
                <Alert>
                  <AlertDescription>{fieldsCopy["fields.unknown.note"]}</AlertDescription>
                </Alert>
                <pre className="overflow-x-auto rounded-md border bg-surface-subdued p-3 text-table">{JSON.stringify(input.value ?? null, null, 2)}</pre>
              </div>
            );
        }
        return (
          <div className="flex flex-col gap-2" data-testid={`field-${field.key}-row`} data-field-type={isKnown(field) ? field.type : "unknown"}>
            <Label id={`${id}-label`} htmlFor={field.type === "enum" && field.enumValues.length <= RADIO_LIMIT ? undefined : id}>
              {label}
              {field.required ? (
                <span className="text-critical" aria-label={fieldsCopy["fields.required"]}>
                  *
                </span>
              ) : null}
            </Label>
            {control}
            {field.helpText ? (
              <p id={`${id}-help`} data-testid={`${id}-help`} className="text-subdued">
                {field.helpText}
              </p>
            ) : null}
            {error ? (
              <p id={`${id}-error`} className="text-critical" data-testid={`${id}-error`}>
                {error}
              </p>
            ) : null}
          </div>
        );
      }}
    />
  );
}
