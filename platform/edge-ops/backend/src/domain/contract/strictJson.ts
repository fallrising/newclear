// Strict JSON profile shared by every Edge Ops wire object (contracts/README.md#strict-json).
// Mirrors agent/internal/contract/strictjson.go; both are checked against
// contracts/vectors/strict-json.json, so behaviour changes need a contract PR.

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

export type StrictJsonCode =
  | "too_large"
  | "invalid_utf8"
  | "bom"
  | "syntax"
  | "duplicate_key"
  | "depth"
  | "non_integer_number"
  | "non_canonical_number"
  | "integer_out_of_range"
  | "lone_surrogate"
  | "trailing_data";

export class StrictJsonError extends Error {
  readonly code: StrictJsonCode;
  constructor(code: StrictJsonCode, message: string) {
    super(message);
    this.name = "StrictJsonError";
    this.code = code;
  }
}

export const STRICT_JSON_MAX_DEPTH = 32;

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function parseStrictJson(bytes: Uint8Array, maxBytes: number): JsonValue {
  if (bytes.length > maxBytes) throw new StrictJsonError("too_large", `body exceeds ${maxBytes} bytes`);
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    throw new StrictJsonError("invalid_utf8", "body is not valid UTF-8");
  }
  if (text.charCodeAt(0) === 0xfeff) throw new StrictJsonError("bom", "byte order mark is not allowed");
  const p = new Parser(text);
  p.ws();
  const value = p.value(0);
  p.ws();
  if (p.i !== text.length) throw new StrictJsonError("trailing_data", "unexpected data after JSON value");
  return value;
}

export function isJsonObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

class Parser {
  readonly s: string;
  i = 0;
  constructor(s: string) {
    this.s = s;
  }

  ws(): void {
    while (this.i < this.s.length) {
      const c = this.s.charCodeAt(this.i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.i++;
      else break;
    }
  }

  fail(msg: string): never {
    throw new StrictJsonError("syntax", `${msg} at offset ${this.i}`);
  }

  value(depth: number): JsonValue {
    const c = this.s[this.i];
    switch (c) {
      case "{":
        return this.object(depth + 1);
      case "[":
        return this.array(depth + 1);
      case '"':
        return this.string();
      case "t":
        return this.literal("true", true);
      case "f":
        return this.literal("false", false);
      case "n":
        return this.literal("null", null);
      default:
        if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) return this.number();
        return this.fail("unexpected character");
    }
  }

  literal<T extends JsonValue>(word: string, v: T): T {
    if (this.s.startsWith(word, this.i)) {
      this.i += word.length;
      return v;
    }
    return this.fail("invalid literal");
  }

  object(depth: number): JsonObject {
    if (depth > STRICT_JSON_MAX_DEPTH) throw new StrictJsonError("depth", "nesting too deep");
    this.i++;
    const out: JsonObject = Object.create(null);
    const seen = new Set<string>();
    this.ws();
    if (this.s[this.i] === "}") {
      this.i++;
      return out;
    }
    for (;;) {
      this.ws();
      if (this.s[this.i] !== '"') this.fail("expected object key");
      const key = this.string();
      if (seen.has(key)) throw new StrictJsonError("duplicate_key", `duplicate key ${JSON.stringify(key)}`);
      seen.add(key);
      this.ws();
      if (this.s[this.i] !== ":") this.fail("expected ':'");
      this.i++;
      this.ws();
      out[key] = this.value(depth);
      this.ws();
      const c = this.s[this.i];
      if (c === ",") {
        this.i++;
        continue;
      }
      if (c === "}") {
        this.i++;
        return out;
      }
      this.fail("expected ',' or '}'");
    }
  }

  array(depth: number): JsonValue[] {
    if (depth > STRICT_JSON_MAX_DEPTH) throw new StrictJsonError("depth", "nesting too deep");
    this.i++;
    const out: JsonValue[] = [];
    this.ws();
    if (this.s[this.i] === "]") {
      this.i++;
      return out;
    }
    for (;;) {
      this.ws();
      out.push(this.value(depth));
      this.ws();
      const c = this.s[this.i];
      if (c === ",") {
        this.i++;
        continue;
      }
      if (c === "]") {
        this.i++;
        return out;
      }
      this.fail("expected ',' or ']'");
    }
  }

  string(): string {
    this.i++; // opening quote
    let out = "";
    for (;;) {
      if (this.i >= this.s.length) this.fail("unterminated string");
      const c = this.s.charCodeAt(this.i);
      if (c === 0x22) {
        this.i++;
        return out;
      }
      if (c < 0x20) this.fail("control character in string");
      if (c !== 0x5c) {
        out += this.s[this.i];
        this.i++;
        continue;
      }
      this.i++;
      const e = this.s[this.i];
      this.i++;
      switch (e) {
        case '"':
          out += '"';
          break;
        case "\\":
          out += "\\";
          break;
        case "/":
          out += "/";
          break;
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "u": {
          const u = this.hex4();
          if (u >= 0xdc00 && u <= 0xdfff) throw new StrictJsonError("lone_surrogate", "unpaired low surrogate");
          if (u >= 0xd800 && u <= 0xdbff) {
            if (this.s[this.i] !== "\\" || this.s[this.i + 1] !== "u") {
              throw new StrictJsonError("lone_surrogate", "unpaired high surrogate");
            }
            this.i += 2;
            const lo = this.hex4();
            if (lo < 0xdc00 || lo > 0xdfff) throw new StrictJsonError("lone_surrogate", "unpaired high surrogate");
            out += String.fromCharCode(u, lo);
          } else {
            out += String.fromCharCode(u);
          }
          break;
        }
        default:
          this.i--;
          this.fail("invalid escape");
      }
    }
  }

  hex4(): number {
    const h = this.s.slice(this.i, this.i + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(h)) this.fail("invalid \\u escape");
    this.i += 4;
    return parseInt(h, 16);
  }

  number(): number {
    const start = this.i;
    if (this.s[this.i] === "-") this.i++;
    const digitsStart = this.i;
    if (this.s[this.i] === "0") {
      this.i++;
    } else if (this.s[this.i] !== undefined && this.s[this.i]! >= "1" && this.s[this.i]! <= "9") {
      while (isDigit(this.s[this.i])) this.i++;
    } else {
      this.fail("invalid number");
    }
    let fractional = false;
    if (this.s[this.i] === ".") {
      fractional = true;
      this.i++;
      if (!isDigit(this.s[this.i])) this.fail("invalid fraction");
      while (isDigit(this.s[this.i])) this.i++;
    }
    if (this.s[this.i] === "e" || this.s[this.i] === "E") {
      fractional = true;
      this.i++;
      if (this.s[this.i] === "+" || this.s[this.i] === "-") this.i++;
      if (!isDigit(this.s[this.i])) this.fail("invalid exponent");
      while (isDigit(this.s[this.i])) this.i++;
    }
    // Leading zeros such as 01 are a grammar error, caught by the caller seeing a digit.
    if (isDigit(this.s[this.i])) this.fail("invalid number");
    if (fractional) throw new StrictJsonError("non_integer_number", "only integers are allowed");
    const lit = this.s.slice(start, this.i);
    if (lit === "-0") throw new StrictJsonError("non_canonical_number", "-0 is not allowed");
    // Compare by digit count first so huge literals never reach floating point.
    const digits = this.i - digitsStart;
    if (digits > 16 || Math.abs(Number(lit)) > Number.MAX_SAFE_INTEGER) {
      throw new StrictJsonError("integer_out_of_range", "integer outside ±(2^53-1)");
    }
    return Number(lit);
  }
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}
