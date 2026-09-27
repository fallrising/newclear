import type { RoomMember, RuntimeStatus } from "../../api/types";

export type LimitView =
  | { kind: "fixed"; text: string }
  | { kind: "sidecar_off" }
  | { kind: "runtime"; status: Exclude<RuntimeStatus, "ok"> }
  | { kind: "external" }
  | { kind: "none" };

export function limitView(member: RoomMember, viewerIsOperator: boolean): LimitView {
  const runtime = member.agent_runtime;
  if (member.kind === "agent" && runtime && runtime.runtime !== null) {
    if (!viewerIsOperator && member.quota_class === "operator_personal") return { kind: "none" };
    if (runtime.runtime_status !== "ok") return { kind: "runtime", status: runtime.runtime_status };
    if (runtime.runtime === "external") return { kind: "external" };
    return { kind: "none" };
  }
  const limit = member.reply_limit;
  if (limit?.code === "fixed") return { kind: "fixed", text: limit.fixed_text };
  if (!viewerIsOperator && member.quota_class === "operator_personal") return { kind: "none" };
  if (limit?.code === "sidecar_off") return { kind: "sidecar_off" };
  return { kind: "none" };
}

export function showsOperatorOnly(member: RoomMember, viewerIsOperator: boolean): boolean {
  return !viewerIsOperator && member.kind === "agent" && member.quota_class === "operator_personal";
}
