import type { AdminContentType, AuditActor, CmsAction, PrincipalStatus } from "@cms/api";
import { copy, type CopyKey } from "./copy";

function pick(prefix: string, value: string | null | undefined, fallback: string): string {
  const key = `${prefix}.${value ?? ""}` as CopyKey;
  return key in copy ? copy[key] : fallback;
}

/** System roles have zh-Hant names; any other code is shown as its display name from GET /roles. */
export function roleLabel(code: string, displayName?: string): string {
  return pick("role", code, displayName ?? code);
}

export function statusLabel(status: PrincipalStatus): string {
  return pick("principal.status", status, status);
}

/** Known audit actions get a sentence; unknown ones are shown as sent (they are stable dotted codes). */
export function actionLabel(action: string): string {
  return pick("audit.action", action, action);
}

export function categoryLabel(category: string): string {
  return pick("audit.category", category, category);
}

export function targetTypeLabel(targetType: string | null): string {
  return targetType ? pick("audit.target", targetType, targetType) : copy["audit.target.none"];
}

export function surfaceLabel(surface: string | null): string {
  return surface ? pick("surface", surface, surface) : copy["common.none"];
}

export function outcomeLabel(outcome: string): string {
  return pick("audit.outcome", outcome, outcome);
}

export function actorLabel(actor: AuditActor | null): string {
  if (!actor) return copy["audit.actor.system"];
  return actor.displayName ?? actor.username ?? copy["audit.actor.deleted"];
}

export function fieldTypeLabel(type: string): string {
  return pick("field.type", type, type);
}

export function visibilityLabel(visibility: string): string {
  return pick("field.visibility", visibility, visibility);
}

export function slugPolicyLabel(policy: AdminContentType["slugPolicy"]): string {
  return pick("type.slugPolicy", policy, policy);
}

export function permissionLabel(action: CmsAction): string {
  return pick("permission", action, action);
}

/** A field label from the schema, else the key made readable ("ownerPrincipalId" → "Owner principal id"). */
export function fieldLabel(field: { key: string; label: string | null }): string {
  if (field.label) return field.label;
  const words = field.key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
