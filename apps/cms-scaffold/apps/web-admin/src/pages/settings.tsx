import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminQueries, isApiError, keys, type RetentionDays } from "@cms/api";
import { useSession } from "@cms/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ContextualSaveBar,
  fill,
  Label,
  PageHeader,
  QueryBoundary,
  RadioGroup,
  RadioGroupItem,
  toast,
} from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { failureText } from "../errors";
import { formatDateTime } from "../format";
import { canGlobal, hasAdminRole } from "../nav";

const RETENTION: RetentionDays[] = [30, 90, 365];

/** /settings: the settings that exist, each a card linking to its page (Shopify settings index, 01 §2.1). */
export function SettingsPage() {
  const me = useSession().me!;
  const cards = [
    { show: canGlobal(me, "manage_settings"), to: "/settings/audit", title: copy["settings.audit"], body: copy["settings.audit.lead"], testId: "settings-audit" },
    { show: canGlobal(me, "manage_media"), to: "/media", title: copy["media.title"], body: copy["settings.media.lead"], testId: "settings-media" },
    { show: hasAdminRole(me), to: "/entries", title: copy["entries.title"], body: copy["settings.entries.lead"], testId: "settings-entries" },
  ].filter((card) => card.show);
  return (
    <>
      <PageHeader title={copy["settings.title"]} />
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <Card key={card.to} data-testid={card.testId}>
            <CardHeader>
              <CardTitle className="text-card-title">
                <Link to={card.to} className="hover:underline">
                  {card.title}
                </Link>
              </CardTitle>
              <CardDescription>{card.body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </>
  );
}

function RetentionForm({ current, updatedAt, updatedBy }: { current: RetentionDays; updatedAt: string; updatedBy: string | null }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState<RetentionDays>(current);
  useEffect(() => setValue(current), [current]);
  const save = useMutation({
    mutationFn: () => api.admin.patchAuditSettings(value),
    onSuccess: (settings) => {
      queryClient.setQueryData(keys.admin.auditSettings(), settings);
      toast.success(copy["retention.saved"]);
    },
    onError: (error) => toast.error(isApiError(error) && error.status === 422 ? copy["retention.invalid"] : failureText(error)),
  });
  return (
    <Card data-testid="retention-card">
      <CardHeader>
        <CardTitle className="text-card-title">{copy["settings.audit"]}</CardTitle>
        <CardDescription>{copy["retention.lead"]}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <RadioGroup value={String(value)} onValueChange={(next) => setValue(Number(next) as RetentionDays)} aria-label={copy["settings.audit"]}>
          {RETENTION.map((days) => (
            <div key={days} className="flex items-center gap-2">
              <RadioGroupItem id={`retention-${days}`} value={String(days)} data-testid={`retention-${days}`} />
              <Label htmlFor={`retention-${days}`}>{fill(copy[days === 90 ? "retention.defaultOption" : "retention.option"], { days })}</Label>
            </div>
          ))}
        </RadioGroup>
        <p className="text-subdued" data-testid="retention-updated">
          {updatedBy ? fill(copy["retention.updated"], { at: formatDateTime(updatedAt) }) : copy["retention.default"]}
        </p>
      </CardContent>
      <ContextualSaveBar dirty={value !== current} saving={save.isPending} onSave={() => save.mutate()} onDiscard={() => setValue(current)} />
    </Card>
  );
}

/** /settings/audit: audit retention 30 / 90 / 365 days with an explicit save (surface-admin §7.2, BW4). */
export function AuditSettingsPage() {
  const settings = useQuery(adminQueries.auditSettings(api.admin));
  return (
    <>
      <PageHeader backTo={{ to: "/settings", label: copy["settings.title"] }} title={copy["settings.audit"]} />
      <QueryBoundary query={settings}>
        {(s) => <RetentionForm current={s.retentionDays} updatedAt={s.updatedAt} updatedBy={s.updatedBy} />}
      </QueryBoundary>
    </>
  );
}
