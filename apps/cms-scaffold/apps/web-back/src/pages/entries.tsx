import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys, workQueries, type WorkContentType, type WorkEntry } from "@cms/api";
import { useSession } from "@cms/auth";
import { Alert, AlertDescription, Badge, Button, EmptyState, Input, Label, PageHeader, QueryBoundary, Textarea } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { canPublish } from "../nav";

export function EntryListPage() {
  const { type = "" } = useParams();
  const entries = useQuery(workQueries.entries(api.work, type));
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

/** v1 form: one text box per field, values kept as strings (C-05 is fixed in W1). */
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
  const [error, setError] = useState(false);

  function stored(updated: WorkEntry) {
    queryClient.setQueryData(keys.entries.detail(updated.id), updated);
    void queryClient.invalidateQueries({ queryKey: keys.entries.lists(type) });
  }

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      for (const field of schema.fields) {
        const raw = payload[field.key];
        if (raw == null || raw === "") continue;
        body[field.key] = field.type === "int" ? Number(raw) : raw;
      }
      return entry
        ? api.work.patch(entry.id, { slug, payload: body, version: entry.version })
        : api.work.create(type, { slug, payload: body });
    },
    onSuccess: (saved) => {
      stored(saved);
      if (entry) setNotice(copy["editor.saved"]);
      else navigate(`/entries/${type}/${saved.id}`);
    },
    onError: () => setError(true),
  });

  const act = useMutation({
    mutationFn: (action: "publish" | "unpublish" | "archive") => api.work[action](entry!.id),
    onSuccess: (updated) => {
      stored(updated);
      setNotice(updated.publicationState);
    },
    onError: () => setError(true),
  });

  const upload = useMutation({
    mutationFn: ({ file }: { file: File; field: string }) => api.work.upload(file),
    onSuccess: (media, { field }) => {
      setPayload((current) => ({ ...current, [field]: media.id }));
      setNotice(`${copy["editor.uploaded"]} ${media.id}`);
    },
    onError: () => setError(true),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(false);
    save.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{copy["editor.error"]}</AlertDescription>
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
        <Input id="field-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
      </div>
      {schema.fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-2">
          <Label htmlFor={`field-${field.key}`}>{`${field.key} (${field.type})`}</Label>
          {field.type === "markdown" ? (
            <Textarea
              id={`field-${field.key}`}
              value={payload[field.key] ?? ""}
              onChange={(e) => setPayload((p) => ({ ...p, [field.key]: e.target.value }))}
            />
          ) : (
            <Input
              id={`field-${field.key}`}
              value={payload[field.key] ?? ""}
              onChange={(e) => setPayload((p) => ({ ...p, [field.key]: e.target.value }))}
            />
          )}
          {field.type === "media-ref" ? (
            <input
              type="file"
              aria-label={`${field.key} file`}
              onChange={(e) => e.target.files?.[0] && upload.mutate({ file: e.target.files[0], field: field.key })}
            />
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          {copy["editor.save"]}
        </Button>
        {canPublish(me) && entry ? (
          <>
            <Button type="button" variant="outline" onClick={() => act.mutate("publish")}>
              {copy["editor.publish"]}
            </Button>
            <Button type="button" variant="outline" onClick={() => act.mutate("unpublish")}>
              {copy["editor.unpublish"]}
            </Button>
            <Button type="button" variant="destructive" onClick={() => act.mutate("archive")}>
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
              {(current) => <EditorForm key={`${current.id}:${current.version}`} type={type} schema={loaded} entry={current} />}
            </QueryBoundary>
          )
        }
      </QueryBoundary>
    </>
  );
}
