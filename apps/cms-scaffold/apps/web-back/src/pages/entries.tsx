import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiError, keys, workQueries, type WorkContentType, type WorkEntry } from "@cms/api";
import { useSession } from "@cms/auth";
import { Alert, AlertDescription, Badge, Button, EmptyState, Input, Label, PageHeader, QueryBoundary, Textarea } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { canPublish } from "../nav";

export function EntryListPage() {
  const { type = "" } = useParams();
  const entries = useQuery(workQueries.allEntries(api.work, type));
  return (
    <>
      <PageHeader title={type} primaryAction={{ label: copy["list.create"], to: `/entries/${type}/new`, testId: "entry-create" }} />
      <QueryBoundary query={entries} isEmpty={(page) => page.items.length === 0} empty={<EmptyState title={copy["list.empty"]} />}>
        {(page) => (
          <ul className="flex flex-col gap-2 rounded-xl border bg-surface p-4">
            {page.items.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <Link to={`/entries/${type}/${item.id}`} className="hover:underline">
                  {item.title || item.slug || item.id}
                </Link>
                <Badge variant="secondary">{item.publicationState}</Badge>
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </>
  );
}

/** Keep draft input strings so invalid integers remain editable. */
function toStrings(entry: WorkEntry | undefined): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry?.payload ?? {})) {
    values[key] = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
  }
  return values;
}

function EditorForm({ type, schema, entry }: { type: string; schema: WorkContentType; entry: WorkEntry | undefined }) {
  const me = useSession().me;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [slug, setSlug] = useState(entry?.slug ?? "");
  const [payload, setPayload] = useState<Record<string, string>>(() => toStrings(entry));
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const writing = useRef(false);
  const editVersion = useRef(entry?.version);
  const baseline = useRef({ slug: entry?.slug ?? "", payload: toStrings(entry) });
  const dirty = slug !== baseline.current.slug || schema.fields.some((field) =>
    (payload[field.key] ?? "") !== (baseline.current.payload[field.key] ?? ""));

  function failed(cause: unknown) {
    setError(isApiError(cause) && cause.code === "VERSION_CONFLICT" ? copy["editor.conflict"] : copy["editor.retry"]);
  }

  function beginWrite() {
    if (writing.current) return false;
    writing.current = true;
    setError("");
    setNotice("");
    return true;
  }

  function finished() {
    writing.current = false;
  }

  function stored(updated: WorkEntry) {
    editVersion.current = updated.version;
    const values = toStrings(updated);
    baseline.current = { slug: updated.slug ?? "", payload: values };
    setSlug(baseline.current.slug);
    setPayload(values);
    queryClient.setQueryData(keys.entries.detail(updated.id), updated);
    void queryClient.invalidateQueries({ queryKey: keys.entries.lists(type) });
  }

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => entry
      ? api.work.patch(entry.id, { slug, payload: body, version: editVersion.current })
      : api.work.create(type, { slug, payload: body }),
    onSuccess: (saved) => {
      stored(saved);
      if (entry) setNotice(copy["editor.saved"]);
      else navigate(`/entries/${type}/${saved.id}`);
    },
    onError: failed,
    onSettled: finished,
  });

  const act = useMutation({
    mutationFn: (action: "publish" | "unpublish" | "archive") => api.work[action](entry!.id),
    onSuccess: (updated) => {
      stored(updated);
      setNotice(`${copy["editor.stateUpdated"]} ${updated.publicationState}`);
    },
    onError: failed,
    onSettled: finished,
  });

  const upload = useMutation({
    mutationFn: ({ file }: { file: File; field: string }) => api.work.upload(file),
    onSuccess: (media, { field }) => {
      setPayload((current) => ({ ...current, [field]: media.id }));
      setNotice(`${copy["editor.uploaded"]} ${media.id}`);
    },
    onError: failed,
    onSettled: finished,
  });

  const busy = save.isPending || act.isPending || upload.isPending;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (writing.current) return;
    const body: Record<string, unknown> = {};
    const invalid: Record<string, string> = {};
    for (const field of schema.fields) {
      const raw = payload[field.key] ?? "";
      if (raw === "" || (field.type === "int" && raw.trim() === "")) {
        if (Object.hasOwn(entry?.payload ?? {}, field.key)) body[field.key] = null;
        continue;
      }
      if (field.type === "int") {
        const number = Number(raw);
        if (!Number.isSafeInteger(number)) invalid[field.key] = copy["editor.integerError"];
        else body[field.key] = number;
      } else if (field.type === "boolean") {
        body[field.key] = raw === "true";
      } else body[field.key] = raw;
    }
    setFieldErrors(invalid);
    if (Object.keys(invalid).length) {
      setNotice("");
      return;
    }
    if (beginWrite()) save.mutate(body);
  }

  function changeField(key: string, value: string) {
    setPayload((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  }

  function runAction(action: "publish" | "unpublish" | "archive") {
    if (!dirty && beginWrite()) act.mutate(action);
  }

  return (
    <form aria-busy={busy} onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription><span>{copy["editor.error"]}</span> {error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert data-testid="editor-notice">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {entry ? <p className="text-subdued">{copy["editor.previewNote"]}</p> : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="field-slug">{copy["editor.slug"]}</Label>
        <Input id="field-slug" value={slug} disabled={busy} onChange={(e) => setSlug(e.target.value)} />
      </div>
      {schema.fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-2">
          <Label htmlFor={`field-${field.key}`}>{`${field.key} (${field.type})`}</Label>
          {field.type === "boolean" || field.type === "enum" ? (
            <select
              id={`field-${field.key}`}
              className="h-9 rounded-md border bg-surface px-3 text-sm"
              value={payload[field.key] ?? ""}
              disabled={busy}
              onChange={(e) => changeField(field.key, e.target.value)}
            >
              <option value="">{copy["editor.unset"]}</option>
              {field.type === "boolean" ? (
                <><option value="true">{copy["editor.yes"]}</option><option value="false">{copy["editor.no"]}</option></>
              ) : field.enumValues.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          ) : field.type === "markdown" ? (
            <Textarea
              id={`field-${field.key}`}
              value={payload[field.key] ?? ""}
              disabled={busy}
              aria-invalid={!!fieldErrors[field.key]}
              aria-describedby={fieldErrors[field.key] ? `error-${field.key}` : undefined}
              onChange={(e) => changeField(field.key, e.target.value)}
            />
          ) : (
            <Input
              id={`field-${field.key}`}
              value={payload[field.key] ?? ""}
              disabled={busy}
              aria-invalid={!!fieldErrors[field.key]}
              aria-describedby={fieldErrors[field.key] ? `error-${field.key}` : undefined}
              onChange={(e) => changeField(field.key, e.target.value)}
            />
          )}
          {fieldErrors[field.key] ? <p id={`error-${field.key}`} role="alert" className="text-sm text-destructive">{fieldErrors[field.key]}</p> : null}
          {field.type === "media-ref" ? (
            <input
              type="file"
              aria-label={`${field.key} file`}
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && beginWrite()) upload.mutate({ file, field: field.key });
              }}
            />
          ) : null}
        </div>
      ))}
      {canPublish(me) && entry && dirty ? <p role="status" className="text-sm text-subdued">{copy["editor.saveFirst"]}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {copy["editor.save"]}
        </Button>
        {canPublish(me) && entry ? (
          <>
            <Button type="button" variant="outline" disabled={busy || dirty} onClick={() => runAction("publish")}>
              {copy["editor.publish"]}
            </Button>
            <Button type="button" variant="outline" disabled={busy || dirty} onClick={() => runAction("unpublish")}>
              {copy["editor.unpublish"]}
            </Button>
            <Button type="button" variant="destructive" disabled={busy || dirty} onClick={() => runAction("archive")}>
              {copy["editor.archive"]}
            </Button>
          </>
        ) : null}
      </div>
    </form>
  );
}

export function EntryEditorPage() {
  const { type = "", id } = useParams();
  const isNew = !id || id === "new";
  const schema = useQuery(workQueries.type(api.work, type));
  const entry = useQuery({ ...workQueries.entry(api.work, id ?? ""), enabled: !isNew });
  const title = isNew ? `${copy["editor.newTitle"]} ${type}` : (entry.data?.title ?? type);
  return (
    <>
      <PageHeader title={title} />
      <QueryBoundary query={schema}>
        {(loaded) =>
          isNew ? (
            <EditorForm type={type} schema={loaded} entry={undefined} />
          ) : (
            <QueryBoundary query={entry}>
              {(current) => <EditorForm key={current.id} type={type} schema={loaded} entry={current} />}
            </QueryBoundary>
          )
        }
      </QueryBoundary>
    </>
  );
}
