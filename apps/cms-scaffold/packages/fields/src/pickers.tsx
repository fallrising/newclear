import { useEffect, useId, useState, type DragEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiError, keys, workQueries, type MediaAsset, type WorkEntry, type WorkField } from "@cms/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  fill,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@cms/ui";
import { fieldsCopy } from "./copy";
import { useFieldsServices } from "./context";
import { formatBytes } from "./format";
import { fieldLabel } from "./labels";
import { MediaThumb, MediaValue, RefValue } from "./values";

/** Search results shown in the relation picker (one API page). */
export const REF_PAGE_SIZE = 20;
/** Library cells shown in the media picker; GET /media is not paged, so the rest is reached by searching. */
export const MEDIA_GRID_LIMIT = 24;
const SEARCH_DEBOUNCE_MS = 300;
/** BW0 §4.2 uploadMedia: the types the API accepts (detected from bytes on the server). */
const ACCEPT = "image/jpeg,image/png,image/gif,application/pdf";

export interface PickerProps {
  /** `field-<key>`: prefix of the test ids; the group is labelled by `<id>-label` (the widget's <Label>). */
  id: string;
  field: WorkField;
  /** The current id, "" when empty. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

/** The current value, then 選擇／更換 and 移除 (01 §6.4). Disabled fields show the value only. */
function PickerField({ id, field, value, disabled, onOpen, onClear, children }: PickerProps & { onOpen: () => void; onClear: () => void; children: ReactNode }) {
  const label = fieldLabel(field);
  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex flex-wrap items-center gap-3" data-testid={`${id}-picker`}>
      {value ? children : <span className="text-subdued">{fieldsCopy["fields.unset"]}</span>}
      {disabled ? null : (
        <span className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onOpen} data-testid={`${id}-pick`}>
            {fill(value ? fieldsCopy["fields.pick.change"] : fieldsCopy["fields.pick.choose"], { label })}
          </Button>
          {value ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClear} data-testid={`${id}-clear`}>
              {fill(fieldsCopy["fields.pick.remove"], { label })}
            </Button>
          ) : null}
        </span>
      )}
    </div>
  );
}

function SearchBox({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="search" value={value} onChange={(event) => onChange(event.target.value)} data-testid="picker-search" />
    </div>
  );
}

function RelationResults({ field, q, selected, onSelect }: { field: WorkField; q: string; selected: string; onSelect: (entry: WorkEntry) => void }) {
  const { work } = useFieldsServices();
  const params = { ...(q.trim() ? { q: q.trim() } : {}), sort: "title", size: REF_PAGE_SIZE };
  const results = useQuery({ ...workQueries.entries(work, field.refTarget ?? "", params), enabled: field.refTarget !== null, retry: false });
  if (results.isPending) {
    return (
      <div className="flex flex-col gap-2" data-testid="picker-loading">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (results.isError) {
    if (isApiError(results.error) && results.error.status === 403) return <p className="text-subdued">{fieldsCopy["fields.ref.forbidden"]}</p>;
    return <ErrorState onRetry={results.refetch} />;
  }
  if (results.data.items.length === 0) return <p className="text-subdued" data-testid="picker-empty">{fieldsCopy["fields.ref.noResults"]}</p>;
  return (
    <div className="flex flex-col gap-2">
      <RadioGroup
        value={selected}
        onValueChange={(id) => onSelect(results.data.items.find((e) => e.id === id)!)}
        aria-label={fieldLabel(field)}
        className="max-h-80 gap-1 overflow-y-auto"
      >
        {results.data.items.map((entry) => (
          <Label key={entry.id} className="flex items-center gap-3 rounded-md border px-3 py-2 font-normal hover:bg-accent" data-testid="picker-option">
            <RadioGroupItem value={entry.id} />
            <span className="min-w-0 flex-1 truncate">{entry.title || fieldsCopy["fields.ref.untitled"]}</span>
            <StatusBadge state={entry.publicationState} dirty={entry.dirty} />
          </Label>
        ))}
      </RadioGroup>
      {results.data.total > results.data.items.length ? (
        <p className="text-subdued">{fill(fieldsCopy["fields.ref.more"], { n: results.data.items.length })}</p>
      ) : null}
    </div>
  );
}

/**
 * 01 §6.4 `ref`: the target's title and status; a dialog searches the target type by title (`q`, 20 per page) and
 * lists drafts too. The chosen entry is written to the detail cache, so RefValue shows it without another request.
 */
export function RelationPicker(props: PickerProps) {
  const { field, value, onChange } = props;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<WorkEntry | null>(null);
  const search = useDebounced(q);
  const searchId = useId();
  const label = fieldLabel(field);

  function show() {
    setQ("");
    setChosen(null);
    setOpen(true);
  }

  function confirm() {
    if (!chosen) return;
    queryClient.setQueryData(keys.entries.detail(chosen.id), chosen);
    onChange(chosen.id);
    setOpen(false);
  }

  return (
    <>
      <PickerField {...props} onOpen={show} onClear={() => onChange("")}>
        <RefValue id={value} />
      </PickerField>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto" data-testid="relation-picker">
          <DialogHeader>
            <DialogTitle>{fill(fieldsCopy["fields.pick.choose"], { label })}</DialogTitle>
            <DialogDescription className="sr-only">{fieldsCopy["fields.pick.search"]}</DialogDescription>
          </DialogHeader>
          <SearchBox id={searchId} label={fieldsCopy["fields.pick.search"]} value={q} onChange={setQ} />
          {open ? <RelationResults field={field} q={search} selected={chosen?.id ?? value} onSelect={setChosen} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {fieldsCopy["fields.pick.cancel"]}
            </Button>
            <Button type="button" onClick={confirm} disabled={!chosen} data-testid="picker-confirm">
              {fieldsCopy["fields.pick.confirm"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LibraryTab({ selected, onSelect }: { selected: string; onSelect: (asset: MediaAsset) => void }) {
  const { work } = useFieldsServices();
  const library = useQuery({ ...workQueries.mediaList(work), retry: false });
  const [q, setQ] = useState("");
  const searchId = useId();
  let body: ReactNode;
  if (library.isPending) {
    body = (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid="picker-loading">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="aspect-square w-full" />
        ))}
      </div>
    );
  } else if (library.isError) {
    body =
      isApiError(library.error) && library.error.status === 403 ? (
        <p className="text-subdued">{fieldsCopy["fields.media.forbidden"]}</p>
      ) : (
        <ErrorState onRetry={library.refetch} />
      );
  } else {
    const needle = q.trim().toLowerCase();
    const matches = library.data.items.filter((m) => m.title.toLowerCase().includes(needle));
    const shown = matches.slice(0, MEDIA_GRID_LIMIT);
    body =
      library.data.items.length === 0 ? (
        <p className="text-subdued" data-testid="picker-empty">{fieldsCopy["fields.media.empty"]}</p>
      ) : shown.length === 0 ? (
        <p className="text-subdued" data-testid="picker-empty">{fieldsCopy["fields.media.noResults"]}</p>
      ) : (
        <>
          <RadioGroup
            value={selected}
            onValueChange={(id) => onSelect(shown.find((m) => m.id === id)!)}
            aria-label={fieldsCopy["fields.media.library"]}
            className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4"
          >
            {shown.map((asset) => (
              <Label
                key={asset.id}
                className="flex min-w-0 flex-col items-start gap-1 rounded-md border p-2 font-normal hover:bg-accent has-[[data-state=checked]]:border-primary"
                data-testid="picker-option"
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <RadioGroupItem value={asset.id} className="shrink-0" />
                  <span className="min-w-0 truncate text-table">{asset.title}</span>
                </span>
                <MediaThumb asset={asset} size={72} />
              </Label>
            ))}
          </RadioGroup>
          {matches.length > shown.length ? <p className="text-subdued">{fill(fieldsCopy["fields.media.more"], { n: MEDIA_GRID_LIMIT })}</p> : null}
        </>
      );
  }
  return (
    <div className="flex flex-col gap-3">
      <SearchBox id={searchId} label={fieldsCopy["fields.media.search"]} value={q} onChange={setQ} />
      {body}
    </div>
  );
}

function uploadError(error: unknown, limit: string | null): string {
  if (!isApiError(error)) return fieldsCopy["fields.media.error.failed"];
  if (error.code === "file_too_large") return limit ? fill(fieldsCopy["fields.media.error.tooLarge"], { size: limit }) : fieldsCopy["fields.media.error.failed"];
  if (error.code === "unsupported_media_type") return fieldsCopy["fields.media.error.type"];
  if (error.code === "quota_exceeded") return fieldsCopy["fields.media.error.quota"];
  if (error.status === 403) return fieldsCopy["fields.media.error.forbidden"];
  return fieldsCopy["fields.media.error.failed"];
}

/** Upload tab: drop zone or file input; a file over the quota's maxFileBytes is refused before it is sent. */
export function UploadPanel({ onUploaded }: { onUploaded: (asset: MediaAsset) => void }) {
  const { work } = useFieldsServices();
  const queryClient = useQueryClient();
  const quota = useQuery({ ...workQueries.mediaQuota(work), retry: false });
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const maxBytes = quota.data?.maxFileBytes ?? null;
  const limit = maxBytes === null ? null : formatBytes(maxBytes);
  const upload = useMutation({
    mutationFn: (file: File) => work.upload(file),
    onSuccess: (asset) => {
      queryClient.setQueryData(keys.media.detail(asset.id), asset);
      void queryClient.invalidateQueries({ queryKey: keys.media.list() });
      toast.success(fill(fieldsCopy["fields.media.uploaded"], { title: asset.title }));
      onUploaded(asset);
    },
    onError: (e) => setError(uploadError(e, limit)),
  });

  function send(file: File | undefined) {
    if (!file || upload.isPending) return;
    setError(null);
    if (maxBytes !== null && file.size > maxBytes) return setError(fill(fieldsCopy["fields.media.error.tooLarge"], { size: limit! }));
    upload.mutate(file);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    send(event.dataTransfer.files[0]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center"
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
        data-testid="media-dropzone"
      >
        <p>
          {fieldsCopy["fields.media.drop"]}{" "}
          <Label htmlFor={inputId} className="inline cursor-pointer text-link underline">
            {fieldsCopy["fields.media.browse"]}
          </Label>
        </p>
        <input
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={upload.isPending}
          onChange={(event) => {
            send(event.target.files?.[0]);
            event.target.value = "";
          }}
          data-testid="media-upload-input"
        />
        <p className="text-subdued">{limit ? fill(fieldsCopy["fields.media.limit"], { size: limit }) : fieldsCopy["fields.media.limitUnknown"]}</p>
      </div>
      <p aria-live="polite" className="text-subdued">
        {upload.isPending ? fieldsCopy["fields.media.uploading"] : ""}
      </p>
      {error ? (
        <p className="text-critical" role="alert" data-testid="media-upload-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 01 §6.4 `media-ref` and B-S4: thumbnail and title; a dialog with two tabs, 媒體庫 (search by name, pick one) and
 * 上傳 (the uploaded file is chosen at once). The dialog never leaves the page (surface-back AC-MEDIA-01).
 */
export function MediaPicker(props: PickerProps) {
  const { field, value, onChange } = props;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<MediaAsset | null>(null);
  const label = fieldLabel(field);

  function show() {
    setChosen(null);
    setOpen(true);
  }

  function use(asset: MediaAsset) {
    queryClient.setQueryData(keys.media.detail(asset.id), asset);
    onChange(asset.id);
    setOpen(false);
  }

  return (
    <>
      <PickerField {...props} onOpen={show} onClear={() => onChange("")}>
        <MediaValue id={value} />
      </PickerField>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-testid="media-picker">
          <DialogHeader>
            <DialogTitle>{fill(fieldsCopy["fields.pick.choose"], { label })}</DialogTitle>
            <DialogDescription className="sr-only">{fieldsCopy["fields.media.library"]}</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="library">
            <TabsList>
              <TabsTrigger value="library" data-testid="media-tab-library">{fieldsCopy["fields.media.library"]}</TabsTrigger>
              <TabsTrigger value="upload" data-testid="media-tab-upload">{fieldsCopy["fields.media.upload"]}</TabsTrigger>
            </TabsList>
            <TabsContent value="library">
              {open ? <LibraryTab selected={chosen?.id ?? value} onSelect={setChosen} /> : null}
            </TabsContent>
            <TabsContent value="upload">
              <UploadPanel onUploaded={use} />
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {fieldsCopy["fields.pick.cancel"]}
            </Button>
            <Button type="button" onClick={() => chosen && use(chosen)} disabled={!chosen} data-testid="picker-confirm">
              {fieldsCopy["fields.media.confirm"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
