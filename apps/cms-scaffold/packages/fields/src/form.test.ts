// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { WorkContentType } from "@cms/api";
import { fixtures } from "@cms/mocks";
import { diffPayload, toFormValues, toPayload } from "./form";

const note = fixtures.workContentTypes.items.find((t) => t.key === "note")!;

/** Deterministic PRNG (mulberry32) so the property test is reproducible without a new dependency. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPayload(type: WorkContentType, next: () => number): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of type.fields) {
    if (next() < 0.25) continue; // absent
    if (next() < 0.1) {
      payload[field.key] = null;
      continue;
    }
    const n = Math.floor(next() * 1000);
    switch (field.type) {
      case "string":
      case "markdown":
        payload[field.key] = `text ${n}`;
        break;
      case "int":
        payload[field.key] = n - 500;
        break;
      case "boolean":
        payload[field.key] = next() < 0.5;
        break;
      case "enum":
        payload[field.key] = field.enumValues[n % field.enumValues.length];
        break;
      case "datetime":
        payload[field.key] = new Date(Date.UTC(2026, n % 12, 1 + (n % 28), n % 24)).toISOString();
        break;
      case "ref":
      case "media-ref":
        payload[field.key] = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
        break;
      default:
        payload[field.key] = { nested: n, list: [n, "x"] };
    }
  }
  return payload;
}

/** What toPayload must produce: known fields present (absent/null → null, booleans → true/false), unknown fields kept. */
function canonical(type: WorkContentType, payload: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const field of type.fields) {
    const value = payload[field.key];
    if (field.type === "geo") {
      if (value !== undefined) out[field.key] = value;
    } else if (["ref", "media-ref", "principal-ref"].includes(field.type)) {
      if (value !== undefined) out[field.key] = value;
    } else if (field.type === "boolean") out[field.key] = value === null ? null : value === true;
    else out[field.key] = value ?? null;
  }
  return out;
}

describe("form (de)serialization", () => {
  it("V2-AC-06 toPayload(toFormValues(p)) keeps every value and its JSON type (300 random payloads)", () => {
    const next = rng(20260925);
    for (let i = 0; i < 300; i++) {
      const payload = randomPayload(note, next);
      expect(toPayload(note, toFormValues(note, payload))).toEqual(canonical(note, payload));
    }
  });

  it("V2-AC-06 clearing one field sends exactly that key as null; the other keys are not sent", () => {
    const next = rng(7);
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const payload = randomPayload(note, next);
      const initial = toFormValues(note, payload);
      const clearable = note.fields.filter((f) => !["boolean", "geo", "ref", "media-ref", "principal-ref"].includes(f.type) && initial[f.key] !== "");
      if (clearable.length === 0) continue;
      const field = clearable[Math.floor(next() * clearable.length)];
      expect(diffPayload(note, initial, { ...initial, [field.key]: "" })).toEqual({ [field.key]: null });
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("C-05 an object value is not turned into a string and an untouched form sends nothing", () => {
    const payload = { title: "Buy film", priority: 2, pinned: true, location: { lat: 25.03, lng: 121.56 } };
    const values = toFormValues(note, payload);
    expect(values.location).toEqual({ lat: 25.03, lng: 121.56 });
    expect(values.priority).toBe("2");
    expect(diffPayload(note, values, { ...values })).toEqual({});
    expect(diffPayload(note, values, { ...values, priority: "7" })).toEqual({ priority: 7 });
    expect(toPayload(note, values)).toMatchObject({ location: { lat: 25.03, lng: 121.56 }, priority: 2, pinned: true, title: "Buy film" });
  });

  it("C-05 a media-ref stored as {mediaId} retains its original shape", () => {
    const values = toFormValues(note, { attachment: { mediaId: "20000000-0000-4000-8000-000000000001" } });
    expect(values.attachment).toEqual({ mediaId: "20000000-0000-4000-8000-000000000001" });
  });
});
