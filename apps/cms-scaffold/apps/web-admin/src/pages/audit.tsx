import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { adminQueries, type AuditEventSummary, type AuditQuery } from "@cms/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DefaultSkeleton,
  EmptyState,
  ErrorState,
  IndexPagination,
  IndexTable,
  Input,
  Label,
  PageHeader,
  PAGE_SIZES,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { redirectFor } from "../errors";
import { formatDateTime, localDayStart } from "../format";
import { actionLabel, actorLabel, categoryLabel, outcomeLabel, surfaceLabel, targetTypeLabel } from "../labels";

/** AuditEventSummary.category values (BW2 §4.3, identity events). */
export const CATEGORIES = ["AUTH", "CONTENT", "SCHEMA", "SETTINGS", "MEDIA", "GOVERNANCE"] as const;
/** Actions offered in the filter, in this order; "entry." is the prefix of every entry action (BW2 §4.4). */
export const ACTION_FILTERS = [
  "entry.",
  "entry.publish",
  "entry.unpublish",
  "entry.archive",
  "entry.purge",
  "type.enable",
  "type.disable",
  "role.permissions_update",
  "settings.retention_updated",
  "PRINCIPAL_CREATED",
  "PRINCIPAL_DISABLED",
  "ROLE_ASSIGNED",
  "PASSWORD_SET_BY_ADMIN",
  "LOGIN_SUCCESS",
  "LOGIN_FAILURE",
] as const;
const OUTCOME_TABS = ["all", "ok", "denied"] as const;
const ANY = "__any__";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface AuditFilters {
  outcome: string;
  from: string;
  to: string;
  actor: string;
  action: string;
  category: string;
  targetId: string;
  page: number;
  size: number;
}

/** URL → filters. Unknown values fall back to "no condition" (01 §4.4). */
export function readAuditFilters(params: URLSearchParams): AuditFilters {
  const pick = (name: string, allowed: readonly string[]) => {
    const value = params.get(name) ?? "";
    return allowed.includes(value) ? value : "";
  };
  const day = (name: string) => {
    const value = params.get(name) ?? "";
    return DAY.test(value) && localDayStart(value) ? value : "";
  };
  const page = Number(params.get("page"));
  const size = Number(params.get("size"));
  return {
    outcome: pick("outcome", ["ok", "denied"]),
    from: day("from"),
    to: day("to"),
    actor: (params.get("actor") ?? "").trim(),
    action: pick("action", ACTION_FILTERS),
    category: pick("category", CATEGORIES),
    targetId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.get("targetId") ?? "") ? params.get("targetId")! : "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : 20,
  };
}

/** Filters → GET /admin/audit query: local days become instants, `to` is the next day's midnight (exclusive). */
export function toAuditQuery(filters: AuditFilters): AuditQuery {
  return {
    page: filters.page,
    size: filters.size,
    from: filters.from ? localDayStart(filters.from)! : undefined,
    to: filters.to ? localDayStart(filters.to, 1)! : undefined,
    actor: filters.actor || undefined,
    action: filters.action || undefined,
    category: filters.category || undefined,
    targetId: filters.targetId || undefined,
    outcome: filters.outcome || undefined,
  };
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  return <Badge variant={outcome === "denied" ? "destructive" : "secondary"}>{outcomeLabel(outcome)}</Badge>;
}

function Target({ event }: { event: Pick<AuditEventSummary, "targetType" | "targetId"> }) {
  if (event.targetType === "entry" && event.targetId) {
    return (
      <Link to={`/entries/${event.targetId}`} className="hover:underline" data-testid="audit-target-link">
        {copy["audit.openEntry"]}
      </Link>
    );
  }
  if (event.targetType === "principal" && event.targetId) {
    return (
      <Link to={`/principals/${event.targetId}`} className="hover:underline">
        {targetTypeLabel(event.targetType)}
      </Link>
    );
  }
  return <>{targetTypeLabel(event.targetType)}</>;
}

function FilterSelect({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value || ANY} onValueChange={(next) => onChange(next === ANY ? "" : next)}>
        <SelectTrigger id={id} className="w-48" data-testid={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{copy["common.all"]}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** /audit: search the audit log (surface-admin §4.4, §7.3). Read only: no edit or delete anywhere (AC-J). */
export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const filters = readAuditFilters(params);
  const [draft, setDraft] = useState(filters);
  const paramsKey = params.toString();
  useEffect(() => setDraft(readAuditFilters(new URLSearchParams(paramsKey))), [paramsKey]);
  const events = useQuery(adminQueries.audit(api.admin, toAuditQuery(filters)));
  const write = (next: AuditFilters) => {
    const out = new URLSearchParams();
    for (const name of ["outcome", "from", "to", "actor", "action", "category", "targetId"] as const) {
      if (next[name]) out.set(name, next[name]);
    }
    if (next.page !== 1) out.set("page", String(next.page));
    if (next.size !== 20) out.set("size", String(next.size));
    setParams(out);
  };
  const apply = (event: FormEvent) => {
    event.preventDefault();
    write({ ...draft, outcome: filters.outcome, targetId: filters.targetId, page: 1, size: filters.size });
  };
  const narrowed = ["outcome", "from", "to", "actor", "action", "category", "targetId"].some((n) => filters[n as keyof AuditFilters]);
  return (
    <>
      <PageHeader title={copy["audit.title"]} />
      <p className="mb-4 text-subdued">{copy["audit.lead"]}</p>
      <div className="flex flex-col gap-3 rounded-t-xl border border-b-0 bg-surface p-3" data-testid="audit-filters">
        <Tabs value={filters.outcome || "all"} onValueChange={(value) => write({ ...filters, outcome: value === "all" ? "" : value, page: 1 })}>
          <TabsList>
            {OUTCOME_TABS.map((value) => (
              <TabsTrigger key={value} value={value} aria-controls={undefined} data-testid={`audit-tab-${value}`}>
                {copy[`audit.tab.${value}`]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <form className="flex flex-wrap items-end gap-3" onSubmit={apply}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audit-from">{copy["audit.from"]}</Label>
            <Input id="audit-from" type="date" className="w-40" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} data-testid="audit-from" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audit-to">{copy["audit.to"]}</Label>
            <Input id="audit-to" type="date" className="w-40" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} data-testid="audit-to" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audit-actor">{copy["audit.actor"]}</Label>
            <Input id="audit-actor" className="w-48" value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} data-testid="audit-actor" />
          </div>
          <FilterSelect
            id="audit-action"
            label={copy["audit.action"]}
            value={draft.action}
            options={ACTION_FILTERS.map((value) => ({ value, label: actionLabel(value) }))}
            onChange={(action) => setDraft({ ...draft, action })}
          />
          <FilterSelect
            id="audit-category"
            label={copy["audit.category"]}
            value={draft.category}
            options={CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))}
            onChange={(category) => setDraft({ ...draft, category })}
          />
          <Button type="submit" data-testid="audit-apply">
            {copy["audit.apply"]}
          </Button>
          {narrowed ? (
            <Button type="button" variant="ghost" onClick={() => setParams(new URLSearchParams())} data-testid="audit-clear">
              {copy["common.clearFilters"]}
            </Button>
          ) : null}
        </form>
        {filters.targetId ? (
          <p className="text-subdued" data-testid="audit-target-filter">
            {copy["audit.targetFilter"]}{" "}
            <Button type="button" variant="link" className="h-auto p-0" onClick={() => write({ ...filters, targetId: "", page: 1 })}>
              {copy["audit.targetFilter.clear"]}
            </Button>
          </p>
        ) : null}
      </div>
      {events.isError ? (
        <ErrorState onRetry={events.refetch} />
      ) : (
        <>
          <IndexTable
            columns={[
              { key: "at", header: copy["audit.col.at"], cell: (e) => formatDateTime(e.at) },
              { key: "actor", header: copy["audit.col.actor"], cell: (e) => actorLabel(e.actor) },
              { key: "action", header: copy["audit.col.action"], cell: (e) => actionLabel(e.action) },
              { key: "target", header: copy["audit.col.target"], cell: (e) => <Target event={e} /> },
              { key: "outcome", header: copy["audit.col.outcome"], cell: (e) => <OutcomeBadge outcome={e.outcome} /> },
            ]}
            rows={events.data?.items}
            rowKey={(e) => e.id}
            rowHref={(e) => `/audit/${e.id}`}
            rowLabel={(e) => formatDateTime(e.at)}
            loading={events.isPending}
            empty={<EmptyState testId="audit-empty" title={copy["audit.empty"]} />}
          />
          {events.data && events.data.total > 0 ? (
            <IndexPagination
              page={filters.page}
              size={filters.size}
              total={events.data.total}
              onPageChange={(page) => write({ ...filters, page })}
              onSizeChange={(size) => write({ ...filters, size, page: 1 })}
            />
          ) : null}
        </>
      )}
    </>
  );
}

/** /audit/:id: one event, read only, with its full detail JSON (01 A-S3). */
export function AuditDetailPage() {
  const { id = "" } = useParams();
  const event = useQuery(adminQueries.auditEvent(api.admin, id));
  const redirect = redirectFor(event.error);
  if (redirect) return <Navigate to={redirect} replace />;
  const back = { to: "/audit", label: copy["audit.title"] };
  if (event.isError) {
    return (
      <>
        <PageHeader backTo={back} title={copy["audit.title"]} />
        <ErrorState onRetry={event.refetch} />
      </>
    );
  }
  if (event.isPending) {
    return (
      <>
        <PageHeader backTo={back} title={copy["audit.title"]} />
        <DefaultSkeleton />
      </>
    );
  }
  const e = event.data;
  return (
    <>
      <PageHeader backTo={back} title={actionLabel(e.action)} badges={<OutcomeBadge outcome={e.outcome} />} />
      <div className="flex flex-col gap-4">
        <Card data-testid="audit-summary">
          <CardHeader>
            <CardTitle className="text-card-title">{copy["audit.detail.summary"]}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="text-subdued">{copy["audit.col.at"]}</dt>
              <dd>{formatDateTime(e.at)}</dd>
              <dt className="text-subdued">{copy["audit.col.actor"]}</dt>
              <dd>
                {actorLabel(e.actor)}
                {e.actor?.username ? <span className="ml-2 font-mono text-subdued">{e.actor.username}</span> : null}
              </dd>
              <dt className="text-subdued">{copy["audit.category"]}</dt>
              <dd>{categoryLabel(e.category)}</dd>
              <dt className="text-subdued">{copy["audit.detail.code"]}</dt>
              <dd className="font-mono">{e.action}</dd>
              <dt className="text-subdued">{copy["audit.col.target"]}</dt>
              <dd>
                <Target event={e} />
              </dd>
              <dt className="text-subdued">{copy["audit.detail.surface"]}</dt>
              <dd>{surfaceLabel(e.surface)}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card data-testid="audit-detail">
          <CardHeader>
            <CardTitle className="text-card-title">{copy["audit.detail.json"]}</CardTitle>
            <p className="text-subdued">{copy["audit.detail.readOnly"]}</p>
          </CardHeader>
          <CardContent>
            {e.detail ? (
              <pre className="overflow-x-auto rounded-md bg-surface-subdued p-3 font-mono text-table" data-testid="audit-detail-json">
                {JSON.stringify(e.detail, null, 2)}
              </pre>
            ) : (
              <p className="text-subdued" data-testid="audit-detail-none">{copy["audit.detail.none"]}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
