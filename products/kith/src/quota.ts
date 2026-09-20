export type QuotaClass = "api_key" | "operator_personal";

export type WakeGateInput = {
  quota_class: QuotaClass;
  trigger_member_id: string;
  operator_member_id: string;
};

export type WakeGateOk = { ok: true; persistable: true };
export type WakeGateReject = { ok: false; code: "subscription_operator_only"; persistable: true };
export type WakeGateResult = WakeGateOk | WakeGateReject;

/** INV-13: operator_personal wakes only when trigger is the instance operator. Persist is never blocked. */
export function canWake(input: WakeGateInput): WakeGateResult {
  if (input.quota_class === "api_key") {
    return { ok: true, persistable: true };
  }
  if (input.trigger_member_id === input.operator_member_id) {
    return { ok: true, persistable: true };
  }
  return { ok: false, code: "subscription_operator_only", persistable: true };
}
