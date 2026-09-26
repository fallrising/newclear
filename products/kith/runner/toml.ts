/**
 * The TOML subset runner.toml needs: comments, [table] / [a.b] headers, key = value with basic "strings"
 * (escapes \" \\ \n \t \uXXXX), 'literal strings', integers, booleans and single-line arrays of those.
 * Anything else is an error with a line number — never a silent default.
 */
export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export type TomlTable = { [key: string]: TomlValue };

export class TomlError extends Error {
  override name = "TomlError";
}

export function parseToml(text: string): TomlTable {
  const root: TomlTable = {};
  let table = root;
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = stripComment(raw).trim();
    const where = `runner.toml line ${i + 1}`;
    if (line === "") return;
    const header = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (header) {
      table = root;
      for (const part of header[1]!.split(".")) {
        const next = table[part];
        if (next === undefined) table[part] = {};
        else if (typeof next !== "object" || Array.isArray(next)) throw new TomlError(`${where}: [${header[1]}] redefines a value`);
        table = table[part] as TomlTable;
      }
      return;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) throw new TomlError(`${where}: expected key = value`);
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new TomlError(`${where}: invalid key`);
    if (key in table) throw new TomlError(`${where}: duplicate key ${key}`);
    const [value, rest] = parseValue(line.slice(eq + 1).trim(), where);
    if (rest.trim() !== "") throw new TomlError(`${where}: unexpected text after value`);
    table[key] = value;
  });
  return root;
}

function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#") return line.slice(0, i);
  }
  return line;
}

function parseValue(src: string, where: string): [TomlValue, string] {
  if (src.startsWith('"')) {
    let out = "";
    for (let i = 1; i < src.length; i++) {
      const ch = src[i]!;
      if (ch === '"') return [out, src.slice(i + 1)];
      if (ch === "\\") {
        const e = src[++i];
        if (e === '"' || e === "\\") out += e;
        else if (e === "n") out += "\n";
        else if (e === "t") out += "\t";
        else if (e === "u" && /^[0-9A-Fa-f]{4}$/.test(src.slice(i + 1, i + 5))) {
          out += String.fromCharCode(parseInt(src.slice(i + 1, i + 5), 16));
          i += 4;
        } else throw new TomlError(`${where}: unsupported escape`);
      } else out += ch;
    }
    throw new TomlError(`${where}: unterminated string`);
  }
  if (src.startsWith("'")) {
    const end = src.indexOf("'", 1);
    if (end < 0) throw new TomlError(`${where}: unterminated string`);
    return [src.slice(1, end), src.slice(end + 1)];
  }
  if (src.startsWith("[")) {
    const items: TomlValue[] = [];
    let rest = src.slice(1).trim();
    while (!rest.startsWith("]")) {
      const [v, after] = parseValue(rest, where);
      if (Array.isArray(v)) throw new TomlError(`${where}: nested arrays are not supported`);
      items.push(v);
      rest = after.trim();
      if (rest.startsWith(",")) rest = rest.slice(1).trim();
      else if (!rest.startsWith("]")) throw new TomlError(`${where}: expected , or ]`);
    }
    return [items, rest.slice(1)];
  }
  const m = /^(true|false|[+-]?\d+)(.*)$/.exec(src);
  if (!m) throw new TomlError(`${where}: unsupported value`);
  const token = m[1]!;
  return [token === "true" ? true : token === "false" ? false : Number(token), m[2]!];
}
