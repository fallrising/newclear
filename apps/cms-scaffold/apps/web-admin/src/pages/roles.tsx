import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminQueries, isApiError, keys, type AdminContentType, type CmsAction, type Permission, type PermissionInput } from "@cms/api";
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  ContextualSaveBar,
  DefaultSkeleton,
  EmptyState,
  ErrorState,
  fill,
  IndexTable,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@cms/ui";
import { api } from "../api";
import { ConfirmDialog } from "../confirm";
import { copy } from "../copy";
import { failureText } from "../errors";
import { permissionLabel, roleLabel } from "../labels";

/** Matrix columns: the type-bound actions, in CmsAction order (surface-admin §4.4). */
export const TYPE_ACTIONS: CmsAction[] = ["read_published", "read_draft", "create", "update", "publish", "unpublish", "delete", "archive"];
/** Grants without a content type (the "治理權限" card). */
export const GLOBAL_ACTIONS: CmsAction[] = ["manage_media", "manage_types", "manage_principals", "manage_settings", "read_audit"];
/** The row key of a grant whose contentTypeCode is null ("所有類型"). */
export const ALL_TYPES = "*";
/** Roles whose grants the matrix shows read-only: editing them could lock every admin out (surface-admin AC-H). */
export const LOCKED_ROLES = ["admin"];

/** "action|type" of a grant; type is ALL_TYPES for null. */
export function cellKey(action: CmsAction, type: string | null): string {
  return `${action}|${type ?? ALL_TYPES}`;
}

function plainKeys(permissions: Permission[]): Set<string> {
  return new Set(permissions.filter((p) => !p.predicateJson).map((p) => cellKey(p.action, p.contentTypeCode)));
}

/**
 * The PUT body: every grant with a predicate unchanged, every plain grant whose cell is still checked unchanged, and one
 * new grant per newly checked cell (no allowedSurfaces: the server applies its default, BW5 replaceRolePermissions).
 */
export function buildPermissions(original: Permission[], checked: Set<string>): PermissionInput[] {
  const before = plainKeys(original);
  const kept = original
    .filter((p) => p.predicateJson || checked.has(cellKey(p.action, p.contentTypeCode)))
    .map((p) => ({ action: p.action, contentTypeCode: p.contentTypeCode, predicateJson: p.predicateJson, allowedSurfaces: p.allowedSurfaces }));
  const added = [...checked]
    .filter((key) => !before.has(key))
    .map((key) => {
      const [action, type] = key.split("|");
      return { action: action as CmsAction, contentTypeCode: type === ALL_TYPES ? null : type };
    });
  return [...kept, ...added];
}

/** /roles: the system roles. The API has no role creation or deletion (W4.md §1.2). */
export function RolesPage() {
  const roles = useQuery(adminQueries.roles(api.admin));
  return (
    <>
      <PageHeader title={copy["roles.title"]} />
      <p className="mb-4 text-subdued">{copy["roles.lead"]}</p>
      {roles.isError ? (
        <ErrorState onRetry={roles.refetch} />
      ) : (
        <IndexTable
          columns={[
            { key: "name", header: copy["roles.col.name"], cell: (r) => roleLabel(r.code, r.displayName) },
            { key: "code", header: copy["roles.col.code"], cell: (r) => <span className="font-mono text-subdued">{r.code}</span> },
            { key: "kind", header: copy["roles.col.kind"], cell: (r) => (r.system ? <Badge variant="secondary">{copy["roles.system"]}</Badge> : copy["roles.custom"]) },
          ]}
          rows={roles.data?.items}
          rowKey={(r) => r.code}
          rowHref={(r) => `/roles/${r.code}`}
          rowLabel={(r) => roleLabel(r.code, r.displayName)}
          loading={roles.isPending}
          empty={<EmptyState title={copy["roles.empty"]} />}
        />
      )}
    </>
  );
}

function Cell({ keyName, label, checked, locked, scoped, onToggle }: { keyName: string; label: string; checked: boolean; locked: boolean; scoped: boolean; onToggle: (key: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Checkbox checked={checked} disabled={locked} aria-label={label} onCheckedChange={() => onToggle(keyName)} data-testid={`cell-${keyName.replace("|", "-")}`} />
      {scoped ? (
        <Badge variant="outline" className="px-1 text-table">
          {copy["roles.scoped"]}
        </Badge>
      ) : null}
    </div>
  );
}

function Matrix({ code, original, types }: { code: string; original: Permission[]; types: AdminContentType[] }) {
  const queryClient = useQueryClient();
  const initial = useMemo(() => plainKeys(original), [original]);
  const [checked, setChecked] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setChecked(initial), [initial]);
  const locked = LOCKED_ROLES.includes(code);
  const added = [...checked].filter((k) => !initial.has(k)).length;
  const removed = [...initial].filter((k) => !checked.has(k)).length;
  const dirty = added + removed > 0;
  const scoped = new Set(original.filter((p) => p.predicateJson).map((p) => cellKey(p.action, p.contentTypeCode)));
  const save = useMutation({
    mutationFn: () => api.admin.replaceRolePermissions(code, buildPermissions(original, checked)),
    onSuccess: async () => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: keys.admin.rolePermissions(code) });
      toast.success(copy["roles.saved"]);
    },
    onError: (error) => {
      // surface-admin §9.4: a 4xx keeps the edits (Dirty → Dirty).
      setConfirming(false);
      toast.error(isApiError(error) && error.code === "VALIDATION_FAILED" ? copy["roles.invalid"] : failureText(error));
    },
  });
  const toggle = (key: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const rows: { key: string | null; label: string; disabled: boolean }[] = [
    { key: null, label: copy["roles.allTypes"], disabled: false },
    ...types.map((t) => ({ key: t.key, label: t.displayName, disabled: !t.enabled })),
  ];
  return (
    <>
      {locked ? (
        <Alert className="mb-4" data-testid="role-locked">
          <AlertDescription>{copy["roles.locked"]}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-4">
        <Card data-testid="matrix-types">
          <CardHeader>
            <CardTitle className="text-card-title">{copy["roles.matrix"]}</CardTitle>
            <p className="text-subdued">{copy["roles.matrix.lead"]}</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table className="text-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{copy["roles.col.type"]}</TableHead>
                  {TYPE_ACTIONS.map((action) => (
                    <TableHead key={action}>{permissionLabel(action)}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key ?? ALL_TYPES} className={row.disabled ? "text-subdued" : undefined} data-testid="matrix-row">
                    <TableCell className="font-semibold">
                      {row.label}
                      {row.disabled ? ` ${copy["roles.typeDisabled"]}` : ""}
                    </TableCell>
                    {TYPE_ACTIONS.map((action) => {
                      const key = cellKey(action, row.key);
                      return (
                        <TableCell key={action}>
                          <Cell keyName={key} label={`${row.label} ${permissionLabel(action)}`} checked={checked.has(key)} locked={locked} scoped={scoped.has(key)} onToggle={toggle} />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card data-testid="matrix-global">
          <CardHeader>
            <CardTitle className="text-card-title">{copy["roles.global"]}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {GLOBAL_ACTIONS.map((action) => {
              const key = cellKey(action, null);
              return (
                <label key={action} className="flex items-center gap-2">
                  <Cell keyName={key} label={permissionLabel(action)} checked={checked.has(key)} locked={locked} scoped={false} onToggle={toggle} />
                  <span>{permissionLabel(action)}</span>
                </label>
              );
            })}
          </CardContent>
        </Card>
      </div>
      <ContextualSaveBar dirty={dirty} saving={save.isPending} onSave={() => setConfirming(true)} onDiscard={() => setChecked(initial)} />
      <ConfirmDialog
        open={confirming}
        title={copy["roles.confirm.title"]}
        description={fill(copy["roles.confirm.body"], { added, removed })}
        confirmLabel={copy["roles.confirm.submit"]}
        pending={save.isPending}
        onConfirm={() => save.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

/** /roles/:code: the permission matrix with an explicit save (surface-admin §4.4, §9.4, AC-K). */
export function RoleDetailPage() {
  const { code = "" } = useParams();
  const permissions = useQuery(adminQueries.rolePermissions(api.admin, code));
  const types = useQuery(adminQueries.types(api.admin));
  const header = <PageHeader backTo={{ to: "/roles", label: copy["roles.title"] }} title={roleLabel(code)} />;
  if (permissions.isError) {
    // An unknown role code is 400 VALIDATION_FAILED (BW5 getRolePermissions): the role does not exist.
    if (isApiError(permissions.error) && permissions.error.status === 400) return <Navigate to="/404" replace />;
    return (
      <>
        {header}
        <ErrorState onRetry={permissions.refetch} />
      </>
    );
  }
  if (types.isError) {
    return (
      <>
        {header}
        <ErrorState onRetry={types.refetch} />
      </>
    );
  }
  if (permissions.isPending || types.isPending) {
    return (
      <>
        {header}
        <DefaultSkeleton />
      </>
    );
  }
  return (
    <>
      {header}
      <Matrix code={code} original={permissions.data.items} types={types.data.items} />
    </>
  );
}
