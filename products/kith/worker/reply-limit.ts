export type ReplyLimit = { code: "fixed"; fixed_text: string } | { code: "sidecar_off" } | null;

const FIXED_TEXT_MAX = 120;

export function unicodeScalarLength(value: string): number {
  return [...value].length;
}

/** Secret-free limit for one member. Humans are always null. */
export function replyLimit(input: {
  kind: string;
  quotaClass: string;
  sidecarOn: boolean;
  hasApiKey: boolean;
  fakeText: string | undefined;
}): ReplyLimit {
  if (input.kind !== "agent") {
    return null;
  }
  if (input.quotaClass === "operator_personal") {
    return input.sidecarOn ? null : { code: "sidecar_off" };
  }
  if (input.quotaClass !== "api_key" || input.hasApiKey) {
    return null;
  }
  const text = input.fakeText ?? "";
  if (!text || unicodeScalarLength(text) > FIXED_TEXT_MAX) {
    return null;
  }
  return { code: "fixed", fixed_text: text };
}
