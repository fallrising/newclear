import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiError, keys, workQueries, type WorkContentType, type WorkEntry } from "@cms/api";
import { useSession } from "@cms/auth";
import { buildZod, diffPayload, FieldWidget, formatDateTime, groupFields, toPayload, type FormValues } from "@cms/fields";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ContextualSaveBar,
  DefaultSkeleton,
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
  PageHeader,
  ResourceLayout,
  StatusBadge,
  toast,
  type PageAction,
} from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { publicUrl } from "../front-links";
import { can } from "../nav";
import { TypeGate } from "../type-gate";
import { Confirm, formOf, placeServerErrors, saveResolver, SideCard, SLUG, slugMessage } from "./entry-form";

type Transition = "publish" | "unpublish" | "archive" | "restore" | "remove" | "requestPublish" | "cancelPublishRequest";

const DONE: Record<Transition, string> = {
  publish: copy["details.published"],
  unpublish: copy["details.unpublished"],
  archive: copy["details.archived"],
  restore: copy["details.restored"],
  remove: copy["details.deleted"],
  requestPublish: copy["details.requested"],
  cancelPublishRequest: copy["details.requestCancelled"],
};

interface EditorProps {
  type: WorkContentType;
  /** null on /new. */
  entry: WorkEntry | null;
}

/** 01 §7.2 B-S3. One form for create and edit; the server entry this form was loaded from is `base`. */
function EntryEditor({ type, entry }: EditorProps) {
  const me = useSession().me!;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [base, setBase] = useState(entry);
  const initial = useMemo(() => formOf(type, base), [type, base]);
  const form = useForm<FormValues>({ defaultValues: initial, resolver: saveResolver(type, base), mode: "onTouched" });
  const dirty = form.formState.isDirty;
  const [reloading, setReloading] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [confirm, setConfirm] = useState<"archive" | "remove" | null>(null);
  const writing = useRef(false);
  const loadingLatest = useRef(false);
  const [created, setCreated] = useState<string | null>(null);

  const state = base?.publicationState ?? "draft";
  const readOnly = base !== null && (state === "archived" || !can(me, type.key, "update"));
  const requested = base?.publishRequestedAt != null;
  const listPath = `/entries/${type.key}`;

  // Leave /new only after reset() has cleared the dirty flag, so the save bar's blocker does not ask.
  useEffect(() => {
    if (created && !dirty) navigate(`${listPath}/${created}`, { replace: true });
  }, [created, dirty, navigate, listPath]);

  function adopt(saved: WorkEntry) {
    queryClient.setQueryData(keys.entries.detail(saved.id), saved);
    void queryClient.invalidateQueries({ queryKey: keys.entries.lists(type.key) });
    void queryClient.invalidateQueries({ queryKey: keys.entries.revisions(saved.id) });
    void queryClient.invalidateQueries({ queryKey: keys.entries.preview(saved.id) });
    setBase(saved);
    form.reset(formOf(type, saved));
  }

  function failed(error: unknown) {
    if (placeServerErrors(form, type, error)) {
      toast.error(copy["details.fixFields"]);
      return;
    }
    if (isApiError(error) && error.code === "VERSION_CONFLICT") return setConflict(true);
    if (isApiError(error) && error.code === "SLUG_CONFLICT") return form.setError(SLUG, { type: "server", message: "SLUG_CONFLICT" });
    if (isApiError(error) && error.code === "SINGLETON_EXISTS") return toast.error(copy["details.singletonExists"]);
    if (isApiError(error) && error.code === "REF_CONSTRAINT") return toast.error(copy["details.referenced"]);
    if (isApiError(error) && error.code === "INVALID_STATE_TRANSITION" && base) {
      toast.error(copy["details.stateChanged"]);
      void reload();
      return;
    }
    toast.error(copy["details.failed"]);
  }

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const slug = String(values[SLUG] ?? "").trim();
      if (!base) return api.work.create(type.key, { slug: slug || null, payload: toPayload(type, values) });
      return api.work.patch(base.id, {
        version: base.version,
        payload: diffPayload(type, initial, values),
        ...(slug !== (base.slug ?? "") ? { slug } : {}),
      });
    },
    onSuccess: (saved) => {
      adopt(saved);
      if (base) {
        toast.success(copy["details.saved"]);
      } else {
        toast.success(copy["details.created"]);
        setCreated(saved.id);
      }
    },
    onError: failed,
    onSettled: () => { writing.current = false; },
  });

  const act = useMutation({
    mutationFn: async (action: Transition): Promise<WorkEntry | null> => {
      if (action === "remove") {
        await api.work.remove(base!.id);
        return null;
      }
      return api.work[action](base!.id);
    },
    onSuccess: (updated, action) => {
      toast.success(DONE[action]);
      if (updated) return adopt(updated);
      // The detail query is left to expire: removing it while this page is still mounted refetches it, and its
      // 404 would redirect to /not-found before the list opens (W1-FM07).
      void queryClient.invalidateQueries({ queryKey: keys.entries.lists(type.key) });
      navigate(listPath, { replace: true });
    },
    onError: failed,
    onSettled: () => { writing.current = false; },
  });

  async function reload() {
    if (!base || loadingLatest.current) return;
    loadingLatest.current = true;
    setReloading(true);
    try {
      const latest = await queryClient.fetchQuery({ ...workQueries.entry(api.work, base.id), staleTime: 0 });
      setConflict(false);
      adopt(latest);
    } catch { toast.error(copy["details.failed"]); }
    finally { loadingLatest.current = false; setReloading(false); }
  }

  function saveDraft() {
    if (writing.current || loadingLatest.current || readOnly) return;
    writing.current = true;
    void form.handleSubmit((values) => save.mutate(values), () => { writing.current = false; })()
      .catch(() => { writing.current = false; });
  }

  function transition(action: Transition) {
    if (writing.current || loadingLatest.current || dirty || !base) return;
    writing.current = true;
    act.mutate(action);
  }

  /** Checks the saved work copy against the publish rules (REQUIRED, slug policy) before calling the API. */
  function publish() {
    if (!base || writing.current || loadingLatest.current || dirty) return;
    const result = buildZod(type, "publish").safeParse(formOf(type, base));
    let blocked = false;
    if (!result.success) {
      for (const issue of result.error.issues) form.setError(String(issue.path[0]), { type: "publish", message: issue.message });
      blocked = true;
    }
    if (type.slugPolicy === "required" && !base.slug) {
      form.setError(SLUG, { type: "publish", message: "REQUIRED" });
      blocked = true;
    }
    if (blocked) toast.error(copy["details.publishBlocked"]);
    else transition("publish");
  }

  const busy = save.isPending || act.isPending || reloading;
  const title = base ? base.title || copy["index.untitled"] : fill(copy["details.new"], { name: type.displayName });

  // Saved content may be published or requested; local changes must be saved first.
  const publishable = base !== null && (state === "draft" || (state === "published" && base.dirty));
  let primary: PageAction | undefined;
  if (!base) {
    primary = dirty ? undefined : { label: copy["details.create"], onSelect: saveDraft, disabled: busy, testId: "details-create" };
  } else if (!dirty && publishable && can(me, type.key, "publish")) {
    primary = { label: state === "draft" ? copy["details.publish"] : copy["details.publishChanges"], onSelect: publish, disabled: busy, testId: "details-publish" };
  } else if (!dirty && publishable && !requested && can(me, type.key, "update")) {
    primary = { label: copy["details.requestPublish"], onSelect: () => transition("requestPublish"), disabled: busy, testId: "details-request-publish" };
  }
  const secondary: PageAction[] = base && type.previewable ? [{ label: copy["details.preview"], to: `${listPath}/${base.id}/preview`, testId: "details-preview", disabled: busy }] : [];

  const more: PageAction[] = [];
  if (base && can(me, type.key, "archive")) {
    if (state === "archived") more.push({ label: copy["details.restore"], onSelect: () => transition("restore"), disabled: busy || dirty, testId: "details-restore" });
    else more.push({ label: copy["details.archive"], onSelect: () => setConfirm("archive"), disabled: busy || dirty, testId: "details-archive" });
  }
  if (base && can(me, type.key, "delete")) {
    more.push({ label: copy["details.delete"], onSelect: () => setConfirm("remove"), disabled: busy || dirty, testId: "details-delete" });
  }

  const { main, relations } = groupFields(type);
  const slugError = slugMessage(form.formState.errors[SLUG]?.message as string | undefined);
  const link = base && state === "published" ? publicUrl(base) : null;
  const linkable = base ? publicUrl(base) !== null : false;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        saveDraft();
      }}
    >
      <PageHeader
        title={title}
        backTo={{ to: listPath, label: type.pluralDisplayName }}
        badges={base ? <StatusBadge state={state} dirty={base.dirty} requested={requested} /> : null}
        secondaryActions={secondary}
        moreActions={more}
        primaryAction={primary}
      />
      {readOnly ? (
        <Alert className="mb-4" data-testid="details-read-only">
          <AlertDescription>{state === "archived" ? copy["details.readOnlyArchived"] : copy["details.readOnlyNoUpdate"]}</AlertDescription>
        </Alert>
      ) : null}
      <ResourceLayout
        main={main.map((group) => (
          <Card key={group.key} data-testid={`group-${group.key}`}>
            <CardHeader>
              <CardTitle>{group.label}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {group.fields.map((field) => (
                <FieldWidget key={field.key} field={field} control={form.control} disabled={readOnly || busy} />
              ))}
            </CardContent>
          </Card>
        ))}
        aside={
          <>
            {base ? (
              <SideCard title={copy["card.publish"]} testId="card-publish">
                <p>
                  <span className="text-subdued">{copy["card.publish.state"]} </span>
                  <StatusBadge state={state} dirty={base.dirty} requested={requested} />
                </p>
                <p>
                  <span className="text-subdued">{copy["card.publish.lastPublished"]} </span>
                  {base.publishedAt ? formatDateTime(base.publishedAt) : copy["card.publish.never"]}
                </p>
                {requested ? (
                  <div className="flex flex-col gap-2 rounded-md bg-caution-bg p-3 text-caution" data-testid="publish-request">
                    <p>{copy["card.publish.requestedAt"]} {formatDateTime(base.publishRequestedAt)}</p>
                    <p>{copy["card.publish.requestedNote"]}</p>
                    {can(me, type.key, "update") && state !== "archived" ? (
                      <Button type="button" variant="outline" className="self-start" onClick={() => transition("cancelPublishRequest")} disabled={busy || dirty} data-testid="details-cancel-request">
                        {copy["details.cancelRequest"]}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {state === "published" && can(me, type.key, "unpublish") ? (
                  <Button type="button" variant="outline" onClick={() => transition("unpublish")} disabled={busy || dirty} data-testid="details-unpublish">
                    {copy["details.unpublish"]}
                  </Button>
                ) : null}
              </SideCard>
            ) : null}
            {relations ? (
              <SideCard title={copy["card.relations"]} testId="card-relations">
                {relations.fields.map((field) => (
                  <FieldWidget key={field.key} field={field} control={form.control} disabled={readOnly || busy} />
                ))}
              </SideCard>
            ) : null}
            {type.slugPolicy !== "none" ? (
              <SideCard title={copy["card.url"]} testId="card-url">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="field-slug">
                    {copy["card.url.slug"]}
                    {type.slugPolicy === "required" ? <span className="text-critical">*</span> : null}
                  </Label>
                  <Input
                    id="field-slug"
                    disabled={readOnly || busy}
                    aria-invalid={!!slugError}
                    aria-describedby={slugError ? "field-slug-error" : "field-slug-help"}
                    {...form.register(SLUG)}
                  />
                  <p id="field-slug-help" className="text-subdued">
                    {copy["card.url.slugHelp"]}
                  </p>
                  {slugError ? (
                    <p id="field-slug-error" className="text-critical" data-testid="field-slug-error">
                      {slugError}
                    </p>
                  ) : null}
                </div>
                {link ? (
                  <a href={link} target="_blank" rel="noreferrer" className="break-all text-link hover:underline" aria-label={copy["card.url.open"]} data-testid="public-link">
                    {link}
                  </a>
                ) : linkable ? (
                  <p className="text-subdued">{copy["card.url.notPublished"]}</p>
                ) : null}
              </SideCard>
            ) : null}
            {base ? (
              <SideCard title={copy["card.meta"]} testId="card-meta">
                <p className="flex items-center gap-2">
                  <span className="text-subdued">{copy["card.meta.id"]}</span>
                  <code title={base.id}>{base.id.slice(0, 8)}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void navigator.clipboard?.writeText(base.id).then(() => toast.success(copy["card.meta.copied"]))}
                    data-testid="copy-id"
                  >
                    {copy["card.meta.copy"]}
                  </Button>
                </p>
                <p>
                  <span className="text-subdued">{copy["card.meta.version"]} </span>
                  {base.version}
                </p>
                <p>
                  <span className="text-subdued">{copy["card.meta.updated"]} </span>
                  {formatDateTime(base.updatedAt)}
                </p>
                <Link to={`${listPath}/${base.id}/history`} className="text-link hover:underline" data-testid="history-link">{copy["card.meta.history"]}</Link>
              </SideCard>
            ) : null}
          </>
        }
      />
      {readOnly ? null : (
        <ContextualSaveBar
          dirty={dirty}
          saving={busy}
          onSave={saveDraft}
          onDiscard={() => form.reset(initial)}
          saveLabel={base ? undefined : copy["details.create"]}
        />
      )}
      <Dialog open={conflict} onOpenChange={setConflict}>
        <DialogContent data-testid="conflict-dialog">
          <DialogHeader>
            <DialogTitle>{copy["conflict.title"]}</DialogTitle>
            <DialogDescription>{copy["conflict.body"]}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={reloading} onClick={() => setConflict(false)} data-testid="conflict-keep">
              {copy["conflict.keep"]}
            </Button>
            <Button type="button" disabled={reloading} onClick={() => void reload()} data-testid="conflict-reload">
              {copy["conflict.reload"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {base ? (
        <>
          <Confirm
            open={confirm === "archive"}
            title={fill(copy["details.archiveTitle"], { title })}
            body={copy["details.archiveBody"]}
            action={copy["details.archive"]}
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              setConfirm(null);
              transition("archive");
            }}
            testId="confirm-archive"
          />
          <Confirm
            open={confirm === "remove"}
            title={fill(copy["details.deleteTitle"], { title })}
            body={copy["details.deleteBody"]}
            action={copy["details.delete"]}
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              setConfirm(null);
              transition("remove");
            }}
            testId="confirm-delete"
          />
        </>
      ) : null}
    </form>
  );
}

/** /entries/:type/new — needs `create`. */
export function NewEntryPage() {
  const { type = "" } = useParams();
  const me = useSession().me!;
  return (
    <TypeGate type={type}>
      {(schema) => (can(me, schema.key, "create") ? <EntryEditor key="new" type={schema} entry={null} /> : <Navigate to="/forbidden" replace />)}
    </TypeGate>
  );
}

function EntryLoader({ type, id }: { type: WorkContentType; id: string }) {
  const entry = useQuery(workQueries.entry(api.work, id));
  if (entry.isPending) return <DefaultSkeleton />;
  if (entry.isError && !entry.data) {
    if (isApiError(entry.error) && entry.error.status === 404) return <Navigate to="/not-found" replace />;
    if (isApiError(entry.error) && entry.error.status === 403) return <Navigate to="/forbidden" replace />;
    return <ErrorState onRetry={entry.refetch} />;
  }
  // A link with the wrong type segment is corrected, not shown under the wrong schema.
  if (entry.data.contentType !== type.key) return <Navigate to={`/entries/${entry.data.contentType}/${id}`} replace />;
  // Keyed by id only: a background refetch must not wipe what the user typed (V2-AC-09); the editor keeps its own base.
  return <EntryEditor key={id} type={type} entry={entry.data} />;
}

/** /entries/:type/:id */
export function EntryDetailsPage() {
  const { type = "", id = "" } = useParams();
  return <TypeGate type={type}>{(schema) => <EntryLoader type={schema} id={id} />}</TypeGate>;
}
