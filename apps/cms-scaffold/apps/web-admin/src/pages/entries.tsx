import { useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminQueries, isApiError, keys, workQueries, type AdminField, type WorkEntry } from "@cms/api";
import { useSession } from "@cms/auth";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DefaultSkeleton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  fill,
  IndexPagination,
  IndexTable,
  Input,
  Label,
  PageHeader,
  RadioGroup,
  RadioGroupItem,
  ResourceLayout,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  toast,
} from "@cms/ui";
import { api } from "../api";
import { ConfirmDialog } from "../confirm";
import { copy } from "../copy";
import { failureText, redirectFor } from "../errors";
import { formatDateTime } from "../format";
import { actionLabel, actorLabel, fieldLabel } from "../labels";
import { canGlobal } from "../nav";

/** Every state, so archived entries can be found too (the work list defaults to draft,published). */
const ALL_STATES = "draft,published,archived";
const PAGE_SIZE = 20;
/** RadioGroup value of "no member linked". */
const NONE = "__none__";
/** Principals listed in the member dialog at most (the API does not page GET /principals). */
export const MEMBER_LIMIT = 50;

function entryName(entry: Pick<WorkEntry, "title" | "slug">): string {
  return entry.title ?? entry.slug ?? copy["entries.untitled"];
}

/** /entries: find an entry by type and title (surface-admin §3.6: metadata only, never field values). */
export function EntryLookupPage() {
  const [params, setParams] = useSearchParams();
  const types = useQuery(adminQueries.types(api.admin));
  const enabled = types.data?.items.filter((t) => t.enabled) ?? [];
  const type = enabled.some((t) => t.key === params.get("type")) ? params.get("type")! : "";
  const q = params.get("q") ?? "";
  const pageParam = Number(params.get("page"));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const [text, setText] = useState(q);
  const entries = useQuery({
    ...workQueries.entries(api.work, type, { q: q || undefined, state: ALL_STATES, page, size: PAGE_SIZE, sort: "-updatedAt" }),
    enabled: type !== "",
  });
  const write = (next: { type: string; q: string; page: number }) => {
    const out = new URLSearchParams();
    if (next.type) out.set("type", next.type);
    if (next.q) out.set("q", next.q);
    if (next.page !== 1) out.set("page", String(next.page));
    setParams(out);
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    write({ type, q: text.trim(), page: 1 });
  };
  return (
    <>
      <PageHeader backTo={{ to: "/settings", label: copy["settings.title"] }} title={copy["entries.title"]} />
      <p className="mb-4 text-subdued">{copy["entries.lead"]}</p>
      {/* The type Select stays outside the <form>: Radix renders a hidden native select inside forms, which resets it. */}
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border bg-surface p-3" data-testid="lookup-form">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lookup-type">{copy["entries.type"]}</Label>
          <Select value={type} onValueChange={(next) => write({ type: next, q, page: 1 })}>
            <SelectTrigger id="lookup-type" className="w-48" data-testid="lookup-type">
              <SelectValue placeholder={copy["entries.type.placeholder"]} />
            </SelectTrigger>
            <SelectContent>
              {enabled.map((t) => (
                <SelectItem key={t.key} value={t.key}>
                  {t.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <form className="flex flex-wrap items-end gap-3" onSubmit={search}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lookup-q">{copy["entries.search"]}</Label>
            <Input id="lookup-q" className="w-64" value={text} onChange={(event) => setText(event.target.value)} data-testid="lookup-q" />
          </div>
          <Button type="submit" disabled={!type} data-testid="lookup-submit">
            {copy["entries.submit"]}
          </Button>
        </form>
      </div>
      {types.isError ? (
        <ErrorState onRetry={types.refetch} />
      ) : !type ? (
        <EmptyState testId="lookup-pick" title={copy["entries.pickType"]} />
      ) : entries.isError ? (
        <ErrorState onRetry={entries.refetch} />
      ) : (
        <>
          <IndexTable
            columns={[
              { key: "title", header: copy["entries.col.title"], cell: (e) => entryName(e) },
              { key: "slug", header: copy["entries.col.slug"], cell: (e) => <span className="font-mono">{e.slug ?? copy["common.none"]}</span> },
              { key: "state", header: copy["entries.col.state"], cell: (e) => <StatusBadge state={e.publicationState} dirty={e.dirty} /> },
              { key: "updated", header: copy["entries.col.updated"], cell: (e) => formatDateTime(e.updatedAt) },
            ]}
            rows={entries.data?.items}
            rowKey={(e) => e.id}
            rowHref={(e) => `/entries/${e.id}`}
            rowLabel={(e) => entryName(e)}
            loading={entries.isPending}
            empty={<EmptyState testId="lookup-empty" title={copy["entries.empty"]} />}
          />
          {entries.data && entries.data.total > 0 ? (
            <IndexPagination page={page} size={PAGE_SIZE} total={entries.data.total} onPageChange={(next) => write({ type, q, page: next })} onSizeChange={() => undefined} />
          ) : null}
        </>
      )}
    </>
  );
}

function History({ id }: { id: string }) {
  const events = useQuery(adminQueries.audit(api.admin, { targetId: id, action: "entry.", size: 20 }));
  return (
    <Card data-testid="entry-history">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-card-title">{copy["entries.history"]}</CardTitle>
        <Link to={`/audit?targetId=${id}`} className="text-table hover:underline">
          {copy["entries.history.all"]}
        </Link>
      </CardHeader>
      <CardContent>
        {events.isPending ? (
          <DefaultSkeleton />
        ) : events.isError ? (
          <ErrorState onRetry={events.refetch} />
        ) : events.data.items.length === 0 ? (
          <p className="text-subdued">{copy["entries.history.empty"]}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {events.data.items.map((event) => (
              <li key={event.id} className="flex flex-wrap gap-x-3 py-2 text-table" data-testid="entry-history-row">
                <span className="text-subdued">{formatDateTime(event.at)}</span>
                <span>{actorLabel(event.actor)}</span>
                <Link to={`/audit/${event.id}`} className="hover:underline">
                  {actionLabel(event.action)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MemberDialog({ entry, field, open, onClose }: { entry: WorkEntry; field: AdminField; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const principals = useQuery({ ...adminQueries.principals(api.admin), enabled: open });
  const current = typeof entry.payload[field.key] === "string" ? (entry.payload[field.key] as string) : NONE;
  const [choice, setChoice] = useState(current);
  const [text, setText] = useState("");
  const candidates = useMemo(() => {
    const needle = text.trim().toLowerCase();
    const items = principals.data?.items ?? [];
    const matching = items
      .filter((p) => p.status === "active" && p.id !== current)
      .filter((p) => !needle || p.username.includes(needle) || p.displayName.toLowerCase().includes(needle))
      .slice(0, MEMBER_LIMIT);
    // Keep the current link visible even when disabled, outside the first page, or excluded by search.
    const linked = items.find((p) => p.id === current);
    return linked ? [linked, ...matching] : matching;
  }, [principals.data, text, current]);
  const save = useMutation({
    mutationFn: () => api.work.patch(entry.id, { version: entry.version, payload: { [field.key]: choice === NONE ? null : choice } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.entries.detail(entry.id), updated);
      toast.success(copy["member.saved"]);
      onClose();
    },
    onError: (error) => {
      if (isApiError(error) && error.code === "VERSION_CONFLICT") {
        void queryClient.invalidateQueries({ queryKey: keys.entries.detail(entry.id) });
        toast.error(copy["member.conflict"]);
        onClose();
      } else if (isApiError(error) && error.status === 422) {
        toast.error(copy["member.invalid"]);
      } else {
        toast.error(failureText(error));
      }
    },
  });
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent data-testid="member-dialog">
        <DialogHeader>
          <DialogTitle>{fill(copy["member.title"], { field: fieldLabel(field) })}</DialogTitle>
          <DialogDescription>{copy["member.lead"]}</DialogDescription>
        </DialogHeader>
        <Input aria-label={copy["member.search"]} placeholder={copy["member.search"]} value={text} onChange={(event) => setText(event.target.value)} data-testid="member-search" />
        {principals.isPending ? (
          <DefaultSkeleton />
        ) : principals.isError ? (
          <ErrorState onRetry={principals.refetch} />
        ) : (
          <RadioGroup value={choice} onValueChange={setChoice} aria-label={fieldLabel(field)} className="max-h-72 overflow-y-auto">
            <div className="flex items-center gap-2">
              <RadioGroupItem id="member-none" value={NONE} data-testid="member-none" />
              <Label htmlFor="member-none">{copy["member.none"]}</Label>
            </div>
            {candidates.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <RadioGroupItem id={`member-${p.id}`} value={p.id} data-testid="member-option" />
                <Label htmlFor={`member-${p.id}`}>
                  {p.displayName} <span className="font-mono text-subdued">{p.username}</span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {copy["common.cancel"]}
          </Button>
          <Button type="button" disabled={choice === current || save.isPending} onClick={() => save.mutate()} data-testid="member-save">
            {save.isPending ? copy["common.working"] : copy["member.save"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 01 Q-13 (B): linking a member account (a principal-ref field) is done here, not in Back. One row per principal-ref
 * field of the type; the value is written with PATCH /entries/{id} and the entry's version.
 */
function MemberLinks({ entry, fields }: { entry: WorkEntry; fields: AdminField[] }) {
  const principals = useQuery(adminQueries.principals(api.admin));
  const [editing, setEditing] = useState<AdminField | null>(null);
  const nameOf = (id: string) => {
    const p = principals.data?.items.find((x) => x.id === id);
    return p ? fill(copy["member.name"], { name: p.displayName, username: p.username }) : copy["member.unknown"];
  };
  return (
    <Card data-testid="member-links">
      <CardHeader>
        <CardTitle className="text-card-title">{copy["member.card"]}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {fields.map((field) => {
          const value = entry.payload[field.key];
          return (
            <div key={field.key} className="flex flex-wrap items-center justify-between gap-2" data-testid={`member-field-${field.key}`}>
              <div>
                <p className="font-semibold">{fieldLabel(field)}</p>
                <p className="text-subdued" data-testid="member-current">
                  {typeof value === "string" ? nameOf(value) : copy["member.none"]}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" disabled={entry.publicationState === "archived"} onClick={() => setEditing(field)} data-testid="member-edit">
                {copy["member.edit"]}
              </Button>
            </div>
          );
        })}
      </CardContent>
      {editing ? <MemberDialog entry={entry} field={editing} open onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

type Action = "unpublish" | "archive" | "purge";

function Inspector({ entry }: { entry: WorkEntry }) {
  const me = useSession().me!;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const types = useQuery(adminQueries.types(api.admin));
  const type = types.data?.items.find((t) => t.key === entry.contentType);
  const [pending, setPending] = useState<Action | null>(null);
  const run = useMutation({
    mutationFn: async (action: Action) => {
      if (action === "purge") return api.admin.purgeEntry(entry.id);
      return action === "unpublish" ? api.work.unpublish(entry.id) : api.work.archive(entry.id);
    },
    onSuccess: (result, action) => {
      setPending(null);
      void queryClient.invalidateQueries({ queryKey: keys.admin.auditAll() });
      void queryClient.invalidateQueries({ queryKey: keys.entries.lists(entry.contentType) });
      if (action === "purge") {
        // Keep the detail cache: a refetch would 404 and flash /404 before the list (W1-FM07).
        toast.success(copy["entries.purged"]);
        navigate(`/entries?type=${entry.contentType}`, { replace: true });
        return;
      }
      queryClient.setQueryData(keys.entries.detail(entry.id), result as WorkEntry);
      toast.success(copy[action === "unpublish" ? "entries.unpublished" : "entries.archived"]);
    },
    onError: (error) => {
      setPending(null);
      if (isApiError(error) && error.code === "REF_CONSTRAINT") toast.error(copy["entries.referenced"]);
      else if (isApiError(error) && error.code === "INVALID_STATE_TRANSITION") {
        void queryClient.invalidateQueries({ queryKey: keys.entries.detail(entry.id) });
        toast.error(copy["entries.stateChanged"]);
      } else toast.error(failureText(error));
    },
  });
  const memberFields = type?.fields.filter((f) => f.type === "principal-ref" && f.enabled) ?? [];
  const name = entryName(entry);
  const phrase = entry.slug ?? entry.id;
  const actions = [
    entry.publicationState === "published" ? { label: copy["entries.unpublish"], onSelect: () => setPending("unpublish"), testId: "entry-unpublish" } : null,
    entry.publicationState !== "archived" ? { label: copy["entries.archive"], onSelect: () => setPending("archive"), testId: "entry-archive" } : null,
    { label: copy["entries.purge"], onSelect: () => setPending("purge"), testId: "entry-purge" },
  ].filter((a) => a !== null);
  const dialog = {
    unpublish: { title: fill(copy["entries.unpublish.title"], { name }), body: copy["entries.unpublish.body"], confirm: copy["entries.unpublish"] },
    archive: { title: fill(copy["entries.archive.title"], { name }), body: copy["entries.archive.body"], confirm: copy["entries.archive"] },
    purge: { title: fill(copy["entries.purge.title"], { name }), body: copy["entries.purge.body"], confirm: copy["entries.purge"] },
  };
  return (
    <>
      <PageHeader
        backTo={{ to: `/entries?type=${entry.contentType}`, label: copy["entries.title"] }}
        title={name}
        badges={<StatusBadge state={entry.publicationState} dirty={entry.dirty} requested={entry.publishRequestedAt !== null} />}
        moreActions={actions}
      />
      <ResourceLayout
        main={
          <>
            <Card data-testid="entry-meta">
              <CardHeader>
                <CardTitle className="text-card-title">{copy["entries.meta"]}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
                  <dt className="text-subdued">{copy["entries.type"]}</dt>
                  <dd>{type ? <Link to={`/types/${type.key}`} className="hover:underline">{type.displayName}</Link> : entry.contentType}</dd>
                  <dt className="text-subdued">{copy["entries.col.slug"]}</dt>
                  <dd className="font-mono">{entry.slug ?? copy["common.none"]}</dd>
                  <dt className="text-subdued">{copy["entries.version"]}</dt>
                  <dd>{entry.version}</dd>
                  <dt className="text-subdued">{copy["entries.col.updated"]}</dt>
                  <dd>{formatDateTime(entry.updatedAt)}</dd>
                  <dt className="text-subdued">{copy["entries.published"]}</dt>
                  <dd>{entry.publishedAt ? formatDateTime(entry.publishedAt) : copy["entries.neverPublished"]}</dd>
                  <dt className="text-subdued">{copy["entries.requested"]}</dt>
                  <dd>{entry.publishRequestedAt ? formatDateTime(entry.publishRequestedAt) : copy["common.none"]}</dd>
                </dl>
              </CardContent>
            </Card>
            {canGlobal(me, "read_audit") ? <History id={entry.id} /> : null}
            {memberFields.length > 0 && canGlobal(me, "manage_principals") ? <MemberLinks entry={entry} fields={memberFields} /> : null}
          </>
        }
        aside={
          <Card data-testid="entry-help">
            <CardHeader>
              <CardTitle className="text-card-title">{copy["entries.help.title"]}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-subdued">{copy["entries.help.body"]}</p>
            </CardContent>
          </Card>
        }
      />
      <ConfirmDialog
        open={pending !== null}
        title={pending ? dialog[pending].title : ""}
        description={pending ? dialog[pending].body : ""}
        confirmLabel={pending ? dialog[pending].confirm : ""}
        phrase={pending === "purge" ? phrase : undefined}
        destructive={pending === "purge"}
        pending={run.isPending}
        onConfirm={() => pending && run.mutate(pending)}
        onCancel={() => setPending(null)}
      />
    </>
  );
}

/** /entries/:id: the emergency inspector (surface-admin §4.4): metadata, publish history, force actions, member links. */
export function EntryInspectorPage() {
  const { id = "" } = useParams();
  const entry = useQuery(workQueries.entry(api.work, id));
  const redirect = redirectFor(entry.error);
  if (redirect) return <Navigate to={redirect} replace />;
  if (entry.isError) {
    return (
      <>
        <PageHeader backTo={{ to: "/entries", label: copy["entries.title"] }} title={copy["entries.title"]} />
        <ErrorState onRetry={entry.refetch} />
      </>
    );
  }
  if (entry.isPending) return <DefaultSkeleton />;
  return <Inspector entry={entry.data} />;
}
