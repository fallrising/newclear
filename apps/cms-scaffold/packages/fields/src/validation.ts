import { z } from "zod";
import type { FieldError, FieldErrorCode, WorkContentType, WorkField } from "@cms/api";
import type { FieldErrors, Resolver } from "react-hook-form";
import { isEditable, isKnown, type FormValues } from "./form";

// Client-side mirror of the BW1c rules (BW1c §4.3) so the form can mark errors before sending; the server stays
// authoritative and its 422 `error.fields` are shown the same way. Messages are FieldErrorCode values.
const INT = /^-?\d+$/;

/** Match BW1c offset/calendar rules; Date.parse alone normalizes invalid calendar dates. */
function validDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}(?::\d{2})?)$/i.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, zone] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59) return false;
  if (zone.toUpperCase() === "Z") return true;
  const [offsetHour, offsetMinute, offsetSecond = 0] = zone.slice(1).split(":").map(Number);
  return offsetHour <= 18 && offsetMinute <= 59 && offsetSecond <= 59 && (offsetHour < 18 || offsetMinute === 0 && offsetSecond === 0);
}

function fieldSchema(field: WorkField, publish: boolean): z.ZodType {
  if (!isKnown(field)) return z.unknown();
  if (!isEditable(field) || field.type === "boolean") return z.unknown().superRefine((value, ctx) => {
    const empty = value == null || value === "";
    if (empty && publish && field.required) ctx.addIssue({ code: "custom", message: "REQUIRED" });
    else if (!empty && field.type === "boolean" && typeof value !== "boolean") ctx.addIssue({ code: "custom", message: "WRONG_TYPE" });
  });
  return z.string().superRefine((value, ctx) => {
    const fail = (code: FieldErrorCode) => ctx.addIssue({ code: "custom", message: code });
    if (value.trim() === "") {
      if (publish && field.required) fail("REQUIRED");
      return;
    }
    const length = [...value].length;
    if (field.type === "string" && length > 1000) fail("TOO_LONG");
    if (field.type === "markdown" && length > 100000) fail("TOO_LONG");
    if (field.type === "int" && !(INT.test(value.trim()) && Number.isSafeInteger(Number(value)))) fail("WRONG_TYPE");
    if (field.type === "enum" && field.enumValues.length > 0 && !field.enumValues.includes(value)) fail("NOT_IN_ENUM");
    if (field.type === "datetime" && !validDateTime(value)) fail("INVALID_DATETIME");
  });
}

/** `save` checks value formats only (the API accepts empty required fields on save); `publish` adds REQUIRED. */
export function buildZod(type: WorkContentType, mode: "save" | "publish") {
  return z.object(Object.fromEntries(type.fields.map((field) => [field.key, fieldSchema(field, mode === "publish")])));
}

/** react-hook-form resolver for buildZod (no extra dependency). The message of each error is a FieldErrorCode. */
export function zodFormResolver(type: WorkContentType, mode: "save" | "publish"): Resolver<FormValues> {
  const schema = buildZod(type, mode);
  return async (values) => {
    const result = schema.safeParse(values);
    if (result.success) return { values, errors: {} };
    const errors: FieldErrors<FormValues> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0]);
      if (!errors[key]) errors[key] = { type: "validate", message: issue.message };
    }
    return { values: {}, errors };
  };
}

/** BW1c 422 `error.fields` → `{ key, code }` (strips the "payload." prefix; keeps only fields of the type). */
export function serverFieldErrors(type: WorkContentType, fields: FieldError[]): { key: string; code: FieldErrorCode }[] {
  return fields
    .map((f) => ({ key: f.field.replace(/^payload\./, ""), code: f.code }))
    .filter((f) => type.fields.some((field) => field.key === f.key));
}
