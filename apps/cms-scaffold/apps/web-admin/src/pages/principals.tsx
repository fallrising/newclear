import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminQueries,
  isApiError,
  keys,
  type AdminContentType,
  type EffectivePermission,
  type Principal,
  type PrincipalStatus,
  type RoleAssignmentInput,
} from "@cms/api";
import { useSession } from "@cms/auth";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  DefaultSkeleton,
  EmptyState,
  ErrorState,
  fill,
  IndexPagination,
  IndexTable,
  Input,
  Label,
  PageHeader,
  PAGE_SIZES,
  ResourceLayout,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from "@cms/ui";
import { api } from "../api";
import { ConfirmDialog, TemporaryPasswordDialog } from "../confirm";
import { copy } from "../copy";
import { failureText, redirectFor } from "../errors";
import { roleLabel, statusLabel } from "../labels";

/** Roles an admin can assign, in display order. `anonymous` is implicit for everyone and never assigned. */
export const ASSIGNABLE_ROLES = ["member", "editor", "operator", "admin"] as const;
/** BW5 replacePrincipalRoles: these roles need a non-empty contentTypeCodes. */
export const SCOPED_ROLES = ["editor", "operator"];
/** CreatePrincipalRequest.username pattern. */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
const STATUS_TABS = ["all", "active", "disabled", "locked"] as const;

export function StatusBadge({ status }: { status: PrincipalStatus }) {
  const variant = status === "active" ? "secondary" : status === "locked" ? "destructive" : "outline";
  return (
    <Badge variant={variant} data-testid="principal-status">
      {statusLabel(status)}
    </Badge>
  );
}

/** The role assignments shown in the form, read back from effective permissions (one entry per role, anonymous left out). */
export function assignmentsFrom(items: EffectivePermission[]): RoleAssignmentInput[] {
  const byRole = new Map<string, string[]>();
  for (const item of items) {
    if (item.role === "anonymous" || byRole.has(item.role)) continue;
    byRole.set(item.role, item.allowlist);
  }
  return [...byRole].map(([code, contentTypeCodes]) => ({ code, contentTypeCodes }));
}

function sameAssignments(a: RoleAssignmentInput[], b: RoleAssignmentInput[]): boolean {
  const norm = (list: RoleAssignmentInput[]) =>
    JSON.stringify([...list].map((r) => [r.code, [...(r.contentTypeCodes ?? [])].sort()]).sort());
  return norm(a) === norm(b);
}

/** Scoped roles without any content type; the form refuses to send them (the API would answer 400). */
export function roleProblems(value: RoleAssignmentInput[]): string[] {
  return value.filter((r) => SCOPED_ROLES.includes(r.code) && (r.contentTypeCodes ?? []).length === 0).map((r) => r.code);
}

export interface RoleFieldsProps {
  value: RoleAssignmentInput[];
  onChange: (value: RoleAssignmentInput[]) => void;
  types: AdminContentType[];
  /** The signed-in admin editing their own account: the admin role cannot be removed (surface-admin §8). */
  lockAdmin: boolean;
  showProblems: boolean;
}

export function RoleFields({ value, onChange, types, lockAdmin, showProblems }: RoleFieldsProps) {
  const selected = (code: string) => value.find((r) => r.code === code);
  const problems = roleProblems(value);
  const setRole = (code: string, on: boolean) =>
    onChange(on ? [...value, { code, contentTypeCodes: [] }] : value.filter((r) => r.code !== code));
  const setType = (code: string, type: string, on: boolean) =>
    onChange(
      value.map((r) =>
        r.code !== code ? r : { ...r, contentTypeCodes: on ? [...(r.contentTypeCodes ?? []), type] : (r.contentTypeCodes ?? []).filter((t) => t !== type) },
      ),
    );
  return (
    <fieldset className="flex flex-col gap-3" data-testid="role-fields">
      <legend className="sr-only">{copy["principals.roles"]}</legend>
      {ASSIGNABLE_ROLES.map((code) => {
        const current = selected(code);
        const locked = code === "admin" && lockAdmin && current !== undefined;
        return (
          <div key={code} className="flex flex-col gap-2">
            <label className="flex items-start gap-2">
              <Checkbox
                checked={current !== undefined}
                disabled={locked}
                onCheckedChange={(on) => setRole(code, on === true)}
                aria-describedby={`role-hint-${code}`}
                data-testid={`role-${code}`}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold">{roleLabel(code)}</span>
                <span id={`role-hint-${code}`} className="block text-subdued">
                  {copy[`principals.role.${code}.hint`]}
                </span>
              </span>
            </label>
            {current && SCOPED_ROLES.includes(code) ? (
              <div className="ml-6 flex flex-col gap-1" role="group" aria-label={fill(copy["principals.role.types"], { role: roleLabel(code) })}>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {types.map((type) => (
                    <label key={type.key} className="flex items-center gap-1.5">
                      <Checkbox
                        checked={(current.contentTypeCodes ?? []).includes(type.key)}
                        onCheckedChange={(on) => setType(code, type.key, on === true)}
                        data-testid={`role-${code}-type-${type.key}`}
                      />
                      {type.displayName}
                    </label>
                  ))}
                </div>
                {showProblems && problems.includes(code) ? <p className="text-critical">{copy["principals.role.needTypes"]}</p> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}

function readStatus(value: string | null): (typeof STATUS_TABS)[number] {
  return (STATUS_TABS as readonly string[]).includes(value ?? "") ? (value as (typeof STATUS_TABS)[number]) : "all";
}

function positive(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** /principals: every principal (the API does not page), filtered and paged here; state in the URL (01 §4.4). */
export function PrincipalsPage() {
  const [params, setParams] = useSearchParams();
  const status = readStatus(params.get("status"));
  const q = params.get("q") ?? "";
  const sizeParam = positive(params.get("size"), 20);
  const size = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : 20;
  const principals = useQuery(adminQueries.principals(api.admin));
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return principals.data?.items.filter(
      (p) =>
        (status === "all" || p.status === status) &&
        (!needle || p.username.includes(needle) || p.displayName.toLowerCase().includes(needle)),
    );
  }, [principals.data, status, q]);
  const pages = Math.max(1, Math.ceil((filtered?.length ?? 0) / size));
  const page = Math.min(positive(params.get("page"), 1), pages);
  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next, { replace: "q" in changes });
  };
  return (
    <>
      <PageHeader title={copy["principals.title"]} primaryAction={{ label: copy["principals.new"], to: "/principals/new", testId: "principal-new" }} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Tabs value={status} onValueChange={(value) => update({ status: value === "all" ? "" : value })}>
          <TabsList>
            {STATUS_TABS.map((value) => (
              <TabsTrigger key={value} value={value} aria-controls={undefined} data-testid={`principals-tab-${value}`}>
                {copy[`principals.tab.${value}`]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Input
          className="max-w-xs"
          aria-label={copy["principals.search"]}
          placeholder={copy["principals.search"]}
          value={q}
          onChange={(event) => update({ q: event.target.value })}
          data-testid="principals-search"
        />
      </div>
      {principals.isError ? (
        <ErrorState onRetry={principals.refetch} />
      ) : (
        <>
          <IndexTable
            columns={[
              { key: "username", header: copy["principals.col.username"], cell: (p) => p.username },
              { key: "name", header: copy["principals.col.name"], cell: (p) => p.displayName },
              { key: "email", header: copy["principals.col.email"], cell: (p) => p.email ?? copy["common.none"] },
              { key: "status", header: copy["principals.col.status"], cell: (p) => <StatusBadge status={p.status} /> },
            ]}
            rows={filtered?.slice((page - 1) * size, page * size)}
            rowKey={(p) => p.id}
            rowHref={(p) => `/principals/${p.id}`}
            rowLabel={(p) => p.username}
            loading={principals.isPending}
            empty={
              <EmptyState
                testId="principals-empty"
                title={copy["principals.noMatch"]}
                action={
                  <Button variant="outline" onClick={() => setParams(new URLSearchParams())}>
                    {copy["common.clearFilters"]}
                  </Button>
                }
              />
            }
          />
          {filtered && filtered.length > 0 ? (
            <IndexPagination
              page={page}
              size={size}
              total={filtered.length}
              onPageChange={(next) => update({ page: next === 1 ? "" : String(next) })}
              onSizeChange={(next) => update({ size: next === 20 ? "" : String(next) })}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function useEnabledTypes() {
  const types = useQuery(adminQueries.types(api.admin));
  return { ...types, enabled: types.data?.items.filter((t) => t.enabled) ?? [] };
}

/** /principals/new: username, names, roles; the server's temporary password is shown once (surface-admin §4.4). */
export function PrincipalNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const types = useEnabledTypes();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<RoleAssignmentInput[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [created, setCreated] = useState<{ id: string; password: string } | null>(null);
  const usernameValid = USERNAME_PATTERN.test(username);
  const create = useMutation({
    mutationFn: async () => {
      const principal = await api.admin.createPrincipal({ username, displayName: displayName.trim() || null, email: email.trim() || null });
      let rolesSaved = true;
      if (roles.length > 0) {
        rolesSaved = await api.admin.replacePrincipalRoles(principal.id, roles).then(
          () => true,
          () => false,
        );
      }
      return { principal, rolesSaved };
    },
    onSuccess: ({ principal, rolesSaved }) => {
      void queryClient.invalidateQueries({ queryKey: keys.admin.principals() });
      if (!rolesSaved) toast.error(copy["principals.new.rolesFailed"]);
      setCreated({ id: principal.id, password: principal.temporaryPassword });
    },
    onError: (error) => {
      if (isApiError(error) && error.code === "VALIDATION_FAILED") setRejected(true);
      else toast.error(failureText(error));
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setRejected(false);
    if (!usernameValid || roleProblems(roles).length > 0) return;
    create.mutate();
  };
  return (
    <>
      <PageHeader backTo={{ to: "/principals", label: copy["principals.title"] }} title={copy["principals.new.title"]} />
      <form className="flex max-w-2xl flex-col gap-4" onSubmit={submit} noValidate>
        {rejected ? (
          <Alert variant="destructive" data-testid="principal-rejected">
            <AlertDescription>{copy["principals.new.rejected"]}</AlertDescription>
          </Alert>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle className="text-card-title">{copy["principals.profile"]}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-username">{copy["principals.col.username"]} *</Label>
              <Input
                id="new-username"
                value={username}
                onChange={(event) => setUsername(event.target.value.trim())}
                aria-invalid={submitted && !usernameValid}
                aria-describedby="new-username-hint"
                autoComplete="off"
                data-testid="new-username"
              />
              <p id="new-username-hint" className={submitted && !usernameValid ? "text-critical" : "text-subdued"}>
                {copy["principals.username.hint"]}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-name">{copy["principals.col.name"]}</Label>
              <Input id="new-name" value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} data-testid="new-name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-email">{copy["principals.col.email"]}</Label>
              <Input id="new-email" type="email" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} data-testid="new-email" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-card-title">{copy["principals.roles"]}</CardTitle>
          </CardHeader>
          <CardContent>
            {types.isPending ? <DefaultSkeleton /> : <RoleFields value={roles} onChange={setRoles} types={types.enabled} lockAdmin={false} showProblems={submitted} />}
          </CardContent>
        </Card>
        <div>
          <Button type="submit" disabled={create.isPending} data-testid="new-submit">
            {create.isPending ? copy["common.working"] : copy["principals.new.submit"]}
          </Button>
        </div>
      </form>
      <TemporaryPasswordDialog
        password={created?.password ?? null}
        title={copy["principals.new.created"]}
        onClose={() => navigate(`/principals/${created!.id}`, { replace: true })}
      />
    </>
  );
}

type Pending = "disable" | "reset" | null;

function Profile({ principal }: { principal: Principal }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(principal.displayName);
  const [email, setEmail] = useState(principal.email ?? "");
  useEffect(() => {
    setDisplayName(principal.displayName);
    setEmail(principal.email ?? "");
  }, [principal]);
  const clearingEmail = principal.email !== null && email.trim() === "";
  const changes = {
    ...(displayName.trim() !== principal.displayName && displayName.trim() !== "" ? { displayName: displayName.trim() } : {}),
    ...(email.trim() !== (principal.email ?? "") && email.trim() !== "" ? { email: email.trim() } : {}),
  };
  const save = useMutation({
    mutationFn: () => api.admin.patchPrincipal(principal.id, changes),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.admin.principal(principal.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.admin.principals(), exact: true });
      toast.success(copy["principals.profile.saved"]);
    },
    onError: (error) => toast.error(isApiError(error) && error.code === "VALIDATION_FAILED" ? copy["principals.profile.invalid"] : failureText(error)),
  });
  return (
    <Card data-testid="principal-profile">
      <CardHeader>
        <CardTitle className="text-card-title">{copy["principals.profile"]}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6">
          <dt className="text-subdued">{copy["principals.col.username"]}</dt>
          <dd className="font-mono" data-testid="profile-username">{principal.username}</dd>
        </dl>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-name">{copy["principals.col.name"]}</Label>
          <Input id="profile-name" value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} data-testid="profile-name" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-email">{copy["principals.col.email"]}</Label>
          <Input id="profile-email" type="email" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} data-testid="profile-email" />
          {clearingEmail ? <p className="text-caution">{copy["principals.email.cannotClear"]}</p> : null}
        </div>
        <div>
          <Button type="button" variant="outline" disabled={Object.keys(changes).length === 0 || save.isPending} onClick={() => save.mutate()} data-testid="profile-save">
            {copy["principals.profile.save"]}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Roles({ principal, initial, types, self }: { principal: Principal; initial: RoleAssignmentInput[]; types: AdminContentType[]; self: boolean }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(initial);
  const [tried, setTried] = useState(false);
  useEffect(() => setValue(initial), [initial]);
  const changed = !sameAssignments(value, initial);
  const save = useMutation({
    mutationFn: () => api.admin.replacePrincipalRoles(principal.id, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.admin.effectivePermissions(principal.id) });
      toast.success(copy["principals.roles.saved"]);
    },
    onError: (error) => toast.error(isApiError(error) && error.code === "VALIDATION_FAILED" ? copy["principals.roles.invalid"] : failureText(error)),
  });
  return (
    <Card data-testid="principal-roles">
      <CardHeader>
        <CardTitle className="text-card-title">{copy["principals.roles"]}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <RoleFields value={value} onChange={setValue} types={types} lockAdmin={self} showProblems={tried} />
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={!changed || save.isPending}
            onClick={() => {
              setTried(true);
              if (roleProblems(value).length === 0) save.mutate();
            }}
            data-testid="roles-save"
          >
            {copy["principals.roles.save"]}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusCard({ principal, self, onDisable, onReset }: { principal: Principal; self: boolean; onDisable: () => void; onReset: () => void }) {
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (kind: "unlock" | "enable") => (kind === "unlock" ? api.admin.unlockPrincipal(principal.id) : api.admin.patchPrincipal(principal.id, { status: "active" })),
    onSuccess: (updated, kind) => {
      queryClient.setQueryData(keys.admin.principal(principal.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.admin.principals(), exact: true });
      toast.success(copy[kind === "unlock" ? "principals.unlocked" : "principals.enabled"]);
    },
    onError: (error) => toast.error(failureText(error)),
  });
  return (
    <Card data-testid="principal-status-card">
      <CardHeader>
        <CardTitle className="text-card-title">{copy["principals.status"]}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p>
          <StatusBadge status={principal.status} /> <span className="text-subdued">{copy[`principals.status.${principal.status}.hint`]}</span>
        </p>
        {self ? <p className="text-subdued" data-testid="principal-self">{copy["principals.self"]}</p> : null}
        <div className="flex flex-wrap gap-2">
          {principal.status === "locked" ? (
            <Button type="button" variant="outline" disabled={change.isPending} onClick={() => change.mutate("unlock")} data-testid="principal-unlock">
              {copy["principals.unlock"]}
            </Button>
          ) : null}
          {principal.status === "disabled" ? (
            <Button type="button" variant="outline" disabled={change.isPending} onClick={() => change.mutate("enable")} data-testid="principal-enable">
              {copy["principals.enable"]}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={onReset} data-testid="principal-reset">
            {copy["principals.reset"]}
          </Button>
          {principal.status !== "disabled" && !self ? (
            <Button type="button" variant="destructive" onClick={onDisable} data-testid="principal-disable">
              {copy["principals.disable"]}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** /principals/:id: profile, roles, status actions (surface-admin §4.4, §8: no self-disable, no self-demotion). */
export function PrincipalDetailPage() {
  const { id = "" } = useParams();
  const me = useSession().me!;
  const queryClient = useQueryClient();
  const principal = useQuery(adminQueries.principal(api.admin, id));
  const effective = useQuery(adminQueries.effectivePermissions(api.admin, id));
  const types = useEnabledTypes();
  const [pending, setPending] = useState<Pending>(null);
  const [password, setPassword] = useState<string | null>(null);
  const initial = useMemo(() => (effective.data ? assignmentsFrom(effective.data.items) : []), [effective.data]);
  const disable = useMutation({
    mutationFn: () => api.admin.disablePrincipal(id),
    onSuccess: (updated) => {
      queryClient.setQueryData(keys.admin.principal(id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.admin.principals(), exact: true });
      setPending(null);
      toast.success(copy["principals.disabled"]);
    },
    onError: (error) => toast.error(failureText(error)),
  });
  const reset = useMutation({
    mutationFn: () => api.admin.resetPassword(id),
    onSuccess: (result) => {
      setPending(null);
      setPassword(result.temporaryPassword);
    },
    onError: (error) => toast.error(failureText(error)),
  });
  const redirect = redirectFor(principal.error);
  if (redirect) return <Navigate to={redirect} replace />;
  const header = (title: string, badge?: PrincipalStatus) => (
    <PageHeader backTo={{ to: "/principals", label: copy["principals.title"] }} title={title} badges={badge ? <StatusBadge status={badge} /> : undefined} />
  );
  if (principal.isError) {
    return (
      <>
        {header(copy["principals.title"])}
        <ErrorState onRetry={principal.refetch} />
      </>
    );
  }
  if (principal.isPending) {
    return (
      <>
        {header(copy["principals.title"])}
        <DefaultSkeleton />
      </>
    );
  }
  const p = principal.data;
  const self = p.id === me.principal.id;
  return (
    <>
      {header(p.displayName, p.status)}
      <ResourceLayout
        main={
          <>
            <Profile principal={p} />
            {effective.isError || types.isError ? (
              <ErrorState onRetry={() => void (effective.refetch(), types.refetch())} />
            ) : effective.isPending || types.isPending ? (
              <DefaultSkeleton />
            ) : (
              <Roles principal={p} initial={initial} types={types.enabled} self={self} />
            )}
          </>
        }
        aside={<StatusCard principal={p} self={self} onDisable={() => setPending("disable")} onReset={() => setPending("reset")} />}
      />
      <ConfirmDialog
        open={pending === "disable"}
        title={fill(copy["principals.disable.title"], { name: p.displayName })}
        description={copy["principals.disable.body"]}
        confirmLabel={copy["principals.disable"]}
        phrase={p.username}
        destructive
        pending={disable.isPending}
        onConfirm={() => disable.mutate()}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending === "reset"}
        title={fill(copy["principals.reset.title"], { name: p.displayName })}
        description={copy["principals.reset.body"]}
        confirmLabel={copy["principals.reset"]}
        pending={reset.isPending}
        onConfirm={() => reset.mutate()}
        onCancel={() => setPending(null)}
      />
      <TemporaryPasswordDialog password={password} title={copy["principals.reset.done"]} onClose={() => setPassword(null)} />
    </>
  );
}
