import { useMemo, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminQueries, keys, type AdminContentType } from "@cms/api";
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
  fill,
  IndexTable,
  Input,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from "@cms/ui";
import { api } from "../api";
import { ConfirmDialog } from "../confirm";
import { copy } from "../copy";
import { failureText } from "../errors";
import { fieldLabel, fieldTypeLabel, slugPolicyLabel, visibilityLabel } from "../labels";

const TABS = ["all", "enabled", "disabled"] as const;
type TypeTab = (typeof TABS)[number];

export function EnabledBadge({ enabled }: { enabled: boolean }) {
  return enabled ? <Badge variant="secondary">{copy["types.enabled"]}</Badge> : <Badge variant="outline">{copy["types.disabled"]}</Badge>;
}

/**
 * surface-admin §6.2 / V2-AC-16: disabling asks for the type's display name; enabling only asks once.
 * `type` null keeps the dialog closed.
 */
export function TypeToggleDialog({ type, onClose }: { type: AdminContentType | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (target: AdminContentType) => (target.enabled ? api.admin.disableType(target.key) : api.admin.enableType(target.key)),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: keys.admin.types() });
      toast.success(fill(copy[updated.enabled ? "types.enabledToast" : "types.disabledToast"], { name: updated.displayName }));
      onClose();
    },
    onError: (error) => toast.error(failureText(error)),
  });
  const disabling = type?.enabled ?? false;
  const name = type?.displayName ?? "";
  return (
    <ConfirmDialog
      open={type !== null}
      title={fill(copy[disabling ? "types.disable.title" : "types.enable.title"], { name })}
      description={copy[disabling ? "types.disable.body" : "types.enable.body"]}
      confirmLabel={copy[disabling ? "types.disable.confirm" : "types.enable.confirm"]}
      phrase={disabling ? name : undefined}
      destructive={disabling}
      pending={toggle.isPending}
      onConfirm={() => type && toggle.mutate(type)}
      onCancel={onClose}
    />
  );
}

function readTab(value: string | null): TypeTab {
  return (TABS as readonly string[]).includes(value ?? "") ? (value as TypeTab) : "all";
}

/** /types: every registered type, including disabled ones. No "new type" control (surface-admin AC-C). */
export function TypesPage() {
  const [params, setParams] = useSearchParams();
  const tab = readTab(params.get("enabled") === "true" ? "enabled" : params.get("enabled") === "false" ? "disabled" : null);
  const q = params.get("q") ?? "";
  const types = useQuery(adminQueries.types(api.admin));
  const [target, setTarget] = useState<AdminContentType | null>(null);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return types.data?.items.filter(
      (t) =>
        (tab === "all" || t.enabled === (tab === "enabled")) &&
        (!needle || t.displayName.toLowerCase().includes(needle) || t.key.includes(needle)),
    );
  }, [types.data, tab, q]);
  const update = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: name === "q" });
  };
  return (
    <>
      <PageHeader title={copy["types.title"]} />
      <p className="mb-4 text-subdued">{copy["types.lead"]}</p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(value) => update("enabled", value === "enabled" ? "true" : value === "disabled" ? "false" : "")}>
          <TabsList>
            {TABS.map((value) => (
              <TabsTrigger key={value} value={value} aria-controls={undefined} data-testid={`types-tab-${value}`}>
                {copy[`types.tab.${value}`]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          className="max-w-xs"
          aria-label={copy["types.search"]}
          placeholder={copy["types.search"]}
          value={q}
          onChange={(event) => update("q", event.target.value)}
          data-testid="types-search"
        />
      </div>
      {types.isError ? (
        <ErrorState onRetry={types.refetch} />
      ) : types.data && types.data.items.length === 0 ? (
        <EmptyState testId="types-none" title={copy["types.none.title"]} description={copy["types.none.body"]} />
      ) : (
        <IndexTable
          columns={[
            { key: "name", header: copy["types.col.name"], cell: (t) => t.displayName },
            { key: "key", header: copy["types.col.key"], cell: (t) => <span className="font-mono text-subdued">{t.key}</span> },
            { key: "status", header: copy["types.col.status"], cell: (t) => <EnabledBadge enabled={t.enabled} /> },
            { key: "fields", header: copy["types.col.fields"], cell: (t) => t.fields.length },
            {
              key: "action",
              header: copy["types.col.action"],
              cell: (t) => (
                <Button variant="outline" size="sm" onClick={() => setTarget(t)} data-testid={`type-toggle-${t.key}`}>
                  {t.enabled ? copy["types.disable"] : copy["types.enable"]}
                </Button>
              ),
            },
          ]}
          rows={rows}
          rowKey={(t) => t.key}
          rowHref={(t) => `/types/${t.key}`}
          rowLabel={(t) => t.displayName}
          loading={types.isPending}
          empty={<EmptyState testId="types-no-match" title={copy["types.noMatch"]} />}
        />
      )}
      <TypeToggleDialog type={target} onClose={() => setTarget(null)} />
    </>
  );
}

function YesNo({ value }: { value: boolean }) {
  return <>{value ? copy["common.yes"] : copy["common.no"]}</>;
}

function Detail({ type }: { type: AdminContentType }) {
  const [target, setTarget] = useState<AdminContentType | null>(null);
  const title = type.fields.find((f) => f.key === type.titleField);
  return (
    <>
      <PageHeader
        backTo={{ to: "/types", label: copy["types.title"] }}
        title={type.displayName}
        badges={<EnabledBadge enabled={type.enabled} />}
        primaryAction={{
          label: type.enabled ? copy["types.disable.confirm"] : copy["types.enable.confirm"],
          onSelect: () => setTarget(type),
          testId: "type-toggle",
        }}
      />
      <div className="flex flex-col gap-4">
        <Card data-testid="type-settings">
          <CardHeader>
            <CardTitle className="text-card-title">{copy["type.settings"]}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
              <dt className="text-subdued">{copy["types.col.key"]}</dt>
              <dd className="font-mono">{type.key}</dd>
              <dt className="text-subdued">{copy["type.plural"]}</dt>
              <dd>{type.pluralDisplayName}</dd>
              <dt className="text-subdued">{copy["type.titleField"]}</dt>
              <dd>{title ? fieldLabel(title) : type.titleField}</dd>
              <dt className="text-subdued">{copy["type.slugPolicy"]}</dt>
              <dd>{slugPolicyLabel(type.slugPolicy)}</dd>
              <dt className="text-subdued">{copy["type.singleton"]}</dt>
              <dd><YesNo value={type.singleton} /></dd>
              <dt className="text-subdued">{copy["type.previewable"]}</dt>
              <dd><YesNo value={type.previewable} /></dd>
            </dl>
          </CardContent>
        </Card>
        <Card data-testid="type-fields">
          <CardHeader>
            <CardTitle className="text-card-title">{copy["type.fields"]}</CardTitle>
            <p className="text-subdued">{copy["type.fields.lead"]}</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table className="text-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{copy["field.col.name"]}</TableHead>
                  <TableHead>{copy["types.col.key"]}</TableHead>
                  <TableHead>{copy["field.col.type"]}</TableHead>
                  <TableHead>{copy["field.col.required"]}</TableHead>
                  <TableHead>{copy["field.col.listable"]}</TableHead>
                  <TableHead>{copy["field.col.filterable"]}</TableHead>
                  <TableHead>{copy["field.col.visibility"]}</TableHead>
                  <TableHead>{copy["field.col.options"]}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...type.fields]
                  .sort((a, b) => a.order - b.order)
                  .map((field) => (
                    <TableRow key={field.key} data-testid="type-field" className={field.enabled ? undefined : "text-subdued"}>
                      <TableCell>
                        {fieldLabel(field)}
                        {field.enabled ? null : ` ${copy["field.disabled"]}`}
                      </TableCell>
                      <TableCell className="font-mono">{field.key}</TableCell>
                      <TableCell>{fieldTypeLabel(field.type)}</TableCell>
                      <TableCell>{field.required ? copy["common.yes"] : copy["common.none"]}</TableCell>
                      <TableCell>{field.listable ? copy["common.yes"] : copy["common.none"]}</TableCell>
                      <TableCell>{field.filterable ? copy["common.yes"] : copy["common.none"]}</TableCell>
                      <TableCell>{visibilityLabel(field.visibility)}</TableCell>
                      <TableCell>
                        {field.enumValues.length > 0
                          ? field.enumValues.map((v) => field.enumLabels[v] ?? v).join("、")
                          : field.refTarget
                            ? fill(copy["field.refTarget"], { target: field.refTarget })
                            : copy["common.none"]}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <TypeToggleDialog type={target} onClose={() => setTarget(null)} />
    </>
  );
}

/** /types/:key: read-only schema plus the enable switch (surface-admin §3.1: no field editing). */
export function TypeDetailPage() {
  const { key = "" } = useParams();
  const types = useQuery(adminQueries.types(api.admin));
  if (types.isPending) return <DefaultSkeleton />;
  if (types.isError) return <ErrorState onRetry={types.refetch} />;
  const type = types.data.items.find((t) => t.key === key);
  return type ? <Detail type={type} /> : <Navigate to="/404" replace />;
}
