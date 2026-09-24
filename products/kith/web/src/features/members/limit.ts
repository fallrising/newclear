import type { RoomMember } from "../../api/types";

export type LimitView = { kind: "fixed"; text: string } | { kind: "sidecar_off" } | { kind: "none" };

export function limitView(member: RoomMember, viewerIsOperator: boolean): LimitView {
  const limit = member.reply_limit;
  if (limit?.code === "fixed") return { kind: "fixed", text: limit.fixed_text };
  if (!viewerIsOperator && member.quota_class === "operator_personal") return { kind: "none" };
  if (limit?.code === "sidecar_off") return { kind: "sidecar_off" };
  return { kind: "none" };
}

export function showsOperatorOnly(member: RoomMember, viewerIsOperator: boolean): boolean {
  return !viewerIsOperator && member.kind === "agent" && member.quota_class === "operator_personal";
}
