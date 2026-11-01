import type { FieldError, FieldErrorCode, ErrorCode } from "@cms/api";
import { db } from "./db";
import { me } from "./fixtures.gen";
import { apiError } from "./respond";

const reserved = new Set(["id", "slug", "contentType", "publicationState", "version", "createdAt", "updatedAt", "publishedAt", "deletedAt", "createdBy", "updatedBy", "payload"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function mediaId(value: unknown): string | null {
  const id = typeof value === "object" && value !== null && "mediaId" in value ? value.mediaId : value;
  if (typeof id !== "string") return null;
  const parts = id.split("-");
  const widths = [8, 4, 4, 4, 12];
  return parts.length === 5 && parts.every((part, i) => /^[0-9a-f]+$/i.test(part) && part.length <= widths[i])
    ? parts.map((part, i) => part.toLowerCase().padStart(widths[i], "0")).join("-") : null;
}

/** ISO offset dates must retain valid calendar components; Date.parse normalizes invalid days. */
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

/** Match BW1c write validation using full field metadata, including disabled/private fields. */
export function validatePayload(type: string, payload: Record<string, unknown>, publish = false) {
  const errors: FieldError[] = [];
  const add = (key: string, code: FieldErrorCode, message: string) => errors.push({ field: `payload.${key}`, code, message });
  for (const key of Object.keys(payload)) if (reserved.has(key)) add(key, "RESERVED_KEY", `Reserved field: ${key}`);
  const fields = [...(db.adminTypes.find((t) => t.key === type)?.fields ?? [])].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  for (const field of fields) {
    const key = field.key, value = payload[key];
    if (errors.some((error) => error.field === `payload.${key}`)) continue;
    if (value == null || typeof value === "string" && value.trim() === "") {
      if (publish && field.required) add(key, "REQUIRED", `Missing required field ${key}`);
      continue;
    }
    const wrongString = () => add(key, "WRONG_TYPE", `${key} must be a string`);
    switch (field.type) {
      case "string": case "markdown": {
        const max = field.type === "string" ? 1000 : 100000;
        if (typeof value !== "string") wrongString();
        else if ([...value].length > max) add(key, "TOO_LONG", `${key} must be at most ${max} characters`);
        break;
      }
      case "int":
        if (typeof value !== "number" || !Number.isInteger(value) || value < -9223372036854775808 || value >= 9223372036854775808) add(key, "WRONG_TYPE", `${key} must be an integer`);
        break;
      case "boolean":
        if (typeof value !== "boolean") add(key, "WRONG_TYPE", `${key} must be boolean`);
        break;
      case "datetime":
        if (typeof value !== "string") wrongString();
        else if (!validDateTime(value)) add(key, "INVALID_DATETIME", `${key} must be an ISO-8601 date-time with offset`);
        break;
      case "enum":
        if (typeof value !== "string") wrongString();
        else if (field.enumValues.length && !field.enumValues.includes(value)) add(key, "NOT_IN_ENUM", `${key} is not a valid enum value`);
        break;
      case "ref": case "principal-ref": {
        if (typeof value !== "string" || !uuid.test(value)) { add(key, "INVALID_UUID", `${key} must be a UUID`); break; }
        if (field.type === "principal-ref") {
          if (!Object.values(me).some((user) => user.principal.id === value)) add(key, "PRINCIPAL_REF_UNRESOLVED", "Principal not found");
        } else {
          const target = db.workEntries.find((entry) => entry.id === value);
          if (!target) add(key, "REF_TARGET_NOT_FOUND", "Referenced entry not found");
          else if (field.refTarget && target.contentType !== field.refTarget) add(key, "REF_TARGET_WRONG_TYPE", "Referenced entry is the wrong type");
        }
        break;
      }
      case "media-ref": if (!mediaId(value)) add(key, "INVALID_UUID", `${key} must be a media UUID`); break;
    }
  }
  if (!errors.length) return null;
  const first = errors[0];
  const code: ErrorCode = ["REF_TARGET_NOT_FOUND", "REF_TARGET_WRONG_TYPE", "PRINCIPAL_REF_UNRESOLVED"].includes(first.code) ? first.code as ErrorCode : "FIELD_VALIDATION";
  return apiError(422, code, `${errors.length} invalid field(s); first: ${first.message}`, errors);
}
